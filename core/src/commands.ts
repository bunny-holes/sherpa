import { invalidRequest } from "./cli/errors.ts";
import * as imessage from "./imessage/commands.ts";
import { journaled, type JournaledResult, MutationJournal } from "./journal/journal.ts";
import * as kakaotalk from "./kakaotalk/commands.ts";
import { EnvelopeIndex } from "./mail/envelope-index.ts";
import { type MailMessage, mailAuthorizationStatus, sendMail } from "./mail/outbound.ts";

/**
 * The core commands both outer adapters call: the `sherpa` argv dispatch and
 * the MCP tools of `sherpa app serve` (app-connection-v1 §11). Each takes
 * typed values, runs the same validation, journal and output shape, and
 * rejects the same input with the same stable code.
 */
export interface CoreCommands {
  imessageChats(limit: number): Promise<string>;
  imessageHistory(input: {
    chatID: bigint;
    start: string;
    end: string;
    limit: number;
  }): Promise<string>;
  imessageSend(input: {
    chatID: bigint;
    text: Uint8Array;
    operationID?: string;
  }): Promise<JournaledResult<Uint8Array>>;
  kakaotalkStatus(): Promise<string>;
  kakaotalkSearch(query: Uint8Array, limit: number): Promise<string>;
  kakaotalkHistory(displayName: Uint8Array, limit: number): Promise<string>;
  kakaotalkArchive(input: { since: string; timeZone: string; limit: number }): Promise<string>;
  kakaotalkCheckpoint(confirm: string, token: Uint8Array): Promise<string>;
  mailAuthorizationStatus(): Promise<Uint8Array>;
  mailList(input: {
    from: string;
    to: string;
    limit: number;
    maxBodyBytes: number;
    cursor?: string;
  }): Promise<string>;
  mailRead(input: { messageID: string; maxBodyBytes: number }): Promise<string>;
  mailSend(input: {
    message: MailMessage;
    operationID?: string;
  }): Promise<JournaledResult<Uint8Array>>;
  operationsList(limit: number): Promise<string>;
}

/** The confirmation value of `kakaotalk checkpoint` (`--confirm` and the tool's `confirm`). */
export const CHECKPOINT_CONFIRMATION = "COMMIT_LOCAL_CHECKPOINT";
const MAIL_BODY_BYTES_MAX = 1024 * 1024;

/** The commands against this Mac's stores, journal and apps. */
export const systemCommands: CoreCommands = {
  imessageChats: (limit) => imessage.chats(limit),
  imessageHistory: (input) => imessage.history(input),
  imessageSend: ({ chatID, text, operationID }) =>
    journaled(
      MutationJournal.openDefault(),
      "imessage.send",
      () => imessage.send(chatID, text),
      operationID,
    ),
  kakaotalkStatus: () => kakaotalk.status(),
  kakaotalkSearch: (query, limit) => kakaotalk.search(query, limit),
  kakaotalkHistory: (displayName, limit) => kakaotalk.history(displayName, limit),
  kakaotalkArchive: (input) => kakaotalk.archive(input),
  kakaotalkCheckpoint: async (confirm, token) => {
    if (confirm !== CHECKPOINT_CONFIRMATION) throw invalidRequest();
    return kakaotalk.commitCheckpoint(token);
  },
  mailAuthorizationStatus: () => mailAuthorizationStatus(),
  mailList: async ({ from, to, limit, maxBodyBytes, cursor }) => {
    if (maxBodyBytes < 0 || maxBodyBytes > MAIL_BODY_BYTES_MAX) throw invalidRequest();
    return JSON.stringify(
      new EnvelopeIndex().list({ from, to, limit, ...(cursor ? { cursor } : {}) }),
    );
  },
  mailRead: async ({ messageID, maxBodyBytes }) =>
    JSON.stringify(new EnvelopeIndex().read(messageID, maxBodyBytes)),
  mailSend: ({ message, operationID }) =>
    journaled(MutationJournal.openDefault(), "mail.send", () => sendMail(message), operationID),
  operationsList: async (limit) => JSON.stringify(MutationJournal.openDefault().recent(limit)),
};
