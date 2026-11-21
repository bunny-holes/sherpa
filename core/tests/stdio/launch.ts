import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeApp } from "./fake-app.ts";

/** The binary the gate builds (`bun run build`); this layer drives it through its pipes. */
export const BINARY = join(import.meta.dirname, "../../dist/sherpa");

const homes: string[] = [];

/** Starts `sherpa app serve` with a scratch HOME so no journal or store of this Mac is touched. */
export function launch(env: Record<string, string> = {}): FakeApp {
  if (!existsSync(BINARY)) throw new Error("core/dist/sherpa is missing: run bun run build first");
  const home = mkdtempSync(join(tmpdir(), "sherpa-stdio-"));
  homes.push(home);
  return FakeApp.launch(BINARY, { HOME: home, LOG_LEVEL: "info", ...env });
}

export function cleanHomes(): void {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
}
