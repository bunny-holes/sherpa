import { codes, invalidRequest, SherpaError } from "../cli/errors.ts";
import { utf8 } from "../cli/stdin.ts";
import { log } from "../log.ts";
import { accountStatus, openAccountDatabase, setupAccount } from "./account.ts";
import { CheckpointStore, type CheckpointCandidate } from "./checkpoint-store.ts";
import type { KakaoMessage, MessageSource } from "./database.ts";
import { errorType } from "./device.ts";
import { useSQLCipher } from "./sqlcipher.ts";

/**
 * `sherpa kakaotalk …`: local, read-only access to the KakaoTalk Mac database.
 * Envelopes keep the keys and semantics of the 0.7 Swift adapter
 * (`KakaoTalkLocalSearchAdapter`). Native identifiers never appear in output.
 */

export interface KakaoTalkDependencies {
  openSource(): Promise<MessageSource>;
  openCheckpointStore(): CheckpointStore;
  now(): Date;
}

const systemDependencies: KakaoTalkDependencies = {
  openSource: () => openAccountDatabase(),
  openCheckpointStore: () => {
    useSQLCipher();
    return CheckpointStore.openDefault();
  },
  now: () => new Date(),
};

const historyWindowMs = 7 * 24 * 60 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;
const supportedTypes = new Set(["text", "photo", "video", "voice"]);
const coverage = (limitReached: boolean) => ({
  completeness: "partial",
  reason: "local_database_may_be_incomplete",
  limit_reached: limitReached,
});

interface ResultRow {
  reference: string;
  timestamp: string;
  chat?: string;
  sender?: string;
  text: string;
  message_type: string;
  is_from_me: boolean;
}

export function kakaoTalkCommands(dependencies: KakaoTalkDependencies) {
  async function withSource<T>(read: (source: MessageSource) => T): Promise<T> {
    const source = await dependencies.openSource();
    try {
      return read(source);
    } finally {
      source.close();
    }
  }

  async function search(query: Uint8Array, limit: number): Promise<string> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalidRequest();
    const normalized = boundedName(query);
    return logged("search", `limit=${limit}`, async () => {
      const nativeRows = await withSource((source) => {
        const rows = source.search(normalized, limit);
        return { rows, chatNames: rows.length > 0 ? chatNames(source) : new Map<bigint, string>() };
      });
      if (nativeRows.rows.length > limit) throw new SherpaError(codes.failed);
      const seen = new Set<string>();
      const results: ResultRow[] = [];
      let omitted = 0;
      for (const row of nativeRows.rows) {
        const timestamp = boundedRequired(row.timestamp, 128);
        if (timestamp === null || parseISO8601(timestamp) === null)
          throw new SherpaError(codes.failed);
        if (!supportedTypes.has(row.type)) {
          omitted++;
          continue;
        }
        const text = boundedRequired(row.text, 256 * 1024);
        if (text === null) throw new SherpaError(codes.failed);
        const key = `${row.chatId}:${row.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(
          resultRow(
            `KLS${pad(results.length + 1, 3)}`,
            row,
            timestamp,
            text,
            nativeRows.chatNames.get(row.chatId),
          ),
        );
      }
      const output = encode({
        schema: "sherpa.kakaotalk-local-search.v1",
        source: "mac_local_synchronized_database",
        coverage: coverage(nativeRows.rows.length >= limit),
        returned_count: results.length,
        omitted_unsupported_count: omitted,
        limit,
        results,
      });
      return {
        output: bounded(output, 4 * 1024 * 1024),
        fields: `returned_count=${results.length}`,
      };
    });
  }

  async function history(chatName: Uint8Array, limit: number): Promise<string> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw invalidRequest();
    const normalized = boundedName(chatName);
    const now = dependencies.now();
    return logged("history", `limit=${limit} window_days=7`, async () => {
      const windowStart = new Date(now.getTime() - historyWindowMs);
      const read = await withSource((source) => {
        const matches = source
          .chats(1000)
          .filter((chat) => boundedOptional(chat.displayName)?.normalize("NFC") === normalized);
        if (matches.length !== 1) throw new SherpaError(codes.failed);
        const selected = matches[0]!;
        const rows = source.messages({
          chatId: selected.id,
          sinceSeconds: Math.ceil(windowStart.getTime() / 1000),
          limit,
        });
        return { selected, rows };
      });
      if (read.rows.length > limit) throw new SherpaError(codes.failed);
      const seen = new Set<string>();
      const results: ResultRow[] = [];
      let omitted = 0;
      for (const row of read.rows) {
        const timestamp = boundedRequired(row.timestamp, 128);
        const date = timestamp === null ? null : parseISO8601(timestamp);
        if (
          row.chatId !== read.selected.id ||
          timestamp === null ||
          date === null ||
          date < windowStart.getTime()
        ) {
          throw new SherpaError(codes.failed);
        }
        if (!supportedTypes.has(row.type)) {
          omitted++;
          continue;
        }
        const text = boundedRequired(row.text, 256 * 1024);
        if (text === null) throw new SherpaError(codes.failed);
        const key = `${row.chatId}:${row.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(resultRow("", row, timestamp, text, read.selected.displayName));
      }
      const sorted = numbered(results, "KLH", 3);
      const output = encode({
        schema: "sherpa.kakaotalk-local-history.v1",
        source: "mac_local_synchronized_database",
        baseline: {
          kind: "checkpoint_missing_local_seven_day_window",
          checkpoint_available: false,
          earlier_history_read: false,
          window_start: windowStart.toISOString(),
          window_end: now.toISOString(),
        },
        coverage: coverage(read.rows.length >= limit),
        returned_count: sorted.length,
        omitted_unsupported_count: omitted,
        limit,
        results: sorted,
      });
      return {
        output: bounded(output, 8 * 1024 * 1024),
        fields: `returned_count=${sorted.length}`,
      };
    });
  }

  async function archive(options: {
    since: string;
    timeZone: string;
    limit: number;
  }): Promise<string> {
    const { since, timeZone, limit } = options;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50_000 || !validTimeZone(timeZone))
      throw invalidRequest();
    const store = dependencies.openCheckpointStore();
    try {
      const now = dependencies.now();
      let windowStart: number;
      let rangeKind: string;
      let checkpointAvailable: boolean;
      if (since === "checkpoint") {
        const current = store.current();
        const highWater = current ? parseISO8601(current.high_water) : null;
        if (highWater === null) throw invalidRequest();
        windowStart = highWater - dayMs;
        rangeKind = "local_checkpoint_with_overlap";
        checkpointAvailable = true;
      } else {
        const explicit = localDateStart(since, timeZone);
        if (explicit === null) throw invalidRequest();
        windowStart = explicit;
        rangeKind = "explicit_local_date_range";
        checkpointAvailable = false;
      }
      if (windowStart > now.getTime()) throw invalidRequest();
      const elapsedDays = Math.ceil((now.getTime() - windowStart) / dayMs) + 1;
      if (elapsedDays < 1 || elapsedDays > 3650) throw invalidRequest();

      return await logged("archive", `limit=${limit} window_days=${elapsedDays}`, async () => {
        const read = await withSource((source) => ({
          rows: source.messages({
            sinceSeconds: Math.trunc((now.getTime() - elapsedDays * dayMs) / 1000),
            limit,
          }),
          chatNames: chatNames(source),
        }));
        if (read.rows.length > limit) throw new SherpaError(codes.failed);
        const seen = new Set<string>();
        const chats = new Set<bigint>();
        const results: ResultRow[] = [];
        let omitted = 0;
        for (const row of read.rows) {
          const timestamp = boundedRequired(row.timestamp, 128);
          const date = timestamp === null ? null : parseISO8601(timestamp);
          if (timestamp === null || date === null) throw new SherpaError(codes.failed);
          if (date < windowStart || date > now.getTime()) continue;
          if (!supportedTypes.has(row.type)) {
            omitted++;
            continue;
          }
          const text = boundedRequired(row.text, 256 * 1024);
          if (text === null) throw new SherpaError(codes.failed);
          const key = `${row.chatId}:${row.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          chats.add(row.chatId);
          results.push(resultRow("", row, timestamp, text, read.chatNames.get(row.chatId)));
        }
        const sorted = numbered(results, "KLA", 5);
        const limitReached = read.rows.length >= limit;
        const checkpoint: CheckpointCandidate | undefined = limitReached
          ? undefined
          : store.stage(now);
        const output = encode({
          schema: "sherpa.kakaotalk-local-archive.v1",
          source: "mac_local_synchronized_database",
          range: {
            kind: rangeKind,
            checkpoint_available: checkpointAvailable,
            earlier_history_read: false,
            requested_start: since,
            window_start: new Date(windowStart).toISOString(),
            window_end: now.toISOString(),
            time_zone: timeZone,
          },
          coverage: coverage(limitReached),
          returned_count: sorted.length,
          returned_chat_count: chats.size,
          omitted_unsupported_count: omitted,
          limit,
          checkpoint,
          results: sorted,
        });
        return {
          output: bounded(output, 64 * 1024 * 1024),
          fields: `returned_count=${sorted.length} chat_count=${chats.size}`,
        };
      });
    } finally {
      store.close();
    }
  }

  async function commitCheckpoint(token: Uint8Array): Promise<string> {
    if (token.byteLength > 256) throw invalidRequest();
    const normalized = trimmed(utf8(token));
    if (
      !normalized.startsWith("KLCP") ||
      Buffer.byteLength(normalized) > 128 ||
      normalized.includes("\0") ||
      hasNewline(normalized)
    ) {
      throw invalidRequest();
    }
    return logged("checkpoint", "source=local_database", async () => {
      const store = dependencies.openCheckpointStore();
      try {
        return { output: encode(store.commit(normalized)), fields: "state=committed" };
      } finally {
        store.close();
      }
    });
  }

  return { search, history, archive, commitCheckpoint };
}

const commands = kakaoTalkCommands(systemDependencies);

export const search = commands.search;
export const history = commands.history;
export const archive = commands.archive;
export const commitCheckpoint = commands.commitCheckpoint;

export async function setup(userIdInput: Uint8Array | null): Promise<string> {
  return logged("setup", `input=${userIdInput !== null}`, async () => {
    const envelope = await setupAccount(userIdInput);
    return { output: encode(envelope), fields: `source=${envelope.source}` };
  });
}

export async function status(): Promise<string> {
  return logged("status", "source=local_files", async () => {
    const envelope = await accountStatus();
    return { output: encode(envelope), fields: `ready=${envelope.ready}` };
  });
}

/** Logs start, success and failure; translates unexpected failures to `failed`. */
async function logged(
  action: string,
  fields: string,
  run: () => Promise<{ output: string; fields: string }>,
): Promise<string> {
  log.info(`[adapter:kakaotalk:${action}-start] ${fields}`);
  try {
    const result = await run();
    log.info(`[adapter:kakaotalk:${action}-success] ${result.fields}`);
    return result.output;
  } catch (error) {
    log.error(`[adapter:kakaotalk:${action}-failure] error=${errorType(error)}`);
    if (error instanceof SherpaError) throw error;
    throw new SherpaError(codes.failed);
  }
}

function chatNames(source: MessageSource): Map<bigint, string> {
  const names = new Map<bigint, string>();
  for (const chat of source.chats(1000)) {
    const name = boundedOptional(chat.displayName);
    if (name !== null && !names.has(chat.id)) names.set(chat.id, name);
  }
  return names;
}

function resultRow(
  reference: string,
  row: KakaoMessage,
  timestamp: string,
  text: string,
  chat: string | undefined,
): ResultRow {
  return {
    reference,
    timestamp,
    ...(chat === undefined ? {} : { chat }),
    ...(boundedOptional(row.sender) === null ? {} : { sender: row.sender! }),
    text,
    message_type: row.type,
    is_from_me: row.isFromMe,
  };
}

function numbered(rows: ResultRow[], prefix: string, width: number): ResultRow[] {
  return [...rows]
    .sort((left, right) =>
      left.timestamp < right.timestamp ? -1 : left.timestamp > right.timestamp ? 1 : 0,
    )
    .map((row, index) => ({ ...row, reference: `${prefix}${pad(index + 1, width)}` }));
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** A chat name or query: trimmed, 1–256 characters, one line, NFC. */
function boundedName(input: Uint8Array): string {
  if (input.byteLength > 4096) throw invalidRequest();
  const value = trimmed(utf8(input));
  if (
    value.length === 0 ||
    graphemeCount(value) > 256 ||
    value.includes("\0") ||
    hasNewline(value)
  ) {
    throw invalidRequest();
  }
  return value.normalize("NFC");
}

/** Foundation `trimmingCharacters(in: .whitespacesAndNewlines)`. */
function trimmed(value: string): string {
  return value.replace(/^[\p{Z}\t\n\v\f\r\u0085]+|[\p{Z}\t\n\v\f\r\u0085]+$/gu, "");
}

/** Swift `Character.isNewline`. */
function hasNewline(value: string): boolean {
  return /[\n\v\f\r\u0085\u2028\u2029]/u.test(value);
}

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
function graphemeCount(value: string): number {
  let count = 0;
  for (const _ of graphemes.segment(value)) count++;
  return count;
}

function boundedRequired(value: string | null, maximumBytes: number): string | null {
  if (
    value === null ||
    value.length === 0 ||
    Buffer.byteLength(value) > maximumBytes ||
    value.includes("\0")
  ) {
    return null;
  }
  return value;
}

function boundedOptional(value: string | null): string | null {
  return boundedRequired(value, 4096);
}

/** Foundation ISO8601DateFormatter with or without fractional seconds; milliseconds since the epoch. */
export function parseISO8601(value: string): number | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number) as number[];
  const date = new Date(0);
  date.setUTCFullYear(year!, month! - 1, day!);
  date.setUTCHours(hour!, minute!, second!, 0);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month! - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null;
  }
  const fraction = match[7] ? Math.round(Number(`0${match[7]}`) * 1000) : 0;
  const zone = match[8]!;
  let offsetMinutes = 0;
  if (zone !== "Z") {
    const digits = zone.replace(":", "");
    offsetMinutes =
      (zone.startsWith("-") ? -1 : 1) *
      (Number(digits.slice(1, 3)) * 60 + Number(digits.slice(3, 5)));
  }
  return date.getTime() + fraction - offsetMinutes * 60_000;
}

function validTimeZone(identifier: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(identifier)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: identifier });
    return true;
  } catch {
    return false;
  }
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
function zoneOffset(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    era: "short",
  }).formatToParts(new Date(instant));
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  const era = parts.find((entry) => entry.type === "era")?.value;
  const local = new Date(0);
  local.setUTCFullYear(
    era === "BC" ? 1 - part("year") : part("year"),
    part("month") - 1,
    part("day"),
  );
  local.setUTCHours(part("hour"), part("minute"), part("second"), 0);
  return local.getTime() - (instant - (((instant % 1000) + 1000) % 1000));
}

/** Start of the strict `yyyy-MM-dd` local date in `timeZone`, or null when it is not a real date. */
export function localDateStart(value: string, timeZone: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utcMidnight = new Date(0);
  utcMidnight.setUTCFullYear(year, month - 1, day);
  if (
    utcMidnight.getUTCFullYear() !== year ||
    utcMidnight.getUTCMonth() !== month - 1 ||
    utcMidnight.getUTCDate() !== day
  ) {
    return null;
  }
  let instant = utcMidnight.getTime();
  for (let iteration = 0; iteration < 3; iteration++) {
    instant = utcMidnight.getTime() - zoneOffset(instant, timeZone);
  }
  // A midnight skipped by a daylight-saving jump resolves to the first instant of that date.
  while (localDate(instant - 60 * 60 * 1000, timeZone) === value) instant -= 60 * 60 * 1000;
  return localDate(instant, timeZone) === value ? instant : null;
}

function localDate(instant: number, timeZone: string): string {
  const shifted = new Date(instant + zoneOffset(instant, timeZone));
  return shifted.toISOString().slice(0, 10);
}

function bounded(output: string, maximumBytes: number): string {
  if (Buffer.byteLength(output) > maximumBytes) throw new SherpaError(codes.outputTooLarge);
  return output;
}

/** Pretty-printed JSON with keys sorted at every level, like `JSONEncoder` `[.prettyPrinted, .sortedKeys]`. */
export function encode(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) sorted[key] = sortKeys(entry);
    }
    return sorted;
  }
  return value;
}
