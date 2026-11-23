import { defineConfig } from "vite-plus";

// The core's only way to the network is the turn fetch of src/chat/egress.ts (ADR-0012 "네트워크",
// app-connection-v1 §7.1). The overrides below keep every other network API out of src/;
// tests/egress-lint.test.ts lints tests/fixtures/egress/ with them and checks each form is caught.
const NETWORK =
  "The core opens no connection of its own: it sends only through src/chat/egress.ts.";
// Bun 1.4.4 and 1.4.5 resolve each of these without an install: Node's socket and name-lookup
// modules with their legacy internals, and shims that bring a fetch or a WebSocket of their own.
// tests/dependency-network.test.ts holds the packages the core bundles to the same list.
export const networkModules = [
  {
    regex: "^(node:)?(net|tls|https?|http2|dgram|dns|_http_\\w+|_tls_\\w+)(/.*)?$",
    message: NETWORK,
  },
  { regex: "^(ws|undici|node-fetch|isomorphic-fetch|cross-fetch)(/.*)?$", message: NETWORK },
];
// Bun's network surface on `Bun` and in "bun" (Bun 1.4.4 and 1.4.5): sockets, its own fetch and
// fetch sessions, which replacing the global fetch does not reach, name lookups, and its S3, SQL
// and Redis clients.
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

// The AI SDK (ADR-0012 "코드로 지키기" 3, "메모리와 크기"). Its values load under src/chat/sdk/,
// which only src/chat/load.ts imports, with import() when the first turn starts or a resume is
// checked; a chat module elsewhere takes only its types. Of src/chat/sdk/, only turn.ts imports the functions that take a
// model, so only its types need to keep a model id given as a string away from them, and no
// module imports the AI Gateway. A rule that picks names does not read import() (oxlint 1.94.0),
// and none of these tells a static import of src/chat/sdk/ in load.ts from import(); the default
// provider that src/chat/egress.ts installs refuses a model id given as a string at run time.
const AI_SDK = ["ai", "ai/*", "@ai-sdk/*"];
const SDK_TYPES =
  "Outside src/chat/sdk/ a chat module imports only the AI SDK's types; src/chat/load.ts loads the rest when the first turn starts or a resume is checked (ADR-0012).";
/** A relative path into a folder named sdk: src/chat/sdk/ from anywhere under src/. */
const SDK_FOLDER = "^\\.{1,2}/(?:.*/)?sdk(?:/|$)";
const SDK_LOAD =
  "Only src/chat/load.ts imports src/chat/sdk/, with import() when the first turn starts or a resume is checked (ADR-0012).";
const NO_GATEWAY = {
  group: ["@ai-sdk/gateway", "@ai-sdk/mcp", "@ai-sdk/otel"].flatMap((name) => [name, `${name}/*`]),
  message: "No AI Gateway, AI SDK MCP client or OpenTelemetry anywhere (ADR-0012).",
};
const AI_ROOT = {
  group: ["ai/*"],
  message: "The core imports ai only from its root, never ai/internal or ai/test.",
};
/**
 * What a module under src/chat/sdk/ other than turn.ts imports from ai besides its types: the
 * tools' schemas, and what a chat's state needs (src/chat/sdk/state.ts).
 */
const SDK_VALUES = [
  "jsonSchema",
  "tool",
  "fingerprintTools",
  "modelMessageSchema",
  "pruneMessages",
];
/** What src/chat/sdk/turn.ts never imports from ai: the AI Gateway and the telemetry registry. */
const NEVER_FROM_AI = ["createGateway", "gateway", "registerTelemetry"];

type Message = { message: string };
type Pattern = ({ group: string[] } | { regex: string }) & Message & { allowTypeImports?: boolean };
type ImportPath = {
  name: string;
  importNames?: string[];
  allowImportNames?: string[];
  allowTypeImports?: boolean;
} & Message;

function restrictedImports({
  paths = [],
  patterns = [],
}: {
  paths?: ImportPath[];
  patterns?: Pattern[];
}): ["error", { paths: ImportPath[]; patterns: Pattern[] }] {
  return [
    "error",
    {
      paths: [{ name: "bun", importNames: bunNetwork, message: NETWORK }, ...paths],
      patterns: [...networkModules, ...patterns],
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
            patterns: [
              { group: AI_SDK, message: "The AI SDK is imported only under src/chat/ (ADR-0012)." },
              { regex: SDK_FOLDER, message: SDK_LOAD },
            ],
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
            patterns: [
              NO_GATEWAY,
              { group: AI_SDK, allowTypeImports: true, message: SDK_TYPES },
              { regex: SDK_FOLDER, allowTypeImports: true, message: SDK_LOAD },
            ],
          }),
        },
      },
      {
        // Loads src/chat/sdk/ when the first turn starts or a resume is checked.
        files: ["src/chat/load.ts"],
        rules: {
          "no-restricted-imports": restrictedImports({
            patterns: [NO_GATEWAY, { group: AI_SDK, allowTypeImports: true, message: SDK_TYPES }],
          }),
        },
      },
      {
        files: ["src/chat/sdk/**"],
        rules: {
          "no-restricted-imports": restrictedImports({
            paths: [
              {
                name: "ai",
                allowImportNames: SDK_VALUES,
                allowTypeImports: true,
                message:
                  "Only src/chat/sdk/turn.ts takes a model; the other modules here import from ai only its types and these names (ADR-0012).",
              },
            ],
            patterns: [NO_GATEWAY, AI_ROOT],
          }),
        },
      },
      {
        // The one module that takes a model.
        files: ["src/chat/sdk/turn.ts"],
        rules: {
          "no-restricted-imports": restrictedImports({
            paths: [
              {
                name: "ai",
                importNames: NEVER_FROM_AI,
                message: "No AI Gateway and no telemetry integration (ADR-0012).",
              },
            ],
            patterns: [NO_GATEWAY, AI_ROOT],
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
