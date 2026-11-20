import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { resolveAppleHelper } from "../src/apple/helper.ts";
import { SherpaError } from "../src/cli/errors.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function installation(files: string[]): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sherpa-helper-")));
  roots.push(root);
  for (const file of ["bin/sherpa", ...files]) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), "");
  }
  return root;
}

describe("resolveAppleHelper", () => {
  test("finds the helper inside the installed app bundle", () => {
    const root = installation(["libexec/SherpaHelper.app/Contents/MacOS/sherpa-apple"]);
    expect(resolveAppleHelper(join(root, "bin/sherpa"), {})).toBe(
      join(root, "libexec/SherpaHelper.app/Contents/MacOS/sherpa-apple"),
    );
  });

  // A bare libexec/sherpa-apple is keyed by path in macOS privacy settings and
  // would ask for Calendar and Reminders again after every upgrade.
  test("does not fall back to a bare executable in libexec", () => {
    const root = installation(["libexec/sherpa-apple"]);
    expect(() => resolveAppleHelper(join(root, "bin/sherpa"), {})).toThrow(SherpaError);
  });

  test("SHERPA_APPLE_BIN wins", () => {
    const root = installation([
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
