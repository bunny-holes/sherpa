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

test("the built CLI reads no configuration from the directory it runs in, HOME or XDG_CONFIG_HOME", async () => {
  // A Bun standalone executable reads .env files and bunfig.toml from its working directory, and
  // tsconfig.json and package.json when its build asks, unless the build turns each off
  // (`bun build --help`); Bun 1.4.5 reads the last two only while it reads .env files. Each file
  // here shows on standard error if the core reads it.
  const directory = scratchHome();
  const home = scratchHome();
  const config = scratchHome();
  const files: Record<string, string> = {
    [join(directory, ".env")]: "LOG_LEVEL=debug\n",
    [join(directory, ".env.local")]: "LOG_LEVEL=debug\n",
    [join(directory, ".env.production")]: "LOG_LEVEL=debug\n",
    [join(directory, "bunfig.toml")]: 'preload = ["./preload.js"]\n',
    [join(directory, "preload.js")]: 'console.error("preloaded from the directory");\n',
    [join(directory, "tsconfig.json")]: "{ not json\n",
    [join(directory, "package.json")]: "{ not json\n",
    [join(home, ".bunfig.toml")]: `preload = [${JSON.stringify(join(home, "preload.js"))}]\n`,
    [join(home, "preload.js")]: 'console.error("preloaded from HOME");\n',
    [join(config, ".bunfig.toml")]: `preload = [${JSON.stringify(join(config, "preload.js"))}]\n`,
    [join(config, "preload.js")]: 'console.error("preloaded from XDG_CONFIG_HOME");\n',
  };
  await Promise.all(Object.entries(files).map(([path, text]) => Bun.write(path, text)));
  const version = (env: Record<string, string> = {}) =>
    Bun.spawnSync([BINARY, "--version"], {
      cwd: directory,
      env: { HOME: home, XDG_CONFIG_HOME: config, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", ...env },
      stdin: "ignore",
    });
  for (const env of [{}, { NODE_ENV: "production" }] as Record<string, string>[]) {
    const run = version(env);
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString()).toMatch(/^sherpa \d+\.\d+\.\d+\n$/);
    expect(run.stderr.toString()).toBe("");
  }
  // LOG_LEVEL=debug given for real prints the line a loaded .env would.
  expect(version({ LOG_LEVEL: "debug" }).stderr.toString()).toMatch(
    /^debug \[core:egress:install\]/m,
  );
});
