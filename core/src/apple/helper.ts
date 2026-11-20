import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { SherpaError } from "../cli/errors.ts";
import { log } from "../log.ts";

const REINSTALL = "brew reinstall xiyo/tap/sherpa";

/**
 * Locates the Swift Apple helper. It owns what needs Apple frameworks and an
 * embedded Info.plist: EventKit Calendar/Reminders, private ReminderKit and the
 * Mail shim. Order: `SHERPA_APPLE_BIN`, the installed `libexec/` next to this
 * executable, then a sibling file for development builds.
 */
export function resolveAppleHelper(): string {
  const configured = process.env.SHERPA_APPLE_BIN;
  if (configured) {
    if (!existsSync(configured)) {
      throw new SherpaError("executableUnavailable", {
        remedy: "SHERPA_APPLE_BIN does not name an executable sherpa-apple helper",
      });
    }
    return configured;
  }
  const self = realpathSync(process.execPath);
  for (const candidate of [
    join(dirname(self), "../libexec/sherpa-apple"),
    join(dirname(self), "sherpa-apple"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new SherpaError("executableUnavailable", {
    remedy: `the sherpa-apple helper is missing from this installation; run: ${REINSTALL}`,
  });
}

/**
 * Hands one Worker Protocol V2 request to the helper. Standard input, output and
 * the exit status pass through unchanged: the helper validates, journals planner
 * mutations and writes the response itself.
 */
export async function proxyAppleRequest(args: readonly string[]): Promise<number> {
  const helper = resolveAppleHelper();
  log.info(`[cli:apple-helper:start] command=${args.join(".")}`);
  const child = Bun.spawn([helper, ...args], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });
  const exitCode = await child.exited;
  if (exitCode === 0) log.info(`[cli:apple-helper:success] command=${args.join(".")}`);
  else log.warn(`[cli:apple-helper:failure] command=${args.join(".")} exit=${exitCode}`);
  return exitCode;
}
