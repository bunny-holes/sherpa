import { defineConfig } from "vite-plus";

// The core's only way to the network is the turn fetch of src/chat/egress.ts (ADR-0012 "네트워크",
// app-connection-v1 §7.1). The overrides below keep every other network API out of src/;
// tests/egress-lint.test.ts lints tests/fixtures/egress/ with them and checks each form is caught.
const NETWORK =
  "The core opens no connection of its own: it sends only through src/chat/egress.ts.";
// Bun 1.4.4 resolves each of these without an install: Node's socket and name-lookup modules with
// their legacy internals, and shims that bring a fetch or a WebSocket of their own.
const networkModules = [
  {
    regex: "^(node:)?(net|tls|https?|http2|dgram|dns|_http_\\w+|_tls_\\w+)(/.*)?$",
    message: NETWORK,
  },
  { regex: "^(ws|undici|node-fetch|isomorphic-fetch|cross-fetch)(/.*)?$", message: NETWORK },
];
// Bun's network surface on `Bun` and in "bun" (Bun 1.4.4): sockets, its own fetch and fetch
// sessions, which replacing the global fetch does not reach, name lookups, and its S3, SQL and
// Redis clients.
const bunNetwork = [
  "FetchSession",
  "RedisClient",
  "S3Client",
  "SQL",
  "connect",
  "dns",
  "fetch",
  "listen",
  "postgres",
  "redis",
  "s3",
  "serve",
  "sql",
  "udpSocket",
];
const webSockets = ["WebSocket", "EventSource"];

type Pattern = { group: string[]; message: string } | { regex: string; message: string };
type Message = { message: string };

function restrictedImports(
  aiSdk: Pattern,
): [
  "error",
  { paths: ({ name: string; importNames: string[] } & Message)[]; patterns: Pattern[] },
] {
  return [
    "error",
    {
      paths: [{ name: "bun", importNames: bunNetwork, message: NETWORK }],
      patterns: [...networkModules, aiSdk],
    },
  ];
}

function restrictedGlobals(names: string[]): ["error", ...({ name: string } & Message)[]] {
  return ["error", ...names.map((name) => ({ name, message: NETWORK }))];
}

function restrictedProperties(
  globals: string[],
): ["error", ...({ object?: string; property: string } & Message)[]] {
  return [
    "error",
    ...bunNetwork.map((property) => ({ object: "Bun", property, message: NETWORK })),
    ...["globalThis", "self"].flatMap((object) =>
      globals.map((property) => ({ object, property, message: NETWORK })),
    ),
    // `import.meta.require` and `module.require`; `typescript/no-require-imports` takes `require()`.
    { property: "require", message: "Load modules with import, which these rules read." },
  ];
}

export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/*.test.ts"] } },
      // Drives the built dist/sherpa through its pipes; run after `bun run build`.
      {
        extends: true,
        test: { name: "stdio", include: ["tests/stdio/*.test.ts"], testTimeout: 20_000 },
      },
    ],
  },
  lint: {
    // They break the egress rules on purpose; tests/egress-lint.test.ts lints them.
    ignorePatterns: ["tests/fixtures/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    overrides: [
      {
        files: ["src/**"],
        rules: {
          "no-restricted-imports": restrictedImports({
            group: ["ai", "ai/*", "@ai-sdk/*"],
            message: "The AI SDK is imported only under src/chat/ (ADR-0012).",
          }),
          "no-restricted-globals": restrictedGlobals(["fetch", ...webSockets]),
          "no-restricted-properties": restrictedProperties(["fetch", ...webSockets]),
          "typescript/no-require-imports": "error",
        },
      },
      {
        files: ["src/chat/**"],
        rules: {
          "no-restricted-imports": restrictedImports({
            group: ["@ai-sdk/gateway", "@ai-sdk/mcp", "@ai-sdk/otel"].flatMap((name) => [
              name,
              `${name}/*`,
            ]),
            message: "No AI Gateway, AI SDK MCP client or OpenTelemetry anywhere (ADR-0012).",
          }),
        },
      },
      {
        // The one module that holds fetch.
        files: ["src/chat/egress.ts"],
        rules: {
          "no-restricted-globals": restrictedGlobals(webSockets),
          "no-restricted-properties": restrictedProperties(webSockets),
        },
      },
    ],
  },
  fmt: {},
});
