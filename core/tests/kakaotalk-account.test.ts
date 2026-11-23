import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import {
  accountStatus,
  openAccountDatabase,
  setupAccount,
  type AccountEnvironment,
} from "../src/kakaotalk/account.ts";
import { preferencesFrom, positiveUserId } from "../src/kakaotalk/device.ts";
import {
  accountHash,
  databaseName,
  hashedDeviceUUID,
  secureKey,
} from "../src/kakaotalk/key-derivation.ts";
import { parseBinaryPlist, readPlistFile } from "../src/plist/plist.ts";
import { searchPreimage } from "../src/kakaotalk/preimage-search.ts";

// Synthetic vectors: kakaocli 0.6.0 KeyDerivation.swift compiled with swiftc and run on
// the inputs of its own KeyDerivationTests (no real device or account values).
const uuid = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";

describe("key derivation (kakaocli parity)", () => {
  test("hashed device UUID", () => {
    expect(hashedDeviceUUID(uuid)).toBe(
      "nimoAVPKEChfYbT+0fQ9rqnv84dfSdAmfUERfn8ODHCuZqqkpDv1VDDltK5kAvIyIeZ3KA==",
    );
  });

  test("database name", () => {
    expect(databaseName("12345", uuid)).toBe(
      "41d955f9bda54b4af4c5ef87c2954421e0fc1efb939c01b77077b29dd8d55364706a0e98db7259",
    );
    expect(databaseName("22222", uuid)).toBe(
      "af61e68598206601ddcd7abefa33368f99fa493e723de0101ebd546442d72c554bc35194163313",
    );
    expect(databaseName("987654321", "01234567-89AB-CDEF-0123-456789ABCDEF")).toBe(
      "ca1e425632cda104dec461956263dfb43c04a5e620398c6f0d9799eb5f8e2524b64870a4e3ff55",
    );
  });

  test("secure key", () => {
    expect(secureKey("12345", uuid)).toBe(
      "09370703034c75bc9a381e686d3221ff7c2c6d062e30540ec6e487b6eab65083eb3757e9e398d5c6a160f360f6a6c52efeb03a511d20f9f4c60f542231a2cd7d1c2cd8caaef29d505291d493e1fb570ac8baa17692343a3a7bac6ed3027b57b46ccade990bcbddc434153acf16dc03eedac58b2645183d036d6e180eaeb2c67f",
    );
    expect(secureKey("987654321", "01234567-89AB-CDEF-0123-456789ABCDEF")).toBe(
      "691023dac737afedf2eab87fdf6f8e26e18aaf23758ace272aab4ca800e195d4b7ce1a8115c0100b0d98f07d3e11b291038abe9d1fc644915df1ce8ab1f8c8e529d5c1002f05b8f52c0d2c7ef2f3b6309a8833733795756e0e4f3c9969b83596360dc6c379c82d5ca190a48f1df3fee8d64ebfbc916d212b6c098ed90b155de0",
    );
    expect(secureKey("11111", uuid)).not.toBe(secureKey("22222", uuid));
  });

  test("account hash is SHA-512 of the decimal id", () => {
    expect(accountHash("0")).toBe(
      "31bca02094eb78126a517b206a88c73cfa9ec6f704c7030d18212cace820f025f00bf0ea68dbf3f3a5436ca63b53bf7bf80ad8d5de7d8359d0b7fed9dbc3ab99",
    );
  });
});

describe("binary plist", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>AlertKakaoIDsList</key><array><integer>4242</integer><string>77</string><integer>-1</integer></array>
  <key>DESIGNATEDFRIENDSREVISION:${accountHash("4242")}</key><integer>17</integer>
  <key>Big</key><integer>9007199254740993</integer>
  <key>Blob</key><data>AAEC</data>
  <key>When</key><date>2026-01-02T03:04:05Z</date>
  <key>Name</key><string>카카오 ✓</string>
  <key>Ratio</key><real>0.5</real>
  <key>Flag</key><true/>
</dict></plist>`;

  async function binaryFixture(): Promise<{ binary: Uint8Array; xmlPath: string }> {
    const directory = mkdtempSync(join(tmpdir(), "sherpa-plist-"));
    const xmlPath = join(directory, "fixture.plist");
    await Bun.write(xmlPath, xml);
    const child = Bun.spawn(["/usr/bin/plutil", "-convert", "binary1", "-o", "-", xmlPath], {
      stdout: "pipe",
    });
    const binary = new Uint8Array(await new Response(child.stdout).arrayBuffer());
    expect(await child.exited).toBe(0);
    return { binary, xmlPath };
  }

  test("parses every value kind KakaoTalk preferences use", async () => {
    const { binary } = await binaryFixture();
    const value = parseBinaryPlist(binary) as Record<string, unknown>;
    expect(value.AlertKakaoIDsList).toEqual([4242, "77", -1]);
    expect(value.Big).toBe(9007199254740993n);
    expect(value.Blob).toEqual(Uint8Array.from([0, 1, 2]));
    expect((value.When as Date).toISOString()).toBe("2026-01-02T03:04:05.000Z");
    expect(value.Name).toBe("카카오 ✓");
    expect(value.Ratio).toBe(0.5);
    expect(value.Flag).toBe(true);
  });

  test("reads XML plists through plutil", async () => {
    const { xmlPath } = await binaryFixture();
    const value = (await readPlistFile(xmlPath)) as Record<string, unknown>;
    expect(value.Name).toBe("카카오 ✓");
  });

  test("rejects truncated input", () => {
    expect(() => parseBinaryPlist(new TextEncoder().encode("bplist00garbage"))).toThrow();
  });
});

describe("preferences", () => {
  const empty = accountHash("0");
  test("active hashes skip the empty account and zero revisions", () => {
    const preferences = preferencesFrom([
      {
        [`DESIGNATEDFRIENDSREVISION:${empty}`]: 5,
        [`DESIGNATEDFRIENDSREVISION:${accountHash("1")}`]: 0,
        [`DESIGNATEDFRIENDSREVISION:${accountHash("2").toUpperCase()}`]: 9,
      },
    ]);
    expect(preferences.activeAccountHashes).toEqual([accountHash("2")]);
  });

  test("cheap candidates follow kakaocli strategies 1, 2, 4 and AlertKakaoIDsList", () => {
    const preferences = preferencesFrom([
      {
        FSChatWindowTransparency111: 1,
        FSChatWindowTransparency2111: 1,
        userId: "222",
        "NSWindow Frame FSChatWindowFrame_9333": "x",
        "NSWindow Frame FSChatWindowFrame_8333": "x",
        AlertKakaoIDsList: [444, "555", 0, -3, "abc"],
      },
    ]);
    expect(preferences.candidateUserIds).toEqual(["111", "222", "333", "444", "555"]);
  });

  test("an empty common suffix gives no candidate (KakaoTalk 26.10 frame keys)", () => {
    const preferences = preferencesFrom([
      {
        "NSWindow Frame FSChatWindowFrame_0123456789abcdef0123456789abcdef01234567": "x",
        "NSWindow Frame FSChatWindowFrame_fedcba9876543210fedcba9876543210fedcba98": "x",
      },
    ]);
    expect(preferences.candidateUserIds).toEqual([]);
  });

  test("user ids are positive 64-bit integers", () => {
    expect(positiveUserId(" 42 ")).toBe("42");
    expect(positiveUserId("042")).toBeNull();
    expect(positiveUserId("9223372036854775808")).toBeNull();
    expect(positiveUserId(0)).toBeNull();
    expect(positiveUserId(9223372036854775807n)).toBe("9223372036854775807");
  });
});

describe("pre-image search", () => {
  test("finds a synthetic id with parallel workers", async () => {
    const result = await searchPreimage([accountHash("123457")], {
      budgetMs: 60_000,
      workers: 2,
      chunk: 50_000,
    });
    expect(result.userId).toBe("123457");
    expect(result.workers).toBe(2);
    expect(result.candidatesPerSecond).toBeGreaterThan(0);
  });

  test("stops at the budget without a match", async () => {
    const result = await searchPreimage(["0".repeat(128)], {
      budgetMs: 200,
      workers: 1,
      chunk: 10_000,
    });
    expect(result.userId).toBeNull();
    expect(result.exhaustedBudget).toBe(true);
  });
});

/** A fake system: the database "opens" only with the key derived from `realId`. */
function environment(
  realId: string,
  options: {
    stored?: string | null;
    candidates?: string[];
    hashes?: string[];
    found?: string | null;
  } = {},
) {
  const fakeUUID = "11111111-2222-3333-4444-555555555555";
  const state = { stored: options.stored ?? null, searches: 0 };
  const env: AccountEnvironment = {
    sqlcipherAvailable: () => true,
    useSQLCipher: () => {},
    platformUUID: async () => fakeUUID,
    readPreferences: async () => ({
      fileCount: 1,
      activeAccountHashes: options.hashes ?? [accountHash(realId)],
      candidateUserIds: options.candidates ?? [],
    }),
    databaseFile: () => "/fixture/database",
    databaseFileCount: () => 1,
    openDatabase: (_path, passphrase) =>
      passphrase === secureKey(realId, fakeUUID) ? new Database(":memory:") : null,
    applicationInstalled: () => true,
    applicationVersion: async () => "26.10.0",
    keychain: {
      get: async () => state.stored,
      set: async (value) => {
        state.stored = value;
      },
    },
    searchPreimage: async () => {
      state.searches++;
      return {
        userId: options.found === undefined ? realId : options.found,
        candidates: 1,
        elapsedMs: 5,
        workers: 3,
        candidatesPerSecond: 1000,
        exhaustedBudget: false,
      };
    },
    searchBudgetMs: 1000,
  };
  return { env, state };
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe("setup", () => {
  test("accepts a stdin id that matches the account hash and opens the database", async () => {
    const { env, state } = environment("8642");
    const envelope = await setupAccount(bytes("8642\n"), env);
    expect(envelope).toEqual({
      schema: "sherpa.kakaotalk-setup.v1",
      status: "ready",
      source: "stdin",
      database_verified: true,
    });
    expect(state.stored).toBe("8642");
    expect(JSON.stringify(envelope)).not.toContain("8642");
  });

  test("rejects a stdin id whose hash does not match", async () => {
    const { env, state } = environment("8642");
    await expect(setupAccount(bytes("8643"), env)).rejects.toMatchObject({
      code: "kakaotalk.user_id_mismatch",
    });
    expect(state.stored).toBeNull();
  });

  test("rejects malformed stdin", async () => {
    const { env } = environment("8642");
    await expect(setupAccount(bytes("12a"), env)).rejects.toMatchObject({ code: "invalidRequest" });
  });

  test("reports ready from a valid keychain id without searching", async () => {
    const { env, state } = environment("8642", { stored: "8642" });
    const envelope = await setupAccount(null, env);
    expect(envelope.source).toBe("keychain");
    expect(state.searches).toBe(0);
  });

  test("tries preference candidates before searching", async () => {
    const { env, state } = environment("8642", { candidates: ["1", "8642"] });
    const envelope = await setupAccount(null, env);
    expect(envelope).toMatchObject({ source: "recovered", method: "preferences_candidate" });
    expect(state.searches).toBe(0);
    expect(state.stored).toBe("8642");
  });

  test("recovers the id by pre-image search and stores it", async () => {
    const { env, state } = environment("8642", { stored: "999" });
    const envelope = await setupAccount(null, env);
    expect(envelope).toMatchObject({
      source: "recovered",
      method: "preimage_search",
      recovery: { workers: 3, elapsed_ms: 5, candidates_per_second: 1000 },
    });
    expect(state.stored).toBe("8642");
    expect(JSON.stringify(envelope)).not.toContain("8642");
  });

  test("fails with a manual remedy when the search finds nothing", async () => {
    const { env } = environment("8642", { found: null });
    await expect(setupAccount(null, env)).rejects.toMatchObject({
      code: "kakaotalk.user_id_not_found",
      remedy: "run: sherpa kakaotalk setup --user-id-stdin",
    });
  });
});

describe("read-command account resolution", () => {
  test("uses the keychain id", async () => {
    const { env } = environment("8642", { stored: "8642" });
    const source = await openAccountDatabase(env);
    source.close();
  });

  test("falls back to cheap candidates when the keychain id is stale", async () => {
    const { env, state } = environment("8642", { stored: "1234", candidates: ["8642"] });
    const source = await openAccountDatabase(env);
    source.close();
    expect(state.searches).toBe(0);
  });

  test("asks for setup instead of searching", async () => {
    const { env, state } = environment("8642", { stored: "1234" });
    await expect(openAccountDatabase(env)).rejects.toMatchObject({
      code: "kakaotalk.setup_required",
      remedy: "run: sherpa kakaotalk setup",
    });
    expect(state.searches).toBe(0);
  });
});

describe("status", () => {
  test("reports booleans and counts only", async () => {
    const { env } = environment("8642", { stored: "8642", candidates: ["77"] });
    const envelope = await accountStatus(env);
    expect(envelope).toEqual({
      schema: "sherpa.kakaotalk-status.v1",
      application: { installed: true, version: "26.10.0" },
      preferences: {
        found: true,
        file_count: 1,
        active_account_hash_present: true,
        candidate_count: 1,
      },
      keychain: { user_id_present: true, matches_active_account: true },
      database: { file_found: true, file_count: 1, sqlcipher_available: true, opens: true },
      ready: true,
    });
    const text = JSON.stringify(envelope);
    expect(text).not.toContain("8642");
    expect(text).not.toContain(accountHash("8642"));
  });

  test("reports a stale keychain id as not matching", async () => {
    const { env } = environment("8642", { stored: "1234" });
    const envelope = await accountStatus(env);
    expect(envelope.keychain).toEqual({ user_id_present: true, matches_active_account: false });
    expect(envelope.ready).toBe(false);
  });
});
