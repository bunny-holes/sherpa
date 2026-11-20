import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { codes, SherpaError } from "../cli/errors.ts";

export interface CheckpointCandidate {
  schema: "sherpa.kakaotalk-local-checkpoint.v1";
  state: "pending" | "committed";
  token?: string;
  high_water: string;
}

/**
 * The local archive checkpoint, in the same file, tables and token format as the
 * Swift `KakaoTalkLocalCheckpointStore`, so checkpoints written by 0.7 keep working.
 */
export class CheckpointStore {
  private readonly db: Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path, { create: true, readwrite: true });
    this.db.run("PRAGMA journal_mode=WAL");
    this.db.run("PRAGMA synchronous=NORMAL");
    this.db.run(`CREATE TABLE IF NOT EXISTS kakaotalk_local_checkpoint (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          high_water TEXT NOT NULL,
          committed_at INTEGER NOT NULL
        ) STRICT`);
    this.db.run(`CREATE TABLE IF NOT EXISTS kakaotalk_local_checkpoint_pending (
          token TEXT PRIMARY KEY,
          high_water TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('pending', 'committed')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        ) STRICT`);
    chmodSync(path, 0o600);
  }

  static defaultPath(): string {
    return join(homedir(), "Library/Application Support/Sherpa/context.sqlite3");
  }

  static openDefault(): CheckpointStore {
    return new CheckpointStore(CheckpointStore.defaultPath());
  }

  stage(highWater: Date): CheckpointCandidate {
    const token = `KLCP${crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
    const highWaterText = highWater.toISOString();
    const now = Math.floor(Date.now() / 1000);
    this.db
      .query(
        "INSERT INTO kakaotalk_local_checkpoint_pending(token, high_water, state, created_at, updated_at) VALUES(?, ?, 'pending', ?, ?)",
      )
      .run(token, highWaterText, now, now);
    return {
      schema: "sherpa.kakaotalk-local-checkpoint.v1",
      state: "pending",
      token,
      high_water: highWaterText,
    };
  }

  commit(token: string): CheckpointCandidate {
    if (!token.startsWith("KLCP") || Buffer.byteLength(token) > 128)
      throw new SherpaError(codes.invalidRequest);
    const now = Math.floor(Date.now() / 1000);
    const transaction = this.db.transaction(() => {
      const pending = this.db
        .query<{ high_water: string }, [string]>(
          "SELECT high_water FROM kakaotalk_local_checkpoint_pending WHERE token=? AND state='pending'",
        )
        .get(token);
      if (!pending) throw new SherpaError(codes.failed);
      this.db
        .query(
          `INSERT INTO kakaotalk_local_checkpoint(singleton, high_water, committed_at)
           VALUES(1, ?, ?)
           ON CONFLICT(singleton) DO UPDATE SET
             high_water = CASE WHEN excluded.high_water > high_water THEN excluded.high_water ELSE high_water END,
             committed_at = excluded.committed_at`,
        )
        .run(pending.high_water, now);
      const updated = this.db
        .query(
          "UPDATE kakaotalk_local_checkpoint_pending SET state='committed', updated_at=? WHERE token=? AND state='pending'",
        )
        .run(now, token);
      if (updated.changes !== 1) throw new SherpaError(codes.failed);
      return pending.high_water;
    });
    const highWater = transaction.immediate();
    return {
      schema: "sherpa.kakaotalk-local-checkpoint.v1",
      state: "committed",
      high_water: highWater,
    };
  }

  current(): CheckpointCandidate | null {
    const row = this.db
      .query<{ high_water: string }, []>(
        "SELECT high_water FROM kakaotalk_local_checkpoint WHERE singleton=1",
      )
      .get();
    if (!row) return null;
    if (typeof row.high_water !== "string") throw new SherpaError(codes.failed);
    return {
      schema: "sherpa.kakaotalk-local-checkpoint.v1",
      state: "committed",
      high_water: row.high_water,
    };
  }

  close(): void {
    this.db.close();
  }
}
