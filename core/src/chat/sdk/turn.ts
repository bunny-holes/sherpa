/**
 * One turn's model call (ADR-0012 "스트리밍", "재시도"; app-connection-v1 §7.11): the only module that
 * hands the AI SDK a model. It reads the `stream` of `streamText` and tells its caller the answer's
 * text, each output, the finished steps the conversation keeps, and how the call ended.
 */
import {
  AISDKError,
  APICallError,
  type FinishReason,
  type ModelMessage,
  RetryError,
  StreamProviderError,
  streamText,
} from "ai";
import { EgressDeniedError, type Fetch } from "../egress.ts";
import { ChatFailure, isTransportError, responseFailure, transportFailure } from "../errors.ts";
import { type TurnTarget, turnProvider } from "./provider.ts";

/**
 * The AI SDK sends one model request again at most twice, and only before its response streams
 * (§7.11). Named here so that a later SDK default does not change the contract; `streamRetries`
 * stays unset, since setting it, even to 0, lets `onError` run a step again.
 */
const MODEL_RETRIES = 2;

export type { TurnTarget };

export interface TurnCall {
  target: TurnTarget;
  /** The conversation, the person's text of this turn last. */
  messages: ModelMessage[];
  /** The turn's fetch, which sends through the egress. */
  fetch: Fetch;
  /** Ends the call: the person cancelled, the channel closed, or a request went without output. */
  signal: AbortSignal;
  /** Between two outputs of one model response (§7.11). */
  chunkMs: number;
}

export interface TurnHooks {
  /** The model produced output: text, reasoning, a tool call or its input, a file. */
  output(): void;
  /** A piece of the answer's text. */
  text(text: string): void;
  /** The messages of a step that finished, which the conversation keeps. */
  step(messages: ModelMessage[]): void;
}

export type TurnOutcome =
  | {
      type: "finished";
      reason: FinishReason;
      inputTokens: number | undefined;
      outputTokens: number | undefined;
      steps: number;
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
  // The provider answered, but not in a shape its package reads.
  if (AISDKError.isInstance(error)) return new ChatFailure("provider_invalid_response");
  return new ChatFailure("internal");
}

/** One turn's model call; it never throws, since every way it ends is an outcome. */
export async function streamTurn(call: TurnCall, hooks: TurnHooks): Promise<TurnOutcome> {
  let steps = 0;
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
      model,
      instructions,
      messages: call.messages,
      providerOptions,
      abortSignal: call.signal,
      maxRetries: MODEL_RETRIES,
      timeout: { chunkMs: call.chunkMs },
      // Errors reach the stream below as `error` parts; the SDK's own handler would write the
      // whole error, the request body with the person's text included, to standard error.
      onError: () => {},
      onStepEnd: (step) => {
        steps += 1;
        if (!DROPPED.has(step.finishReason)) hooks.step(step.response.messages);
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
          // Reasoning stays in the conversation and never reaches the app (ADR-0012 "스트리밍").
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
        case "error":
          failed ??= { failure: failureOf(part.error), error: part.error };
          break;
        case "abort":
          // Not the turn's own signal: the SDK's limit between two outputs.
          if (!call.signal.aborted) timedOut = true;
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
  if (call.signal.aborted) return { type: "aborted", steps };
  if (timedOut) return { type: "failed", failure: new ChatFailure("timeout"), error: null, steps };
  if (failed) return { type: "failed", ...failed, steps };
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
  return { type: "finished", ...finish, steps };
}
