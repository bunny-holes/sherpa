import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { SherpaError } from "../src/cli/errors.ts";
import { runCommand } from "../src/process/runner.ts";

let dir: string;
function script(body: string): string {
  const path = join(dir, "fixture");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o700);
  return path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sherpa-runner-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("passes stdin and returns stdout", async () => {
  const out = await runCommand(script("cat"), [], { stdin: new TextEncoder().encode("hi") });
  expect(new TextDecoder().decode(out.stdout)).toBe("hi");
});

test("bounds output", async () => {
  await expect(runCommand(script("yes | head -c 5000"), [], { outputLimit: 100 })).rejects.toThrow(
    "outputTooLarge",
  );
});

test("a mutation whose output overflows is uncertain", async () => {
  const error = (await runCommand(script("yes | head -c 5000"), [], {
    outputLimit: 100,
    effect: "mutation",
  }).catch((e: unknown) => e)) as SherpaError;
  expect(error.code).toBe("uncertain");
  expect(error.mayHaveApplied).toBe(true);
});

test("times out", async () => {
  await expect(runCommand(script("sleep 5"), [], { timeoutMs: 100 })).rejects.toThrow("timedOut");
});

test("a non-zero exit fails", async () => {
  await expect(runCommand(script("exit 3"), [])).rejects.toThrow("failed");
});

test("a missing executable is unavailable", async () => {
  await expect(runCommand(join(dir, "missing"), [])).rejects.toThrow("executableUnavailable");
});
