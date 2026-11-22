/**
 * The messages of a chat channel, `sherpa.chat.v1` (app-connection-v1 §7.11, ADR-0012 "앱과 코어
 * 사이 채널"): one JSON object per `data` frame each way, told apart by `type`. This edition
 * reads `list_models` and writes `models` and `error`.
 */
import { z } from "zod";
import { type ChatErrorCode, retryable } from "./errors.ts";
import { FIXED_PROVIDERS } from "./providers.ts";

/** The limits of a chat channel (§7.11). */
export const chatLimits = {
  /** Chat channels open at once; the core closes the next one with `chat_limit`. */
  channels: 4,
  /** An API key, printable ASCII without a space, so it can break no header. */
  apiKeyBytes: 512,
  /** The base URL of an OpenAI-compatible server. */
  baseURLBytes: 2048,
  /** Model ids in one `models` answer, and the bytes of each. */
  models: 1000,
  modelIdBytes: 256,
  /** Requests one `list_models` sends, and the bytes of each response body once decoded. */
  pages: 10,
  responseBytes: 4 * 1024 * 1024,
  /** One `list_models`, every page included. */
  listMs: 30_000,
} as const;

const apiKey = z
  .string()
  .min(1)
  .max(chatLimits.apiKeyBytes)
  .regex(/^[!-~]+$/);
const baseURL = z
  .string()
  .regex(/^\P{Cc}+$/u)
  .refine((value) => Buffer.byteLength(value) <= chatLimits.baseURLBytes);

// The first three providers' origin is Sherpa's, so they take no base URL; an OpenAI-compatible
// server may need no key (ADR-0012 "OpenAI 호환의 base URL").
const listModels = z.union([
  z.strictObject({
    type: z.literal("list_models"),
    provider: z.enum(FIXED_PROVIDERS),
    api_key: apiKey,
  }),
  z.strictObject({
    type: z.literal("list_models"),
    provider: z.literal("openai-compatible"),
    base_url: baseURL,
    api_key: apiKey.optional(),
  }),
]);

export type ListModelsRequest = z.infer<typeof listModels>;

/** The app messages an `error` can answer, by their `type`. */
export type AnsweredMessage = "list_models";

/** What the core writes on a chat channel. */
export type ChatEvent =
  | { type: "models"; models: string[]; truncated: boolean }
  | {
      type: "error";
      in_reply_to: AnsweredMessage | null;
      code: ChatErrorCode;
      retryable: boolean;
      status: number | null;
    };

/** The `error` that ends a message: `inReplyTo` is `null` when the message could not be read. */
export function errorEvent(
  inReplyTo: AnsweredMessage | null,
  code: ChatErrorCode,
  status: number | null = null,
): ChatEvent {
  return { type: "error", in_reply_to: inReplyTo, code, retryable: retryable(code), status };
}

/** Why a `data` body is not a message this edition reads. */
export type MessageRefusal = "not_json" | "unknown_type" | "schema";

export type AppMessage =
  | { type: "list_models"; request: ListModelsRequest }
  | { type: "refused"; inReplyTo: AnsweredMessage | null; reason: MessageRefusal };

const decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Reads one `data` body. A body that is not a UTF-8 JSON object of a `type` this edition reads
 * answers nothing in particular; one of a known `type` that breaks its schema answers that type.
 */
export function readMessage(body: Uint8Array): AppMessage {
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(body));
  } catch {
    return { type: "refused", inReplyTo: null, reason: "not_json" };
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    value.type !== "list_models"
  ) {
    return { type: "refused", inReplyTo: null, reason: "unknown_type" };
  }
  const request = listModels.safeParse(value);
  return request.success
    ? { type: "list_models", request: request.data }
    : { type: "refused", inReplyTo: "list_models", reason: "schema" };
}
