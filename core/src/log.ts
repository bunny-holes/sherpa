/**
 * Diagnostic log on stderr. Lines carry `[layer:module:action]` and safe fields only:
 * never message bodies, identifiers of people, keys or paths that embed them.
 * `LOG_LEVEL` selects verbosity; the default is `warn`.
 */
const levels = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof levels;

function configuredLevel(): number {
  const value = process.env.LOG_LEVEL?.toLowerCase();
  return value && value in levels ? levels[value as Level] : levels.warn;
}

function write(level: Level, line: string): void {
  if (levels[level] < configuredLevel()) return;
  process.stderr.write(`${level} ${line}\n`);
}

export const log = {
  debug: (line: string) => write("debug", line),
  info: (line: string) => write("info", line),
  warn: (line: string) => write("warn", line),
  error: (line: string) => write("error", line),
};
