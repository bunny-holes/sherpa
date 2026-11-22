/**
 * One turn's model call (ADR-0012 "스트리밍", "재시도", "도구"; app-connection-v1 §7.11): the only
 * module that hands the AI SDK a model. It reads the `stream` of `streamText` and tells its caller
 * the answer's text, each output, the finished steps the conversation keeps, and how the call
 * ended; the tools the model calls run through the turn's calls (src/chat/calls.ts), and the
 * conversation's limit holds through the turn's room (src/chat/conversation.ts).
 */
import {
  AISDKError,
  APICallError,
  type FinishReason,
  InvalidMessageRoleError,
  InvalidPromptError,
  isStepCount,
  type JSONValue,
  MessageConversionError,
  MissingToolResultsError,
  type ModelMessage,
  RetryError,
  StreamProviderError,
  streamText,
  type ToolCallPart,
  type ToolContent,
  type ToolModelMessage,
  type ToolResultPart,
  wrapLanguageModel,
} from "ai";
import type { ModelTool } from "../../tools/call.ts";
import type { ToolOutcome } from "../../tools/outcome.ts";
import type { TurnRoom } from "../conversation.ts";
import { EgressDeniedError, type Fetch } from "../egress.ts";
import { ChatFailure, isTransportError, responseFailure, transportFailure } from "../errors.ts";
import { StateTooLarge } from "../state.ts";
import { answerLimit } from "./answer.ts";
import { type TurnTarget, turnProvider } from "./provider.ts";
import { type ToolRunner, toolSet } from "./tools.ts";

/**
 * The AI SDK sends one model request again at most twice, and only before its response streams
 * (§7.11). Named here so that a later SDK default does not change the contract; `streamRetries`
 * stays unset, since setting it, even to 0, lets `onError` run a step again.
 */
const MODEL_RETRIES = 2;

export type { TurnTarget };

/** The tool calls of one turn, as the model call needs them (src/chat/calls.ts). */
export interface TurnTools extends ToolRunner {
  readonly tools: readonly ModelTool[];
  /** The AI SDK refused a call before it ran: a tool the core does not have, or bad arguments. */
  invalid(name: string): void;
  /** What the model reads of a call the AI SDK did not run. */
  unrun(name: string): ToolOutcome;
  /** The AI SDK did not run a call: its step ended first. */
  notRun(name: string): void;
  /** A step ended, its calls with it. */
  stepEnded(): void;
  /** The person cancelled while a step's calls ran: the turn takes no later step. */
  readonly cancelled: boolean;
}

export interface TurnCall {
  target: TurnTarget;
  /** The conversation, which ends with what the model answers: the person's text or tool results. */
  messages: ModelMessage[];
  /** The turn's fetch, which sends through the egress. */
  fetch: Fetch;
  /** Ends the call: the person cancelled, the channel closed, or a request went without output. */
  signal: AbortSignal;
  /** Between two outputs of one model response (§7.11). */
  chunkMs: number;
  /** Model requests the turn may make (§7.11). */
  steps: number;
  /** What the conversation's limit leaves the turn (§7.11 "대화 한도"). */
  room: TurnRoom;
  tools: TurnTools;
}

export interface TurnHooks {
  /** The model produced output: text, reasoning, a tool call or its input, a file. */
  output(): void;
  /** A piece of the answer's text. */
  text(text: string): void;
  /**
   * The messages of a step that finished, which the conversation keeps: what writes the
   * conversation's state then, or `null` when the state would not fit one `data`, after which
   * no step follows.
   */
  step(messages: ModelMessage[]): (() => void) | null;
}

export type TurnOutcome =
  | {
      type: "finished";
      reason: FinishReason;
      inputTokens: number | undefined;
      outputTokens: number | undefined;
      steps: number;
      /** The last step called tools, so no answer followed it: the loop stopped there. */
      calledTools: boolean;
    }
  /** `signal` ended the call. */
  | { type: "aborted"; steps: number }
  | { type: "failed"; failure: ChatFailure; error: unknown; steps: number };

// A step that ended in an error, broke off or was refused leaves nothing in the conversation
// (ADR-0012 "상태를 넘기는 때"): Anthropic says to treat the output before a refusal as incomplete.
// `interrupted` is a stream that closed before the provider said it finished.
const DROPPED: ReadonlySet<FinishReason> = new Set<FinishReason>([
  "error",
  "interrupted",
  "content-filter",
]);

/**
 * The finish reasons after which the AI SDK runs a step's calls (ai 7.0.179
 * is-tool-execution-allowed-finish-reason.ts, which the package does not export). The turn takes
 * no step after any other.
 */
const RUNS_CALLS: ReadonlySet<FinishReason> = new Set<FinishReason>(["stop", "tool-calls"]);

/**
 * A step's messages with a result for each call the AI SDK left without one, which `unrun` gives,
 * in the order of the calls. The SDK runs a step's calls only when the step ended with `stop` or
 * `tool-calls`, and refuses to send a conversation that holds a call without its result (ai
 * 7.0.179 execute-tools-from-stream.ts, convert-to-language-model-prompt.ts): without one, every
 * later turn of the chat would fail before its request.
 */
function answered(
  messages: ModelMessage[],
  unrun: (call: ToolCallPart) => ToolOutcome,
): ModelMessage[] {
  const results = new Set(
    messages.flatMap((message) =>
      message.role === "tool"
        ? message.content.flatMap((part) => (part.type === "tool-result" ? [part.toolCallId] : []))
        : [],
    ),
  );
  const calls = messages.flatMap((message) =>
    message.role === "assistant" && typeof message.content !== "string"
      ? message.content.filter(
          (part): part is ToolCallPart =>
            part.type === "tool-call" && part.providerExecuted !== true,
        )
      : [],
  );
  const missing = calls.filter((call) => !results.has(call.toolCallId));
  if (missing.length === 0) return messages;
  const added = missing.map((call): ToolResultPart => ({
    type: "tool-result",
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    // As the SDK gives the model a call's result (ai 7.0.179 create-tool-model-output.ts).
    output: { type: "json", value: JSON.parse(JSON.stringify(unrun(call))) as JSONValue },
  }));
  const at = messages.findIndex((message) => message.role === "tool");
  if (at === -1) return [...messages, { role: "tool", content: added }];
  const order = new Map(calls.map((call, index) => [call.toolCallId, index]));
  const rank = (part: ToolContent[number]) =>
    part.type === "tool-result" ? (order.get(part.toolCallId) ?? -1) : -1;
  const tool = messages[at] as ToolModelMessage;
  return messages.with(at, {
    ...tool,
    content: [...tool.content, ...added].sort((a, b) => rank(a) - rank(b)),
  });
}

/** How an error the AI SDK passed on reads as a chat error. */
function failureOf(error: unknown): ChatFailure {
  if (error instanceof ChatFailure) return error;
  if (RetryError.isInstance(error)) return failureOf(error.lastError);
  if (APICallError.isInstance(error)) {
    // No status: the request got no response, and the cause is what Bun's fetch threw.
    if (error.statusCode !== undefined) return responseFailure(error.statusCode);
    return isTransportError(error.cause)
      ? transportFailure(error.cause)
      : new ChatFailure("network");
  }
  if (error instanceof EgressDeniedError) return new ChatFailure("egress_denied");
  if (error instanceof Error && error.name === "TimeoutError") return new ChatFailure("timeout");
  if (isTransportError(error)) return transportFailure(error);
  // An error the provider sent in a response that had begun to stream, read by the HTTP status
  // its kind names as the provider's package gives it (Anthropic's `overloaded_error` is 529).
  if (StreamProviderError.isInstance(error)) {
    if (error.statusCode !== undefined) return responseFailure(error.statusCode);
    return new ChatFailure(error.isRetryable ? "provider_unavailable" : "provider_rejected");
  }
  // A prompt the core built that the SDK refuses before any request: the core's defect, not the
  // provider's (ai 7.0.179 convert-to-language-model-prompt.ts).
  if (
    MissingToolResultsError.isInstance(error) ||
    InvalidPromptError.isInstance(error) ||
    InvalidMessageRoleError.isInstance(error) ||
    MessageConversionError.isInstance(error)
  ) {
    return new ChatFailure("internal");
  }
  // The provider answered, but not in a shape its package reads.
  if (AISDKError.isInstance(error)) return new ChatFailure("provider_invalid_response");
  return new ChatFailure("internal");
}

/** One turn's model call; it never throws, since every way it ends is an outcome. */
export async function streamTurn(call: TurnCall, hooks: TurnHooks): Promise<TurnOutcome> {
  const calls = call.tools;
  let steps = 0;
  let calledTools = false;
  /**
   * What each step the conversation kept tells the app, by the step's number, once this loop has
   * read the step's end: after the step's text, before the next step's parts. The SDK calls
   * `onStepEnd` once it has passed the step's end on, which this loop may read before or after
   * (ai 7.0.179 stream-text.ts). The calls of the step the SDK did not run come first, then the
   * conversation's state, which holds their results; `write` is `null` for a state that would
   * not fit one `data`.
   */
  const ended: { step: number; unrun: string[]; write: (() => void) | null }[] = [];
  let read = 0;
  let stateFailed = false;
  const tell = ({ unrun, write }: (typeof ended)[number]) => {
    for (const name of unrun) calls.notRun(name);
    write?.();
  };
  const tellEnded = () => {
    while (ended.length > 0 && ended[0]!.step <= read) tell(ended.shift()!);
  };
  let failed: { failure: ChatFailure; error: unknown } | null = null;
  let timedOut = false;
  let finish: {
    reason: FinishReason;
    inputTokens: number | undefined;
    outputTokens: number | undefined;
  } | null = null;
  try {
    const { model, instructions, providerOptions } = turnProvider(call.target, call.fetch);
    const result = streamText({
      // Each response counts against the conversation's limit as it streams, and is cut past it.
      model: wrapLanguageModel({ model, middleware: answerLimit(call.room) }),
      instructions,
      messages: call.messages,
      providerOptions,
      // The SDK runs a step's calls once the model's response has ended, and only when it ended
      // with `stop` or `tool-calls` (ai 7.0.179 execute-tools-from-stream.ts); a call it did not
      // run reads `chat.not_run` (`answered`).
      ...(calls.tools.length > 0 ? { tools: toolSet(calls.tools, calls) } : {}),
      // One call at a time: the app shows one confirmation window at a time (§9), and a window
      // that waited behind another call would have spent its 30 s.
      toolCallConcurrency: 1,
      stopWhen: [
        isStepCount(call.steps),
        () => calls.cancelled,
        // The turn passed the conversation's limit: it refused a call, or kept a step past it.
        () => call.room.passed,
        // The state of a step it kept would not fit one `data`.
        () => stateFailed,
        // The SDK takes the next step once each call of a step has a result, an error for one it
        // refused included, whatever the step ended with (ai 7.0.179 stream-text.ts
        // `shouldStartNextStep`), though its `StopCondition` says it stops after a finish reason
        // other than `tool-calls`. A call cut at the length limit would be cut again.
        ({ steps }) => !RUNS_CALLS.has(steps.at(-1)!.finishReason),
      ],
      abortSignal: call.signal,
      maxRetries: MODEL_RETRIES,
      // No `toolMs`: it would only abort a call's signal, and every tool has its own limit
      // (ADR-0012 "재시도").
      timeout: { chunkMs: call.chunkMs },
      // Errors reach the stream below as `error` parts; the SDK's own handler would write the
      // whole error, the request body with the person's text included, to standard error.
      onError: () => {},
      onStepEnd: (step) => {
        steps += 1;
        calledTools = step.toolCalls.length > 0;
        calls.stepEnded();
        if (DROPPED.has(step.finishReason)) return;
        const unrun: string[] = [];
        const messages = answered(step.response.messages, (toolCall) => {
          unrun.push(toolCall.toolName);
          return calls.unrun(toolCall.toolName);
        });
        // A step that passes the limit stays, as its calls ran; no request follows it, and its
        // state says the chat is full.
        call.room.keep(messages);
        const write = hooks.step(messages);
        if (write === null) stateFailed = true;
        ended.push({ step: steps, unrun, write });
        tellEnded();
      },
    });
    for await (const part of result.stream) {
      switch (part.type) {
        case "text-delta":
          if (part.text.length > 0) {
            hooks.output();
            hooks.text(part.text);
          }
          break;
        case "reasoning-delta":
          // Reasoning stays in the conversation, which reaches the app only in a state it does
          // not read (ADR-0012 "스트리밍").
          if (part.text.length > 0) hooks.output();
          break;
        case "tool-input-delta":
          if (part.delta.length > 0) hooks.output();
          break;
        case "tool-call":
        case "file":
        case "reasoning-file":
          hooks.output();
          break;
        case "tool-error":
          // A call the SDK refused before it ran, whose error the model reads as its result
          // (ai 7.0.179 stream-language-model-call.ts): the turn's own calls never throw.
          calls.invalid(part.toolName);
          break;
        case "error":
          failed ??= { failure: failureOf(part.error), error: part.error };
          break;
        case "abort":
          // Not the turn's own signal: the SDK's limit between two outputs.
          if (!call.signal.aborted) timedOut = true;
          break;
        case "finish-step":
          read += 1;
          tellEnded();
          break;
        case "finish":
          finish = {
            reason: part.finishReason,
            inputTokens: part.totalUsage.inputTokens,
            outputTokens: part.totalUsage.outputTokens,
          };
          break;
      }
    }
  } catch (error) {
    failed ??= { failure: failureOf(error), error };
  }
  // A stream that ended early left the last steps' ends unread: what they tell goes now. The app
  // hears of a call the SDK did not run after the text before it, however far the SDK's step ran
  // ahead of this loop, and before the turn's end. No step follows one with such a call
  // (`RUNS_CALLS`).
  for (const entry of ended.splice(0)) tell(entry);
  // A state that does not fit is the core's defect, however else the turn ended.
  if (stateFailed) {
    return {
      type: "failed",
      failure: new ChatFailure("internal"),
      error: new StateTooLarge(),
      steps,
    };
  }
  if (call.signal.aborted) return { type: "aborted", steps };
  if (timedOut) return { type: "failed", failure: new ChatFailure("timeout"), error: null, steps };
  if (failed) return { type: "failed", ...failed, steps };
  // Past the conversation's limit with no error in the stream: a call refused, or a step kept.
  if (call.room.passed) {
    return { type: "failed", failure: new ChatFailure("conversation_limit"), error: null, steps };
  }
  // The stream closed before the provider said the answer finished, as a connection that breaks.
  if (finish?.reason === "interrupted") {
    return { type: "failed", failure: new ChatFailure("network"), error: null, steps };
  }
  if (finish === null || finish.reason === "error") {
    return {
      type: "failed",
      failure: new ChatFailure("provider_invalid_response"),
      error: null,
      steps,
    };
  }
  return { type: "finished", ...finish, steps, calledTools };
}
