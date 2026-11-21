import { invalidRequest, SherpaError } from "../cli/errors.ts";
import { utf8 } from "../cli/stdin.ts";
import { log } from "../log.ts";
import { chatLine, messageLine } from "./output.ts";
import { type Runner, sendToChat } from "./send.ts";
import { defaultChatDatabasePath, FULL_DISK_ACCESS, MessageStore } from "./store.ts";
import { parseInstant } from "./time.ts";

/**
 * `sherpa imessage chats|history|send`. Reads come straight from chat.db
 * (read-only) and print the newline-delimited JSON that 0.7.x passed through
 * from `imsg 0.21.1`; send drives Messages.app through osascript.
 */
export interface IMessageEnvironment {
  databasePath: string;
  osascript?: string;
  run?: Runner;
}

const MAX_TEXT_BYTES = 64 * 1024;
const INT64_MAX = 9_223_372_036_854_775_807n;

/** The message body `send` accepts: 1 byte to 64 KiB of strict UTF-8 without NUL. */
export function messageBody(text: Uint8Array): string {
  if (text.byteLength === 0 || text.byteLength > MAX_TEXT_BYTES) throw invalidRequest();
  const body = utf8(text);
  if (body.includes("\0")) throw invalidRequest();
  return body;
}

function withStore<T>(environment: IMessageEnvironment, body: (store: MessageStore) => T): T {
  const store = MessageStore.open(environment.databasePath);
  try {
    return body(store);
  } catch (error) {
    if (error instanceof SherpaError) throw error;
    log.error(
      `[adapter:imessage:read] failure error_type=${error instanceof Error ? error.name : typeof error}`,
    );
    throw new SherpaError("imessage.store_unreadable", { remedy: FULL_DISK_ACCESS });
  } finally {
    store.close();
  }
}

export function imessageCommands(environment: IMessageEnvironment) {
  return {
    async chats(limit: number): Promise<string> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw invalidRequest();
      log.info(`[adapter:imessage:chats] start limit=${limit}`);
      const lines = withStore(environment, (store) =>
        store
          .listChats(limit)
          .map((chat) => chatLine(chat, store.chatInfo(chat.id), store.participants(chat.id))),
      );
      log.info(`[adapter:imessage:chats] success count=${lines.length}`);
      return lines.join("\n");
    },

    async history(options: {
      chatID: bigint;
      start: string;
      end: string;
      limit: number;
    }): Promise<string> {
      const { chatID, limit } = options;
      if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw invalidRequest();
      const start = parseInstant(options.start);
      const end = parseInstant(options.end);
      log.info(`[adapter:imessage:history] start chat_id=${chatID} limit=${limit}`);
      if (chatID > BigInt(Number.MAX_SAFE_INTEGER)) return "";
      const id = Number(chatID);
      const lines = withStore(environment, (store) => {
        const messages = store.messages(id, limit, { start, end });
        const attachments = store.attachments(
          messages.filter((m) => m.unsentAt === null).map((m) => m.rowID),
        );
        const reactions = store.reactions(messages);
        const info = new Map<number, ReturnType<MessageStore["chatInfo"]>>();
        const participants = new Map<number, string[]>();
        return messages.map((message) => {
          if (!info.has(message.chatID)) {
            info.set(message.chatID, store.chatInfo(message.chatID));
            participants.set(message.chatID, store.participants(message.chatID));
          }
          return messageLine(
            message,
            info.get(message.chatID) ?? null,
            participants.get(message.chatID) ?? [],
            attachments.get(message.rowID) ?? [],
            reactions.get(message.rowID) ?? [],
          );
        });
      });
      log.info(`[adapter:imessage:history] success chat_id=${chatID} count=${lines.length}`);
      return lines.join("\n");
    },

    async send(chatID: bigint, text: Uint8Array): Promise<Uint8Array> {
      const body = messageBody(text);
      const guids =
        chatID > INT64_MAX ? [] : withStore(environment, (store) => store.chatGUIDs(chatID));
      const guid = guids.length === 1 ? guids[0]! : "";
      if (guid === "" || /[\r\n]/.test(guid)) throw new SherpaError("imessage.chat_not_found");
      log.info(`[adapter:imessage:send] start chat_id=${chatID} bytes=${text.byteLength}`);
      try {
        const result = await sendToChat(guid, body, {
          ...(environment.osascript ? { executable: environment.osascript } : {}),
          ...(environment.run ? { run: environment.run } : {}),
        });
        log.info(`[adapter:imessage:send] success chat_id=${chatID} status=${result.status}`);
        return new TextEncoder().encode(JSON.stringify(result));
      } catch (error) {
        const code = error instanceof SherpaError ? error.code : "unknown";
        log.error(`[adapter:imessage:send] failure chat_id=${chatID} code=${code}`);
        throw error;
      }
    },
  };
}

const live = () => imessageCommands({ databasePath: defaultChatDatabasePath() });

export const chats = (limit: number): Promise<string> => live().chats(limit);

export const history = (options: {
  chatID: bigint;
  start: string;
  end: string;
  limit: number;
}): Promise<string> => live().history(options);

export const send = (chatID: bigint, text: Uint8Array): Promise<Uint8Array> =>
  live().send(chatID, text);
