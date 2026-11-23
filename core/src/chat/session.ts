/**
 * The chat channels of one app connection (app-connection-v1 §7.11, ADR-0012 "앱과 코어 사이
 * 채널"): at most four open at once, each answering the messages of its own channel and keeping
 * its own conversation. A message that fails ends in an `error` on its channel and a log line;
 * none ends the channel or the core.
 */
import type { ModelMessage } from "ai";
import { log } from "../log.ts";
import type { ModelTool } from "../tools/call.ts";
import { type ChatIdentity, Conversation, type TurnRefusal } from "./conversation.ts";
import { type AllowedOrigin, allowedOrigin, type Egress, EgressDeniedError } from "./egress.ts";
import { type ChatErrorCode, ChatFailure } from "./errors.ts";
import { loadChat } from "./load.ts";
import { listModels, type ModelSource } from "./models.ts";
import { systemTimeZone, timeNote } from "./now.ts";
import {
  type ChatEvent,
  chatLimits,
  errorEvent,
  type ListModelsRequest,
  readMessage,
  type TurnAnswer,
  type TurnRequest,
} from "./protocol.ts";
import { FIXED_BASE_URLS, requestBase } from "./providers.ts";
import { decodeState, encodeState } from "./state.ts";
import { ChatTurn, type TurnLimits } from "./turn.ts";

/** What a chat needs of its channel: one JSON message per `data` frame each way. */
export interface ChatChannel {
  readonly id: number;
  /** One `data` body from the app. */
  onmessage?: (body: Uint8Array) => void;
  /** The app closed the channel, or the core is stopping. */
  onclose?: () => void;
  send(body: string): Promise<void>;
  close(reason: string): Promise<void>;
}

export interface ChatOptions {
  /** How long one `list_models` may take, every page included (§7.11: 30 s). */
  listMs?: number;
  /** The limits of a turn (§7.11). */
  turn?: Partial<TurnLimits>;
  /** The time a turn's text was sent; tests fix it. */
  clock?: () => Date;
  /** The IANA time zone it was sent in, read for each turn; tests fix it. */
  timeZone?: () => string;
  /** The most bytes of a `data` body the core writes (§7.4); tests lower it. */
  dataBytes?: number;
}

const errorType = (error: unknown) => (error instanceof Error ? error.name : typeof error);

/**
 * Where a `list_models` or a `turn` goes: the origin the egress lets out and the base its paths
 * join. The person's base URL is refused here, before anything leaves, unless the egress allows it.
 */
function destination(request: ListModelsRequest | TurnRequest): {
  origin: AllowedOrigin;
  base: string;
} {
  const raw =
    request.provider === "openai-compatible" ? request.base_url : FIXED_BASE_URLS[request.provider];
  const origin = allowedOrigin(raw);
  return { origin, base: requestBase(raw)! };
}

function modelSource(request: ListModelsRequest): ModelSource & { origin: AllowedOrigin } {
  const { origin, base } = destination(request);
  return { provider: request.provider, base, apiKey: request.api_key, origin };
}

/** The code of a turn its chat refuses. */
const REFUSAL_CODES: Readonly<Record<TurnRefusal, ChatErrorCode>> = {
  other_chat: "invalid_message",
  state_mismatch: "chat_state_mismatch",
  nothing_to_retry: "invalid_message",
  conversation_limit: "conversation_limit",
};

/** What a failed `list_models` ends with; anything unforeseen is a core defect. */
function failureOf(error: unknown): ChatFailure {
  if (error instanceof ChatFailure) return error;
  return new ChatFailure(error instanceof EgressDeniedError ? "egress_denied" : "internal");
}

class ChatSession {
  private readonly ended = new AbortController();
  private readonly conversation = new Conversation();
  private listing = false;
  private turn: ChatTurn | null = null;
  /** The channel read a `turn` or a `resume`: a `resume` comes before both (§7.11 "이어 쓰기"). */
  private opened = false;
  /** A `resume` is being checked. */
  private resuming = false;
  /** The tool calls this channel has made: a `tool` message's number (§7.11). */
  private calls = 0;
  /**
   * The fingerprint of the chat's last `state`, or of what its `resume` was checked against: what
   * a `state` the chat writes outside a turn carries. `null` while the app holds no state of it.
   */
  private fingerprint: string | null = null;

  constructor(
    private readonly channel: ChatChannel,
    private readonly egress: Egress,
    private readonly tools: () => Promise<readonly ModelTool[]>,
    private readonly listMs: number,
    private readonly turnLimits: TurnLimits,
    private readonly clock: () => Date,
    private readonly timeZone: () => string,
    private readonly dataBytes: number,
    onEnd: () => void,
  ) {
    channel.onmessage = (body) => this.receive(body);
    channel.onclose = () => {
      this.ended.abort();
      onEnd();
    };
  }

  private receive(body: Uint8Array): void {
    const message = readMessage(body);
    if (message.type === "refused") {
      log.warn(
        `[core:chat:message] refused channel=${this.channel.id} reason=${message.reason} bytes=${body.byteLength}`,
      );
      if (message.inReplyTo === "turn") this.answer(errorEvent("turn", "invalid_message"));
      else this.reply(errorEvent(message.inReplyTo, "invalid_message"));
      return;
    }
    if (message.type === "turn") {
      this.opened = true;
      this.startTurn(message.request);
      return;
    }
    if (message.type === "resume") {
      this.resume(message.state);
      return;
    }
    if (message.type === "cancel") {
      // A cancel that meets no turn, one that just ended included, has nothing to stop.
      this.turn?.cancel();
      return;
    }
    if (this.listing) {
      log.warn(`[core:chat:list-models] refused channel=${this.channel.id} reason=busy`);
      this.reply(errorEvent("list_models", "busy"));
      return;
    }
    // The next list is taken once this one is answered, so the app may send it on the answer.
    this.listing = true;
    void this.list(message.request).then((answer) => {
      this.listing = false;
      if (answer) this.reply(answer);
    });
  }

  /** One `list_models`: its `models` or `error`, or `null` when the channel ended first. */
  private async list(request: ListModelsRequest): Promise<ChatEvent | null> {
    const fields = `channel=${this.channel.id} provider=${request.provider}`;
    const started = Date.now();
    const timeout = AbortSignal.timeout(this.listMs);
    log.info(`[core:chat:list-models] start ${fields}`);
    try {
      const source = modelSource(request);
      const signal = AbortSignal.any([this.ended.signal, timeout]);
      const list = await listModels(source, this.egress.turnFetch(source.origin, signal));
      log.info(
        `[core:chat:list-models] success ${fields} models=${list.models.length} pages=${list.pages} skipped=${list.skipped} truncated=${list.truncated} ms=${Date.now() - started}`,
      );
      return { type: "models", models: list.models, truncated: list.truncated };
    } catch (error) {
      const ms = Date.now() - started;
      if (this.ended.signal.aborted) {
        log.info(`[core:chat:list-models] abandoned ${fields} ms=${ms}`);
        return null;
      }
      const failure = timeout.aborted ? new ChatFailure("timeout") : failureOf(error);
      if (failure.code === "internal") {
        log.error(
          `[core:chat:list-models] failure ${fields} code=internal error_type=${errorType(error)} ms=${ms}`,
        );
      } else {
        log.warn(
          `[core:chat:list-models] failure ${fields} code=${failure.code} status=${failure.status ?? "none"} ms=${ms}`,
        );
      }
      return errorEvent("list_models", failure.code, failure.status);
    }
  }

  /**
   * Takes a `resume` (§7.11 "이어 쓰기"): only as the channel's first `turn` or `resume`, a
   * `list_models` allowed before it. A `turn` that comes while its state is checked is `busy`.
   */
  private resume(state: string): void {
    if (this.opened) {
      log.warn(`[core:chat:resume] refused channel=${this.channel.id} reason=not_first`);
      this.reply(errorEvent("resume", "invalid_message"));
      return;
    }
    this.opened = true;
    this.resuming = true;
    void this.restore(state).then((answer) => {
      // A turn is taken once the resume is answered, as the next turn is once one ends.
      this.resuming = false;
      if (answer) this.reply(answer);
    });
  }

  /**
   * Checks a `resume`'s state and takes its conversation: `resumed`, an `error` after which the
   * chat starts empty, or `null` when the channel ended first. Anthropic gets the conversation
   * without its reasoning when the instructions or the tools changed since the state was written
   * (ADR-0012 "이어 쓰기").
   */
  private async restore(value: string): Promise<ChatEvent | null> {
    const id = this.channel.id;
    const started = Date.now();
    const bytes = Buffer.byteLength(value);
    let taken:
      | { refusal: string }
      | {
          identity: ChatIdentity;
          full: boolean;
          messages: ModelMessage[];
          fingerprint: string;
          same: boolean;
          pruned: number;
        };
    try {
      const decoded = decodeState(value);
      if ("refusal" in decoded) {
        taken = decoded;
      } else {
        const [{ state: sdk }, tools] = await Promise.all([loadChat(), this.tools()]);
        const { identity, fingerprint, full, messages } = decoded.state;
        const checked = sdk.checkMessages(messages);
        if ("refusal" in checked) {
          taken = checked;
        } else {
          const current = await sdk.fingerprint(tools);
          const same = current === fingerprint;
          const chat = { identity, full, fingerprint: current, same };
          taken =
            !same && identity.provider === "anthropic"
              ? { ...chat, ...sdk.withoutReasoning(checked.messages) }
              : { ...chat, messages: checked.messages, pruned: 0 };
        }
      }
    } catch (error) {
      if (this.ended.signal.aborted) return this.abandoned(started);
      log.error(
        `[core:chat:resume] failure channel=${id} code=internal error_type=${errorType(error)} ms=${Date.now() - started}`,
      );
      return errorEvent("resume", "internal");
    }
    if (this.ended.signal.aborted) return this.abandoned(started);
    if ("refusal" in taken) {
      log.warn(`[core:chat:resume] refused channel=${id} reason=${taken.refusal} bytes=${bytes}`);
      return errorEvent("resume", "chat_state_invalid");
    }
    this.conversation.resume(taken.identity, taken.messages, taken.full);
    this.fingerprint = taken.fingerprint;
    log.info(
      `[core:chat:resume] success channel=${id} provider=${taken.identity.provider} messages=${taken.messages.length} bytes=${bytes} fingerprint=${taken.same ? "same" : "changed"} pruned=${taken.pruned} full=${taken.full} ms=${Date.now() - started}`,
    );
    return { type: "resumed", resend: this.conversation.resendable() };
  }

  private abandoned(started: number): null {
    log.info(`[core:chat:resume] abandoned channel=${this.channel.id} ms=${Date.now() - started}`);
    return null;
  }

  /**
   * Starts a turn, or refuses it at once: one runs already or a `resume` is being checked, the
   * base URL is not allowed, the turn is for another chat, a turn without text has nothing to
   * send again, or the conversation is full. A refused turn sends nothing and leaves the
   * conversation as it was, but the refusal that fills the chat says so first in a `state`
   * (§7.11 "대화 한도").
   */
  private startTurn(request: TurnRequest): void {
    const id = this.channel.id;
    const refuse = (reason: string, event: TurnAnswer) => {
      log.warn(`[core:chat:turn] refused channel=${id} reason=${reason}`);
      this.answer(event);
    };
    if (this.turn || this.resuming) {
      refuse("busy", errorEvent("turn", "busy"));
      return;
    }
    let where: { origin: AllowedOrigin; base: string };
    try {
      where = destination(request);
    } catch (error) {
      if (!(error instanceof EgressDeniedError)) throw error;
      refuse("egress_denied", errorEvent("turn", "egress_denied"));
      return;
    }
    const identity: ChatIdentity = {
      provider: request.provider,
      baseURL: where.base,
      model: request.model,
    };
    // A turn without text adds no text, so no time line either (§7.11 "다시 보내기").
    const start =
      request.text === undefined
        ? this.conversation.again(identity)
        : this.conversation.start(identity, request.text, timeNote(this.clock(), this.timeZone()));
    if (start.type === "refused") {
      // A chat whose app holds no state of it has none to correct.
      if (start.filled && this.fingerprint !== null) {
        const state = this.stateWriter(identity, this.fingerprint);
        if (state === null) {
          refuse(start.reason, errorEvent("turn", "internal"));
          return;
        }
        state.write();
      }
      refuse(start.reason, errorEvent("turn", REFUSAL_CODES[start.reason]));
      return;
    }
    const turn = new ChatTurn({
      channel: id,
      provider: request.provider,
      fetch: (signal) => this.egress.turnFetch(where.origin, signal),
      send: (event) => this.reply(event),
      ended: this.ended.signal,
      limits: this.turnLimits,
      tools: this.tools,
      callNumber: () => ++this.calls,
    });
    this.turn = turn;
    void turn
      .run(
        {
          target: { ...identity, apiKey: request.api_key },
          messages: start.messages,
          room: start.room,
        },
        {
          said: request.text !== undefined,
          keep: (messages) => this.conversation.keep(messages),
          state: (fingerprint) => this.stateWriter(identity, fingerprint),
        },
      )
      .then((end) => {
        // The next turn is taken once this one is answered, as the next list is.
        this.turn = null;
        if (end) this.answer(end);
      });
  }

  /**
   * Writes what answers a `turn`, with `resend`: whether a turn without text sent right after it
   * would start (§7.11 "다시 보내기"). None does while a turn runs, which is `busy`, nor one the
   * conversation would refuse. Such a turn carries this chat's provider, base URL and model, and
   * the egress let that base URL out when the chat's first turn started: its rule reads the URL
   * alone.
   */
  private answer(event: TurnAnswer): void {
    this.reply({ ...event, resend: this.turn === null && this.conversation.resendable() });
  }

  /**
   * The conversation's `state` as it stands (§7.11 "대화 상태"): whether it says the chat is
   * full, and what writes it once what comes before it is out; or `null` when it would not fit
   * one `data` (§7.4): the chat then takes no later turn, and the turn ends.
   */
  private stateWriter(
    identity: ChatIdentity,
    fingerprint: string,
  ): { full: boolean; write(): void } | null {
    const messages = this.conversation.kept;
    const full = this.conversation.full;
    const event: ChatEvent = {
      type: "state",
      state: encodeState({ identity, fingerprint, full, messages }),
    };
    const body = JSON.stringify(event);
    // Base64 and the keys around it are ASCII: each character is a byte.
    const fields = `channel=${this.channel.id} bytes=${body.length}`;
    if (body.length > this.dataBytes) {
      log.error(`[core:chat:state] failure ${fields} reason=too_large`);
      this.conversation.fill();
      return null;
    }
    this.fingerprint = fingerprint;
    const count = messages.length;
    return {
      full,
      write: () => {
        log.debug(`[core:chat:state] sent ${fields} messages=${count} full=${full} pending=0`);
        this.write(body);
      },
    };
  }

  private reply(event: ChatEvent): void {
    this.write(JSON.stringify(event));
  }

  private write(body: string): void {
    this.channel.send(body).catch((error: unknown) => {
      log.error(
        `[core:chat:send] failure channel=${this.channel.id} error_type=${errorType(error)}`,
      );
    });
  }
}

const TURN_LIMITS: TurnLimits = {
  firstOutputMs: chatLimits.firstOutputMs,
  chunkMs: chatLimits.chunkMs,
  deltaMs: chatLimits.deltaMs,
  deltaBytes: chatLimits.deltaBytes,
  failureBodyBytes: chatLimits.failureBodyBytes,
  steps: chatLimits.steps,
};

/** The chat channels of one app connection, which share its egress and the core's tools. */
export class ChatSessions {
  private readonly open = new Set<ChatSession>();

  constructor(
    private readonly egress: Egress,
    /** The tools a chat's model may call, once their discovery has settled (§10.1). */
    private readonly tools: () => Promise<readonly ModelTool[]>,
    private readonly options: ChatOptions = {},
  ) {}

  /** Serves a channel the app opened as `chat`, or closes it when four are open already. */
  serve(channel: ChatChannel): void {
    if (this.open.size >= chatLimits.channels) {
      log.warn(
        `[core:chat:open] refused channel=${channel.id} reason=chat_limit chats=${this.open.size}`,
      );
      channel.close("chat_limit").catch((error: unknown) => {
        log.error(
          `[core:chat:open] write_failure channel=${channel.id} error_type=${errorType(error)}`,
        );
      });
      return;
    }
    const session: ChatSession = new ChatSession(
      channel,
      this.egress,
      this.tools,
      this.options.listMs ?? chatLimits.listMs,
      { ...TURN_LIMITS, ...this.options.turn },
      this.options.clock ?? (() => new Date()),
      this.options.timeZone ?? systemTimeZone,
      this.options.dataBytes ?? chatLimits.dataBytes,
      () => this.open.delete(session),
    );
    this.open.add(session);
  }
}
