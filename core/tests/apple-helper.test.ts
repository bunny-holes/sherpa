import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { resolveAppleHelper } from "../src/apple/helper.ts";
import { SherpaError } from "../src/cli/errors.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// Bun.write creates the parent folders of each file.
async function installation(files: string[]): Promise<string> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sherpa-helper-")));
  roots.push(root);
  for (const file of ["bin/sherpa", ...files]) await Bun.write(join(root, file), "");
  return root;
}

describe("resolveAppleHelper", () => {
  test("finds the helper inside the installed app bundle", async () => {
    const root = await installation(["libexec/SherpaHelper.app/Contents/MacOS/sherpa-apple"]);
    expect(resolveAppleHelper(join(root, "bin/sherpa"), {})).toBe(
      join(root, "libexec/SherpaHelper.app/Contents/MacOS/sherpa-apple"),
    );
  });

  // A bare libexec/sherpa-apple is keyed by path in macOS privacy settings and
  // would ask for Calendar and Reminders again after every upgrade.
  test("does not fall back to a bare executable in libexec", async () => {
    const root = await installation(["libexec/sherpa-apple"]);
    expect(() => resolveAppleHelper(join(root, "bin/sherpa"), {})).toThrow(SherpaError);
  });

  test("SHERPA_APPLE_BIN wins", async () => {
    const root = await installation([
      "libexec/SherpaHelper.app/Contents/MacOS/sherpa-apple",
      "dev/sherpa-apple",
    ]);
    expect(
      resolveAppleHelper(join(root, "bin/sherpa"), {
        SHERPA_APPLE_BIN: join(root, "dev/sherpa-apple"),
      }),
    ).toBe(join(root, "dev/sherpa-apple"));
  });
});
