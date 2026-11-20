import { invalidRequest } from "../cli/errors.ts";

/**
 * chat.db stores instants as nanoseconds since 2001-01-01T00:00:00Z. imsg
 * converts them to a Foundation `Date` (a double of seconds since 2001) and
 * formats with millisecond precision; the arithmetic below follows the same
 * double operations so the printed millisecond matches.
 */
export const APPLE_EPOCH_OFFSET = 978_307_200;

/** Seconds since 2001 as Foundation holds them; a NULL column is the epoch itself. */
export function appleSeconds(nanoseconds: bigint | null): number {
  if (nanoseconds === null) return 0;
  const since1970 = Number(nanoseconds) / 1_000_000_000 + APPLE_EPOCH_OFFSET;
  return since1970 - APPLE_EPOCH_OFFSET;
}

/** `2026-11-20T01:02:03.456Z`, rounded to the nearest millisecond like Foundation. */
export function formatAppleSeconds(referenceSeconds: number): string {
  const milliseconds = Math.round((referenceSeconds + APPLE_EPOCH_OFFSET) * 1000);
  return new Date(milliseconds).toISOString();
}

const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * Parses an RFC 3339 instant with or without fractional seconds into seconds
 * since 2001, keeping millisecond precision as Foundation's ISO 8601 parser does.
 */
export function parseInstant(value: string): number {
  const match = RFC3339.exec(value);
  if (!match) throw invalidRequest();
  const [, year, month, day, hour, minute, second, fraction, zone, sign, zoneHour, zoneMinute] =
    match;
  const fields = [Number(month), Number(day), Number(hour), Number(minute), Number(second)];
  const daysInMonth = new Date(Date.UTC(Number(year), fields[0]!, 0)).getUTCDate();
  if (
    fields[0]! < 1 ||
    fields[0]! > 12 ||
    fields[1]! < 1 ||
    fields[1]! > daysInMonth ||
    fields[2]! > 23 ||
    fields[3]! > 59 ||
    fields[4]! > 59
  ) {
    throw invalidRequest();
  }
  let offsetMinutes = 0;
  if (zone !== "Z") {
    if (Number(zoneHour) > 23 || Number(zoneMinute) > 59) throw invalidRequest();
    offsetMinutes = (Number(zoneHour) * 60 + Number(zoneMinute)) * (sign === "-" ? -1 : 1);
  }
  const utc = new Date(0);
  utc.setUTCFullYear(Number(year), fields[0]! - 1, fields[1]!);
  utc.setUTCHours(fields[2]!, fields[3]!, fields[4]!, 0);
  const millis = fraction ? Number(fraction.slice(1, 4).padEnd(3, "0")) : 0;
  const unixMilliseconds = utc.getTime() + millis - offsetMinutes * 60_000;
  return unixMilliseconds / 1000 - APPLE_EPOCH_OFFSET;
}

/** The nanosecond bound imsg binds for a filter instant (truncated toward zero). */
export function appleNanoseconds(referenceSeconds: number): number | bigint {
  const since1970 = referenceSeconds + APPLE_EPOCH_OFFSET;
  const nanoseconds = Math.trunc((since1970 - APPLE_EPOCH_OFFSET) * 1_000_000_000);
  return Number.isSafeInteger(nanoseconds) ? nanoseconds : BigInt(nanoseconds);
}
