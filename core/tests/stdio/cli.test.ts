import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { BINARY, cleanHomes, scratchHome } from "./launch.ts";

// The built CLI checks every argument before it opens a store (owner review of #44):
// a scratch HOME has no Mail store and no journal, so only a valid request reaches them.
afterEach(() => cleanHomes());

function run(home: string, args: string[]) {
  const child = Bun.spawnSync([BINARY, ...args], {
    env: { HOME: home, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LOG_LEVEL: "error" },
    stdin: "ignore",
  });
  return {
    code: child.exitCode,
    output: JSON.parse(child.stdout.toString()) as { status: string; error: string | null },
  };
}

const range = ["--from", "2026-11-01T00:00:00Z", "--to", "2026-11-02T00:00:00Z"];

test.each([
  ["mail list without --limit", ["mail", "list", ...range, "--max-body-bytes", "0"]],
  [
    "mail list with max-body-bytes below 0",
    ["mail", "list", ...range, "--limit", "1", "--max-body-bytes", "-1"],
  ],
  [
    "mail list over 1 MiB",
    ["mail", "list", ...range, "--limit", "1", "--max-body-bytes", "1048577"],
  ],
  [
    "mail list with an empty range",
    [
      "mail",
      "list",
      "--from",
      range[3]!,
      "--to",
      range[1]!,
      "--limit",
      "1",
      "--max-body-bytes",
      "0",
    ],
  ],
  ["mail list with limit 0", ["mail", "list", ...range, "--limit", "0", "--max-body-bytes", "0"]],
  ["mail read with a bad id", ["mail", "read", "--message-id", "42", "--max-body-bytes", "10"]],
  [
    "mail read with max-body-bytes 0",
    ["mail", "read", "--message-id", "mail-index:42", "--max-body-bytes", "0"],
  ],
])("%s is invalidRequest before the missing Mail store is looked up", (_name, args) => {
  expect(run(scratchHome(), args)).toEqual({
    code: 1,
    output: { error: "invalidRequest", status: "failed" },
  });
});

test("a valid mail list reaches the store and names it unreadable", () => {
  const result = run(scratchHome(), [
    "mail",
    "list",
    ...range,
    "--limit",
    "1",
    "--max-body-bytes",
    "0",
  ]);
  expect(result.code).toBe(1);
  expect(result.output).toMatchObject({ status: "failed", error: "mail.store_unreadable" });
});

test.each([
  ["without --limit", ["operations", "list"]],
  ["with limit 0", ["operations", "list", "--limit", "0"]],
  ["with limit 1001", ["operations", "list", "--limit", "1001"]],
])("operations list %s is invalidRequest and creates no journal", (_name, args) => {
  const home = scratchHome();
  expect(run(home, args)).toEqual({
    code: 1,
    output: { error: "invalidRequest", status: "failed" },
  });
  expect(existsSync(join(home, "Library/Application Support/Sherpa"))).toBe(false);
});

test("a valid operations list opens the journal", () => {
  const home = scratchHome();
  const child = Bun.spawnSync([BINARY, "operations", "list", "--limit", "1"], {
    env: { HOME: home, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LOG_LEVEL: "error" },
  });
  expect(child.exitCode).toBe(0);
  expect(JSON.parse(child.stdout.toString())).toEqual([]);
  expect(existsSync(join(home, "Library/Application Support/Sherpa/native.sqlite3"))).toBe(true);
});
