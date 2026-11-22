import { isBuiltin } from "node:module";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { networkModules } from "../vite.config.ts";

// ADR-0012 "코드로 지키기" 3 and app-connection-v1 §7.1: the lint reads src/ only, so this reads
// the packages the core bundles, as patterns. It walks the dependencies of core/package.json,
// theirs and the peers not marked optional, and reads every JavaScript file of each with Bun's
// transpiler, which parses the imports and drops the comments. It cannot see require or import
// reached under another name, code made with eval or Function (Ajv's validators in the MCP server
// are), or a property name put together from strings; the global fetch, WebSocket and AI SDK
// default provider that installEgress leaves refusing stop the paths the packages are known to
// take.

const CORE = join(import.meta.dirname, "..");

/** The Node modules a bundled package may import: files, paths, the OS, crypto and process. */
const NODE_MODULES = new Set(["crypto", "fs", "fs/promises", "os", "path", "process"]);

/** What no bundled package's code may name, comments dropped. */
const FORBIDDEN: [string, RegExp][] = [
  // Bun's sockets, its own fetch, servers and processes, which replacing the globals does not reach.
  ["Bun", /\bBun\b/],
  // A worker's global scope has a fetch of its own.
  ["Worker", /\b(?:Shared)?Worker\b/],
  // A module loaded under a name the transpiler cannot read.
  ["createRequire", /\bcreateRequire\b/],
  ["import.meta.require", /\bimport\s*\.\s*meta\s*\.\s*require\b/],
  ["a computed module name", /\b(?:require|import)\s*\(\s*[^"'`\s)]/],
  ["a computed global", /\bglobalThis\s*\[/],
  ["a native binding", /\bprocess\s*\.\s*(?:binding|_linkedBinding|dlopen)\b/],
];

interface Package {
  name: string;
  dir: string;
}

/** The packages core/package.json brings in, each resolved as Bun resolves it from its dependent. */
async function bundled(): Promise<Package[]> {
  const found = new Map<string, Package>();
  const manifest = (dir: string) => Bun.file(join(dir, "package.json")).json();
  const queue = Object.keys((await manifest(CORE)).dependencies).map((name) => ({
    name,
    from: CORE,
  }));
  for (let next = queue.shift(); next; next = queue.shift()) {
    const nested = join(next.from, "node_modules", next.name);
    const dir = (await Bun.file(join(nested, "package.json")).exists())
      ? nested
      : join(CORE, "node_modules", next.name);
    if (found.has(dir)) continue;
    found.set(dir, { name: next.name, dir });
    const {
      dependencies = {},
      peerDependencies = {},
      peerDependenciesMeta = {},
    } = await manifest(dir);
    const peers = Object.keys(peerDependencies).filter(
      (peer) => !peerDependenciesMeta[peer]?.optional,
    );
    for (const name of [...Object.keys(dependencies), ...peers]) queue.push({ name, from: dir });
  }
  return [...found.values()];
}

/** Each JavaScript file of a package, as its path and its code; a nested package is its own. */
async function* sources({ name, dir }: Package) {
  for await (const path of new Bun.Glob("**/*.{js,mjs,cjs}").scan({ cwd: dir })) {
    if (path.split("/").includes("node_modules")) continue;
    yield { file: `${name}/${path}`, code: await Bun.file(join(dir, path)).text() };
  }
}

const packages = await bundled();
const transpiler = new Bun.Transpiler({ loader: "js" });

test("the walk reaches the packages the AI SDK and the MCP server bring in", () => {
  expect(packages.map(({ name }) => name)).toEqual(
    expect.arrayContaining([
      "ai",
      "@ai-sdk/gateway",
      "@vercel/oidc",
      "@modelcontextprotocol/server",
    ]),
  );
});

test("the bundled packages import no network module and no Node module beyond files, paths, the OS, crypto and process", async () => {
  const network = networkModules.map(({ regex }) => new RegExp(regex));
  const refused: string[] = [];
  for (const source of packages) {
    for await (const { file, code } of sources(source)) {
      for (const { path } of transpiler.scanImports(code)) {
        const bun = path === "bun" || path.startsWith("bun:");
        const node = isBuiltin(path) && !NODE_MODULES.has(path.replace(/^node:/, ""));
        if (bun || node || network.some((pattern) => pattern.test(path))) {
          refused.push(`${file}: ${path}`);
        }
      }
    }
  }
  expect(refused).toEqual([]);
});

test("the bundled packages name no Bun API, Worker, native binding or module named at run time", async () => {
  const refused: string[] = [];
  for (const source of packages) {
    for await (const { file, code } of sources(source)) {
      const stripped = transpiler.transformSync(code);
      for (const [what, pattern] of FORBIDDEN)
        if (pattern.test(stripped)) refused.push(`${file}: ${what}`);
    }
    for await (const path of new Bun.Glob("**/*.node").scan({ cwd: source.dir })) {
      refused.push(`${source.name}/${path}: a native addon`);
    }
  }
  expect(refused).toEqual([]);
});

test(`Bun ${Bun.version} gives the bundled packages no network global beyond fetch and WebSocket`, () => {
  // `ai` 7.0.179's browser realtime session constructs RTCPeerConnection; here that throws.
  const scope = globalThis as Record<string, unknown>;
  for (const name of ["EventSource", "RTCPeerConnection", "WebTransport", "XMLHttpRequest"]) {
    expect(scope[name], name).toBeUndefined();
  }
  expect((navigator as { sendBeacon?: unknown }).sendBeacon).toBeUndefined();
});
