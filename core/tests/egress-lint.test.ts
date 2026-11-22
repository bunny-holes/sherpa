import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vite-plus/test";
import config from "../vite.config.ts";

// ADR-0012 "코드로 지키기" 3: the lint rules that keep the network out of src/ and the AI SDK in its
// place, against fixtures
// that break them on purpose. A fixture line that ends in `// expect: <rule>…` must draw exactly
// those rules, and every other line none. The fixtures are copied to a src/ of their own and linted
// with the lint block of vite.config.ts, so its overrides reach them as they reach src/.
const FIXTURES = join(import.meta.dirname, "fixtures/egress");
/** The linter `vp check` runs (vite-plus pins this oxlint). */
const OXLINT = join(import.meta.dirname, "../node_modules/oxlint/bin/oxlint");
const RULES = [
  "eslint(no-restricted-imports)",
  "eslint(no-restricted-globals)",
  "eslint(no-restricted-properties)",
  "typescript(no-require-imports)",
];

interface Diagnostic {
  code: string;
  filename: string;
  labels: { span: { line: number } }[];
}

const root = mkdtempSync(join(tmpdir(), "sherpa-egress-lint-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("the egress rules refuse each form in the fixtures and nothing else", async () => {
  const expected: string[] = [];
  for await (const path of new Bun.Glob("**/*.ts").scan({ cwd: FIXTURES })) {
    const source = await Bun.file(join(FIXTURES, path)).text();
    await Bun.write(join(root, path), source);
    source.split("\n").forEach((line, index) => {
      const rules = /\/\/ expect: (.+)$/.exec(line)?.[1]?.split(" ") ?? [];
      for (const rule of rules) expected.push(`${path}:${index + 1} ${rule}`);
    });
  }
  // Type-aware linting would need a tsconfig for the copies; these rules read syntax only.
  await Bun.write(
    join(root, ".oxlintrc.json"),
    JSON.stringify({ ...config.lint, options: undefined }),
  );
  const run = Bun.spawnSync(
    [process.execPath, OXLINT, "-c", ".oxlintrc.json", "--format", "json", "src"],
    { cwd: root },
  );
  const { diagnostics } = JSON.parse(run.stdout.toString()) as { diagnostics: Diagnostic[] };
  const found = diagnostics
    .filter((diagnostic) => RULES.includes(diagnostic.code))
    .map(
      (diagnostic) =>
        `${diagnostic.filename}:${diagnostic.labels[0]!.span.line} ${diagnostic.code}`,
    );
  expect(found.sort()).toEqual(expected.sort());
  expect(new Set(expected.map((entry) => entry.split(":")[0])).size).toBe(6);
});
