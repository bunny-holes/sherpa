/**
 * The messages of a chat channel, `sherpa.chat.v1` (app-connection-v1 §7.11, ADR-0012 "앱과 코어
 * 사이 채널"): one JSON object per `data` frame each way, told apart by `type`. This edition
 * reads `list_models`, `turn` and `cancel` and writes `models`, `delta`, `done` and `error`.
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
  /** Model ids in one `models` answer, and the bytes of each; a turn's model id too. */
  models: 1000,
  modelIdBytes: 256,
  /** Requests one `list_models` sends, and the bytes of each response body once decoded. */
  pages: 10,
  responseBytes: 4 * 1024 * 1024,
  /** One `list_models`, every page included. */
  listMs: 30_000,
  /** The person's text in one `turn`. */
  textBytes: 64 * 1024,
  /**
   * The conversation of one chat as the JSON of its model messages, the next turn's text
   * included. A turn past it is not sent, and the chat takes no other: the state of a chat must
   * fit one 4 MiB `data` (§7.4) with the room one turn adds.
   */
  conversationBytes: 2 * 1024 * 1024,
  /**
   * A model request without output: from the moment it is sent until its first output, until
   * its fetch fails, or until the head of a failure answer has come in. Each request the AI SDK
   * sends again starts it anew. Ten minutes: the Claude of today streams nothing while it thinks.
   */
  firstOutputMs: 600_000,
  /** Between two outputs of one model response. */
  chunkMs: 120_000,
  /** How long the answer's text waits for more before a `delta` takes it, and the most one takes. */
  deltaMs: 50,
  deltaBytes: 4096,
  /** The head of a failure answer's body the core reads: its status is what the error carries. */
  failureBodyBytes: 64 * 1024,
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
const modelId = z
  .string()
  .regex(/^\P{Cc}+$/u)
  .refine((value) => Buffer.byteLength(value) <= chatLimits.modelIdBytes);
const text = z
  .string()
  .min(1)
  .refine((value) => Buffer.byteLength(value) <= chatLimits.textBytes);

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

// A turn names its provider as a model list does, and the model and the person's text besides.
const turn = z.union([
  z.strictObject({
    type: z.literal("turn"),
    provider: z.enum(FIXED_PROVIDERS),
    api_key: apiKey,
    model: modelId,
    text,
  }),
  z.strictObject({
    type: z.literal("turn"),
    provider: z.literal("openai-compatible"),
    base_url: baseURL,
    api_key: apiKey.optional(),
    model: modelId,
    text,
  }),
]);

export type TurnRequest = z.infer<typeof turn>;

const cancel = z.strictObject({ type: z.literal("cancel") });

/** The app messages an `error` can answer, by their `type`; a `cancel` only when it is malformed. */
export type AnsweredMessage = "list_models" | "turn" | "cancel";

/** Why a turn ended with `done` (§7.11). */
export type DoneReason = "stop" | "length" | "content-filter" | "aborted" | "other";

/** What the core writes on a chat channel. */
export type ChatEvent =
  | { type: "models"; models: string[]; truncated: boolean }
  | { type: "delta"; text: string }
  | {
      type: "done";
      reason: DoneReason;
      input_tokens: number | null;
      output_tokens: number | null;
    }
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
  | { type: "turn"; request: TurnRequest }
  | { type: "cancel" }
  | { type: "refused"; inReplyTo: AnsweredMessage | null; reason: MessageRefusal };

const decoder = new TextDecoder("utf-8", { fatal: true });

const schema = (inReplyTo: AnsweredMessage): AppMessage => ({
  type: "refused",
  inReplyTo,
  reason: "schema",
});

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
  const type = typeof value === "object" && value !== null && "type" in value ? value.type : null;
  switch (type) {
    case "list_models": {
      const request = listModels.safeParse(value);
      return request.success ? { type, request: request.data } : schema(type);
    }
    case "turn": {
      const request = turn.safeParse(value);
      return request.success ? { type, request: request.data } : schema(type);
    }
    case "cancel":
      return cancel.safeParse(value).success ? { type } : schema(type);
    default:
      return { type: "refused", inReplyTo: null, reason: "unknown_type" };
  }
}
