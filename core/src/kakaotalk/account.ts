import type { Database } from "bun:sqlite";
import { invalidRequest, SherpaError } from "../cli/errors.ts";
import { utf8 } from "../cli/stdin.ts";
import { log } from "../log.ts";
import { KakaoDatabase, type MessageSource } from "./database.ts";
import {
  applicationInstalled,
  applicationVersion,
  databaseFile,
  databaseFiles,
  errorType,
  platformUUID,
  positiveUserId,
  readPreferences,
  type Preferences,
} from "./device.ts";
import { accountHash, secureKey } from "./key-derivation.ts";
import {
  searchPreimage,
  type PreimageSearchOptions,
  type PreimageSearchResult,
} from "./preimage-search.ts";
import { openEncryptedDatabase, sqlcipherAvailable, useSQLCipher } from "./sqlcipher.ts";

/**
 * The KakaoTalk account behind the local database: which user id unlocks it,
 * where that id is kept (the login keychain), and how `setup` recovers it.
 * The user id, derived key, database file name, platform UUID and account hash
 * never leave this module: outputs and logs carry booleans, counts and timings.
 */

const keychainItem = { service: "sherpa.kakaotalk", name: "user-id" } as const;
const setupRemedy = "run: sherpa kakaotalk setup";
const manualRemedy = "run: sherpa kakaotalk setup --user-id-stdin";
const defaultSearchBudgetMs = 15 * 60 * 1000;

export interface Keychain {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
}

export interface AccountEnvironment {
  sqlcipherAvailable(): boolean;
  useSQLCipher(): void;
  platformUUID(): Promise<string>;
  readPreferences(): Promise<Preferences>;
  databaseFile(userId: string, uuid: string): string | null;
  databaseFileCount(): number;
  openDatabase(path: string, passphrase: string): Database | null;
  applicationInstalled(): boolean;
  applicationVersion(): Promise<string | null>;
  keychain: Keychain;
  searchPreimage(
    targets: readonly string[],
    options: PreimageSearchOptions,
  ): Promise<PreimageSearchResult>;
  searchBudgetMs: number;
}

export const systemAccountEnvironment: AccountEnvironment = {
  sqlcipherAvailable,
  useSQLCipher,
  platformUUID,
  readPreferences: () => readPreferences(),
  databaseFile: (userId, uuid) => databaseFile(userId, uuid),
  databaseFileCount: () => databaseFiles().length,
  openDatabase: openEncryptedDatabase,
  applicationInstalled: () => applicationInstalled(),
  applicationVersion: () => applicationVersion(),
  keychain: {
    get: () => Bun.secrets.get(keychainItem),
    set: (value) => Bun.secrets.set({ ...keychainItem, value }),
  },
  searchPreimage,
  searchBudgetMs: defaultSearchBudgetMs,
};

type Verification =
  | { ok: true; database: Database }
  | { ok: false; reason: "hash_mismatch" | "database_missing" | "database_locked" };

interface AccountContext {
  uuid: string;
  preferences: Preferences;
}

function verify(
  environment: AccountEnvironment,
  context: AccountContext,
  userId: string,
): Verification {
  const hashes = context.preferences.activeAccountHashes;
  if (hashes.length > 0 && !hashes.includes(accountHash(userId)))
    return { ok: false, reason: "hash_mismatch" };
  const path = environment.databaseFile(userId, context.uuid);
  if (!path) return { ok: false, reason: "database_missing" };
  const database = environment.openDatabase(path, secureKey(userId, context.uuid));
  return database ? { ok: true, database } : { ok: false, reason: "database_locked" };
}

async function readKeychain(environment: AccountEnvironment): Promise<string | null> {
  try {
    return positiveUserId((await environment.keychain.get()) ?? undefined);
  } catch (error) {
    log.warn(`[adapter:kakaotalk:keychain-read] available=false error_type=${errorType(error)}`);
    return null;
  }
}

async function context(environment: AccountEnvironment): Promise<AccountContext> {
  const [uuid, preferences] = await Promise.all([
    environment.platformUUID(),
    environment.readPreferences(),
  ]);
  return { uuid, preferences };
}

/**
 * Opens the database for a read command: the keychain id first, then the cheap
 * preference candidates. It never runs the pre-image search.
 */
export async function openAccountDatabase(
  environment = systemAccountEnvironment,
): Promise<MessageSource> {
  environment.useSQLCipher();
  const account = await context(environment);
  const stored = await readKeychain(environment);
  const candidates = [
    ...(stored ? [stored] : []),
    ...account.preferences.candidateUserIds.filter((id) => id !== stored),
  ];
  for (const [index, userId] of candidates.entries()) {
    const verification = verify(environment, account, userId);
    if (verification.ok) {
      log.info(
        `[adapter:kakaotalk:database-open] source=${index === 0 && stored ? "keychain" : "preferences_candidate"}`,
      );
      return new KakaoDatabase(verification.database);
    }
    log.info(`[adapter:kakaotalk:database-open] candidate_rejected=${verification.reason}`);
  }
  throw new SherpaError("kakaotalk.setup_required", { remedy: setupRemedy });
}

interface SetupEnvelope {
  schema: "sherpa.kakaotalk-setup.v1";
  status: "ready";
  source: "stdin" | "recovered" | "keychain";
  method?: "preferences_candidate" | "preimage_search";
  database_verified: true;
  recovery?: { workers: number; elapsed_ms: number; candidates_per_second: number };
}

async function store(environment: AccountEnvironment, userId: string): Promise<void> {
  try {
    await environment.keychain.set(userId);
  } catch (error) {
    log.error(`[adapter:kakaotalk:keychain-write] stored=false error_type=${errorType(error)}`);
    throw new SherpaError("kakaotalk.keychain_unavailable");
  }
}

export async function setupAccount(
  input: Uint8Array | null,
  environment = systemAccountEnvironment,
): Promise<SetupEnvelope> {
  environment.useSQLCipher();
  const account = await context(environment);
  log.info(
    `[adapter:kakaotalk:setup-context] input=${input !== null} active_account_hash_count=${account.preferences.activeAccountHashes.length}`,
  );

  if (input !== null) {
    const userId = positiveUserId(utf8(input).trim());
    if (!userId) throw invalidRequest();
    const verification = verify(environment, account, userId);
    if (!verification.ok) {
      log.warn(`[adapter:kakaotalk:setup-input] rejected=${verification.reason}`);
      throw new SherpaError(
        verification.reason === "hash_mismatch"
          ? "kakaotalk.user_id_mismatch"
          : "kakaotalk.database_open_failed",
      );
    }
    verification.database.close();
    await store(environment, userId);
    return {
      schema: "sherpa.kakaotalk-setup.v1",
      status: "ready",
      source: "stdin",
      database_verified: true,
    };
  }

  const stored = await readKeychain(environment);
  if (stored) {
    const verification = verify(environment, account, stored);
    if (verification.ok) {
      verification.database.close();
      return {
        schema: "sherpa.kakaotalk-setup.v1",
        status: "ready",
        source: "keychain",
        database_verified: true,
      };
    }
    log.info(`[adapter:kakaotalk:setup-keychain] rejected=${verification.reason}`);
  }

  for (const userId of account.preferences.candidateUserIds) {
    const verification = verify(environment, account, userId);
    if (!verification.ok) continue;
    verification.database.close();
    await store(environment, userId);
    return {
      schema: "sherpa.kakaotalk-setup.v1",
      status: "ready",
      source: "recovered",
      method: "preferences_candidate",
      database_verified: true,
    };
  }

  let targets = [...account.preferences.activeAccountHashes];
  if (targets.length === 0)
    throw new SherpaError("kakaotalk.user_id_not_found", { remedy: manualRemedy });
  const deadline = performance.now() + environment.searchBudgetMs;
  let start = 1;
  while (targets.length > 0) {
    const budgetMs = deadline - performance.now();
    if (budgetMs <= 0) break;
    const result = await environment.searchPreimage(targets, { budgetMs, start });
    if (result.userId === null) break;
    const verification = verify(environment, account, result.userId);
    if (verification.ok) {
      verification.database.close();
      await store(environment, result.userId);
      return {
        schema: "sherpa.kakaotalk-setup.v1",
        status: "ready",
        source: "recovered",
        method: "preimage_search",
        database_verified: true,
        recovery: {
          workers: result.workers,
          elapsed_ms: result.elapsedMs,
          candidates_per_second: result.candidatesPerSecond,
        },
      };
    }
    // Another account's hash: drop it and keep searching past it.
    log.info(`[adapter:kakaotalk:setup-search] match_rejected=${verification.reason}`);
    const rejected = accountHash(result.userId);
    targets = targets.filter((hash) => hash !== rejected);
    start = Number(result.userId) + 1;
  }
  throw new SherpaError("kakaotalk.user_id_not_found", { remedy: manualRemedy });
}

interface StatusEnvelope {
  schema: "sherpa.kakaotalk-status.v1";
  application: { installed: boolean; version: string | null };
  preferences: {
    found: boolean;
    file_count: number;
    active_account_hash_present: boolean;
    candidate_count: number;
  };
  keychain: { user_id_present: boolean; matches_active_account: boolean | null };
  database: {
    file_found: boolean;
    file_count: number;
    sqlcipher_available: boolean;
    opens: boolean;
  };
  ready: boolean;
}

/** Local diagnosis from files, the keychain and the database only; reports booleans and counts. */
export async function accountStatus(
  environment = systemAccountEnvironment,
): Promise<StatusEnvelope> {
  const probe = async <T>(name: string, run: () => Promise<T> | T, fallback: T): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      log.warn(`[adapter:kakaotalk:status] probe=${name} ok=false error_type=${errorType(error)}`);
      return fallback;
    }
  };
  const version = await probe("application", () => environment.applicationVersion(), null);
  const installed = environment.applicationInstalled();
  const preferences = await probe("preferences", () => environment.readPreferences(), {
    fileCount: 0,
    activeAccountHashes: [],
    candidateUserIds: [],
  });
  const stored = await readKeychain(environment);
  const hashes = preferences.activeAccountHashes;
  const fileCount = await probe("database_files", () => environment.databaseFileCount(), 0);
  const available = environment.sqlcipherAvailable();
  const opens = await probe(
    "database_open",
    async () => {
      if (!available || fileCount === 0) return false;
      environment.useSQLCipher();
      const uuid = await environment.platformUUID();
      const candidates = [
        ...(stored ? [stored] : []),
        ...preferences.candidateUserIds.filter((id) => id !== stored),
      ];
      for (const userId of candidates) {
        const verification = verify(environment, { uuid, preferences }, userId);
        if (verification.ok) {
          verification.database.close();
          return true;
        }
      }
      return false;
    },
    false,
  );
  return {
    schema: "sherpa.kakaotalk-status.v1",
    application: { installed, version },
    preferences: {
      found: preferences.fileCount > 0,
      file_count: preferences.fileCount,
      active_account_hash_present: hashes.length > 0,
      candidate_count: preferences.candidateUserIds.length,
    },
    keychain: {
      user_id_present: stored !== null,
      matches_active_account:
        stored !== null && hashes.length > 0 ? hashes.includes(accountHash(stored)) : null,
    },
    database: {
      file_found: fileCount > 0,
      file_count: fileCount,
      sqlcipher_available: available,
      opens,
    },
    ready: opens,
  };
}
