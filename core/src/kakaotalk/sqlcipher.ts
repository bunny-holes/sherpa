import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { SherpaError } from "../cli/errors.ts";
import { log } from "../log.ts";

/** Homebrew's SQLCipher build; KakaoTalk's database is a SQLCipher database. */
export const sqlcipherLibrary = "/opt/homebrew/opt/sqlcipher/lib/libsqlcipher.dylib";

let selected = false;

export function sqlcipherAvailable(): boolean {
  return existsSync(sqlcipherLibrary);
}

/**
 * Makes `bun:sqlite` use SQLCipher for this whole process. It must run before
 * any `Database` is constructed, so every kakaotalk command calls it first,
 * including before it opens the plain checkpoint store.
 */
export function useSQLCipher(): void {
  if (selected) return;
  if (!sqlcipherAvailable()) {
    throw new SherpaError("kakaotalk.sqlcipher_missing", { remedy: "brew install sqlcipher" });
  }
  try {
    Database.setCustomSQLite(sqlcipherLibrary);
  } catch (error) {
    log.error(
      `[adapter:kakaotalk:sqlcipher] selected=false error_type=${error instanceof Error ? error.name : typeof error}`,
    );
    throw new SherpaError("kakaotalk.sqlcipher_missing", { remedy: "brew install sqlcipher" });
  }
  selected = true;
}

/**
 * Opens a SQLCipher database read-only with a passphrase, as kakaocli does: try
 * cipher compatibility 3, then 4, and accept the first that can read the schema.
 * Returns null when no mode opens it (wrong key or not a SQLCipher database).
 */
export function openEncryptedDatabase(path: string, passphrase: string): Database | null {
  if (!/^[0-9a-f]+$/.test(passphrase)) throw new SherpaError("kakaotalk.database_open_failed");
  for (const compatibility of [3, 4]) {
    let database: Database | null = null;
    try {
      database = new Database(path, { readonly: true, safeIntegers: true });
      database.run(`PRAGMA cipher_default_compatibility = ${compatibility}`);
      database.run(`PRAGMA key='${passphrase}'`);
      database.query("SELECT count(*) FROM sqlite_master").get();
      return database;
    } catch (error) {
      database?.close();
      log.debug(
        `[adapter:kakaotalk:database-open] compatibility=${compatibility} opened=false error_type=${error instanceof Error ? error.name : typeof error}`,
      );
    }
  }
  return null;
}
