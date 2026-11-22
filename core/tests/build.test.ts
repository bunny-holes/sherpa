import { join } from "node:path";
import { expect, test } from "vite-plus/test";

// app-connection-v1 §7.1 and bunny-holes/sherpa#92: a Bun standalone executable reads files from
// the directory it runs in unless its build turns each off. tests/stdio/cli.test.ts sees the core
// read none of them, but Bun 1.4.5 reads tsconfig.json and package.json only while it reads .env
// files, so what the built core does cannot show those two flags; the build command is read here.
const AUTOLOAD = ["dotenv", "bunfig", "tsconfig", "package-json"];

test("the build turns off every file a compiled core could read where it runs", async () => {
  const manifest = await Bun.file(join(import.meta.dirname, "../package.json")).json();
  const build: string[] = manifest.scripts.build.split(/\s+/);
  expect(build.slice(0, 2)).toEqual(["bun", "build"]);
  expect(build).toContain("--compile");
  expect(build).toEqual(
    expect.arrayContaining(AUTOLOAD.map((kind) => `--no-compile-autoload-${kind}`)),
  );
  expect(build.filter((argument) => argument.startsWith("--compile-autoload-"))).toEqual([]);
});
