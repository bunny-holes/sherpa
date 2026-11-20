import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { SherpaError } from "../cli/errors.ts";
import { log } from "../log.ts";

const REINSTALL = "brew reinstall xiyo/tap/sherpa";

/**
 * Where the installed helper lives, relative to `bin/sherpa`. It is an app bundle
 * signed with Developer ID: macOS keys privacy grants for a bundle to its bundle
 * identifier and signing team, so Calendar and Reminders access survives a
 * Homebrew upgrade even though every version installs under a new Cellar path.
 * A bare executable is keyed to its path instead and asks again after each upgrade.
 */
export const HELPER_IN_BUNDLE = "../libexec/SherpaHelper.app/Contents/MacOS/sherpa-apple";

/**
 * Locates the Swift Apple helper. It owns what needs Apple frameworks and an
 * Info.plist: EventKit Calendar/Reminders, private ReminderKit and the Mail shim.
 * Order: `SHERPA_APPLE_BIN`, the installed bundle next to this executable, then a
 * sibling file for development builds.
 */
export function resolveAppleHelper(
  execPath: string = process.execPath,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.SHERPA_APPLE_BIN;
  if (configured) {
    if (!existsSync(configured)) {
      throw new SherpaError("executableUnavailable", {
        remedy: "SHERPA_APPLE_BIN does not name an executable sherpa-apple helper",
      });
    }
    return configured;
  }
  const self = realpathSync(execPath);
  for (const candidate of [
    join(dirname(self), HELPER_IN_BUNDLE),
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
