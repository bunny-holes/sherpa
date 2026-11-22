import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { codes, SherpaError } from "../src/cli/errors.ts";
import {
  isBinaryPlist,
  isPlistDictionary,
  parseBinaryPlist,
  PlistUID,
  readPlistFile,
  tryParseBinaryPlist,
} from "../src/plist/plist.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sherpa-plist-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("shared plist adapter", () => {
  test("reads KakaoTalk-style plists with data and date values that plutil -convert json rejects", async () => {
    const dir = makeTempDir();
    const xmlPath = join(dir, "kakaotalk-prefs.plist");
    const binaryPath = join(dir, "kakaotalk-prefs.bplist");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>OpaqueToken</key><data>AQIDBA==</data>
  <key>LastSync</key><date>2026-11-23T00:00:00Z</date>
  <key>AccountLabel</key><string>카카오</string>
  <key>Revision</key><integer>42</integer>
</dict></plist>`;
    await Bun.write(xmlPath, xml);

    // Regression proof: macOS `plutil -convert json` rejects plists containing <data> or <date>.
    const jsonAttempt = Bun.spawn(["/usr/bin/plutil", "-convert", "json", "-o", "-", xmlPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await jsonAttempt.exited).not.toBe(0);

    // Convert once to binary1 so we test both the XML-via-plutil and direct binary1 paths.
    const toBinary = Bun.spawn(
      ["/usr/bin/plutil", "-convert", "binary1", "-o", binaryPath, xmlPath],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(await toBinary.exited).toBe(0);

    for (const path of [xmlPath, binaryPath]) {
      const parsed = await readPlistFile(path);
      expect(isPlistDictionary(parsed)).toBe(true);
      if (!isPlistDictionary(parsed)) throw new Error("unreachable");
      expect(parsed.OpaqueToken).toEqual(Uint8Array.from([1, 2, 3, 4]));
      expect(parsed.LastSync).toBeInstanceOf(Date);
      expect((parsed.LastSync as Date).toISOString()).toBe("2026-11-23T00:00:00.000Z");
      expect(parsed.AccountLabel).toBe("카카오");
      expect(parsed.Revision).toBe(42);
    }
  });

  test("rejects cyclic binary plists with SherpaError and returns undefined in tryParseBinaryPlist", () => {
    // Craft a minimal bplist00 whose single object (ref 0) is a 1-element array referencing ref 0.
    const body = new Uint8Array([
      ...Buffer.from("bplist00", "latin1"),
      0xa1,
      0x00, // offset 8: array of length 1, element ref 0 (self-cycle)
      0x08, // offset 10: offset table entry 0 -> offset 8
      // 32-byte trailer:
      0,
      0,
      0,
      0,
      0,
      0,
      1, // offsetSize = 1
      1, // refSize = 1
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1, // objectCount = 1
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0, // topObject = 0
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      10, // tableOffset = 10
    ]);
    expect(isBinaryPlist(body)).toBe(true);
    let thrown: unknown;
    try {
      parseBinaryPlist(body);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SherpaError);
    expect((thrown as SherpaError).code).toBe(codes.failed);
    expect(tryParseBinaryPlist(body)).toBeUndefined();
  });

  test("classifies dictionary vs non-dictionary plist values accurately", () => {
    expect(isPlistDictionary({ a: 1 })).toBe(true);
    expect(isPlistDictionary(null)).toBe(false);
    expect(isPlistDictionary([])).toBe(false);
    expect(isPlistDictionary(new Date())).toBe(false);
    expect(isPlistDictionary(new Uint8Array())).toBe(false);
    expect(isPlistDictionary(new PlistUID(1))).toBe(false);
  });

  test("does not mutate Object.prototype when a plist dictionary contains a __proto__ key", async () => {
    const dir = makeTempDir();
    const xmlPath = join(dir, "proto.plist");
    await Bun.write(
      xmlPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>__proto__</key><dict><key>polluted</key><true/></dict>
</dict></plist>`,
    );
    const parsed = await readPlistFile(xmlPath);
    expect(isPlistDictionary(parsed)).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(parsed, "__proto__")).toBe(true);
  });
});
