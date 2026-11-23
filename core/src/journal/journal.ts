import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { codes, SherpaError } from "../cli/errors.ts";
import { log } from "../log.ts";

/** Journal states of one external mutation. `started` is the only non-terminal state. */
export type MutationStatus = "started" | "completed" | "failed" | "partial" | "uncertain";

export interface MutationRecord {
  operation_id: string;
  capability: string;
  status: MutationStatus;
  stable_error_code: string | null;
  created_at: number;
}

/** The `limit` of `recent`: 1–1000. Callers check it before opening, which creates the journal. */
export function checkRecentLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new SherpaError(codes.invalidRequest);
  }
}

/**
 * The SQLite journal shared with the Swift Apple helper, which journals planner
 * mutations in the same table. Schema and file are unchanged from 0.7.
 */
export class MutationJournal {
  private readonly db: Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path, { create: true, strict: true });
    this.db.run("PRAGMA journal_mode=WAL");
    this.db.run("PRAGMA synchronous=NORMAL");
    this.db.run(`CREATE TABLE IF NOT EXISTS native_mutations (
      operation_id TEXT PRIMARY KEY,
      capability TEXT NOT NULL,
      status TEXT NOT NULL,
      stable_error_code TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT`);
    chmodSync(path, 0o600);
  }

  static defaultPath(): string {
    return join(homedir(), "Library/Application Support/Sherpa/native.sqlite3");
  }

  static openDefault(): MutationJournal {
    return new MutationJournal(MutationJournal.defaultPath());
  }

  /** A recovery lookup does not create the journal or write to it. A missing row is unknown. */
  static readStatuses(
    this: void,
    operationIDs: readonly string[],
    path = MutationJournal.defaultPath(),
  ): ReadonlyMap<string, MutationStatus> {
    const statuses = new Map<string, MutationStatus>();
    if (operationIDs.length === 0 || !existsSync(path)) return statuses;
    const db = new Database(path, { readonly: true, strict: true });
    try {
      const query = db.query<{ status: MutationStatus }, [string]>(
        "SELECT status FROM native_mutations WHERE operation_id=?",
      );
      for (const id of new Set(operationIDs)) {
        const row = query.get(id);
        if (row) statuses.set(id, row.status);
      }
      return statuses;
    } finally {
      db.close();
    }
  }

  start(capability: string, operationID = `op-${crypto.randomUUID()}`): string {
    if (!operationID || operationID.length > 128 || capability.length > 128) {
      throw new SherpaError(codes.invalidRequest);
    }
    const now = Math.floor(Date.now() / 1000);
    this.db
      .query(
        "INSERT INTO native_mutations(operation_id, capability, status, created_at, updated_at) VALUES(?, ?, 'started', ?, ?)",
      )
      .run(operationID, capability, now, now);
    return operationID;
  }

  finish(
    operationID: string,
    status: Exclude<MutationStatus, "started">,
    code: string | null,
  ): void {
    const now = Math.floor(Date.now() / 1000);
    const result = this.db
      .query(
        "UPDATE native_mutations SET status=?, stable_error_code=?, updated_at=? WHERE operation_id=? AND status='started'",
      )
      .run(status, code, now, operationID);
    if (result.changes !== 1) throw new SherpaError(codes.failed);
  }

  recent(limit: number): MutationRecord[] {
    checkRecentLimit(limit);
    return this.db
      .query<MutationRecord, [number]>(
        "SELECT operation_id, capability, status, stable_error_code, created_at FROM native_mutations ORDER BY created_at DESC, operation_id DESC LIMIT ?",
      )
      .all(limit);
  }

  close(): void {
    this.db.close();
  }
}

export type JournalFailure = "journal.start_failed" | "journal.finish_failed";

/** The attempt did not return: `failed` when it never started, `uncertain` when it may have applied. */
export class JournaledMutationError extends Error {
  constructor(
    readonly operationID: string | null,
    readonly status: "failed" | "uncertain",
    readonly stableCode: string,
    readonly journalFailure: JournalFailure | null,
  ) {
    super(stableCode);
    this.name = "JournaledMutationError";
  }
}

export interface JournaledResult<T> {
  operationID: string;
  output: T;
  journalFailure: JournalFailure | null;
}

/**
 * Journals one external mutation: start, attempt, one terminal status. The
 * status comes from the attempt alone; a journal write that fails never changes
 * it and leaves the row `started`.
 */
export async function journaled<T>(
  journal: MutationJournal,
  capability: string,
  attempt: () => Promise<T>,
  /** An id the caller already showed (the MCP confirmation); a fresh one otherwise. */
  requestedOperationID?: string,
): Promise<JournaledResult<T>> {
  log.info(`[cli:sherpa:mutation-start] capability=${capability}`);
  let operationID: string;
  try {
    operationID = journal.start(capability, requestedOperationID);
  } catch {
    throw new JournaledMutationError(
      null,
      "failed",
      "journal.start_failed",
      "journal.start_failed",
    );
  }
  let output: T;
  try {
    output = await attempt();
  } catch (error) {
    const mayHaveApplied = error instanceof SherpaError && error.mayHaveApplied;
    const status = mayHaveApplied ? "uncertain" : "failed";
    const code = error instanceof SherpaError ? error.code : codes.failed;
    throw new JournaledMutationError(
      operationID,
      status,
      code,
      finish(journal, operationID, status, code),
    );
  }
  const journalFailure = finish(journal, operationID, "completed", null);
  const fields = `capability=${capability} operation_id=${operationID} status=completed`;
  if (journalFailure) log.error(`[cli:sherpa:journal-failure] ${fields} code=${journalFailure}`);
  else log.info(`[cli:sherpa:mutation-finish] ${fields}`);
  return { operationID, output, journalFailure };
}

function finish(
  journal: MutationJournal,
  operationID: string,
  status: Exclude<MutationStatus, "started">,
  code: string | null,
): JournalFailure | null {
  try {
    journal.finish(operationID, status, code);
    return null;
  } catch {
    return "journal.finish_failed";
  }
}
