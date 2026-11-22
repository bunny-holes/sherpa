/**
 * One chat's conversation in the core's memory (ADR-0012 "앱과 코어 사이 채널", "대화 기록",
 * "메모리와 크기"): the person's texts and the messages of the steps that finished. The chat's
 * first turn fixes its provider, base URL and model, since the provider takes back values it
 * left in the conversation; a turn for another is not this chat's. Its limit holds at a turn's
 * start and while the turn runs (§7.11 "대화 한도").
 */
import type { ModelMessage } from "ai";
import { chatLimits } from "./protocol.ts";
import type { Provider } from "./providers.ts";

/** What fixes a chat: the provider, the base URL its requests start with, and the model. */
export interface ChatIdentity {
  provider: Provider;
  baseURL: string;
  model: string;
}

/**
 * Why a chat takes no turn: another provider, base URL or model, a turn without text whose
 * conversation ends with nothing a model answers, or a conversation too large.
 */
export type TurnRefusal = "other_chat" | "nothing_to_retry" | "conversation_limit";

export type TurnStart =
  | { type: "refused"; reason: TurnRefusal }
  /**
   * The messages to send: the conversation, the person's text of the turn last when it has one;
   * and what the conversation's limit leaves the turn.
   */
  | { type: "started"; messages: ModelMessage[]; room: TurnRoom };

/** What a model answers: the person's text, or the results of the tools it called. */
const answerable = (message: ModelMessage | undefined) =>
  message?.role === "user" || message?.role === "tool";

/** The conversation as its limit reads it: the JSON of its model messages, in bytes. */
const jsonBytes = (value: ModelMessage | ModelMessage[]) =>
  Buffer.byteLength(JSON.stringify(value));

/**
 * What one turn may add to its conversation before the conversation passes its limit (§7.11
 * "대화 한도"): the conversation's bytes as the turn's start measured them and as each step that
 * finished adds its messages, exactly, and, while a model request runs, at most what its answer
 * (src/chat/sdk/answer.ts) and the results of its calls would add. Once past, it stays past: the
 * turn takes no later request and runs no later call, and the chat takes no later turn.
 */
export class TurnRoom {
  private answer = 0;
  private results = 0;
  private over = false;

  constructor(
    private kept: number,
    /** The turn passed the limit: the chat is full. */
    private readonly fill: () => void,
  ) {}

  get passed(): boolean {
    return this.over;
  }

  /** A model request starts: its answer and the results of its calls count from nothing. */
  request(): void {
    this.answer = 0;
    this.results = 0;
  }

  /** Adds what the answer streamed; false once past. */
  answers(bytes: number): boolean {
    this.answer += bytes;
    return this.within(this.kept + this.answer);
  }

  /** Whether the result of one more call, as large as a result may be (§10.5), would fit. */
  admits(): boolean {
    return this.within(this.kept + this.answer + this.results + chatLimits.toolResultBytes);
  }

  /** Adds the result of a call: the JSON of the outcome the model reads. */
  result(bytes: number): void {
    this.results += bytes;
  }

  /** Adds the messages of a step that finished, measured as the turn's start measures. */
  keep(messages: ModelMessage[]): void {
    // Each joins the conversation's JSON after a comma: a turn's conversation is never empty.
    for (const message of messages) this.kept += jsonBytes(message) + 1;
    this.within(this.kept);
  }

  private within(bytes: number): boolean {
    if (!this.over && bytes > chatLimits.conversationBytes) {
      this.over = true;
      this.fill();
    }
    return !this.over;
  }
}

export class Conversation {
  private readonly messages: ModelMessage[] = [];
  private identity: ChatIdentity | null = null;
  private full = false;

  /**
   * Takes the person's text for a turn, which stays whatever the turn ends with (ADR-0012 "상태를
   * 넘기는 때"), with `note`, the time it was sent, on a line before it: one text, which every
   * provider takes. A conversation that would pass its limit ends the chat: it takes no later turn,
   * as when a turn passes it.
   */
  start(identity: ChatIdentity, text: string, note: string): TurnStart {
    return this.take(identity, { role: "user", content: `${note}\n\n${text}` });
  }

  /**
   * Takes a turn without text, which sends the conversation again as it is, so that the person's
   * text in it goes once (§7.11 "다시 보내기"): only when it ends with what a model answers. One
   * that holds nothing, or ends with the model's answer, has nothing to send again.
   */
  again(identity: ChatIdentity): TurnStart {
    return this.take(identity, null);
  }

  /**
   * Whether a turn without text for this chat's provider, base URL and model would start now
   * (§7.11 "다시 보내기"): what `again` would answer, without taking anything.
   */
  resendable(): boolean {
    return "bytes" in this.measure(null);
  }

  private take(identity: ChatIdentity, said: ModelMessage | null): TurnStart {
    const chat = this.identity;
    if (
      chat &&
      (chat.provider !== identity.provider ||
        chat.baseURL !== identity.baseURL ||
        chat.model !== identity.model)
    ) {
      return { type: "refused", reason: "other_chat" };
    }
    const measured = this.measure(said);
    if ("refusal" in measured) {
      if (measured.refusal === "conversation_limit") this.full = true;
      return { type: "refused", reason: measured.refusal };
    }
    this.identity ??= identity;
    if (said !== null) this.messages.push(said);
    const room = new TurnRoom(measured.bytes, () => {
      this.full = true;
    });
    return { type: "started", messages: [...this.messages], room };
  }

  /**
   * Why the conversation would not go with `said` last, or as it is when `said` is `null`, or
   * its bytes when it would. A chat past its limit takes no later turn, one without text
   * included, so the limit comes first.
   */
  private measure(
    said: ModelMessage | null,
  ): { refusal: Exclude<TurnRefusal, "other_chat"> } | { bytes: number } {
    if (this.full) return { refusal: "conversation_limit" };
    if (said === null && !answerable(this.messages.at(-1))) return { refusal: "nothing_to_retry" };
    const bytes = jsonBytes(said === null ? this.messages : [...this.messages, said]);
    return bytes > chatLimits.conversationBytes ? { refusal: "conversation_limit" } : { bytes };
  }

  /** Keeps the messages of a step that finished. */
  keep(messages: ModelMessage[]): void {
    this.messages.push(...messages);
  }
}
