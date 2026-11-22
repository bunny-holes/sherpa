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

/** Why a chat takes no turn: another provider, base URL or model, or a conversation too large. */
export type TurnRefusal = "other_chat" | "conversation_limit";

export type TurnStart =
  | { type: "refused"; reason: TurnRefusal }
  /** The messages to send: the conversation, the person's text last. */
  | { type: "started"; messages: ModelMessage[] };

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
    const chat = this.identity;
    if (
      chat &&
      (chat.provider !== identity.provider ||
        chat.baseURL !== identity.baseURL ||
        chat.model !== identity.model)
    ) {
      return { type: "refused", reason: "other_chat" };
    }
    const messages: ModelMessage[] = [
      ...this.messages,
      { role: "user", content: `${note}\n\n${text}` },
    ];
    if (this.full || Buffer.byteLength(JSON.stringify(messages)) > chatLimits.conversationBytes) {
      this.full = true;
      return { type: "refused", reason: "conversation_limit" };
    }
    this.identity ??= identity;
    this.messages.push(messages.at(-1)!);
    return { type: "started", messages };
  }

  /** Keeps the messages of a step that finished. */
  keep(messages: ModelMessage[]): void {
    this.messages.push(...messages);
  }
}
