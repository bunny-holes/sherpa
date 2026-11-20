import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { CheckpointStore } from "../src/kakaotalk/checkpoint-store.ts";
import {
  encode,
  kakaoTalkCommands,
  localDateStart,
  parseISO8601,
} from "../src/kakaotalk/commands.ts";
import { KakaoDatabase } from "../src/kakaotalk/database.ts";

// Synthetic fixture with the KakaoTalk Mac tables kakaocli reads. No real data.
const now = new Date("2026-11-20T12:00:00.000Z");
const seconds = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const me = 9_000_000_000_000_000_001n;

function fixture(): Database {
  const db = new Database(":memory:", { safeIntegers: true });
  db.run(`CREATE TABLE NTChatRoom (chatId INTEGER, type INTEGER, chatName TEXT, activeMembersCount INTEGER,
    lastLogId INTEGER, lastUpdatedAt INTEGER, countOfNewMessage INTEGER, directChatMemberUserId INTEGER)`);
  db.run(
    `CREATE TABLE NTUser (userId INTEGER, linkId INTEGER, displayName TEXT, friendNickName TEXT, nickName TEXT)`,
  );
  db.run(
    `CREATE TABLE NTChatMessage (logId INTEGER, chatId INTEGER, authorId INTEGER, message TEXT, type INTEGER, sentAt INTEGER)`,
  );
  db.run(`CREATE TABLE NTChatContext (userId INTEGER)`);
  db.query("INSERT INTO NTChatContext VALUES (?)").run(me);
  const rooms: [bigint, string | null, number, bigint | null][] = [
    [101n, "Team Room", 50, null],
    [102n, null, 40, 501n], // direct chat named after the friend
    [103n, "Café", 30, null], // decomposed: matches NFC "Café"
    [104n, "Twin", 20, null],
    [105n, "Twin", 10, null],
    [106n, "", 5, 502n], // empty chatName wins over the friend's name (kakaocli `??`)
  ];
  for (const [id, name, updated, member] of rooms) {
    db.query("INSERT INTO NTChatRoom VALUES (?, 1, ?, 2, 0, ?, 0, ?)").run(
      id,
      name,
      updated,
      member,
    );
  }
  db.run("INSERT INTO NTUser VALUES (501, 0, NULL, 'Friend Nick', 'Nick')");
  db.run("INSERT INTO NTUser VALUES (502, 0, 'Second', NULL, NULL)");
  db.run("INSERT INTO NTUser VALUES (601, 0, 'Alice', NULL, NULL)");
  db.run("INSERT INTO NTUser VALUES (601, 0, 'Alice', NULL, NULL)"); // duplicate join row
  db.run("INSERT INTO NTUser VALUES (602, 0, '', 'Bob', NULL)");
  const message = db.query("INSERT INTO NTChatMessage VALUES (?, ?, ?, ?, ?, ?)");
  message.run(1n, 101n, 601n, "hello lunch", 1, seconds("2026-11-19T01:00:00Z"));
  message.run(2n, 101n, me, "lunch photo", 2, seconds("2026-11-19T02:00:00Z"));
  message.run(3n, 101n, 602n, "lunch sticker", 5, seconds("2026-11-19T03:00:00Z"));
  message.run(4n, 102n, 501n, "old lunch", 1, seconds("2026-11-01T00:00:00Z"));
  message.run(5n, 103n, 601n, "café talk", 1, seconds("2026-11-18T00:00:00Z"));
  message.run(6n, 101n, 601n, "earlier", 1, seconds("2026-11-15T00:00:00Z"));
  return db;
}

function commands() {
  const storePath = join(mkdtempSync(join(tmpdir(), "sherpa-kakao-")), "context.sqlite3");
  return {
    storePath,
    run: kakaoTalkCommands({
      // Each command closes its source, so each one gets a fresh fixture.
      openSource: async () => new KakaoDatabase(fixture()),
      openCheckpointStore: () => new CheckpointStore(storePath),
      now: () => now,
    }),
  };
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe("search", () => {
  test("returns the 0.7 envelope with supported types, chat names and no identifiers", async () => {
    const { run } = commands();
    const output = await run.search(bytes("  lunch \n"), 10);
    const envelope = JSON.parse(output);
    expect(envelope).toEqual({
      schema: "sherpa.kakaotalk-local-search.v1",
      source: "mac_local_synchronized_database",
      coverage: {
        completeness: "partial",
        reason: "local_database_may_be_incomplete",
        limit_reached: false,
      },
      returned_count: 3,
      omitted_unsupported_count: 1,
      limit: 10,
      results: [
        {
          reference: "KLS001",
          timestamp: "2026-11-19T02:00:00Z",
          chat: "Team Room",
          text: "lunch photo",
          message_type: "photo",
          is_from_me: true,
        },
        {
          reference: "KLS002",
          timestamp: "2026-11-19T01:00:00Z",
          chat: "Team Room",
          sender: "Alice",
          text: "hello lunch",
          message_type: "text",
          is_from_me: false,
        },
        {
          reference: "KLS003",
          timestamp: "2026-11-01T00:00:00Z",
          chat: "Friend Nick",
          sender: "Friend Nick",
          text: "old lunch",
          message_type: "text",
          is_from_me: false,
        },
      ],
    });
    expect(output).toBe(encode(envelope));
    expect(output.split("\n")[1]).toBe('  "coverage": {');
    expect(output).not.toContain("101");
    expect(output).not.toContain("601");
  });

  test("deduplicates rows a duplicate user row would repeat and reports limit_reached", async () => {
    const { run } = commands();
    const envelope = JSON.parse(await run.search(bytes("hello"), 2));
    expect(envelope.returned_count).toBe(1);
    expect(envelope.coverage.limit_reached).toBe(true);
  });

  test("validates input like the Swift adapter", async () => {
    const { run } = commands();
    for (const [query, limit] of [
      ["lunch", 0],
      ["lunch", 101],
      ["   ", 5],
      ["a\nb", 5],
      ["a b", 5],
      ["a\0b", 5],
      ["가".repeat(257), 5],
    ] as const) {
      await expect(run.search(bytes(query), limit)).rejects.toMatchObject({
        code: "invalidRequest",
      });
    }
    await expect(run.search(Uint8Array.from([0xff]), 5)).rejects.toMatchObject({
      code: "invalidRequest",
    });
    await expect(run.search(bytes("가".repeat(256)), 5)).resolves.toContain("returned_count");
  });
});

describe("history", () => {
  test("reads the last seven days of one exactly named chat, oldest first", async () => {
    const { run } = commands();
    const envelope = JSON.parse(await run.history(bytes("Team Room"), 10));
    expect(envelope.schema).toBe("sherpa.kakaotalk-local-history.v1");
    expect(envelope.baseline).toEqual({
      kind: "checkpoint_missing_local_seven_day_window",
      checkpoint_available: false,
      earlier_history_read: false,
      window_start: "2026-11-13T12:00:00.000Z",
      window_end: "2026-11-20T12:00:00.000Z",
    });
    expect(
      envelope.results.map((row: { reference: string; text: string }) => [row.reference, row.text]),
    ).toEqual([
      ["KLH001", "earlier"],
      ["KLH002", "hello lunch"],
      ["KLH003", "lunch photo"],
    ]);
    expect(envelope.omitted_unsupported_count).toBe(1);
    expect(envelope.coverage.limit_reached).toBe(false);
  });

  test("matches names after NFC normalization and outputs the stored name", async () => {
    const { run } = commands();
    const envelope = JSON.parse(await run.history(bytes("Café"), 10));
    expect(envelope.results).toHaveLength(1);
    expect(envelope.results[0].chat).toBe("Café");
  });

  test("names a direct chat after the friend and excludes messages older than seven days", async () => {
    const { run } = commands();
    const envelope = JSON.parse(await run.history(bytes("Friend Nick"), 10));
    expect(envelope.returned_count).toBe(0);
  });

  test("fails when the name is ambiguous or unknown", async () => {
    const { run } = commands();
    await expect(run.history(bytes("Twin"), 10)).rejects.toMatchObject({ code: "failed" });
    await expect(run.history(bytes("Second"), 10)).rejects.toMatchObject({ code: "failed" });
    await expect(run.history(bytes("Team Room"), 1001)).rejects.toMatchObject({
      code: "invalidRequest",
    });
  });
});

describe("archive and checkpoint", () => {
  test("explicit local date range stages a checkpoint", async () => {
    const { run } = commands();
    const envelope = JSON.parse(
      await run.archive({ since: "2026-11-18", timeZone: "Asia/Seoul", limit: 100 }),
    );
    expect(envelope.schema).toBe("sherpa.kakaotalk-local-archive.v1");
    expect(envelope.range).toEqual({
      kind: "explicit_local_date_range",
      checkpoint_available: false,
      earlier_history_read: false,
      requested_start: "2026-11-18",
      window_start: "2026-11-17T15:00:00.000Z",
      window_end: "2026-11-20T12:00:00.000Z",
      time_zone: "Asia/Seoul",
    });
    expect(
      envelope.results.map((row: { reference: string; text: string }) => [row.reference, row.text]),
    ).toEqual([
      ["KLA00001", "café talk"],
      ["KLA00002", "hello lunch"],
      ["KLA00003", "lunch photo"],
    ]);
    expect(envelope.returned_chat_count).toBe(2);
    expect(envelope.omitted_unsupported_count).toBe(1);
    expect(envelope.checkpoint.state).toBe("pending");
    expect(envelope.checkpoint.token).toMatch(/^KLCP[0-9a-f]{32}$/);
    expect(envelope.checkpoint.high_water).toBe("2026-11-20T12:00:00.000Z");
  });

  test("no checkpoint is staged when the limit is reached", async () => {
    const { run } = commands();
    const envelope = JSON.parse(
      await run.archive({ since: "2026-11-18", timeZone: "UTC", limit: 2 }),
    );
    expect(envelope.coverage.limit_reached).toBe(true);
    expect("checkpoint" in envelope).toBe(false);
  });

  test("commit, then --since checkpoint reads with a 24-hour overlap", async () => {
    const { run, storePath } = commands();
    await expect(
      run.archive({ since: "checkpoint", timeZone: "UTC", limit: 10 }),
    ).rejects.toMatchObject({
      code: "invalidRequest",
    });
    const staged = JSON.parse(
      await run.archive({ since: "2026-11-18", timeZone: "UTC", limit: 100 }),
    );
    const committed = JSON.parse(await run.commitCheckpoint(bytes(`${staged.checkpoint.token}\n`)));
    expect(committed).toEqual({
      schema: "sherpa.kakaotalk-local-checkpoint.v1",
      state: "committed",
      high_water: "2026-11-20T12:00:00.000Z",
    });
    await expect(run.commitCheckpoint(bytes(staged.checkpoint.token))).rejects.toMatchObject({
      code: "failed",
    });
    const next = JSON.parse(await run.archive({ since: "checkpoint", timeZone: "UTC", limit: 10 }));
    expect(next.range.kind).toBe("local_checkpoint_with_overlap");
    expect(next.range.checkpoint_available).toBe(true);
    expect(next.range.window_start).toBe("2026-11-19T12:00:00.000Z");
    expect(next.returned_count).toBe(0);

    // The store keeps the Swift schema: an older high water never moves the checkpoint back.
    const store = new CheckpointStore(storePath);
    const older = store.stage(new Date("2026-01-01T00:00:00.000Z"));
    store.commit(older.token!);
    expect(store.current()?.high_water).toBe("2026-11-20T12:00:00.000Z");
    store.close();
  });

  test("rejects bad ranges and tokens", async () => {
    const { run } = commands();
    for (const options of [
      { since: "2026-02-30", timeZone: "UTC", limit: 10 },
      { since: "2026-11-21", timeZone: "UTC", limit: 10 },
      { since: "2000-01-01", timeZone: "UTC", limit: 10 },
      { since: "2026-11-18", timeZone: "Mars/Base", limit: 10 },
      { since: "2026-11-18", timeZone: "UTC", limit: 50_001 },
    ]) {
      await expect(run.archive(options)).rejects.toMatchObject({ code: "invalidRequest" });
    }
    await expect(run.commitCheckpoint(bytes("nope"))).rejects.toMatchObject({
      code: "invalidRequest",
    });
  });
});

describe("dates", () => {
  test("parses Foundation ISO 8601 forms", () => {
    expect(parseISO8601("2026-11-20T12:00:00Z")).toBe(Date.parse("2026-11-20T12:00:00Z"));
    expect(parseISO8601("2026-11-20T12:00:00.250Z")).toBe(Date.parse("2026-11-20T12:00:00.250Z"));
    expect(parseISO8601("2026-11-20T21:00:00+09:00")).toBe(Date.parse("2026-11-20T12:00:00Z"));
    expect(parseISO8601("2026-02-30T00:00:00Z")).toBeNull();
    expect(parseISO8601("2026-11-20")).toBeNull();
  });

  test("local date start honours the time zone and daylight saving", () => {
    expect(localDateStart("2026-11-18", "Asia/Seoul")).toBe(Date.parse("2026-11-17T15:00:00Z"));
    expect(localDateStart("2026-03-08", "America/New_York")).toBe(
      Date.parse("2026-03-08T05:00:00Z"),
    );
    expect(localDateStart("2026-03-09", "America/New_York")).toBe(
      Date.parse("2026-03-09T04:00:00Z"),
    );
    // Midnight does not exist on this date in Santiago; the day starts at 01:00 local time.
    expect(localDateStart("2026-09-06", "America/Santiago")).toBe(
      Date.parse("2026-09-06T04:00:00Z"),
    );
    expect(localDateStart("2026-13-01", "UTC")).toBeNull();
  });
});
