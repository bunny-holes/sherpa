import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { SherpaError } from "../src/cli/errors.ts";
import { EnvelopeIndex } from "../src/mail/envelope-index.ts";
import { parseMailMessage } from "../src/mail/outbound.ts";

let root: string;

function seed(count: number, sameSecond = false): void {
  mkdirSync(join(root, "MailData"), { recursive: true });
  const db = new Database(join(root, "MailData/Envelope Index"), { create: true });
  db.run("CREATE TABLE subjects (ROWID INTEGER PRIMARY KEY, subject TEXT)");
  db.run("CREATE TABLE addresses (ROWID INTEGER PRIMARY KEY, address TEXT)");
  db.run("CREATE TABLE summaries (ROWID INTEGER PRIMARY KEY, summary TEXT)");
  db.run("CREATE TABLE mailboxes (ROWID INTEGER PRIMARY KEY, url TEXT)");
  db.run(`CREATE TABLE messages (ROWID INTEGER PRIMARY KEY, subject INTEGER, sender INTEGER, summary INTEGER,
    mailbox INTEGER, date_received INTEGER, date_sent INTEGER, deleted INTEGER)`);
  db.run("INSERT INTO subjects VALUES (1, 'subject')");
  db.run("INSERT INTO addresses VALUES (1, 'a@example.com')");
  db.run("INSERT INTO summaries VALUES (1, 'summary')");
  db.run("INSERT INTO mailboxes VALUES (1, 'imap://box')");
  const base = Date.parse("2026-01-01T00:00:00Z") / 1000;
  const insert = db.query("INSERT INTO messages VALUES (?, 1, 1, 1, 1, ?, ?, ?)");
  for (let i = 1; i <= count; i++)
    insert.run(i, sameSecond ? base : base + i, base + i, i === 3 ? 1 : 0);
  db.close();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sherpa-mail-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const range = { from: "2025-12-31T00:00:00Z", to: "2026-01-02T00:00:00Z", maxBodyBytes: 1024 };

describe("mail list", () => {
  test("pages through every message with the cursor and stops on the last page", () => {
    seed(25);
    const index = new EnvelopeIndex(root);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = index.list({ ...range, limit: 10, ...(cursor ? { cursor } : {}) });
      seen.push(...page.messages.map((m) => m.source_message_id));
      cursor = page.next_cursor ?? undefined;
      expect(page.limit_reached).toBe(page.next_cursor !== null);
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(24);
    expect(new Set(seen).size).toBe(24);
    expect(seen[0]).toBe("mail-index:25");
    expect(seen).not.toContain("mail-index:3");
  });

  test("keeps messages that share one received second across pages", () => {
    seed(7, true);
    const index = new EnvelopeIndex(root);
    const first = index.list({ ...range, limit: 4 });
    const second = index.list({ ...range, limit: 4, cursor: first.next_cursor! });
    const ids = [...first.messages, ...second.messages].map((m) => m.source_message_id);
    expect(new Set(ids).size).toBe(6);
    expect(second.next_cursor).toBeNull();
  });

  test("an exact final page reports no further page", () => {
    seed(4);
    const page = new EnvelopeIndex(root).list({ ...range, limit: 3 });
    expect(page.messages).toHaveLength(3);
    expect(page.limit_reached).toBe(false);
    expect(page.next_cursor).toBeNull();
  });

  test("rejects a cursor issued for another range", () => {
    seed(5);
    const index = new EnvelopeIndex(root);
    const { next_cursor } = index.list({ ...range, limit: 2 });
    expect(() =>
      index.list({ ...range, to: "2026-01-03T00:00:00Z", limit: 2, cursor: next_cursor! }),
    ).toThrow(SherpaError);
  });

  test("rejects invalid ranges and limits before opening the store", () => {
    const index = new EnvelopeIndex(root);
    expect(() =>
      index.list({ from: range.to, to: range.from, limit: 1, maxBodyBytes: 1024 }),
    ).toThrow("invalidRequest");
    expect(() => index.list({ ...range, limit: 0 })).toThrow("invalidRequest");
    expect(() => index.list({ ...range, limit: 50_001 })).toThrow("invalidRequest");
    expect(() =>
      index.list({ from: "2026-01-01", to: range.to, limit: 1, maxBodyBytes: 1024 }),
    ).toThrow("invalidRequest");
    for (const maxBodyBytes of [-1, 1024 * 1024 + 1, 1.5])
      expect(() => index.list({ ...range, limit: 1, maxBodyBytes })).toThrow("invalidRequest");
  });

  test("cuts each summary to max_body_bytes on a whole character", () => {
    seed(2);
    const db = new Database(join(root, "MailData/Envelope Index"));
    db.run("UPDATE summaries SET summary = '가나다' WHERE ROWID = 1");
    db.close();
    const index = new EnvelopeIndex(root);
    const bodies = (maxBodyBytes: number) =>
      index
        .list({ ...range, limit: 1, maxBodyBytes })
        .messages.map((m) => [m.body, m.body_truncated]);
    expect(bodies(1024)).toEqual([["가나다", true]]);
    expect(bodies(4)).toEqual([["가", true]]);
    expect(bodies(6)).toEqual([["가나", true]]);
    expect(bodies(2)).toEqual([["", true]]);
    expect(bodies(0)).toEqual([["", true]]);
  });

  test("a rejected argument is reported before the store is opened", () => {
    // No store exists under root: only a valid request reaches it.
    const index = new EnvelopeIndex(root);
    expect(() => index.list({ ...range, limit: 1, maxBodyBytes: -1 })).toThrow("invalidRequest");
    expect(() => index.list({ ...range, limit: 1 })).toThrow("mail.store_unreadable");
  });

  test("a missing store names the permission remedy", () => {
    try {
      new EnvelopeIndex(root).list({ ...range, limit: 1 });
      expect.unreachable();
    } catch (error) {
      expect((error as SherpaError).code).toBe("mail.store_unreadable");
      expect((error as SherpaError).remedy).toContain("Full Disk Access");
    }
  });
});

describe("mail read", () => {
  test("reads and bounds the body of the indexed message", async () => {
    const dir = join(root, "ACCOUNT/INBOX.mbox/Data/Messages");
    mkdirSync(dir, { recursive: true });
    const message = "Subject: x\r\n\r\nhello body";
    await Bun.write(join(dir, "42.emlx"), `${Buffer.byteLength(message)}\n${message}<plist/>`);
    const index = new EnvelopeIndex(root);
    expect((await index.read("mail-index:42", 1024)).message?.body).toBe("hello body");
    const cut = (await index.read("mail-index:42", 5)).message!;
    expect(cut.body).toBe("hello");
    expect(cut.body_truncated).toBe(true);
    expect((await index.read("mail-index:43", 5)).message).toBeNull();
    await expect(index.read("43", 5)).rejects.toThrow("invalidRequest");
    await expect(index.read("mail-index:42", 0)).rejects.toThrow("invalidRequest");
  });
});

describe("mail send payload", () => {
  const valid = { sender: null, to: ["a@example.com"], cc: [], bcc: [], subject: "s", body: "b" };

  test("accepts a valid message", () => {
    expect(parseMailMessage(JSON.stringify(valid))).toEqual(valid);
  });

  test("rejects header injection and invalid recipients", () => {
    for (const bad of [
      { ...valid, subject: "a\r\nBcc: x@example.com" },
      { ...valid, to: [] },
      { ...valid, to: ["not-an-address"] },
      { ...valid, cc: ["a b@example.com"] },
      { ...valid, sender: "nobody" },
    ]) {
      expect(() => parseMailMessage(JSON.stringify(bad))).toThrow("invalidRequest");
    }
    expect(() => parseMailMessage("not json")).toThrow("invalidRequest");
  });
});
