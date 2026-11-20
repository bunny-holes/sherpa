import type { Database } from "bun:sqlite";

/**
 * Read model of the KakaoTalk Mac database. SQL, chat naming, message types and
 * timestamps mirror kakaocli 0.6.0 `DatabaseReader` so results match what Sherpa
 * 0.7 returned through kakaocli. Identifiers stay inside this process: callers
 * use them only for joins and deduplication and never output them.
 */

export type MessageType =
  | "text"
  | "photo"
  | "video"
  | "voice"
  | "sticker"
  | "file"
  | "location"
  | "system"
  | "unknown";

export interface KakaoChat {
  id: bigint;
  displayName: string;
}

export interface KakaoMessage {
  id: bigint;
  chatId: bigint;
  sender: string | null;
  text: string | null;
  type: MessageType;
  /** ISO 8601 in UTC with whole seconds, as Foundation's default ISO8601DateFormatter writes it. */
  timestamp: string;
  isFromMe: boolean;
}

export interface MessageSource {
  /** Chats by most recent update first. */
  chats(limit: number): KakaoChat[];
  /** Messages newest first, optionally in one chat and at or after `sinceSeconds`. */
  messages(options: { chatId?: bigint; sinceSeconds?: number; limit: number }): KakaoMessage[];
  /** Messages whose text contains `query` (SQLite LIKE), newest first. */
  search(query: string, limit: number): KakaoMessage[];
  close(): void;
}

type Cell = string | number | bigint | Uint8Array | null;

const messageColumns = `SELECT m.logId, m.chatId, m.authorId,
       COALESCE(u.displayName, u.friendNickName, u.nickName) AS senderName,
       m.message, m.type, m.sentAt
FROM NTChatMessage m
LEFT JOIN NTUser u ON m.authorId = u.userId AND u.linkId = 0`;

export class KakaoDatabase implements MessageSource {
  constructor(private readonly database: Database) {}

  chats(limit: number): KakaoChat[] {
    const rows = this.database
      .query<Cell[], [number]>(
        `SELECT r.chatId, r.chatName, u.displayName, u.friendNickName, u.nickName
         FROM NTChatRoom r
         LEFT JOIN NTUser u ON r.directChatMemberUserId = u.userId AND u.linkId = 0
         ORDER BY r.lastUpdatedAt DESC
         LIMIT ?`,
      )
      .values(limit);
    return rows.map((row) => ({
      id: integer(row[0]),
      // kakaocli: chatName ?? displayName ?? friendNickName ?? nickName ?? "(unknown)";
      // an empty chatName is not nil and wins.
      displayName: text(row[1]) ?? text(row[2]) ?? text(row[3]) ?? text(row[4]) ?? "(unknown)",
    }));
  }

  messages(options: { chatId?: bigint; sinceSeconds?: number; limit: number }): KakaoMessage[] {
    const conditions: string[] = [];
    const bindings: (bigint | number)[] = [];
    if (options.chatId !== undefined) {
      conditions.push("m.chatId = ?");
      bindings.push(options.chatId);
    }
    if (options.sinceSeconds !== undefined) {
      conditions.push("m.sentAt >= ?");
      bindings.push(options.sinceSeconds);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    return this.messageRows(`${messageColumns} ${where} ORDER BY m.sentAt DESC LIMIT ?`, [
      ...bindings,
      options.limit,
    ]);
  }

  search(query: string, limit: number): KakaoMessage[] {
    return this.messageRows(
      `${messageColumns} WHERE m.message LIKE ? ORDER BY m.sentAt DESC LIMIT ?`,
      [`%${query}%`, limit],
    );
  }

  close(): void {
    this.database.close();
  }

  private myUserId(): bigint {
    const row = this.database
      .query<Cell[], []>("SELECT userId FROM NTChatContext LIMIT 1")
      .values()[0];
    return row ? integer(row[0]) : 0n;
  }

  private messageRows(sql: string, bindings: (string | number | bigint)[]): KakaoMessage[] {
    const me = this.myUserId();
    return this.database
      .query<Cell[], (string | number | bigint)[]>(sql)
      .values(...bindings)
      .map((row) => {
        const author = integer(row[2]);
        return {
          id: integer(row[0]),
          chatId: integer(row[1]),
          sender: text(row[3]),
          text: text(row[4]),
          type: messageType(Number(BigInt.asIntN(32, integer(row[5])))),
          timestamp: kakaoTimestamp(integer(row[6])),
          isFromMe: author === me,
        };
      });
  }
}

/** kakaocli `Message.MessageType(rawValue:)`. */
export function messageType(raw: number): MessageType {
  switch (raw) {
    case 1:
      return "text";
    case 2:
      return "photo";
    case 3:
      return "video";
    case 4:
      return "voice";
    case 5:
      return "sticker";
    case 6:
      return "file";
    case 7:
      return "location";
    case 0:
      return "system";
    default:
      return "unknown";
  }
}

/** Seconds since the Unix epoch to `yyyy-MM-ddTHH:mm:ssZ`. */
export function kakaoTimestamp(seconds: bigint): string {
  const milliseconds = Number(seconds) * 1000;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** `sqlite3_column_int64` semantics: NULL is 0, REAL truncates. */
function integer(cell: Cell | undefined): bigint {
  if (typeof cell === "bigint") return cell;
  if (typeof cell === "number") return Number.isFinite(cell) ? BigInt(Math.trunc(cell)) : 0n;
  if (typeof cell === "string") {
    const match = /^\s*[-+]?\d+/.exec(cell);
    return match ? BigInt(match[0].trim()) : 0n;
  }
  return 0n;
}

/** `String(cString: sqlite3_column_text(...))` semantics: NULL is nil and text ends at the first NUL. */
function text(cell: Cell | undefined): string | null {
  if (cell === null || cell === undefined) return null;
  const value = cell instanceof Uint8Array ? new TextDecoder().decode(cell) : String(cell);
  const end = value.indexOf("\0");
  return end === -1 ? value : value.slice(0, end);
}
