/**
 * One chat's conversation in the core's memory (ADR-0012 "앱과 코어 사이 채널", "대화 기록",
 * "메모리와 크기"): the person's texts and the messages of the steps that finished. The chat's
 * first turn fixes its provider, base URL and model, since the provider takes back values it
 * left in the conversation; a turn for another is not this chat's.
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
  /** The messages to send: the conversation, the person's text of the turn last when it has one. */
  | { type: "started"; messages: ModelMessage[] };

/** What a model answers: the person's text, or the results of the tools it called. */
const answerable = (message: ModelMessage | undefined) =>
  message?.role === "user" || message?.role === "tool";

export class Conversation {
  private readonly messages: ModelMessage[] = [];
  private identity: ChatIdentity | null = null;
  private full = false;

  /**
   * Takes the person's text for a turn, which stays whatever the turn ends with (ADR-0012 "상태를
   * 넘기는 때"), with `note`, the time it was sent, on a line before it: one text, which every
   * provider takes. A conversation that would pass its limit ends the chat: it takes no later turn.
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
    // A chat past its limit takes no later turn, one without text included.
    if (this.full) return { type: "refused", reason: "conversation_limit" };
    if (said === null && !answerable(this.messages.at(-1))) {
      return { type: "refused", reason: "nothing_to_retry" };
    }
    const messages = said === null ? [...this.messages] : [...this.messages, said];
    if (Buffer.byteLength(JSON.stringify(messages)) > chatLimits.conversationBytes) {
      this.full = true;
      return { type: "refused", reason: "conversation_limit" };
    }
    this.identity ??= identity;
    if (said !== null) this.messages.push(said);
    return { type: "started", messages };
  }

  /** Keeps the messages of a step that finished. */
  keep(messages: ModelMessage[]): void {
    this.messages.push(...messages);
  }
}
