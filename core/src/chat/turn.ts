/**
 * One chat turn from the core's side (app-connection-v1 §7.11, ADR-0012 "스트리밍", "중단",
 * "재시도"): the answer's text in `delta` events, then one `done` or `error`. The AI SDK and the
 * providers load with the first turn (src/chat/load.ts); this module takes only their types.
 *
 * A model request that goes `firstOutputMs` without output ends the turn. The limit runs from
 * the moment the request is sent until its first output, or until the body of an answer that is
 * not 2xx has come in, and every request the AI SDK sends again starts it anew. So the wait
 * after a failure status is not under it, while the wait after a 2xx stream that reported an
 * error before its first output stays under that request's limit. The SDK's own `firstChunkMs`
 * would start only once the response streams, which leaves the wait for its headers open, and
 * for OpenAI the wait for `response.in_progress` as well.
 */
import { log } from "../log.ts";
import type { Fetch } from "./egress.ts";
import { ChatFailure } from "./errors.ts";
import { loadTurn } from "./load.ts";
import { type ChatEvent, type DoneReason, errorEvent } from "./protocol.ts";
import type { TurnCall, TurnHooks, TurnOutcome } from "./sdk/turn.ts";

/** The limits of one turn (§7.11); tests shorten them. */
export interface TurnLimits {
  firstOutputMs: number;
  chunkMs: number;
  deltaMs: number;
  deltaBytes: number;
  failureBodyBytes: number;
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
 * runs; the AI SDK reads the copy, and the wait before it sends again runs without a limit.
 */
function watched(
  fetch: Fetch,
  limits: TurnLimits,
  silent: () => void,
): { fetch: Fetch; output: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const quiet = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const send = async (input: string | URL | Request, init?: BunFetchRequestInit) => {
    quiet();
    timer = setTimeout(silent, limits.firstOutputMs);
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

/** The finish reasons of the AI SDK that a `done` names; the others read as `other`. */
function doneReason(reason: string): DoneReason {
  return reason === "stop" || reason === "length" || reason === "content-filter" ? reason : "other";
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
}

/** One turn: its answer goes out as `delta` events, and `run` resolves the event that ends it. */
export class ChatTurn {
  private readonly stopped = new AbortController();
  private cancelled = false;
  private silent = false;

  constructor(private readonly context: TurnContext) {}

  /** The person stopped the turn: it ends with `done` `aborted`. */
  cancel(): void {
    this.cancelled = true;
    this.stopped.abort(new DOMException("The person cancelled the turn.", "AbortError"));
  }

  /**
   * Runs the turn. Resolves its `done` or `error`, or `null` when the channel closed first;
   * the messages of each step that finished go to `keep` as it finishes.
   */
  async run(
    call: Omit<TurnCall, "fetch" | "signal" | "chunkMs">,
    keep: TurnHooks["step"],
  ): Promise<ChatEvent | null> {
    const { channel, provider, limits } = this.context;
    const fields = `channel=${channel} provider=${provider}`;
    const started = Date.now();
    const signal = AbortSignal.any([this.context.ended, this.stopped.signal]);
    const deltas = new Deltas(this.context.send, limits.deltaMs, limits.deltaBytes);
    const requests = watched(this.context.fetch(signal), limits, () => {
      this.silent = true;
      this.stopped.abort(
        new DOMException(`No output for ${limits.firstOutputMs} ms.`, "TimeoutError"),
      );
    });
    log.info(`[core:chat:turn] start ${fields}`);
    let outcome: TurnOutcome;
    try {
      const { streamTurn } = await loadTurn();
      outcome = await streamTurn(
        { ...call, fetch: requests.fetch, signal, chunkMs: limits.chunkMs },
        { output: requests.output, text: (text) => deltas.add(text), step: keep },
      );
    } catch (error) {
      // Only loading the AI SDK can throw here: `streamTurn` ends in an outcome.
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

  private end(outcome: TurnOutcome, fields: string, ms: number): ChatEvent {
    const steps = `steps=${outcome.steps}`;
    if (outcome.type === "finished") {
      const reason = doneReason(outcome.reason);
      log.info(
        `[core:chat:turn] success ${fields} reason=${reason} ${steps} input_tokens=${outcome.inputTokens ?? "none"} output_tokens=${outcome.outputTokens ?? "none"} ms=${ms}`,
      );
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
