import { z } from "zod";
import { invalidRequest } from "../cli/errors.ts";
import type { CoreCommands } from "../commands.ts";
import { messageBody } from "../imessage/commands.ts";
import type { JournaledResult } from "../journal/journal.ts";
import { validateMailMessage } from "../mail/outbound.ts";
import type { ConfirmationLine } from "./confirmation.ts";
import { type RegistryEntry, toolName } from "./registry.ts";

/**
 * The core tools (app-connection-v1 §10.2, §10.4): each maps its MCP arguments
 * onto the same core command the CLI calls. Arguments carry what the CLI takes
 * from flags and standard input; the CLI's `--confirm` of a send is replaced
 * by the app window.
 */
export type CoreRun =
  | { kind: "output"; output: string | Uint8Array }
  | { kind: "journaled"; result: JournaledResult<Uint8Array> };

export interface CorePreview {
  title: string;
  lines: ConfirmationLine[];
}

export interface CoreEntry extends RegistryEntry {
  source: "core";
  /** `lines` for commands that print one JSON object per line. */
  output: "json" | "lines";
  run(commands: CoreCommands, args: unknown, operationID: string): Promise<CoreRun>;
  /** Validates a send's arguments and builds its preview before the app is asked (§9). */
  preview?(args: unknown): CorePreview;
}

interface Definition<S extends z.ZodObject> {
  capability: string;
  effectClass: "read" | "send" | "local";
  inputSchema: S;
  description: string;
  output?: "json" | "lines";
  confirmation?: "app" | "argument";
  run: (commands: CoreCommands, args: z.infer<S>, operationID: string) => Promise<CoreRun>;
  preview?: (args: z.infer<S>) => CorePreview;
}

function coreTool<S extends z.ZodObject>(definition: Definition<S>): CoreEntry {
  const { preview } = definition;
  return {
    capability: definition.capability,
    source: "core",
    name: toolName(definition.capability),
    description: definition.description,
    inputSchema: definition.inputSchema,
    effectClass: definition.effectClass,
    confirmation: definition.confirmation ?? "none",
    deadlineMs: null,
    output: definition.output ?? "json",
    run: (commands, args, operationID) => definition.run(commands, args as z.infer<S>, operationID),
    ...(preview ? { preview: (args: unknown) => preview(args as z.infer<S>) } : {}),
  };
}

const output = async (value: Promise<string | Uint8Array>): Promise<CoreRun> => ({
  kind: "output",
  output: await value,
});
const bytes = (value: string) => new TextEncoder().encode(value);

/** The CLI's `--chat-id` is an unsigned decimal; JSON gives a number, held to the same rule. */
function chatID(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw invalidRequest();
  return BigInt(value);
}

const limit = z.int();
const instant = z.string().describe("ISO 8601 instant");
const addresses = z.array(z.string());

const SEND_CONFIRM =
  "Each call waits up to 30 seconds for the person to allow it in the Sherpa app window.";

export const coreEntries: readonly CoreEntry[] = [
  coreTool({
    capability: "imessage.chats",
    effectClass: "read",
    output: "lines",
    inputSchema: z.strictObject({ limit }),
    description:
      "List the most recent Messages chats (limit 1–1000), read from the local Messages database.",
    run: (commands, args) => output(commands.imessageChats(args.limit)),
  }),
  coreTool({
    capability: "imessage.history",
    effectClass: "read",
    output: "lines",
    inputSchema: z.strictObject({ chat_id: z.int(), start: instant, end: instant, limit }),
    description: "Read messages of one chat in [start, end), at most limit (1–10000).",
    run: (commands, args) =>
      output(
        commands.imessageHistory({
          chatID: chatID(args.chat_id),
          start: args.start,
          end: args.end,
          limit: args.limit,
        }),
      ),
  }),
  coreTool({
    capability: "imessage.send",
    effectClass: "send",
    confirmation: "app",
    inputSchema: z.strictObject({ chat_id: z.int(), text: z.string() }),
    description: `Send one iMessage to an existing chat through Messages.app. ${SEND_CONFIRM}`,
    preview: (args) => {
      chatID(args.chat_id);
      return {
        title: "Send this iMessage?",
        lines: [
          { label: "Chat", value: String(args.chat_id) },
          { label: "Message", value: messageBody(bytes(args.text)) },
        ],
      };
    },
    run: async (commands, args, operationID) => ({
      kind: "journaled",
      result: await commands.imessageSend({
        chatID: chatID(args.chat_id),
        text: bytes(args.text),
        operationID,
      }),
    }),
  }),
  coreTool({
    capability: "kakaotalk.status",
    effectClass: "read",
    inputSchema: z.strictObject({}),
    description: "Report whether the local KakaoTalk database can be read on this Mac.",
    run: (commands) => output(commands.kakaotalkStatus()),
  }),
  coreTool({
    capability: "kakaotalk.search",
    effectClass: "read",
    inputSchema: z.strictObject({ query: z.string(), limit }),
    description: "Search local KakaoTalk messages for a one-line query (limit 1–100).",
    run: (commands, args) => output(commands.kakaotalkSearch(bytes(args.query), args.limit)),
  }),
  coreTool({
    capability: "kakaotalk.history",
    effectClass: "read",
    inputSchema: z.strictObject({ display_name: z.string(), limit }),
    description:
      "Read the last seven days of one KakaoTalk chat by its exact display name (limit 1–1000).",
    run: (commands, args) =>
      output(commands.kakaotalkHistory(bytes(args.display_name), args.limit)),
  }),
  coreTool({
    capability: "kakaotalk.archive",
    effectClass: "read",
    inputSchema: z.strictObject({
      since: z.string().describe('a local date yyyy-mm-dd, or "checkpoint"'),
      time_zone: z.string().describe("IANA time zone"),
      limit,
    }),
    description:
      "Read KakaoTalk messages of all synchronized rooms since a local date or the last checkpoint (limit 1–50000). A complete archive returns a pending checkpoint token.",
    run: (commands, args) =>
      output(
        commands.kakaotalkArchive({
          since: args.since,
          timeZone: args.time_zone,
          limit: args.limit,
        }),
      ),
  }),
  coreTool({
    capability: "kakaotalk.checkpoint",
    effectClass: "local",
    confirmation: "argument",
    inputSchema: z.strictObject({
      token: z.string().describe("the pending checkpoint token of kakaotalk_archive"),
      confirm: z.string().describe('exactly "COMMIT_LOCAL_CHECKPOINT"'),
    }),
    description: "Commit a pending KakaoTalk checkpoint after its archive was analysed.",
    run: (commands, args) => output(commands.kakaotalkCheckpoint(args.confirm, bytes(args.token))),
  }),
  coreTool({
    capability: "mail.authorization-status",
    effectClass: "read",
    inputSchema: z.strictObject({}),
    description: "Report whether Sherpa may automate Mail.app.",
    run: (commands) => output(commands.mailAuthorizationStatus()),
  }),
  coreTool({
    capability: "mail.list",
    effectClass: "read",
    inputSchema: z.strictObject({
      from: instant,
      to: instant,
      limit,
      max_body_bytes: z.int(),
      cursor: z.string().optional().describe("next_cursor of the previous page, same from and to"),
    }),
    description:
      "List Mail.app messages received in [from, to), newest first, with bodies cut to max_body_bytes (0–1048576).",
    run: (commands, args) =>
      output(
        commands.mailList({
          from: args.from,
          to: args.to,
          limit: args.limit,
          maxBodyBytes: args.max_body_bytes,
          ...(args.cursor ? { cursor: args.cursor } : {}),
        }),
      ),
  }),
  coreTool({
    capability: "mail.read",
    effectClass: "read",
    inputSchema: z.strictObject({ message_id: z.string(), max_body_bytes: z.int() }),
    description: "Read one Mail.app message by message_id with its body cut to max_body_bytes.",
    run: (commands, args) =>
      output(commands.mailRead({ messageID: args.message_id, maxBodyBytes: args.max_body_bytes })),
  }),
  coreTool({
    capability: "mail.send",
    effectClass: "send",
    confirmation: "app",
    inputSchema: z.strictObject({
      sender: z.string().nullable().optional().describe("a configured Mail.app sender address"),
      to: addresses,
      cc: addresses,
      bcc: addresses,
      subject: z.string(),
      body: z.string(),
    }),
    description: `Send one plain-text mail through Mail.app. ${SEND_CONFIRM}`,
    preview: (args) => {
      const message = validateMailMessage(args);
      return {
        title: "Send this mail?",
        lines: [
          { label: "From", value: message.sender ?? "Mail.app default" },
          { label: "To", value: message.to.join(", ") },
          ...(message.cc.length ? [{ label: "Cc", value: message.cc.join(", ") }] : []),
          ...(message.bcc.length ? [{ label: "Bcc", value: message.bcc.join(", ") }] : []),
          { label: "Subject", value: message.subject },
          { label: "Body", value: message.body },
        ],
      };
    },
    run: async (commands, args, operationID) => ({
      kind: "journaled",
      result: await commands.mailSend({ message: validateMailMessage(args), operationID }),
    }),
  }),
  coreTool({
    capability: "operations.list",
    effectClass: "read",
    output: "json",
    inputSchema: z.strictObject({ limit }),
    description:
      "List the latest journaled external changes (limit 1–1000): status and stable error code.",
    run: (commands, args) => output(commands.operationsList(args.limit)),
  }),
];
