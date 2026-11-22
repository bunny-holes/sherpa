/**
 * The chat channels of one app connection (app-connection-v1 §7.11, ADR-0012 "앱과 코어 사이
 * 채널"): at most four open at once, each answering the messages of its own channel and keeping
 * its own conversation. A message that fails ends in an `error` on its channel and a log line;
 * none ends the channel or the core.
 */
import { log } from "../log.ts";
import type { ModelTool } from "../tools/call.ts";
import { type ChatIdentity, Conversation } from "./conversation.ts";
import { type AllowedOrigin, allowedOrigin, type Egress, EgressDeniedError } from "./egress.ts";
import { ChatFailure } from "./errors.ts";
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
import { FIXED_BASE_URLS } from "./providers.ts";
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
  return { origin, base: URL.parse(raw)!.href.replace(/\/+$/, "") };
}

function modelSource(request: ListModelsRequest): ModelSource & { origin: AllowedOrigin } {
  const { origin, base } = destination(request);
  return { provider: request.provider, base, apiKey: request.api_key, origin };
}

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
  /** The tool calls this channel has made: a `tool` message's number (§7.11). */
  private calls = 0;

  constructor(
    private readonly channel: ChatChannel,
    private readonly egress: Egress,
    private readonly tools: () => Promise<readonly ModelTool[]>,
    private readonly listMs: number,
    private readonly turnLimits: TurnLimits,
    private readonly clock: () => Date,
    private readonly timeZone: () => string,
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
      this.startTurn(message.request);
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
   * Starts a turn, or refuses it at once: one runs already, the base URL is not allowed, the turn
   * is for another chat, a turn without text has nothing to send again, or the conversation is
   * full. A refused turn sends nothing and leaves the conversation as it was.
   */
  private startTurn(request: TurnRequest): void {
    const id = this.channel.id;
    const refuse = (reason: string, event: TurnAnswer) => {
      log.warn(`[core:chat:turn] refused channel=${id} reason=${reason}`);
      this.answer(event);
    };
    if (this.turn) {
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
      const code = start.reason === "conversation_limit" ? "conversation_limit" : "invalid_message";
      refuse(start.reason, errorEvent("turn", code));
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
        (messages) => this.conversation.keep(messages),
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

  private reply(event: ChatEvent): void {
    this.channel.send(JSON.stringify(event)).catch((error: unknown) => {
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
      () => this.open.delete(session),
    );
    this.open.add(session);
  }
}
