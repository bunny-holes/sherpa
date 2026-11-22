/**
 * What a chat's state needs of the AI SDK (app-connection-v1 §7.11 "이어 쓰기", ADR-0012 "이어
 * 쓰기"): the fingerprint of what every turn sends besides the conversation, the check of the
 * messages a `resume` gives back, and the conversation without its reasoning. It loads with the
 * SDK (src/chat/load.ts).
 */
import { fingerprintTools, type ModelMessage, modelMessageSchema, pruneMessages } from "ai";
import type { ModelTool } from "../../tools/call.ts";
import { INSTRUCTIONS } from "../instructions.ts";
import { toolDefinitions } from "./tools.ts";

/** Each list of tools' fingerprint, computed once: the tools are settled once (§10.1). */
const prints = new WeakMap<readonly ModelTool[], Promise<string>>();

/**
 * The fingerprint of what every turn sends besides the conversation: the SHA-256, in hex, of the
 * JSON of the instructions and of each tool's name and the digest the AI SDK makes of its
 * definition, in the order a request sends them (ai 7.0.179 tool-fingerprint.ts).
 */
export function fingerprint(tools: readonly ModelTool[]): Promise<string> {
  let print = prints.get(tools);
  if (!print) {
    print = fingerprintTools(toolDefinitions(tools)).then((digests) =>
      new Bun.CryptoHasher("sha256")
        .update(JSON.stringify({ instructions: INSTRUCTIONS, tools: Object.entries(digests) }))
        .digest("hex"),
    );
    prints.set(tools, print);
  }
  return print;
}

/**
 * Why a state's messages are none the core keeps: one is no model message, one is a system
 * message, which the instructions are instead, one holds file data that is not base64, which the
 * AI SDK would read as a URL to fetch, or a call goes without its result.
 */
export type MessagesRefusal = "messages" | "system" | "file_data" | "unanswered";

/**
 * File data the AI SDK reads as the data itself: base64, which holds no `:` and so is never a
 * URL, which it tries first (ai 7.0.179 file-part-data.ts). The SDK keeps a file the model gave
 * in base64 (to-response-messages.ts).
 */
const BASE64 = /^[\w+/-]*={0,2}$/;
const inline = (data: unknown) => typeof data === "string" && BASE64.test(data);

/**
 * Whether every file part holds its data inline. A tool result of `content` may hold a URL in
 * several forms, and no tool of the core returns one.
 */
function filesInline(messages: readonly ModelMessage[]): boolean {
  return messages.every((message) => {
    if (typeof message.content === "string") return true;
    return message.content.every((part) => {
      switch (part.type) {
        case "image":
          return inline(part.image);
        case "file":
        case "reasoning-file":
          return inline(part.data);
        case "tool-result":
          return part.output.type !== "content";
        default:
          return true;
      }
    });
  });
}

/**
 * Whether each call has its result before the next message of the person, as the AI SDK requires
 * before it sends a conversation (ai 7.0.179 convert-to-language-model-prompt.ts): a call the
 * provider ran has none.
 */
function callsAnswered(messages: readonly ModelMessage[]): boolean {
  const open = new Set<string>();
  for (const message of messages) {
    if (message.role === "user" || message.role === "system") {
      if (open.size > 0) return false;
      continue;
    }
    if (typeof message.content === "string") continue;
    for (const part of message.content) {
      if (message.role === "assistant" && part.type === "tool-call" && !part.providerExecuted) {
        open.add(part.toolCallId);
      }
      if (message.role === "tool" && part.type === "tool-result") open.delete(part.toolCallId);
    }
  }
  return open.size === 0;
}

/**
 * Checks the messages of a `resume`'s state. Those that pass are given back as they came: the AI
 * SDK's schema drops keys it does not know, which a provider may still read.
 */
export function checkMessages(
  values: readonly unknown[],
): { messages: ModelMessage[] } | { refusal: MessagesRefusal } {
  if (!values.every((value) => modelMessageSchema.safeParse(value).success)) {
    return { refusal: "messages" };
  }
  const messages = values as ModelMessage[];
  if (messages.some((message) => message.role === "system")) return { refusal: "system" };
  if (!filesInline(messages)) return { refusal: "file_data" };
  if (!callsAnswered(messages)) return { refusal: "unanswered" };
  return { messages };
}

const reasoningParts = (messages: readonly ModelMessage[]) =>
  messages
    .flatMap((message) =>
      message.role === "assistant" && typeof message.content !== "string" ? message.content : [],
    )
    .filter((part) => part.type === "reasoning" || part.type === "reasoning-file").length;

/**
 * The conversation without its reasoning, and how many parts that took out; a message left empty
 * goes as well. Anthropic takes back thinking only in the conversation that gave it, under the
 * same instructions and tools (ADR-0012 "이어 쓰기").
 */
export function withoutReasoning(messages: ModelMessage[]): {
  messages: ModelMessage[];
  pruned: number;
} {
  const kept = pruneMessages({ messages, reasoning: "all", emptyMessages: "remove" });
  return { messages: kept, pruned: reasoningParts(messages) - reasoningParts(kept) };
}
