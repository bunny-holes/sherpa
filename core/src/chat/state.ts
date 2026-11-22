/**
 * A chat's state (app-connection-v1 §7.11 "대화 상태", ADR-0012 "무엇을 저장하나"): the JSON of
 * what fixes the chat, the fingerprint of what every turn sends besides the conversation, and the
 * conversation's model messages, in the base64 a `state` carries. The app keeps it as it came and
 * gives it back in a `resume`, so the core reads it as strictly as it writes it. The check of the
 * messages and the fingerprint need the AI SDK (src/chat/sdk/state.ts).
 */
import type { ModelMessage } from "ai";
import { z } from "zod";
import type { ChatIdentity } from "./conversation.ts";
import { baseURL, modelId } from "./protocol.ts";
import { FIXED_BASE_URLS, FIXED_PROVIDERS, requestBase } from "./providers.ts";

/** The name of this state's format, which a state names first. */
export const STATE_FORMAT = "sherpa.chat.state.v1";

// What fixes the chat follows a turn's rules, and its base URL is kept as the chat keeps it; the
// operations in flight (`pending`) come in the next work (ADR-0012 "이어 쓰기").
const kept = {
  format: z.literal(STATE_FORMAT),
  model: modelId,
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  pending: z.tuple([]),
  messages: z.array(z.unknown()).min(1),
};

const envelope = z.union([
  z.strictObject({ ...kept, provider: z.enum(FIXED_PROVIDERS) }),
  z.strictObject({
    ...kept,
    provider: z.literal("openai-compatible"),
    base_url: baseURL.refine((value) => requestBase(value) === value),
  }),
]);

/** A chat's state: what fixes it, the fingerprint, and the messages. */
export interface ChatState<Messages = readonly ModelMessage[]> {
  identity: ChatIdentity;
  fingerprint: string;
  messages: Messages;
}

/** The base64 of a chat's state, which a `state` carries. */
export function encodeState({ identity, fingerprint, messages }: ChatState): string {
  const { provider, baseURL: base, model } = identity;
  const json = JSON.stringify({
    format: STATE_FORMAT,
    provider,
    ...(provider === "openai-compatible" ? { base_url: base } : {}),
    model,
    fingerprint,
    pending: [],
    messages,
  });
  return Buffer.from(json).toString("base64");
}

/** Why a `resume`'s state is none the core wrote: no base64 as it writes it, no JSON, no envelope. */
export type StateRefusal = "base64" | "not_json" | "envelope";

const decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Reads a `resume`'s state: base64 as the core writes it, which gives the same text when encoded
 * again, of a UTF-8 JSON envelope of this format. Its messages are checked with the AI SDK.
 */
export function decodeState(
  value: string,
): { state: ChatState<readonly unknown[]> } | { refusal: StateRefusal } {
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) return { refusal: "base64" };
  let json: unknown;
  try {
    json = JSON.parse(decoder.decode(bytes));
  } catch {
    return { refusal: "not_json" };
  }
  const parsed = envelope.safeParse(json);
  if (!parsed.success) return { refusal: "envelope" };
  const { provider, model, fingerprint, messages } = parsed.data;
  const base =
    parsed.data.provider === "openai-compatible"
      ? parsed.data.base_url
      : requestBase(FIXED_BASE_URLS[parsed.data.provider])!;
  return { state: { identity: { provider, baseURL: base, model }, fingerprint, messages } };
}

/**
 * A `state` that would not fit one `data` (§7.4). The conversation's limit keeps every state
 * within it, so one that does not fit is the core's defect.
 */
export class StateTooLarge extends Error {
  override name = "StateTooLarge";
}
