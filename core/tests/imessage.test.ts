import { Database } from "bun:sqlite";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { codes, SherpaError } from "../src/cli/errors.ts";
import { parseBinaryPlist, PlistUID } from "../src/plist/plist.ts";
import { imessageCommands } from "../src/imessage/commands.ts";
import type { Runner } from "../src/imessage/send.ts";
import { formatAppleSeconds, parseInstant } from "../src/imessage/time.ts";
import { parseAttributedBody } from "../src/imessage/typedstream.ts";
import { createChatSchema } from "./support/chat-db.ts";

// All fixture data is synthetic: 555 numbers, example.com addresses, made-up guids and text.

// MARK: binary plist writer for fixtures

type Plist = string | number | boolean | PlistUID | Uint8Array | Plist[] | { [key: string]: Plist };

function bplist(root: Plist): Uint8Array {
  const objects: number[][] = [];
  const add = (value: Plist): number => {
    const index = objects.length;
    objects.push([]);
    objects[index] = encode(value);
    return index;
  };
  const header = (high: number, count: number): number[] =>
    count < 15 ? [(high << 4) | count] : [(high << 4) | 0x0f, 0x11, count >> 8, count & 0xff];
  const ref = (index: number): number[] => [index >> 8, index & 0xff];
  const encode = (value: Plist): number[] => {
    if (typeof value === "boolean") return [value ? 0x09 : 0x08];
    if (typeof value === "number")
      return [
        0x13,
        ...[...Array(8)].map((_, i) => Number((BigInt(value) >> BigInt(56 - i * 8)) & 0xffn)),
      ];
    if (value instanceof PlistUID) return [0x80, value.value];
    if (value instanceof Uint8Array) return [...header(0x4, value.length), ...value];
    if (typeof value === "string") {
      if ([...Buffer.from(value, "utf8")].every((byte) => byte < 0x80))
        return [...header(0x5, value.length), ...Buffer.from(value, "latin1")];
      const units = [...Buffer.from(value, "utf16le")];
      const be: number[] = [];
      for (let i = 0; i < units.length; i += 2) be.push(units[i + 1]!, units[i]!);
      return [...header(0x6, value.length), ...be];
    }
    if (Array.isArray(value)) {
      const refs = value.map(add);
      return [...header(0xa, refs.length), ...refs.flatMap(ref)];
    }
    const keys = Object.keys(value).map(add);
    const values = Object.values(value).map(add);
    return [...header(0xd, keys.length), ...keys.flatMap(ref), ...values.flatMap(ref)];
  };
  add(root);
  const body: number[] = [...Buffer.from("bplist00", "latin1")];
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(body.length);
    body.push(...object);
  }
  const tableOffset = body.length;
  for (const offset of offsets)
    body.push((offset >> 24) & 0xff, (offset >> 16) & 0xff, (offset >> 8) & 0xff, offset & 0xff);
  const u64 = (n: number) =>
    [...Array(8)].map((_, i) => Number((BigInt(n) >> BigInt(56 - i * 8)) & 0xffn));
  body.push(0, 0, 0, 0, 0, 0, 4, 2, ...u64(objects.length), ...u64(0), ...u64(tableOffset));
  return new Uint8Array(body);
}

function typedstream(text: string): Uint8Array {
  const utf8 = [...Buffer.from(text, "utf8")];
  const length = utf8.length < 0x80 ? [utf8.length] : [0x81, utf8.length & 0xff, utf8.length >> 8];
  return new Uint8Array([
    0x04,
    0x0b,
    ...Buffer.from("streamtyped", "latin1"),
    0x81,
    0xe8,
    0x03,
    0x84,
    0x01,
    0x40,
    0x84,
    0x84,
    0x84,
    0x12,
    ...Buffer.from("NSAttributedString", "latin1"),
    0x00,
    0x84,
    0x84,
    0x08,
    ...Buffer.from("NSObject", "latin1"),
    0x00,
    0x85,
    0x92,
    0x84,
    0x84,
    0x84,
    0x08,
    ...Buffer.from("NSString", "latin1"),
    0x01,
    0x94,
    0x84,
    0x01,
    0x2b,
    ...length,
    ...utf8,
    0x86,
  ]);
}

// MARK: fixture chat.db

const APPLE_EPOCH = 978_307_200;
/** chat.db nanoseconds for an ISO instant plus extra nanoseconds. */
const ns = (iso: string, extra = 0n): bigint =>
  BigInt(Date.parse(iso) / 1000 - APPLE_EPOCH) * 1_000_000_000n + extra;

let root: string;
let dbPath: string;

type MessageRow = Partial<{
  guid: string;
  text: string | null;
  handle_id: number;
  date: bigint;
  is_from_me: number;
  attributedBody: Uint8Array;
  associated_message_guid: string;
  associated_message_type: number;
  associated_message_emoji: string;
  destination_caller_id: string;
  is_audio_message: number;
  thread_originator_guid: string;
  thread_originator_part: string;
  balloon_bundle_id: string;
  payload_data: Uint8Array;
  message_summary_info: Uint8Array;
  reply_to_guid: string;
  is_read: number;
  date_read: bigint;
  date_edited: bigint;
}>;

function insertMessage(db: Database, rowID: number, chatID: number | null, row: MessageRow): void {
  const columns = Object.keys(row);
  db.query(
    `INSERT INTO message (ROWID, service${columns.map((c) => `, ${c}`).join("")}) VALUES (?, 'iMessage'${columns
      .map(() => ", ?")
      .join("")})`,
  ).run(rowID, ...(Object.values(row) as (string | number | bigint | Uint8Array | null)[]));
  if (chatID !== null)
    db.query("INSERT INTO chat_message_join VALUES (?, ?, ?)").run(chatID, rowID, row.date ?? 0n);
}

function seed(): void {
  const db = new Database(dbPath, { create: true });
  createChatSchema(db);
  db.run(
    "INSERT INTO handle VALUES (1, '+15550000001', 'iMessage'), (2, 'friend@example.com', 'iMessage')",
  );
  db.run(`INSERT INTO chat VALUES
    (1, 'iMessage;-;+15550000001', '+15550000001', NULL, 'iMessage', 'acct-1', 'E:me@example.com', '+15550000009'),
    (2, 'iMessage;+;chat123456', 'chat123456', 'Group Title', 'iMessage', '', NULL, NULL),
    (3, 'SMS;-;+15550000002', '+15550000002', '', 'SMS', NULL, NULL, NULL),
    (4, '', 'empty-chat', NULL, 'iMessage', NULL, NULL, NULL)`);
  db.run("INSERT INTO chat_handle_join VALUES (1, 1), (2, 2), (2, 1), (2, 1), (3, 1)");

  // Chat 1: a direct conversation with every decoding path.
  insertMessage(db, 1, 1, {
    guid: "G-1",
    text: "hello",
    handle_id: 1,
    date: ns("2026-01-01T00:00:00Z"),
    is_read: 1,
    date_read: ns("2026-01-01T00:01:00Z"),
  });
  insertMessage(db, 2, 1, {
    guid: "G-2",
    text: null,
    attributedBody: typedstream("from body ✓"),
    handle_id: 1,
    is_from_me: 1,
    destination_caller_id: "me@example.com",
    date: ns("2026-01-01T00:00:01Z", 456_700_000n),
  });
  insertMessage(db, 3, 1, {
    guid: "G-3",
    text: "reply",
    handle_id: 1,
    thread_originator_guid: "G-1",
    thread_originator_part: "0:0:5",
    date: ns("2026-01-01T00:00:02Z"),
    is_read: 0,
  });
  insertMessage(db, 4, 1, {
    guid: "G-4",
    text: "photo",
    handle_id: 1,
    date: ns("2026-01-01T00:00:03Z"),
    is_read: 1,
  });
  insertMessage(db, 5, 1, {
    guid: "G-5",
    text: "edited text",
    handle_id: 1,
    date: ns("2026-01-01T00:00:04Z"),
    date_edited: ns("2026-01-01T00:05:00Z"),
    is_read: 1,
  });
  insertMessage(db, 6, 1, {
    guid: "G-6",
    text: "gone",
    handle_id: 1,
    date: ns("2026-01-01T00:00:05Z"),
    date_edited: ns("2026-01-01T00:06:00Z"),
    message_summary_info: bplist({ otr: { "0": { le: 4 } }, rp: [0] }),
    is_read: 1,
  });
  insertMessage(db, 7, 1, {
    guid: "G-7",
    text: null,
    handle_id: 1,
    is_audio_message: 1,
    date: ns("2026-01-01T00:00:06Z"),
    is_read: 1,
  });
  insertMessage(db, 8, 1, {
    guid: "G-8",
    text: "outside range",
    handle_id: 1,
    date: ns("2026-02-01T00:00:00Z"),
  });
  // Reactions to G-1: like, then love, then the like is removed; a custom emoji from the text.
  insertMessage(db, 20, 1, {
    guid: "R-1",
    is_read: 1,
    text: "Liked “hello”",
    handle_id: 1,
    associated_message_guid: "p:0/G-1",
    associated_message_type: 2001,
    date: ns("2026-01-01T00:10:00Z"),
  });
  insertMessage(db, 21, 1, {
    guid: "R-2",
    text: "Loved “hello”",
    handle_id: 0,
    is_from_me: 1,
    destination_caller_id: "me@example.com",
    associated_message_guid: "p:0/G-1",
    associated_message_type: 2000,
    date: ns("2026-01-01T00:11:00Z"),
  });
  insertMessage(db, 22, 1, {
    guid: "R-3",
    is_read: 1,
    text: "Removed a like",
    handle_id: 1,
    associated_message_guid: "p:0/G-1",
    associated_message_type: 3001,
    date: ns("2026-01-01T00:12:00Z"),
  });
  insertMessage(db, 23, 1, {
    guid: "R-4",
    is_read: 1,
    text: "Reacted 🎉 to “hello”",
    handle_id: 1,
    associated_message_guid: "p:0/g-1",
    associated_message_type: 2006,
    date: ns("2026-01-01T00:13:00Z"),
  });
  db.run(
    `INSERT INTO attachment VALUES
    (1, '~/Library/Messages/Attachments/zz/missing-photo.heic', 'photo.heic', 'public.heic', 'image/heic', 1234, 0, NULL),
    (2, '${join(root, "present.txt")}', 'present.txt', 'public.plain-text', 'text/plain', 5, 1, NULL),
    (3, NULL, NULL, NULL, NULL, NULL, NULL, ?)`,
    [bplist({ "audio-transcription": "spoken words" })],
  );
  db.run("INSERT INTO message_attachment_join VALUES (4, 1), (4, 2), (7, 3), (6, 1)");

  // Chat 2: group; a URL row that belongs to the text before it.
  insertMessage(db, 30, 2, {
    guid: "G-30",
    text: "see https://example.com/page now",
    handle_id: 2,
    date: ns("2026-01-03T00:00:00Z"),
    is_read: 1,
  });
  insertMessage(db, 31, 2, {
    guid: "G-31",
    text: "https://example.com/page",
    handle_id: 2,
    balloon_bundle_id: "com.apple.messages.URLBalloonProvider",
    date: ns("2026-01-03T00:00:02Z"),
    is_read: 1,
  });
  // Chat 3: newest chat, no messages in range of the tests above.
  insertMessage(db, 40, 3, {
    guid: "G-40",
    text: "sms",
    handle_id: 1,
    date: ns("2026-03-01T00:00:00Z"),
    is_read: 0,
  });
  // Chat 4 has no guid.
  insertMessage(db, 50, 4, {
    guid: "G-50",
    text: "x",
    handle_id: 1,
    date: ns("2025-01-01T00:00:00Z"),
    is_read: 1,
  });
  db.close();
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "sherpa-imessage-"));
  dbPath = join(root, "chat.db");
  await Bun.write(join(root, "present.txt"), "hello");
  seed();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const parseLines = (output: string) =>
  output
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
const commands = (overrides: Partial<Parameters<typeof imessageCommands>[0]> = {}) =>
  imessageCommands({ databasePath: dbPath, ...overrides });
const january = { start: "2026-01-01T00:00:00Z", end: "2026-01-31T00:00:00.000Z" };

async function rejection(promise: Promise<unknown>): Promise<SherpaError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SherpaError) return error;
    throw error;
  }
  throw new Error("expected a rejection");
}

describe("imessage chats", () => {
  test("lists chats newest first with imsg's keys and value rules", async () => {
    const rows = parseLines(await commands().chats(10));
    expect(rows.map((row) => row.id)).toEqual([3, 1, 2, 4]);
    const direct = rows.find((row) => row.id === 1)!;
    expect(direct).toEqual({
      account_id: "acct-1",
      account_login: "E:me@example.com",
      display_name: "+15550000001",
      guid: "iMessage;-;+15550000001",
      id: 1,
      identifier: "+15550000001",
      is_group: false,
      last_addressed_handle: "+15550000009",
      last_message_at: "2026-02-01T00:00:00.000Z",
      name: "+15550000001",
      participants: ["+15550000001"],
      service: "iMessage",
      unread_count: 2,
    });
    const group = rows.find((row) => row.id === 2)!;
    expect(group.is_group).toBe(true);
    expect(group.name).toBe("Group Title");
    expect(group.participants).toEqual(["+15550000001", "friend@example.com"]);
    expect(group).not.toHaveProperty("account_id");
    expect(group.unread_count).toBe(0);
    // An empty stored title stays empty in display_name; name falls back to the identifier.
    const sms = rows.find((row) => row.id === 3)!;
    expect(sms.display_name).toBe("");
    expect(sms.name).toBe("+15550000002");
    expect(rows.find((row) => row.id === 4)).not.toHaveProperty("guid");
  });

  test("applies the limit after ordering", async () => {
    expect(parseLines(await commands().chats(2)).map((row) => row.id)).toEqual([3, 1]);
  });

  test.each([0, 1001, 1.5])("rejects limit %s", async (limit) => {
    expect((await rejection(commands().chats(limit))).code).toBe(codes.invalidRequest);
  });

  test("an unreadable store asks for Full Disk Access", async () => {
    const error = await rejection(
      commands({ databasePath: join(root, "absent", "chat.db") }).chats(5),
    );
    expect(error.code).toBe("imessage.store_unreadable");
    expect(error.remedy).toContain("Full Disk Access");
  });
});

describe("imessage history", () => {
  test("returns the range newest first with decoded text, reactions and attachments", async () => {
    const rows = parseLines(await commands().history({ chatID: 1n, ...january, limit: 100 }));
    expect(rows.map((row) => row.id)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    const byID = new Map(rows.map((row) => [row.id, row]));

    expect(byID.get(1)).toEqual({
      attachments: [],
      chat_guid: "iMessage;-;+15550000001",
      chat_id: 1,
      chat_identifier: "+15550000001",
      chat_name: "+15550000001",
      created_at: "2026-01-01T00:00:00.000Z",
      date_read: "2026-01-01T00:01:00.000Z",
      guid: "G-1",
      id: 1,
      is_from_me: false,
      is_group: false,
      is_read: true,
      participants: ["+15550000001"],
      reactions: [
        {
          created_at: "2026-01-01T00:11:00.000Z",
          emoji: "❤️",
          id: 21,
          is_from_me: true,
          sender: "me@example.com",
          type: "love",
        },
        {
          created_at: "2026-01-01T00:13:00.000Z",
          emoji: "🎉",
          id: 23,
          is_from_me: false,
          sender: "+15550000001",
          type: "custom",
        },
      ],
      sender: "+15550000001",
      text: "hello",
    });

    // Outgoing: text from attributedBody, sender from destination_caller_id, no read state, rounded milliseconds.
    expect(byID.get(2)).toMatchObject({
      text: "from body ✓",
      sender: "me@example.com",
      destination_caller_id: "me@example.com",
      is_from_me: true,
      created_at: "2026-01-01T00:00:01.457Z",
    });
    expect(byID.get(2)).not.toHaveProperty("is_read");

    expect(byID.get(3)).toMatchObject({
      reply_to_guid: "G-1",
      reply_to_text: "hello",
      reply_to_sender: "+15550000001",
      thread_originator_guid: "G-1",
      thread_originator_part: "0:0:5",
      is_read: false,
    });
    expect(byID.get(3)).not.toHaveProperty("date_read");

    const attachments = byID.get(4)!.attachments as Record<string, unknown>[];
    expect(attachments).toEqual([
      {
        filename: "~/Library/Messages/Attachments/zz/missing-photo.heic",
        is_sticker: false,
        mime_type: "image/heic",
        missing: true,
        original_path: join(homedir(), "Library/Messages/Attachments/zz/missing-photo.heic"),
        total_bytes: 1234,
        transfer_name: "photo.heic",
        uti: "public.heic",
      },
      expect.objectContaining({
        missing: false,
        is_sticker: true,
        original_path: join(root, "present.txt"),
      }),
    ]);

    expect(byID.get(5)).toMatchObject({
      text: "edited text",
      edited_at: "2026-01-01T00:05:00.000Z",
    });
    expect(byID.get(5)).not.toHaveProperty("unsent_at");

    // Every original part retracted: an unsend, with no text or attachments.
    expect(byID.get(6)).toMatchObject({
      text: "",
      attachments: [],
      edited_at: "2026-01-01T00:06:00.000Z",
      unsent_at: "2026-01-01T00:06:00.000Z",
    });

    expect(byID.get(7)!.text).toBe("spoken words");
  });

  test("keeps the start inclusive, the end exclusive and the newest rows under the limit", async () => {
    const exact = await commands().history({
      chatID: 1n,
      start: "2026-01-01T00:00:02Z",
      end: "2026-01-01T00:00:04Z",
      limit: 10,
    });
    expect(parseLines(exact).map((row) => row.id)).toEqual([4, 3]);
    const limited = await commands().history({ chatID: 1n, ...january, limit: 2 });
    expect(parseLines(limited).map((row) => row.id)).toEqual([7, 6]);
  });

  test("folds a URL preview row into the text message it belongs to", async () => {
    const rows = parseLines(await commands().history({ chatID: 2n, ...january, limit: 10 }));
    expect(rows.map((row) => row.id)).toEqual([30]);
    expect(rows[0]!.url_preview).toEqual({
      balloon_bundle_id: "com.apple.messages.URLBalloonProvider",
      created_at: "2026-01-03T00:00:02.000Z",
      guid: "G-31",
      id: 31,
    });
    expect(rows[0]).toMatchObject({ is_group: true, chat_name: "Group Title" });
  });

  test("prints nothing for an unknown chat", async () => {
    expect(await commands().history({ chatID: 99n, ...january, limit: 10 })).toBe("");
  });

  test.each([
    [{ limit: 0 }],
    [{ limit: 10_001 }],
    [{ start: "2026-01-01" }],
    [{ start: "2026-01-01T00:00:00" }],
    [{ end: "2026-02-30T00:00:00Z" }],
    [{ end: "2026-01-01 00:00:00Z" }],
  ])("rejects %o", async (override) => {
    const options = { chatID: 1n, ...january, limit: 10, ...override };
    expect((await rejection(commands().history(options))).code).toBe(codes.invalidRequest);
  });
});

describe("imessage chat preview (app-connection-v1 §9)", () => {
  test("shows the display name, or the identifier without one, and the participants", async () => {
    expect(await commands().chat(2n)).toEqual({
      name: "Group Title",
      participants: ["+15550000001", "friend@example.com"],
    });
    expect(await commands().chat(1n)).toEqual({
      name: "+15550000001",
      participants: ["+15550000001"],
    });
    // An empty display name counts as none.
    expect((await commands().chat(3n)).name).toBe("+15550000002");
  });

  test("a chat a send would refuse is not found", async () => {
    for (const chatID of [99n, 4n, 2n ** 64n - 1n])
      expect((await rejection(commands().chat(chatID))).code).toBe("imessage.chat_not_found");
  });

  test("an unreadable store fails with the permission remedy", async () => {
    const error = await rejection(
      commands({ databasePath: join(root, "missing/chat.db") }).chat(1n),
    );
    expect(error.code).toBe("imessage.store_unreadable");
    expect(error.remedy).toContain("Full Disk Access");
  });
});

describe("imessage send", () => {
  const recorded: {
    executable: string;
    args: readonly string[];
    stdin: string;
    effect?: string;
  }[] = [];
  const fakeRunner =
    (stdout: string): Runner =>
    async (executable, args, options) => {
      recorded.push({
        executable,
        args,
        stdin: new TextDecoder().decode(options.stdin),
        effect: options.effect,
      });
      return { stdout: new TextEncoder().encode(stdout) };
    };
  beforeEach(() => {
    recorded.length = 0;
  });
  const text = new TextEncoder().encode("synthetic note\nline two");

  test("sends to the chat guid through osascript with guid and text only on stdin", async () => {
    const output = await commands({ run: fakeRunner("SHERPA_RESULT\tok\t0\n") }).send(1n, text);
    expect(JSON.parse(new TextDecoder().decode(output))).toEqual({
      status: "application_accepted",
    });
    expect(recorded).toHaveLength(1);
    const call = recorded[0]!;
    expect(call.executable).toBe("/usr/bin/osascript");
    expect(call.args.slice(0, 3)).toEqual(["-l", "JavaScript", "-e"]);
    expect(call.args.join(" ")).not.toContain("synthetic note");
    expect(call.args.join(" ")).not.toContain("+15550000001");
    expect(call.stdin).toBe("iMessage;-;+15550000001\nsynthetic note\nline two");
    expect(call.effect).toBe("mutation");
  });

  test("an unknown chat or one without a guid is chat_not_found and runs nothing", async () => {
    for (const chatID of [99n, 4n, 2n ** 64n - 1n]) {
      const error = await rejection(
        commands({ run: fakeRunner("SHERPA_RESULT\tok\t0") }).send(chatID, text),
      );
      expect(error.code).toBe("imessage.chat_not_found");
    }
    expect(recorded).toHaveLength(0);
  });

  test("a failure before dispatch is a plain failure; anything else may have applied", async () => {
    const before = await rejection(
      commands({ run: fakeRunner("SHERPA_RESULT\tnot_started\t-1728") }).send(1n, text),
    );
    expect(before.code).toBe("imessage.send_not_started");
    expect(before.mayHaveApplied).toBe(false);
    for (const stdout of ["SHERPA_RESULT\tmay_have_completed\t-1700", "", "garbage"]) {
      const after = await rejection(commands({ run: fakeRunner(stdout) }).send(1n, text));
      expect(after.code).toBe(codes.uncertain);
      expect(after.mayHaveApplied).toBe(true);
    }
  });

  test.each([
    ["empty", new Uint8Array()],
    ["NUL", new TextEncoder().encode("a\0b")],
    ["invalid UTF-8", new Uint8Array([0xff, 0xfe, 0x41])],
    ["over 64 KiB", new Uint8Array(64 * 1024 + 1).fill(0x41)],
  ])("rejects %s text before touching Messages", async (_name, body) => {
    const error = await rejection(
      commands({ run: fakeRunner("SHERPA_RESULT\tok\t0") }).send(1n, body),
    );
    expect(error.code).toBe(codes.invalidRequest);
    expect(recorded).toHaveLength(0);
  });

  test("works with a real child process standing in for osascript", async () => {
    const fake = join(root, "fake-osascript");
    const capture = join(root, "stdin.txt");
    await Bun.write(fake, `#!/bin/sh\ncat > '${capture}'\nprintf 'SHERPA_RESULT\\tok\\t0\\n'\n`);
    chmodSync(fake, 0o755);
    const output = await commands({ osascript: fake }).send(1n, text);
    expect(JSON.parse(new TextDecoder().decode(output))).toEqual({
      status: "application_accepted",
    });
    expect(await Bun.file(capture).text()).toBe(
      "iMessage;-;+15550000001\nsynthetic note\nline two",
    );
  });
});

describe("imessage decoding helpers", () => {
  test("typedstream bodies decode the first NSString, including long ones", () => {
    expect(parseAttributedBody(typedstream("short"))).toBe("short");
    const long = "x".repeat(300);
    expect(parseAttributedBody(typedstream(long))).toBe(long);
    expect(parseAttributedBody(new Uint8Array())).toBe("");
    expect(parseAttributedBody(new Uint8Array([0x04, 0x0b, 0x01]))).toBe("");
  });

  test("binary plists round-trip dictionaries, arrays, UIDs and unicode", () => {
    const value = parseBinaryPlist(bplist({ a: [1, true, "é"], b: new PlistUID(7) }));
    expect(value).toEqual({ a: [1, true, "é"], b: new PlistUID(7) });
  });

  test("instants parse with or without fractions and offsets and format to milliseconds", () => {
    expect(parseInstant("2001-01-01T00:00:00Z")).toBe(0);
    expect(parseInstant("2001-01-01T09:00:00.5+09:00")).toBe(0.5);
    expect(formatAppleSeconds(0.0004)).toBe("2001-01-01T00:00:00.000Z");
    expect(formatAppleSeconds(0.0006)).toBe("2001-01-01T00:00:00.001Z");
  });
});

describe("imessage polls", () => {
  test("a vote carries its options' text from the poll it answers", async () => {
    const db = new Database(dbPath);
    const pollJSON = {
      item: {
        creatorHandle: "+15550000001",
        title: "",
        orderedPollOptions: [
          { optionIdentifier: "OPT-A", text: "Tea" },
          { optionIdentifier: "OPT-B", text: "Coffee" },
        ],
      },
      version: 1,
    };
    const voteJSON = {
      version: 1,
      item: {
        votes: [
          {
            voteOptionIdentifier: "OPT-B",
            participantHandle: "+15550000001",
            serverVoteTime: 785000000.25,
          },
        ],
      },
    };
    const archive = (json: unknown, query = "") =>
      bplist({
        $archiver: "NSKeyedArchiver",
        $version: 100000,
        $top: { root: new PlistUID(1) },
        $objects: [
          "$null",
          {
            "NS.keys": [new PlistUID(2)],
            "NS.objects": [new PlistUID(3)],
            $class: new PlistUID(5),
          },
          "URL",
          { "NS.base": new PlistUID(0), "NS.relative": new PlistUID(4), $class: new PlistUID(6) },
          `data:,${Buffer.from(JSON.stringify(json)).toString("base64")}${query}`,
          { $classname: "NSDictionary", $classes: ["NSDictionary", "NSObject"] },
          { $classname: "NSURL", $classes: ["NSURL", "NSObject"] },
        ],
      });
    const bundle =
      "com.apple.messages.MSMessageExtensionBalloonPlugin:0000000000:com.apple.messages.Polls";
    insertMessage(db, 60, 1, {
      guid: "POLL-1",
      text: "￼",
      handle_id: 1,
      balloon_bundle_id: bundle,
      associated_message_type: 0,
      payload_data: archive(pollJSON, "?src=a&c=b"),
      date: ns("2026-01-05T00:00:00Z"),
      is_read: 1,
    });
    insertMessage(db, 61, 1, {
      guid: "CAPTION-1",
      text: "Which drink?",
      handle_id: 1,
      reply_to_guid: "POLL-1",
      date: ns("2026-01-05T00:00:01Z"),
      is_read: 1,
    });
    insertMessage(db, 62, 1, {
      guid: "VOTE-1",
      text: "￼",
      handle_id: 1,
      balloon_bundle_id: bundle,
      associated_message_type: 4000,
      associated_message_guid: "POLL-1",
      payload_data: archive(voteJSON),
      date: ns("2026-01-05T00:00:02Z"),
      is_read: 1,
    });
    db.close();

    const rows = parseLines(
      await commands().history({
        chatID: 1n,
        start: "2026-01-05T00:00:00Z",
        end: "2026-01-06T00:00:00Z",
        limit: 10,
      }),
    );
    const byID = new Map(rows.map((row) => [row.id, row]));
    expect(byID.get(60)!.poll).toEqual({
      kind: "created",
      event: "imessage.poll.created",
      poll_guid: "POLL-1",
      question: "Which drink?",
      options: [
        { id: "OPT-A", text: "Tea" },
        { id: "OPT-B", text: "Coffee" },
      ],
      creator: "+15550000001",
      participants: ["+15550000001"],
      metadata: {
        bundle_id: bundle,
        associated_message_type: 0,
        payload_bytes: expect.any(Number),
        query_keys: ["c", "src"],
        url_scheme: "data",
      },
    });
    expect(byID.get(62)!.poll).toMatchObject({
      kind: "vote",
      event: "imessage.poll.voted",
      poll_guid: "POLL-1",
      original_guid: "POLL-1",
      vote: {
        option_id: "OPT-B",
        option_text: "Coffee",
        participant: "+15550000001",
        event_type: "selected",
        server_time: "785000000.25",
      },
    });
  });
});
