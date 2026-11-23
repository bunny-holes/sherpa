/**
 * One chat turn from the core's side (app-connection-v1 §7.11, ADR-0012 "스트리밍", "중단",
 * "재시도", "도구", "상태를 넘기는 때"): the answer's text in `delta` events, each tool call in
 * `tool` events, the conversation's `state` each time it changes, then one `done` or `error`.
 * The AI SDK and the providers load with the first turn (src/chat/load.ts); this module takes only
 * their types.
 *
 * A model request that goes `firstOutputMs` without output ends the turn. The turn has one such
 * limit, which every request the AI SDK sends starts anew. It stops at the request's first
 * output, when its fetch fails, or once the head of an answer that is not 2xx has come in, and
 * for good when the turn ends, is cancelled or loses its channel. So the wait after a failure
 * status is not under it, while the wait after a 2xx stream that reported an error before its
 * first output stays under it until the next request starts it anew. The SDK's own
 * `firstChunkMs` would start only once the response streams, which leaves the wait for its
 * headers open, and for OpenAI the wait for `response.in_progress` as well.
 */
import type { ModelMessage } from "ai";
import { log } from "../log.ts";
import type { ModelTool } from "../tools/call.ts";
import { TurnCalls } from "./calls.ts";
import type { Fetch } from "./egress.ts";
import { ChatFailure } from "./errors.ts";
import { loadChat } from "./load.ts";
import type { PendingChange } from "./pending.ts";
import { type ChatEvent, type DoneReason, errorEvent, type TurnAnswer } from "./protocol.ts";
import type { TurnCall, TurnOutcome } from "./sdk/turn.ts";
import { StateTooLarge } from "./state.ts";

/** The limits of one turn (§7.11); tests shorten them. */
export interface TurnLimits {
  firstOutputMs: number;
  chunkMs: number;
  deltaMs: number;
  deltaBytes: number;
  failureBodyBytes: number;
  steps: number;
}

/** The bytes of one code point in UTF-8; a lone surrogate goes out as U+FFFD. */
function utf8Bytes(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  return codePoint < 0x10000 ? 3 : 4;
}

/**
 * The answer's text in `delta` events: a piece waits at most `ms` for more, and none carries more
 * than `bytes`, cut between code points.
 */
class Deltas {
  private text = "";
  private bytes = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly send: (event: ChatEvent) => void,
    private readonly ms: number,
    private readonly most: number,
  ) {}

  add(text: string): void {
    this.text += text;
    this.bytes += Buffer.byteLength(text);
    while (this.bytes >= this.most) this.cut();
    if (this.text !== "") this.timer ??= setTimeout(() => this.flush(), this.ms);
  }

  /** Sends what waits. */
  flush(): void {
    this.stop();
    if (this.text !== "") this.send({ type: "delta", text: this.text });
    this.text = "";
    this.bytes = 0;
  }

  /** Drops what waits: nobody reads it. */
  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Sends the longest head of the waiting text that fits one `delta`. */
  private cut(): void {
    let bytes = 0;
    let end = 0;
    for (const char of this.text) {
      const size = utf8Bytes(char.codePointAt(0)!);
      if (bytes + size > this.most) break;
      bytes += size;
      end += char.length;
    }
    this.send({ type: "delta", text: this.text.slice(0, end) });
    this.text = this.text.slice(end);
    this.bytes -= bytes;
  }
}

/** At most `most` bytes of a body, the rest left unread. */
async function headOf(response: Response, most: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < most) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel();
  return Buffer.concat(chunks).subarray(0, most);
}

/**
 * The turn's fetch, which ends the turn when a request goes `firstOutputMs` without output. An
 * answer that is not 2xx is read here, its first `failureBodyBytes`, while the limit still
 * runs; the AI SDK reads the copy, and the wait before it sends again runs without a limit. The
 * limit stops for good when `signal` aborts: the turn was cancelled, timed out or lost its
 * channel.
 */
function watched(
  fetch: Fetch,
  signal: AbortSignal,
  limits: TurnLimits,
  silent: () => void,
): { fetch: Fetch; output: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const quiet = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  signal.addEventListener("abort", quiet, { once: true });
  const send = async (input: string | URL | Request, init?: BunFetchRequestInit) => {
    quiet();
    if (!signal.aborted) timer = setTimeout(silent, limits.firstOutputMs);
    try {
      const response = await fetch(input, init);
      if (response.ok) return response;
      const body = await headOf(response, limits.failureBodyBytes);
      quiet();
      const { status, statusText, headers } = response;
      return new Response(body, { status, statusText, headers });
    } catch (error) {
      quiet();
      throw error;
    }
  };
  return { fetch: Object.assign(send, { preconnect: fetch.preconnect }), output: quiet };
}

/**
 * What a `done` names: the AI SDK's finish reason, the ones `done` does not name read as `other`.
 * A loop that stopped after a step that called tools had no answer: the person cancelled while
 * they ran, or the turn reached its step limit. A step cut at the length limit or refused says so
 * even with a call in it, which did not run.
 */
function doneReason(
  outcome: Extract<TurnOutcome, { type: "finished" }>,
  limit: number,
  cancelled: boolean,
): DoneReason {
  const { reason } = outcome;
  if (reason === "length" || reason === "content-filter") return reason;
  if (outcome.calledTools) {
    if (cancelled) return "aborted";
    return outcome.steps >= limit ? "step-limit" : "other";
  }
  return reason === "stop" ? reason : "other";
}

const count = (tokens: number | undefined) => tokens ?? null;
const errorType = (error: unknown) => (error instanceof Error ? error.name : typeof error);

export interface TurnContext {
  /** The channel's number, for the log. */
  channel: number;
  /** The provider's name, for the log. */
  provider: string;
  /** The turn's fetch through the egress, stopped by the turn's signal. */
  fetch: (signal: AbortSignal) => Fetch;
  /** Writes a `delta` on the channel. */
  send: (event: ChatEvent) => void;
  /** Ends when the channel closes. */
  ended: AbortSignal;
  limits: TurnLimits;
  /** The core's tools, once their discovery has settled (§10.1). */
  tools: () => Promise<readonly ModelTool[]>;
  /** The channel's next call number, from 1. */
  callNumber: () => number;
}

/** What a turn needs of its chat's conversation (src/chat/session.ts). */
export interface TurnChat {
  /** The turn added the person's text: the conversation changed before the first request. */
  said: boolean;
  /** Keeps the messages of a step that finished. */
  keep(messages: ModelMessage[]): void;
  /** Records the change whose command will run after the pending state is written. */
  commit(change: PendingChange): void;
  /**
   * The conversation's `state` as it stands: whether it says the chat is full, and what writes it
   * once what comes before it is out; or `null` when it would not fit one `data` (§7.4).
   */
  state(fingerprint: string): { full: boolean; write(): Promise<boolean> } | null;
}

/**
 * One turn: its answer goes out as `delta` events, and `run` resolves the `done` or `error` that
 * ends it, which the session sends with its `resend`.
 */
export class ChatTurn {
  private readonly stopped = new AbortController();
  private cancelled = false;
  private silent = false;
  private calls: TurnCalls | null = null;

  constructor(private readonly context: TurnContext) {}

  /**
   * The person stopped the turn: it ends with `done` `aborted`. While a step's calls run, they
   * end as the calls say (src/chat/calls.ts), the step stays in the conversation and no other
   * follows; until the first call of a step starts, the model request stops at once and its step
   * leaves nothing, no tool of it having run.
   */
  cancel(): void {
    this.cancelled = true;
    if (this.calls?.inStep) {
      this.calls.cancel();
      return;
    }
    this.stopped.abort(new DOMException("The person cancelled the turn.", "AbortError"));
  }

  /**
   * Runs the turn. Resolves its `done` or `error`, or `null` when the channel closed first.
   * The messages of each step that finished go to the chat as it finishes, and the
   * conversation's `state` goes out once the person's text is in it and after each step it
   * keeps, after the text before it, and once more when the turn filled the chat and no `state`
   * said so: `done` and `error` come after the turn's last `state`.
   */
  async run(
    call: Omit<TurnCall, "fetch" | "signal" | "chunkMs" | "steps" | "tools">,
    chat: TurnChat,
  ): Promise<TurnAnswer | null> {
    const { channel, provider, limits } = this.context;
    const fields = `channel=${channel} provider=${provider}`;
    const started = Date.now();
    const signal = AbortSignal.any([this.context.ended, this.stopped.signal]);
    const deltas = new Deltas(this.context.send, limits.deltaMs, limits.deltaBytes);
    const requests = watched(this.context.fetch(signal), signal, limits, () => {
      this.silent = true;
      this.stopped.abort(
        new DOMException(`No output for ${limits.firstOutputMs} ms.`, "TimeoutError"),
      );
    });
    log.info(`[core:chat:turn] start ${fields}`);
    let outcome: TurnOutcome;
    try {
      const [sdk, tools] = await Promise.all([loadChat(), this.context.tools()]);
      const fingerprint = await sdk.state.fingerprint(tools);
      // A `state` of the turn said the chat is full, or one would not fit.
      let toldFull = false;
      let stateFailed = false;
      const state = () => {
        if (stateFailed) return null;
        const made = chat.state(fingerprint);
        if (made === null) {
          stateFailed = true;
          return null;
        }
        if (made.full) toldFull = true;
        return async () => {
          // The channel closed: nothing more goes out.
          if (this.context.ended.aborted) return false;
          deltas.flush();
          return made.write();
        };
      };
      const calls = new TurnCalls({
        channel,
        tools,
        room: call.room,
        number: this.context.callNumber,
        commit: async (change) => {
          if (stateFailed) throw new StateTooLarge();
          chat.commit(change);
          const write = state();
          if (write === null) throw new StateTooLarge();
          if (!(await write())) {
            stateFailed = true;
            throw new Error("Could not write pending chat state");
          }
        },
        send: (event) => {
          // The channel closed: nothing more goes out.
          if (this.context.ended.aborted) return;
          deltas.flush();
          this.context.send(event);
        },
      });
      this.calls = calls;
      // The person's text is in the conversation before the first request (ADR-0012 "상태를
      // 넘기는 때"); a turn without text left it as it was.
      const first = chat.said ? state() : undefined;
      if (first === null) {
        outcome = {
          type: "failed",
          failure: new ChatFailure("internal"),
          error: new StateTooLarge(),
          steps: 0,
        };
      } else {
        void first?.();
        outcome = await sdk.turn.streamTurn(
          {
            ...call,
            fetch: requests.fetch,
            signal,
            chunkMs: limits.chunkMs,
            steps: limits.steps,
            tools: calls,
          },
          {
            output: requests.output,
            text: (text) => deltas.add(text),
            step: (messages) => {
              if (stateFailed) return null;
              chat.keep(messages);
              const write = state();
              return write === null ? null : () => void write();
            },
          },
        );
        // The chat is full once, in a `state` before what ends the turn (§7.11 "대화 한도"): the
        // state of the step that passed the limit says so already, but an answer cut there, or
        // a turn that ended before its step's end, left none that does.
        if (call.room.passed && !toldFull && !stateFailed) {
          const last = state();
          if (last === null) {
            outcome = {
              type: "failed",
              failure: new ChatFailure("internal"),
              error: new StateTooLarge(),
              steps: outcome.steps,
            };
          } else {
            void last();
          }
        }
      }
    } catch (error) {
      // Only loading the AI SDK or the tools, or their fingerprint, can throw here: `streamTurn`
      // ends in an outcome.
      outcome = { type: "failed", failure: new ChatFailure("internal"), error, steps: 0 };
    }
    requests.output();
    const ms = Date.now() - started;
    if (this.context.ended.aborted) {
      deltas.stop();
      log.info(`[core:chat:turn] abandoned ${fields} ms=${ms}`);
      return null;
    }
    deltas.flush();
    return this.end(outcome, fields, ms);
  }

  private end(outcome: TurnOutcome, fields: string, ms: number): TurnAnswer {
    const steps = `steps=${outcome.steps}`;
    if (outcome.type === "finished") {
      const reason = doneReason(outcome, this.context.limits.steps, this.calls?.cancelled ?? false);
      if (reason === "aborted") {
        log.info(`[core:chat:turn] cancelled ${fields} ${steps} ms=${ms}`);
      } else {
        log.info(
          `[core:chat:turn] success ${fields} reason=${reason} ${steps} input_tokens=${outcome.inputTokens ?? "none"} output_tokens=${outcome.outputTokens ?? "none"} ms=${ms}`,
        );
      }
      return {
        type: "done",
        reason,
        input_tokens: count(outcome.inputTokens),
        output_tokens: count(outcome.outputTokens),
      };
    }
    if (outcome.type === "aborted" && this.cancelled && !this.silent) {
      log.info(`[core:chat:turn] cancelled ${fields} ${steps} ms=${ms}`);
      return { type: "done", reason: "aborted", input_tokens: null, output_tokens: null };
    }
    const failure =
      outcome.type === "failed"
        ? outcome.failure
        : new ChatFailure(this.silent ? "timeout" : "internal");
    if (failure.code === "internal") {
      const error = outcome.type === "failed" ? outcome.error : null;
      log.error(
        `[core:chat:turn] failure ${fields} code=internal error_type=${errorType(error)} ${steps} ms=${ms}`,
      );
    } else {
      log.warn(
        `[core:chat:turn] failure ${fields} code=${failure.code} status=${failure.status ?? "none"} ${steps} ms=${ms}`,
      );
    }
    return errorEvent("turn", failure.code, failure.status);
  }
}
