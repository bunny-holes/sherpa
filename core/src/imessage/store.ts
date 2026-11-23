import { Database, type SQLQueryBindings } from "bun:sqlite";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SherpaError } from "../cli/errors.ts";
import { log } from "../log.ts";
import { isPlistDictionary, tryParseBinaryPlist } from "../plist/plist.ts";
import {
  decodePoll,
  isPollCandidate,
  normalizedAssociatedGUID,
  POLLS_BUNDLE_IDENTIFIER,
  type PollEvent,
  pollWithQuestion,
  resolvePollReference,
  resolveVoteOptionTexts,
  UPDATE_ASSOCIATED_MESSAGE_TYPE,
  VOTE_ASSOCIATED_MESSAGE_TYPE,
  type PollOption,
} from "./poll.ts";
import {
  extractCustomEmoji,
  isReaction,
  isReactionRemove,
  nonReactionPredicate,
  reactionPredicate,
  reactionType,
  type ReactionType,
  sameReactionType,
} from "./reaction.ts";
import { appleNanoseconds, appleSeconds } from "./time.ts";
import { parseAttributedBody } from "./typedstream.ts";

/**
 * Read-only access to the Messages database (`~/Library/Messages/chat.db`).
 * Queries, ordering, limits and decoding follow imsg 0.21.1 so the JSON that
 * Sherpa prints matches what 0.7.x passed through from `imsg`.
 */
export const FULL_DISK_ACCESS =
  "grant Full Disk Access to the app that runs sherpa (System Settings > Privacy & Security > Full Disk Access)";

export const defaultChatDatabasePath = (): string => join(homedir(), "Library/Messages/chat.db");

const URL_PREVIEW_BUNDLE_ID = "com.apple.messages.URLBalloonProvider";
const URL_PREVIEW_WINDOW_SECONDS = 5;

type Row = Record<string, unknown>;

interface Schema {
  attributedBody: boolean;
  reactionColumns: boolean;
  associatedMessageEmoji: boolean;
  threadOriginatorGUID: boolean;
  threadOriginatorPart: boolean;
  destinationCallerID: boolean;
  audioMessage: boolean;
  attachmentUserInfo: boolean;
  balloonBundleID: boolean;
  payloadData: boolean;
  messageSummaryInfo: boolean;
  replyToGUID: boolean;
  chatMessageJoinMessageDate: boolean;
  chatAccountID: boolean;
  chatAccountLogin: boolean;
  chatLastAddressedHandle: boolean;
  isRead: boolean;
  dateRead: boolean;
  dateEdited: boolean;
  dateRetracted: boolean;
  unreadMessageIndex: boolean;
}

export interface Chat {
  id: number;
  identifier: string;
  name: string;
  service: string;
  lastMessageAt: number;
  accountID: string | null;
  accountLogin: string | null;
  lastAddressedHandle: string | null;
  unreadCount: number | null;
}

export interface ChatInfo {
  id: number;
  identifier: string;
  guid: string;
  name: string;
  service: string;
  accountID: string | null;
  accountLogin: string | null;
  lastAddressedHandle: string | null;
}

export interface URLPreview {
  rowID: number;
  guid: string;
  balloonBundleID: string;
  date: number;
}

export interface Message {
  rowID: number;
  chatID: number;
  handleID: number | null;
  sender: string;
  text: string;
  /** Seconds since 2001 as a Foundation `Date` holds them. */
  date: number;
  isFromMe: boolean;
  guid: string;
  replyToGUID: string | null;
  threadOriginatorGUID: string | null;
  threadOriginatorPart: string | null;
  destinationCallerID: string | null;
  replyToText: string | null;
  replyToSender: string | null;
  balloonBundleID: string | null;
  urlPreview: URLPreview | null;
  isReaction: boolean;
  poll: PollEvent | null;
  isRead: boolean | null;
  dateRead: number | null;
  editedAt: number | null;
  unsentAt: number | null;
}

export interface AttachmentMeta {
  filename: string;
  transferName: string;
  uti: string;
  mimeType: string;
  totalBytes: number;
  isSticker: boolean;
  originalPath: string;
  missing: boolean;
}

export interface Reaction {
  rowID: number;
  type: ReactionType;
  sender: string;
  isFromMe: boolean;
  date: number;
}

export interface MessageFilter {
  /** Inclusive lower bound, seconds since 2001. */
  start: number;
  /** Exclusive upper bound, seconds since 2001. */
  end: number;
}

interface DecodedRow {
  rowID: number;
  chatID: number;
  handleID: number | null;
  sender: string;
  text: string;
  date: number;
  isFromMe: boolean;
  destinationCallerID: string;
  guid: string;
  associatedGUID: string;
  associatedType: number | null;
  threadOriginatorGUID: string;
  threadOriginatorPart: string;
  balloonBundleID: string;
  poll: PollEvent | null;
  isRead: boolean | null;
  editedAt: number | null;
  unsentAt: number | null;
  dateRead: number | null;
}

interface ReactionRow {
  rowID: number;
  typeValue: number;
  sender: string;
  isFromMe: boolean;
  timestamp: bigint;
  resolvedText: string;
  associatedEmoji: string;
  messageID: number;
}

type ReplyParent = { text: string; sender: string } | null;

/** Per-call caches, as imsg keeps them per query loop. */
interface Caches {
  parents: Map<string, ReplyParent>;
  pollOptions: Map<string, Map<string, string> | null>;
}

const newCaches = (): Caches => ({ parents: new Map(), pollOptions: new Map() });

const str = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean")
    return String(value);
  return "";
};

const bigint = (value: unknown): bigint | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "boolean") return value ? 1n : 0n;
  return null;
};

const num = (value: unknown): number | null => {
  const integer = bigint(value);
  return integer === null ? null : Number(integer);
};

const bool = (value: unknown): boolean => {
  const integer = bigint(value);
  return integer !== null && integer !== 0n;
};

const bytes = (value: unknown): Uint8Array => {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return new TextEncoder().encode(value);
  return new Uint8Array();
};

const nilIfEmpty = (value: string): string | null => (value === "" ? null : value);

/** Trims Unicode white space and newlines, as `whitespacesAndNewlines` does. */
export const trimWhitespace = (value: string): string =>
  value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");

export function normalizeAssociatedGUID(guid: string): string {
  if (guid === "") return "";
  const slash = guid.lastIndexOf("/");
  if (slash < 0 || slash === guid.length - 1) return guid;
  return guid.slice(slash + 1);
}

export function isGroupHandle(identifier: string, guid: string): boolean {
  return guid.includes(";+;") || identifier.includes(";+;");
}

/** `~` and `~user` expansion like `NSString.expandingTildeInPath`. */
export function expandTilde(path: string, home = homedir()): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return path;
}

export class MessageStore {
  private readonly db: Database;
  private readonly schema: Schema;
  private readonly selection: string;
  private readonly scopedSelection: string;

  private constructor(db: Database) {
    this.db = db;
    this.schema = this.readSchema();
    this.selection = this.selectList(null);
    this.scopedSelection = this.selectList("cmj.chat_id");
  }

  /** Opens chat.db read-only. Any failure to open or read it is a permission problem. */
  static open(path = defaultChatDatabasePath()): MessageStore {
    log.info("[adapter:imessage:open] start");
    let db: Database | undefined;
    try {
      db = new Database(path, { readonly: true, safeIntegers: true });
      db.run("PRAGMA busy_timeout = 5000");
      const store = new MessageStore(db);
      log.info("[adapter:imessage:open] success");
      return store;
    } catch (error) {
      db?.close();
      log.error(
        `[adapter:imessage:open] failure error_type=${error instanceof Error ? error.name : typeof error}`,
      );
      throw new SherpaError("imessage.store_unreadable", { remedy: FULL_DISK_ACCESS });
    }
  }

  close(): void {
    this.db.close();
  }

  private all(sql: string, ...bindings: SQLQueryBindings[]): Row[] {
    return this.db.query<Row, SQLQueryBindings[]>(sql).all(...bindings);
  }

  private *iterate(sql: string, ...bindings: SQLQueryBindings[]): Generator<Row> {
    // A fresh statement: an iteration can call back into the store with the same SQL.
    const statement = this.db.prepare<Row, SQLQueryBindings[]>(sql);
    try {
      yield* statement.iterate(...bindings);
    } finally {
      statement.finalize();
    }
  }

  private columns(table: string): Set<string> {
    return new Set(
      this.all(`PRAGMA table_info(${table})`).map((row) => str(row.name).toLowerCase()),
    );
  }

  private readSchema(): Schema {
    const message = this.columns("message");
    const attachment = this.columns("attachment");
    const chatMessageJoin = this.columns("chat_message_join");
    const chat = this.columns("chat");
    if (message.size === 0 || chat.size === 0 || chatMessageJoin.size === 0) {
      throw new Error("Messages schema is missing");
    }
    let unreadIndex = false;
    for (const index of this.all(
      "SELECT name FROM pragma_index_list('message') WHERE partial = 0",
    )) {
      const names = this.all(
        "SELECT name FROM pragma_index_info(?) ORDER BY seqno LIMIT 2",
        str(index.name),
      ).map((row) => str(row.name).toLowerCase());
      const set = new Set(names);
      if (set.size === 2 && set.has("is_read") && set.has("is_from_me")) unreadIndex = true;
    }
    return {
      attributedBody: message.has("attributedbody"),
      reactionColumns:
        message.has("guid") &&
        message.has("associated_message_guid") &&
        message.has("associated_message_type"),
      associatedMessageEmoji: message.has("associated_message_emoji"),
      threadOriginatorGUID: message.has("thread_originator_guid"),
      threadOriginatorPart: message.has("thread_originator_part"),
      destinationCallerID: message.has("destination_caller_id"),
      audioMessage: message.has("is_audio_message"),
      attachmentUserInfo: attachment.has("user_info"),
      balloonBundleID: message.has("balloon_bundle_id"),
      payloadData: message.has("payload_data"),
      messageSummaryInfo: message.has("message_summary_info"),
      replyToGUID: message.has("reply_to_guid"),
      chatMessageJoinMessageDate: chatMessageJoin.has("message_date"),
      chatAccountID: chat.has("account_id"),
      chatAccountLogin: chat.has("account_login"),
      chatLastAddressedHandle: chat.has("last_addressed_handle"),
      isRead: message.has("is_read"),
      dateRead: message.has("date_read"),
      dateEdited: message.has("date_edited"),
      dateRetracted: message.has("date_retracted"),
      unreadMessageIndex: unreadIndex,
    };
  }

  // MARK: message rows

  private selectList(chatIDColumn: string | null): string {
    const s = this.schema;
    const pollBundle = `'${POLLS_BUNDLE_IDENTIFIER}'`;
    const pollBalloon = s.balloonBundleID
      ? `(m.balloon_bundle_id = ${pollBundle} OR m.balloon_bundle_id LIKE '%:' || ${pollBundle})`
      : "0";
    const vote = s.reactionColumns
      ? `m.associated_message_type = ${VOTE_ASSOCIATED_MESSAGE_TYPE}`
      : "0";
    const pollCandidate = `(${pollBalloon} OR ${vote})`;
    const summaryPredicate = s.dateEdited
      ? `(${pollCandidate} OR m.date_edited > 0)`
      : pollCandidate;
    const columns = [
      `m.ROWID AS message_rowid${chatIDColumn ? `, ${chatIDColumn} AS chat_id` : ""}`,
      "m.handle_id AS handle_id",
      "h.id AS sender",
      "IFNULL(m.text, '') AS text",
      "m.date AS date",
      "m.is_from_me AS is_from_me",
      "m.service AS service",
      `${s.audioMessage ? "m.is_audio_message" : "0"} AS is_audio_message`,
      `${s.destinationCallerID ? "m.destination_caller_id" : "NULL"} AS destination_caller_id`,
      `${s.reactionColumns ? "m.guid" : "NULL"} AS guid`,
      `${s.reactionColumns ? "m.associated_message_guid" : "NULL"} AS associated_guid`,
      `${s.reactionColumns ? "m.associated_message_type" : "NULL"} AS associated_type`,
      `${s.associatedMessageEmoji ? "m.associated_message_emoji" : "NULL"} AS associated_emoji`,
      "(SELECT COUNT(*) FROM message_attachment_join maj WHERE maj.message_id = m.ROWID) AS attachments",
      `${s.attributedBody ? "m.attributedBody" : "NULL"} AS body`,
      `${s.threadOriginatorGUID ? "m.thread_originator_guid" : "NULL"} AS thread_originator_guid`,
      `${s.threadOriginatorPart ? "m.thread_originator_part" : "NULL"} AS thread_originator_part`,
      `${s.balloonBundleID ? "m.balloon_bundle_id" : "NULL"} AS balloon_bundle_id`,
      `${s.payloadData ? `CASE WHEN ${pollCandidate} THEN m.payload_data ELSE NULL END` : "NULL"} AS payload_data`,
      `${
        s.messageSummaryInfo
          ? `CASE WHEN ${summaryPredicate} THEN m.message_summary_info ELSE NULL END`
          : "NULL"
      } AS message_summary_info`,
      `${s.isRead ? "m.is_read" : "NULL"} AS is_read`,
      `${s.dateEdited ? "m.date_edited" : "NULL"} AS date_edited`,
      `${s.dateRetracted ? "m.date_retracted" : "NULL"} AS date_retracted`,
      `${s.dateRead ? "m.date_read" : "NULL"} AS date_read`,
    ];
    return columns.join(", ");
  }

  private decodeRow(row: Row, fallbackChatID: number | null): DecodedRow {
    const rowID = num(row.message_rowid) ?? 0;
    const chatID = num(row.chat_id) ?? fallbackChatID ?? 0;
    const handle = str(row.sender);
    const text = str(row.text);
    const isFromMe = bool(row.is_from_me);
    const destinationCallerID = str(row.destination_caller_id);
    const guid = str(row.guid);
    const associatedGUID = str(row.associated_guid);
    const associatedType = num(row.associated_type);
    const body = bytes(row.body);
    const balloonBundleID = str(row.balloon_bundle_id);
    const edited = bigint(row.date_edited) ?? 0n;
    const retracted = retractedStamp(
      edited,
      bigint(row.date_retracted) ?? 0n,
      bytes(row.message_summary_info),
    );
    const editedAt = edited > 0n ? appleSeconds(edited) : null;
    const unsentAt = retracted > 0n ? appleSeconds(retracted) : null;

    let resolvedText = text;
    if (unsentAt !== null) resolvedText = "";
    else if (text === "" || (editedAt !== null && body.byteLength > 0))
      resolvedText = parseAttributedBody(body);
    if (unsentAt === null && bool(row.is_audio_message)) {
      const transcription = this.audioTranscription(rowID);
      if (transcription !== null) resolvedText = transcription;
    }

    // Outgoing rows join the recipient's handle, so destination_caller_id is the real sender.
    const sender =
      destinationCallerID !== "" && (isFromMe || handle === "") ? destinationCallerID : handle;

    let poll: PollEvent | null = null;
    if (unsentAt === null && isPollCandidate(balloonBundleID, associatedType)) {
      poll = decodePoll({
        balloonBundleID,
        payloadData: bytes(row.payload_data),
        messageSummaryInfo: bytes(row.message_summary_info),
        associatedMessageType: associatedType,
        associatedMessageGUID: associatedGUID,
        messageGUID: guid,
        sender,
      });
    }

    let isRead: boolean | null = null;
    let dateRead: number | null = null;
    const readRaw = num(row.is_read);
    if (!isFromMe && readRaw !== null) {
      isRead = readRaw !== 0;
      if (isRead) {
        const readAt = bigint(row.date_read);
        dateRead = readAt !== null && readAt > 0n ? appleSeconds(readAt) : null;
      }
    }

    return {
      rowID,
      chatID,
      handleID: num(row.handle_id),
      sender,
      text: resolvedText,
      date: appleSeconds(bigint(row.date)),
      isFromMe,
      destinationCallerID,
      guid,
      associatedGUID,
      associatedType,
      threadOriginatorGUID: str(row.thread_originator_guid),
      threadOriginatorPart: str(row.thread_originator_part),
      balloonBundleID,
      poll,
      isRead,
      editedAt,
      unsentAt,
      dateRead,
    };
  }

  private audioTranscription(messageID: number): string | null {
    if (!this.schema.attachmentUserInfo) return null;
    const rows = this.all(
      `SELECT a.user_info
       FROM message_attachment_join maj
       JOIN attachment a ON a.ROWID = maj.attachment_id
       WHERE maj.message_id = ?
       ORDER BY a.ROWID ASC`,
      messageID,
    );
    for (const row of rows) {
      const info = bytes(row.user_info);
      if (info.byteLength === 0) continue;
      const plist = tryParseBinaryPlist(info);
      if (!isPlistDictionary(plist)) continue;
      const transcription = plist["audio-transcription"];
      if (typeof transcription === "string" && transcription !== "") return transcription;
    }
    return null;
  }

  private routedReplyToGUID(row: DecodedRow): string | null {
    if (isReaction(row.associatedType)) return null;
    // Not the reply_to_guid column: Messages points it at the previous row on most messages.
    const threadOriginator = normalizeAssociatedGUID(row.threadOriginatorGUID);
    if (threadOriginator !== "") return threadOriginator;
    const associated = normalizeAssociatedGUID(row.associatedGUID);
    return associated === "" ? null : associated;
  }

  private message(row: DecodedRow, caches: Caches): Message {
    const poll = this.enrichedPoll(row.poll, caches);
    const reaction = isReaction(row.associatedType);
    const replyToGUID = this.routedReplyToGUID(row);
    const threadOriginatorGUID =
      reaction || row.threadOriginatorGUID === "" ? null : row.threadOriginatorGUID;
    const threadOriginatorPart =
      reaction || row.threadOriginatorPart === "" ? null : row.threadOriginatorPart;
    const parent = reaction ? null : this.replyContext(replyToGUID, threadOriginatorGUID, caches);
    return {
      rowID: row.rowID,
      chatID: row.chatID,
      handleID: row.handleID,
      sender: row.sender,
      text: row.text,
      date: row.date,
      isFromMe: row.isFromMe,
      guid: row.guid,
      replyToGUID,
      threadOriginatorGUID,
      threadOriginatorPart,
      destinationCallerID: nilIfEmpty(row.destinationCallerID),
      replyToText: parent?.text ?? null,
      replyToSender: parent?.sender ?? null,
      balloonBundleID: nilIfEmpty(row.balloonBundleID),
      urlPreview: null,
      isReaction: reaction,
      poll,
      isRead: row.isRead,
      dateRead: row.dateRead,
      editedAt: row.editedAt,
      unsentAt: row.unsentAt,
    };
  }

  private replyContext(
    replyToGUID: string | null,
    threadOriginatorGUID: string | null,
    caches: Caches,
  ): ReplyParent {
    for (const guid of [threadOriginatorGUID, replyToGUID]) {
      if (!guid) continue;
      if (caches.parents.has(guid)) {
        const cached = caches.parents.get(guid)!;
        if (cached) return cached;
        continue;
      }
      let result: ReplyParent = null;
      try {
        const row = this.all(
          `SELECT ${this.selection} FROM message m LEFT JOIN handle h ON m.handle_id = h.ROWID WHERE m.guid = ? LIMIT 1`,
          guid,
        )[0];
        if (row) {
          const decoded = this.decodeRow(row, null);
          result = { text: decoded.text, sender: decoded.sender };
        }
      } catch (error) {
        // imsg treats a failed parent lookup as "no parent"; the reply itself still prints.
        log.debug(
          `[adapter:imessage:reply-parent] skipped error_type=${error instanceof Error ? error.name : "unknown"}`,
        );
      }
      caches.parents.set(guid, result);
      if (result) return result;
    }
    return null;
  }

  // MARK: polls

  private enrichedPoll(poll: PollEvent | null, caches: Caches): PollEvent | null {
    if (!poll) return null;
    if (poll.kind === "created" && trimWhitespace(poll.question ?? "") === "" && poll.pollGUID) {
      const pollGUID = normalizeAssociatedGUID(poll.pollGUID);
      if (pollGUID !== "") {
        const caption = this.pollCommentText(pollGUID);
        if (caption !== null) return pollWithQuestion(poll, caption);
      }
      return poll;
    }
    if (poll.kind !== "vote") return poll;
    const candidates = [poll.originalGUID, poll.pollGUID]
      .map((value) => (value ? normalizeAssociatedGUID(value) : ""))
      .filter((value) => value !== "");
    const first = candidates[0];
    if (first === undefined) return poll;
    const source = this.sourcePollGUID(candidates) ?? first;
    const optionTexts = this.pollOptionTexts(source, caches);
    return resolvePollReference(resolveVoteOptionTexts(poll, optionTexts), source, source);
  }

  private pollCommentText(pollGUID: string): string | null {
    if (!this.schema.replyToGUID) return null;
    const conditions = ["(m.reply_to_guid = ? OR m.reply_to_guid LIKE '%/' || ?)"];
    if (this.schema.reactionColumns) {
      conditions.push("(m.associated_message_type IS NULL OR m.associated_message_type = 0)");
    }
    if (this.schema.threadOriginatorGUID) conditions.push("m.thread_originator_guid IS NULL");
    const row = this.all(
      `SELECT ${this.selection}
       FROM message m
       LEFT JOIN handle h ON m.handle_id = h.ROWID
       WHERE ${conditions.join(" AND ")}
       ORDER BY m.date ASC, m.ROWID ASC
       LIMIT 1`,
      pollGUID,
      pollGUID,
    )[0];
    if (!row) return null;
    const text = trimWhitespace(this.decodeRow(row, null).text);
    return text === "" ? null : text;
  }

  private pollOptionTexts(pollGUID: string, caches: Caches): Map<string, string> {
    if (caches.pollOptions.has(pollGUID)) return caches.pollOptions.get(pollGUID) ?? new Map();
    const options = this.decodedPollOptions(pollGUID);
    if (options.length === 0) {
      caches.pollOptions.set(pollGUID, null);
      return new Map();
    }
    const texts = new Map<string, string>();
    for (const option of options) if (!texts.has(option.id)) texts.set(option.id, option.text);
    caches.pollOptions.set(pollGUID, texts);
    return texts;
  }

  private decodedPollOptions(guid: string): PollOption[] {
    const source = this.sourcePollGUID([guid]) ?? guid;
    const hasUpdates = this.schema.reactionColumns;
    const updates = hasUpdates
      ? `UNION SELECT guid FROM message
         WHERE associated_message_type = ?
           AND (associated_message_guid = ? COLLATE NOCASE OR associated_message_guid LIKE '%/' || ?)`
      : "";
    const bindings: SQLQueryBindings[] = hasUpdates
      ? [source, UPDATE_ASSOCIATED_MESSAGE_TYPE, source, source]
      : [source];
    const rows = this.all(
      `WITH poll_references(guid) AS (SELECT ? ${updates})
       SELECT ${this.selection}
       FROM message m
       LEFT JOIN handle h ON m.handle_id = h.ROWID
       WHERE m.guid COLLATE NOCASE IN (SELECT guid FROM poll_references)
       ORDER BY m.date ASC, m.ROWID ASC`,
      ...bindings,
    );
    const options: PollOption[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      for (const option of this.decodeRow(row, null).poll?.options ?? []) {
        if (seen.has(option.id)) continue;
        seen.add(option.id);
        options.push(option);
      }
    }
    return options;
  }

  private sourcePollGUID(candidates: string[]): string | null {
    if (!this.schema.reactionColumns) return null;
    for (const candidate of candidates) {
      const row = this.all(
        `SELECT associated_message_guid FROM message
         WHERE guid = ? COLLATE NOCASE AND associated_message_type = ? AND IFNULL(associated_message_guid, '') != ''
         LIMIT 1`,
        candidate,
        UPDATE_ASSOCIATED_MESSAGE_TYPE,
      )[0];
      if (row && row.associated_message_guid !== null) {
        const normalized = normalizedAssociatedGUID(str(row.associated_message_guid));
        if (normalized) return normalized;
      }
    }
    return candidates[0] ?? null;
  }

  // MARK: URL previews

  private isURLPreview(message: Message): boolean {
    return message.balloonBundleID === URL_PREVIEW_BUNDLE_ID;
  }

  private canCoalesce(text: Message, preview: Message): boolean {
    if (!this.isURLPreview(preview)) return false;
    if (text.balloonBundleID !== null) return false;
    if (
      text.chatID !== preview.chatID ||
      text.isFromMe !== preview.isFromMe ||
      text.sender !== preview.sender
    ) {
      return false;
    }
    if (text.handleID !== null && preview.handleID !== null && text.handleID !== preview.handleID)
      return false;
    if (preview.rowID <= text.rowID) return false;
    const delta = preview.date - text.date;
    if (!(delta >= 0 && delta <= URL_PREVIEW_WINDOW_SECONDS)) return false;
    const previewText = trimWhitespace(preview.text);
    const lower = previewText.toLowerCase();
    if (!lower.startsWith("http://") && !lower.startsWith("https://") && !lower.startsWith("www."))
      return false;
    const haystack = text.text.toLowerCase();
    return [previewText, previewText.replace(/^\/+|\/+$/g, "")].some(
      (candidate) => candidate !== "" && haystack.includes(candidate.toLowerCase()),
    );
  }

  /** The text message a URL preview row belongs to, or null when it stands alone. */
  private precedingTextMessage(preview: Message, enrich: boolean): Message | null {
    if (!this.isURLPreview(preview)) return null;
    const reactionFilter = this.schema.reactionColumns
      ? `AND ${nonReactionPredicate("m.associated_message_type")}`
      : "";
    const previews = [preview];
    const caches = newCaches();
    for (const row of this.iterate(
      `SELECT ${this.scopedSelection}
       FROM message m
       JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
       LEFT JOIN handle h ON m.handle_id = h.ROWID
       WHERE m.ROWID < ? AND cmj.chat_id = ? ${reactionFilter}
       ORDER BY cmj.message_id DESC`,
      preview.rowID,
      preview.chatID,
    )) {
      const decoded = this.decodeRow(row, preview.chatID);
      const previous = enrich ? this.message(decoded, caches) : this.plainMessage(decoded);
      if (this.isURLPreview(previous)) {
        previews.push(previous);
        continue;
      }
      // One send can produce a contiguous preview row per URL; validate the whole run.
      return previews.every((item) => this.canCoalesce(previous, item)) ? previous : null;
    }
    return null;
  }

  /** A message without reply or poll enrichment, for paths that only need its identity. */
  private plainMessage(row: DecodedRow): Message {
    return {
      rowID: row.rowID,
      chatID: row.chatID,
      handleID: row.handleID,
      sender: row.sender,
      text: row.text,
      date: row.date,
      isFromMe: row.isFromMe,
      guid: row.guid,
      replyToGUID: null,
      threadOriginatorGUID: null,
      threadOriginatorPart: null,
      destinationCallerID: nilIfEmpty(row.destinationCallerID),
      replyToText: null,
      replyToSender: null,
      balloonBundleID: nilIfEmpty(row.balloonBundleID),
      urlPreview: null,
      isReaction: isReaction(row.associatedType),
      poll: null,
      isRead: row.isRead,
      dateRead: row.dateRead,
      editedAt: row.editedAt,
      unsentAt: row.unsentAt,
    };
  }

  private withURLPreview(message: Message, preview: Message): Message {
    return {
      ...message,
      urlPreview: {
        rowID: preview.rowID,
        guid: preview.guid,
        balloonBundleID: preview.balloonBundleID ?? URL_PREVIEW_BUNDLE_ID,
        date: preview.date,
      },
    };
  }

  // MARK: history

  /**
   * Messages of one chat in [start, end), newest first, at most `limit` after
   * URL preview rows fold into the text message they belong to.
   */
  messages(chatID: number, limit: number, filter: MessageFilter): Message[] {
    if (limit <= 0) return [];
    let physicalLimit = limit;
    const reactionFilter = this.schema.reactionColumns
      ? ` AND ${nonReactionPredicate("m.associated_message_type")}`
      : "";
    const sql = `SELECT ${this.selection}
      FROM message m
      JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      WHERE cmj.chat_id = ?${reactionFilter} AND m.date >= ? AND m.date < ?
      ORDER BY m.date DESC, m.ROWID DESC LIMIT ?`;
    const start = appleNanoseconds(filter.start);
    const end = appleNanoseconds(filter.end);
    const allows = (message: Message) => message.date >= filter.start && message.date < filter.end;
    for (;;) {
      const caches = newCaches();
      const messages = this.all(sql, chatID, start, end, physicalLimit).map((row) =>
        this.message(this.decodeRow(row, chatID), caches),
      );
      let usedFallbackReplacement = false;
      const coalesced = this.coalesce(messages, (preview) => {
        const previous = this.precedingTextMessage(preview, true);
        if (!previous || !allows(previous)) return null;
        usedFallbackReplacement = true;
        return previous;
      }).sort((a, b) => (a.date === b.date ? b.rowID - a.rowID : b.date - a.date));
      if (
        messages.length < physicalLimit ||
        (coalesced.length >= limit && !usedFallbackReplacement)
      ) {
        return coalesced.slice(0, limit);
      }
      if (physicalLimit > Number.MAX_SAFE_INTEGER / 2) return coalesced.slice(0, limit);
      physicalLimit *= 2;
    }
  }

  private coalesce(messages: Message[], fallback: (preview: Message) => Message | null): Message[] {
    if (messages.length === 0) return messages;
    const rowOrdered = messages
      .map((element, offset) => ({ offset, element }))
      .sort((a, b) => a.element.rowID - b.element.rowID);
    const replacements = new Map<number, Message>();
    const suppressed = new Set<number>();
    for (let position = 0; position < rowOrdered.length; position += 1) {
      const preview = rowOrdered[position]!;
      if (!this.isURLPreview(preview.element) || suppressed.has(preview.offset)) continue;
      let candidate: { offset: number; element: Message } | undefined;
      for (let index = position - 1; index >= 0; index -= 1) {
        const item = rowOrdered[index]!;
        if (suppressed.has(item.offset) || item.element.isReaction) continue;
        if (item.element.chatID === preview.element.chatID) {
          candidate = item;
          break;
        }
      }
      if (candidate) {
        const text = replacements.get(candidate.offset) ?? candidate.element;
        const valid = this.precedingTextMessage(preview.element, false)?.rowID === text.rowID;
        if (valid && this.canCoalesce(text, preview.element)) {
          replacements.set(candidate.offset, this.withURLPreview(text, preview.element));
          suppressed.add(preview.offset);
          continue;
        }
      }
      const replacement = fallback(preview.element);
      if (replacement)
        replacements.set(preview.offset, this.withURLPreview(replacement, preview.element));
    }
    return messages.flatMap((message, index) =>
      suppressed.has(index) ? [] : [replacements.get(index) ?? message],
    );
  }

  /** Attachment metadata per message, fetched in batches of 500 like imsg. */
  attachments(messageIDs: number[]): Map<number, AttachmentMeta[]> {
    const unique = [...new Set(messageIDs)].sort((a, b) => a - b);
    const result = new Map<number, AttachmentMeta[]>();
    for (let start = 0; start < unique.length; start += 500) {
      const batch = unique.slice(start, start + 500);
      const rows = this.all(
        `SELECT maj.message_id AS message_id, a.filename AS filename,
                a.transfer_name AS transfer_name, a.uti AS uti, a.mime_type AS mime_type,
                a.total_bytes AS total_bytes, a.is_sticker AS is_sticker
         FROM message_attachment_join maj
         JOIN attachment a ON a.ROWID = maj.attachment_id
         WHERE maj.message_id IN (${batch.map(() => "?").join(",")})
         ORDER BY maj.message_id ASC`,
        ...batch,
      );
      for (const row of rows) {
        const messageID = num(row.message_id) ?? 0;
        const filename = str(row.filename);
        const originalPath = filename === "" ? "" : expandTilde(filename);
        const list = result.get(messageID) ?? [];
        list.push({
          filename,
          transferName: str(row.transfer_name),
          uti: str(row.uti),
          mimeType: str(row.mime_type),
          totalBytes: num(row.total_bytes) ?? 0,
          isSticker: bool(row.is_sticker),
          originalPath,
          missing: originalPath === "" || !isRegularFile(originalPath),
        });
        result.set(messageID, list);
      }
    }
    return result;
  }

  /** Current reactions per message: adds and removals replayed in time order. */
  reactions(messages: Message[]): Map<number, Reaction[]> {
    const result = new Map<number, Reaction[]>();
    if (!this.schema.reactionColumns) return result;
    const byGUID = new Map<string, number>();
    for (const message of messages)
      if (message.guid !== "") byGUID.set(message.guid.toLowerCase(), message.rowID);
    if (byGUID.size === 0) return result;
    const s = this.schema;
    const matched: ReactionRow[] = [];
    for (const row of this.iterate(
      `SELECT r.ROWID AS reaction_rowid, r.associated_message_guid AS associated_message_guid,
              r.associated_message_type AS associated_message_type, h.id AS sender,
              r.is_from_me AS is_from_me, r.date AS date, IFNULL(r.text, '') AS text,
              ${s.destinationCallerID ? "r.destination_caller_id" : "NULL"} AS destination_caller_id,
              ${s.attributedBody ? "r.attributedBody" : "NULL"} AS body,
              ${s.associatedMessageEmoji ? "r.associated_message_emoji" : "NULL"} AS associated_emoji
       FROM message r
       LEFT JOIN handle h ON r.handle_id = h.ROWID
       WHERE r.associated_message_guid IS NOT NULL
         AND r.associated_message_guid != ''
         AND ${reactionPredicate("r.associated_message_type")}`,
    )) {
      const base = normalizeAssociatedGUID(str(row.associated_message_guid)).toLowerCase();
      const messageID = byGUID.get(base);
      if (messageID === undefined) continue;
      const text = str(row.text);
      const isFromMe = bool(row.is_from_me);
      const handle = str(row.sender);
      const destination = str(row.destination_caller_id);
      matched.push({
        rowID: num(row.reaction_rowid) ?? 0,
        typeValue: num(row.associated_message_type) ?? 0,
        // Only outgoing reactions take the local account; a received one without a handle stays empty.
        sender: isFromMe && destination !== "" ? destination : handle,
        isFromMe,
        timestamp: bigint(row.date) ?? 0n,
        resolvedText: text === "" ? parseAttributedBody(bytes(row.body)) : text,
        associatedEmoji: str(row.associated_emoji),
        messageID,
      });
    }
    matched.sort((a, b) =>
      a.timestamp === b.timestamp ? a.rowID - b.rowID : a.timestamp < b.timestamp ? -1 : 1,
    );
    for (const row of matched) {
      const list = result.get(row.messageID) ?? [];
      applyReaction(row, list);
      result.set(row.messageID, list);
    }
    return result;
  }

  // MARK: chats

  chatInfo(chatID: number): ChatInfo | null {
    const r = this.routingColumns();
    const row = this.all(
      `SELECT c.ROWID AS chat_rowid, IFNULL(c.chat_identifier, '') AS identifier, IFNULL(c.guid, '') AS guid,
              IFNULL(c.display_name, c.chat_identifier) AS name, IFNULL(c.service_name, '') AS service,
              ${r.accountID} AS account_id, ${r.accountLogin} AS account_login,
              ${r.lastAddressedHandle} AS last_addressed_handle
       FROM chat c WHERE c.ROWID = ? LIMIT 1`,
      chatID,
    )[0];
    if (!row) return null;
    return {
      id: num(row.chat_rowid) ?? 0,
      identifier: str(row.identifier),
      guid: str(row.guid),
      name: str(row.name),
      service: str(row.service),
      accountID: nilIfEmpty(str(row.account_id)),
      accountLogin: nilIfEmpty(str(row.account_login)),
      lastAddressedHandle: nilIfEmpty(str(row.last_addressed_handle)),
    };
  }

  /** Rows whose ROWID equals `chatID` with their guid; used to target a send. */
  chatGUIDs(chatID: bigint): string[] {
    return this.all("SELECT IFNULL(guid, '') AS guid FROM chat WHERE ROWID = ?", chatID).map(
      (row) => str(row.guid),
    );
  }

  participants(chatID: number): string[] {
    const seen = new Set<string>();
    for (const row of this.all(
      `SELECT h.id FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id
       WHERE chj.chat_id = ? ORDER BY h.id ASC`,
      chatID,
    )) {
      const handle = str(row.id);
      if (handle !== "") seen.add(handle);
    }
    return [...seen];
  }

  private routingColumns() {
    const s = this.schema;
    return {
      accountID: s.chatAccountID ? "IFNULL(c.account_id, '')" : "''",
      accountLogin: s.chatAccountLogin ? "IFNULL(c.account_login, '')" : "''",
      lastAddressedHandle: s.chatLastAddressedHandle ? "IFNULL(c.last_addressed_handle, '')" : "''",
    };
  }

  /** Chats ordered by their newest message, newest first. */
  listChats(limit: number): Chat[] {
    if (limit <= 0) return [];
    const r = this.routingColumns();
    const lastDate = this.schema.chatMessageJoinMessageDate
      ? "MAX(cmj.message_date)"
      : "MAX(m.date)";
    const messageJoin = this.schema.chatMessageJoinMessageDate
      ? ""
      : "JOIN message m ON m.ROWID = cmj.message_id";
    const rows = this.all(
      `SELECT c.ROWID AS chat_rowid, IFNULL(NULLIF(c.display_name, ''), c.chat_identifier) AS name,
              c.chat_identifier AS chat_identifier, c.service_name AS service_name,
              ${lastDate} AS last_date,
              ${r.accountID} AS account_id, ${r.accountLogin} AS account_login,
              ${r.lastAddressedHandle} AS last_addressed_handle
       FROM chat c
       JOIN chat_message_join cmj ON c.ROWID = cmj.chat_id
       ${messageJoin}
       GROUP BY c.ROWID
       ORDER BY last_date DESC, c.ROWID DESC
       LIMIT ? OFFSET ?`,
      limit,
      0,
    );
    const chats = rows.map((row) => ({
      id: num(row.chat_rowid) ?? 0,
      identifier: str(row.chat_identifier),
      name: str(row.name),
      service: str(row.service_name),
      lastMessageAt: appleSeconds(bigint(row.last_date)),
      accountID: nilIfEmpty(str(row.account_id)),
      accountLogin: nilIfEmpty(str(row.account_login)),
      lastAddressedHandle: nilIfEmpty(str(row.last_addressed_handle)),
      unreadCount: null as number | null,
    }));
    if (this.schema.isRead) {
      const counts = this.unreadCounts(chats.map((chat) => chat.id));
      for (const chat of chats) chat.unreadCount = counts.get(chat.id) ?? 0;
    }
    return chats;
  }

  /** Unread inbound logical messages per chat; a URL preview counts with its text row. */
  private unreadCounts(chatIDs: number[]): Map<number, number> {
    const result = new Map<number, number>();
    for (let start = 0; start < chatIDs.length; start += 500) {
      const chunk = chatIDs.slice(start, start + 500);
      const join = this.schema.unreadMessageIndex ? "CROSS JOIN" : "JOIN";
      const rows = this.all(
        `SELECT ${this.scopedSelection}
         FROM message m
         ${join} chat_message_join cmj ON m.ROWID = cmj.message_id
         LEFT JOIN handle h ON m.handle_id = h.ROWID
         WHERE cmj.chat_id IN (${chunk.map(() => "?").join(", ")})
           AND m.is_from_me = 0
           AND m.is_read = 0
         ORDER BY cmj.chat_id, m.ROWID`,
        ...chunk,
      );
      const unread = new Map<number, Set<number>>();
      for (const row of rows) {
        const message = this.plainMessage(this.decodeRow(row, null));
        let logical = message.rowID;
        if (this.isURLPreview(message)) {
          const text = this.precedingTextMessage(message, false);
          if (text) {
            if (text.isRead !== false) continue;
            logical = text.rowID;
          }
        }
        const set = unread.get(message.chatID) ?? new Set<number>();
        set.add(logical);
        unread.set(message.chatID, set);
      }
      for (const [chatID, set] of unread) result.set(chatID, set.size);
    }
    return result;
  }
}

/**
 * Messages usually leaves date_retracted at 0 and records an unsend as retracted
 * parts (`rp`) in message_summary_info. Unsending only some of the original
 * parts (`otr`) leaves the rest, so that stays an edit.
 */
function retractedStamp(edited: bigint, retracted: bigint, summaryInfo: Uint8Array): bigint {
  if (retracted > 0n) return retracted;
  if (edited <= 0n || summaryInfo.byteLength === 0) return 0n;
  const info = tryParseBinaryPlist(summaryInfo);
  if (!isPlistDictionary(info)) return 0n;
  const originalParts = info.otr;
  const retractedParts = info.rp;
  if (!isPlistDictionary(originalParts) || !Array.isArray(retractedParts)) return 0n;
  const keys = Object.keys(originalParts);
  if (keys.length === 0) return 0n;
  if (!retractedParts.every((part) => typeof part === "number" && Number.isInteger(part)))
    return 0n;
  const parts = new Set(retractedParts as number[]);
  return keys.every((key) => /^[+-]?\d+$/.test(key) && parts.has(Number(key))) ? edited : 0n;
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function applyReaction(row: ReactionRow, reactions: Reaction[]): void {
  const removal = isReactionRemove(row.typeValue);
  const emoji =
    row.typeValue === 2006 || row.typeValue === 3006
      ? row.associatedEmoji === ""
        ? extractCustomEmoji(row.resolvedText)
        : row.associatedEmoji
      : null;
  const type = reactionType(removal ? row.typeValue - 1000 : row.typeValue, emoji);
  const index = reactions.findIndex(
    (existing) =>
      existing.sender === row.sender &&
      existing.isFromMe === row.isFromMe &&
      (sameReactionType(existing.type, type) ||
        (row.typeValue === 3006 && type === null && existing.type.name === "custom")),
  );
  if (removal) {
    if (index >= 0) reactions.splice(index, 1);
    return;
  }
  if (!type) return;
  const reaction: Reaction = {
    rowID: row.rowID,
    type,
    sender: row.sender,
    isFromMe: row.isFromMe,
    date: appleSeconds(row.timestamp),
  };
  if (index >= 0) reactions[index] = reaction;
  else reactions.push(reaction);
}
