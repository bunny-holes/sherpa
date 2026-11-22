/**
 * The person's time as the model reads it with each of their messages (ADR-0012 "지시문"): the
 * instructions stay the same every turn, so the date goes with the message instead, and the
 * tools that take a time and a time zone get them from here.
 */

/** The time zone of the Mac the core runs on, as an IANA name. */
export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * The line the core puts before the person's text: the time to the second with its UTC offset,
 * the day of the week, and the time zone. `2026-11-22T21:56:31+09:00 (Sunday), time zone:
 * Asia/Seoul`, in brackets.
 */
export function timeNote(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      weekday: "long",
      timeZoneName: "longOffset",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  ) as Record<Intl.DateTimeFormatPartTypes, string>;
  // "GMT+09:00"; the zero offset reads "GMT" in the specification and "GMT+00:00" in Bun 1.4.5.
  const offset = parts.timeZoneName.slice(3) || "+00:00";
  const time = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
  return `[Current time: ${time} (${parts.weekday}), time zone: ${timeZone}]`;
}
