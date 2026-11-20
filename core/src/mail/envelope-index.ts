import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { codes, invalidRequest, SherpaError } from "../cli/errors.ts";

export interface MailItem {
  source_message_id: string;
  subject: string;
  sender: string;
  received_at: string;
  sent_at: string | null;
  body: string;
  body_truncated: boolean;
  mailbox: string;
  recipients: { role: string; name: string | null; address: string }[];
  attachments: { mime_type: string | null; byte_count: number; downloaded: boolean }[];
}

export interface MailListOutput {
  messages: MailItem[];
  /** True when more messages in the range follow this page. */
  limit_reached: boolean;
  /** Pass to `--cursor` to read the next page; null on the last page. */
  next_cursor: string | null;
}

const FULL_DISK_ACCESS =
  "grant Full Disk Access to the app that runs sherpa (System Settings > Privacy & Security > Full Disk Access)";

/** The newest `~/Library/Mail/V<n>` directory. Mail moves to a new number on major upgrades. */
export function mailRoot(home = homedir()): string {
  const base = join(home, "Library/Mail");
  let entries: string[];
  try {
    entries = readdirSync(base);
  } catch {
    throw new SherpaError("mail.store_unreadable", { remedy: FULL_DISK_ACCESS });
  }
  const versions = entries
    .map((name) => /^V(\d+)$/.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  const newest = versions[0];
  if (!newest)
    throw new SherpaError("mail.store_missing", {
      remedy: "open Mail.app once so it creates its store",
    });
  return join(base, newest[0]);
}

interface Cursor {
  r: number;
  i: number;
  f: number;
  t: number;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(token: string, from: number, to: number): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Partial<Cursor>;
    const { r, i, f, t } = parsed;
    if (![r, i, f, t].every((x) => Number.isSafeInteger(x)) || f !== from || t !== to)
      throw invalidRequest();
    return parsed as Cursor;
  } catch {
    throw invalidRequest();
  }
}

function parseInstant(value: string): number {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(value))
    throw invalidRequest();
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw invalidRequest();
  return Math.floor(ms / 1000);
}

function instant(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Read-only access to Mail.app's local envelope index, newest first, with a
 * keyset cursor. AppleScript mailbox enumeration can block on a syncing
 * account; the index is the data Mail itself lists from and covers every account.
 */
export class EnvelopeIndex {
  constructor(private readonly root = mailRoot()) {}

  list(options: { from: string; to: string; limit: number; cursor?: string }): MailListOutput {
    const start = parseInstant(options.from);
    const end = parseInstant(options.to);
    const { limit } = options;
    if (!(start < end) || !Number.isInteger(limit) || limit < 1 || limit > 50_000)
      throw invalidRequest();
    const after = options.cursor ? decodeCursor(options.cursor, start, end) : null;
    const db = this.open();
    try {
      const rows = db
        .query<
          {
            rowid: number;
            subject: string;
            sender: string;
            received: number;
            sent: number | null;
            summary: string;
            mailbox: string;
          },
          [number, number, number, number, number, number]
        >(
          `SELECT m.ROWID AS rowid, COALESCE(s.subject, '') AS subject, COALESCE(a.address, '') AS sender,
                  m.date_received AS received, m.date_sent AS sent, COALESCE(x.summary, '') AS summary,
                  COALESCE(b.url, '') AS mailbox
           FROM messages m
           LEFT JOIN subjects s ON s.ROWID = m.subject
           LEFT JOIN addresses a ON a.ROWID = m.sender
           LEFT JOIN summaries x ON x.ROWID = m.summary
           LEFT JOIN mailboxes b ON b.ROWID = m.mailbox
           WHERE m.deleted = 0 AND m.date_received >= ? AND m.date_received < ?
             AND (m.date_received < ? OR (m.date_received = ? AND m.ROWID < ?))
           ORDER BY m.date_received DESC, m.ROWID DESC LIMIT ?`,
        )
        .all(
          start,
          end,
          after ? after.r : Number.MAX_SAFE_INTEGER,
          after ? after.r : Number.MAX_SAFE_INTEGER,
          after ? after.i : Number.MAX_SAFE_INTEGER,
          limit + 1,
        );
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const limitReached = rows.length > limit;
      return {
        messages: page.map((row) => ({
          source_message_id: `mail-index:${row.rowid}`,
          subject: row.subject,
          sender: row.sender,
          received_at: instant(row.received),
          sent_at: row.sent ? instant(row.sent) : null,
          body: row.summary,
          body_truncated: true,
          mailbox: row.mailbox,
          recipients: [],
          attachments: [],
        })),
        limit_reached: limitReached,
        next_cursor:
          limitReached && last
            ? encodeCursor({ r: last.received, i: last.rowid, f: start, t: end })
            : null,
      };
    } finally {
      db.close();
    }
  }

  /** The body of one indexed message, read from its `.emlx` file and cut to `maximumBodyBytes`. */
  read(sourceMessageID: string, maximumBodyBytes: number): { message: MailItem | null } {
    const match = /^mail-index:(\d+)$/.exec(sourceMessageID);
    const rowid = match ? Number(match[1]) : 0;
    if (
      !rowid ||
      !Number.isInteger(maximumBodyBytes) ||
      maximumBodyBytes < 1 ||
      maximumBodyBytes > 1024 * 1024
    ) {
      throw invalidRequest();
    }
    const file = findEmlx(this.root, rowid);
    if (!file) return { message: null };
    const data = readFileSync(file);
    const newline = data.indexOf(0x0a);
    const length =
      newline > 0 ? Number(data.subarray(0, newline).toString("utf8").trim()) : Number.NaN;
    if (!Number.isInteger(length) || length < 0 || data.length - newline - 1 < length) {
      throw new SherpaError(codes.failed);
    }
    const message = data.subarray(newline + 1, newline + 1 + length).toString("utf8");
    const separator = message.search(/\r?\n\r?\n/);
    const body = separator >= 0 ? message.slice(separator).replace(/^\r?\n\r?\n/, "") : "";
    const bytes = Buffer.from(body, "utf8");
    const bounded = new TextDecoder()
      .decode(bytes.subarray(0, maximumBodyBytes))
      .replace(/\uFFFD$/, "");
    return {
      message: {
        source_message_id: sourceMessageID,
        subject: "",
        sender: "",
        received_at: "",
        sent_at: null,
        body: bounded,
        body_truncated: bytes.length > Buffer.byteLength(bounded),
        mailbox: "",
        recipients: [],
        attachments: [],
      },
    };
  }

  private open(): Database {
    const path = join(this.root, "MailData/Envelope Index");
    if (!existsSync(path))
      throw new SherpaError("mail.store_unreadable", { remedy: FULL_DISK_ACCESS });
    try {
      return new Database(path, { readonly: true });
    } catch {
      throw new SherpaError("mail.store_unreadable", { remedy: FULL_DISK_ACCESS });
    }
  }
}

function findEmlx(root: string, rowid: number): string | null {
  const names = new Set([`${rowid}.emlx`, `${rowid}.partial.emlx`]);
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const path = join(directory, entry);
      if (names.has(entry)) return path;
      if (!entry.includes(".") || entry.endsWith(".mbox")) {
        try {
          if (statSync(path).isDirectory()) stack.push(path);
        } catch {
          continue;
        }
      }
    }
  }
  return null;
}
