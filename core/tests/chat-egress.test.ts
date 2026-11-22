import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import {
  allowedOrigin,
  EgressDeniedError,
  type EgressRefusal,
  type Fetch,
  installEgress,
} from "../src/chat/egress.ts";

// ADR-0012 "시험으로 지키기": the egress without a socket. The runtime's fetch and WebSocket are
// fakes that record whatever reaches them.
interface Sent {
  input: string | URL | Request;
  init: BunFetchRequestInit | undefined;
}

function runtime(answer: (sent: Sent) => Promise<Response> = async () => new Response("ok")) {
  const sent: Sent[] = [];
  const fake = Object.assign(
    (input: string | URL | Request, init?: BunFetchRequestInit) => {
      sent.push({ input, init });
      return answer({ input, init });
    },
    { preconnect: () => sent.push({ input: "preconnect", init: undefined }) },
  );
  class Socket {
    constructor(url: string | URL) {
      sent.push({ input: String(url), init: undefined });
    }
  }
  const scope: { fetch: Fetch; WebSocket?: unknown; AI_SDK_DEFAULT_PROVIDER?: unknown } = {
    fetch: fake,
    WebSocket: Socket,
  };
  return { scope, sent, egress: installEgress(scope) };
}

/** The constructor shape the AI SDK's WebSocket helper calls (`@ai-sdk/provider-utils` 5.0.83). */
type WebSocketConstructor = new (
  url: string | URL,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> },
) => object;

const ANTHROPIC = allowedOrigin("https://api.anthropic.com/v1");
const MESSAGES = "https://api.anthropic.com/v1/messages";

let lines: string[];
beforeEach(() => {
  lines = [];
  vi.stubEnv("LOG_LEVEL", "warn");
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const refused = (action: string, reason: EgressRefusal) =>
  `warn [core:egress:${action}] refused reason=${reason}\n`;

describe("the global fetch", () => {
  test("refuses every call, preconnect included, before the runtime sees it", async () => {
    const { scope, sent } = runtime();
    const call = scope.fetch(MESSAGES, { method: "POST" });
    await expect(call).rejects.toBeInstanceOf(EgressDeniedError);
    await expect(call).rejects.toMatchObject({
      name: "EgressDeniedError",
      code: "egress_denied",
      reason: "global_fetch",
    });
    expect(() => scope.fetch.preconnect("https://api.anthropic.com")).toThrow(EgressDeniedError);
    expect(sent).toEqual([]);
    expect(lines).toEqual([refused("fetch", "global_fetch"), refused("fetch", "global_fetch")]);
  });

  test("cannot be assigned back or installed twice", async () => {
    const { scope, sent } = runtime();
    const restore = Object.assign(async () => new Response("bypass"), { preconnect() {} });
    expect(() => {
      scope.fetch = restore;
    }).toThrow(TypeError);
    expect(() => installEgress(scope)).toThrow(TypeError);
    await expect(scope.fetch(MESSAGES)).rejects.toMatchObject({ reason: "global_fetch" });
    expect(sent).toEqual([]);
  });
});

describe("the global WebSocket", () => {
  test("refuses every connection, a subclass's and a call included, before the runtime sees it", () => {
    const { scope, sent } = runtime();
    const WebSocket = scope.WebSocket as WebSocketConstructor;
    const denied = expect.objectContaining({
      name: "EgressDeniedError",
      code: "egress_denied",
      reason: "global_websocket",
    });
    const realtime = "wss://api.openai.com/v1/realtime";
    expect(() => new WebSocket(realtime, [], { headers: { authorization: "Bearer k" } })).toThrow(
      denied,
    );
    class Reconnecting extends WebSocket {}
    expect(() => new Reconnecting(realtime)).toThrow(EgressDeniedError);
    expect(() => (scope.WebSocket as () => unknown)()).toThrow(EgressDeniedError);
    expect(sent).toEqual([]);
    expect(lines).toEqual(Array(3).fill(refused("websocket", "global_websocket")));
  });

  test("cannot be assigned back or redefined", () => {
    const { scope, sent } = runtime();
    class Bypass {}
    expect(() => {
      scope.WebSocket = Bypass;
    }).toThrow(TypeError);
    expect(() => Object.defineProperty(scope, "WebSocket", { value: Bypass })).toThrow(TypeError);
    expect(() => new (scope.WebSocket as WebSocketConstructor)("wss://models.example")).toThrow(
      EgressDeniedError,
    );
    expect(sent).toEqual([]);
  });

  test("is replaced together with the global fetch, and the install says so at debug", () => {
    vi.stubEnv("LOG_LEVEL", "debug");
    runtime();
    expect(lines).toEqual([
      "debug [core:egress:install] success global_fetch=refused global_websocket=refused ai_sdk_default_provider=refused\n",
    ]);
  });
});

/** Every factory `ai` 7.0.179 calls on its default provider for a model id given as a string. */
const FACTORIES = [
  "languageModel",
  "embeddingModel",
  "imageModel",
  "transcriptionModel",
  "speechModel",
  "rerankingModel",
  "videoModel",
  "speechTranslationModel",
  "decisionModel",
  "evaluationModel",
  "extractionModel",
  "experimental_batch",
];

describe("the AI SDK's default provider", () => {
  test("is a version 4 provider whose every factory refuses, before the runtime sees anything", () => {
    const { scope, sent } = runtime();
    const provider = scope.AI_SDK_DEFAULT_PROVIDER as Record<string, unknown>;
    expect(provider.specificationVersion).toBe("v4");
    expect(Object.keys(provider).sort()).toEqual(["specificationVersion", ...FACTORIES].sort());
    for (const name of FACTORIES) {
      expect(() => (provider[name] as (id: string) => unknown)("claude-sonnet-4-5")).toThrow(
        expect.objectContaining({
          name: "EgressDeniedError",
          code: "egress_denied",
          reason: "string_model_id",
        }),
      );
    }
    expect(sent).toEqual([]);
    expect(lines).toEqual(
      Array(FACTORIES.length).fill(refused("default-provider", "string_model_id")),
    );
  });

  test("cannot be assigned back, redefined or changed", () => {
    const { scope } = runtime();
    const gateway = { specificationVersion: "v4", languageModel: () => ({}) };
    expect(() => {
      scope.AI_SDK_DEFAULT_PROVIDER = gateway;
    }).toThrow(TypeError);
    expect(() =>
      Object.defineProperty(scope, "AI_SDK_DEFAULT_PROVIDER", { value: gateway }),
    ).toThrow(TypeError);
    const provider = scope.AI_SDK_DEFAULT_PROVIDER as Record<string, unknown>;
    expect(() => {
      provider.languageModel = gateway.languageModel;
    }).toThrow(TypeError);
    expect(() => (provider.languageModel as (id: string) => unknown)("m")).toThrow(
      EgressDeniedError,
    );
  });
});

describe("a turn fetch", () => {
  test.each([
    ["a string", () => MESSAGES, MESSAGES],
    ["a URL", () => new URL(MESSAGES), MESSAGES],
  ])(
    "sends %s as the checked URL with redirect: error and the turn's signal",
    async (_n, input, target) => {
      const { egress, sent } = runtime();
      const turn = new AbortController();
      const response = await egress.turnFetch(ANTHROPIC, turn.signal)(input(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(await response.text()).toBe("ok");
      expect(sent).toHaveLength(1);
      expect(sent[0]!.input).toBe(target);
      expect(sent[0]!.init).toMatchObject({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        redirect: "error",
      });
      const signal = sent[0]!.init!.signal!;
      expect(signal.aborted).toBe(false);
      turn.abort();
      expect(signal.aborted).toBe(true);
    },
  );

  test("sends a Request itself, its redirect replaced and its signal joined with the turn's", async () => {
    const { egress, sent } = runtime();
    const caller = new AbortController();
    const request = new Request(MESSAGES, {
      method: "POST",
      redirect: "follow",
      signal: caller.signal,
    });
    await egress.turnFetch(ANTHROPIC, new AbortController().signal)(request);
    expect(sent[0]!.input).toBe(request);
    expect(sent[0]!.init!.redirect).toBe("error");
    caller.abort();
    expect(sent[0]!.init!.signal!.aborted).toBe(true);
  });

  test.each(["follow", "manual", "error"] as const)(
    "replaces the caller's redirect %s with error",
    async (redirect) => {
      const { egress, sent } = runtime();
      await egress.turnFetch(ANTHROPIC, new AbortController().signal)(MESSAGES, { redirect });
      expect(sent[0]!.init!.redirect).toBe("error");
    },
  );

  test("joins the caller's signal with the turn's", async () => {
    const { egress, sent } = runtime();
    const caller = new AbortController();
    const turn = new AbortController();
    await egress.turnFetch(ANTHROPIC, turn.signal)(MESSAGES, { signal: caller.signal });
    const signal = sent[0]!.init!.signal!;
    caller.abort();
    expect(signal.aborted).toBe(true);
    expect(turn.signal.aborted).toBe(false);
  });

  test("drops Bun's extensions that would route, weaken or print the request", async () => {
    const { egress, sent } = runtime();
    await egress.turnFetch(ANTHROPIC, new AbortController().signal)(MESSAGES, {
      method: "POST",
      proxy: "http://127.0.0.1:8080",
      unix: "/tmp/elsewhere.sock",
      tls: { rejectUnauthorized: false },
      protocol: "http3",
      verbose: true,
    });
    expect(Object.keys(sent[0]!.init!).sort()).toEqual(["method", "redirect", "signal"]);
    expect(lines).toEqual([
      "warn [core:egress:fetch] dropped options=proxy,unix,tls,protocol,verbose\n",
    ]);
  });

  test.each([
    ["https://models.example/v1/messages", "other_origin"],
    ["https://api.anthropic.com:8443/v1/messages", "other_origin"],
    ["https://api.anthropic.com.models.example/v1/messages", "other_origin"],
    ["http://api.anthropic.com/v1/messages", "not_https"],
    ["wss://api.anthropic.com/v1/messages", "not_https"],
    ["file:///etc/hosts", "not_https"],
    ["data:text/plain,hello", "not_https"],
    ["https://user:secret@api.anthropic.com/v1/messages", "userinfo"],
    ["https://user@api.anthropic.com/v1/messages", "userinfo"],
    ["/v1/messages", "invalid_url"],
    ["not a url", "invalid_url"],
  ] as const)("refuses %s before it leaves (%s)", async (url, reason) => {
    const { egress, sent } = runtime();
    const send = egress.turnFetch(ANTHROPIC, new AbortController().signal);
    for (const input of [url, ...(URL.canParse(url) ? [new URL(url), new Request(url)] : [])]) {
      await expect(send(input)).rejects.toMatchObject({ name: "EgressDeniedError", reason });
    }
    expect(sent).toEqual([]);
    expect(new Set(lines)).toEqual(new Set([refused("fetch", reason)]));
  });

  test("refuses the redirect the runtime reports and keeps Bun's error as the cause", async () => {
    const redirect = Object.assign(new TypeError(`UnexpectedRedirect fetching "${MESSAGES}"`), {
      code: "UnexpectedRedirect",
    });
    const { egress } = runtime(() => Promise.reject(redirect));
    const call = egress.turnFetch(ANTHROPIC, new AbortController().signal)(MESSAGES);
    await expect(call).rejects.toMatchObject({ name: "EgressDeniedError", reason: "redirect" });
    await expect(call.catch((error: Error) => error.cause)).resolves.toBe(redirect);
    expect(lines).toEqual([refused("fetch", "redirect")]);
  });

  test("passes any other failure through and logs its type and code, never its message", async () => {
    const failure = Object.assign(new TypeError(`Unable to connect to ${MESSAGES}`), {
      code: "ConnectionRefused",
    });
    const { egress } = runtime(() => Promise.reject(failure));
    await expect(egress.turnFetch(ANTHROPIC, new AbortController().signal)(MESSAGES)).rejects.toBe(
      failure,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^error \[core:egress:fetch\] failure error_type=TypeError code=ConnectionRefused ms=\d+\n$/,
    );
  });

  test("logs start, success and an abandoned request at info", async () => {
    vi.stubEnv("LOG_LEVEL", "info");
    const { egress } = runtime(
      ({ init }) =>
        new Promise((resolve, reject) => {
          if (init!.method === "GET") resolve(new Response("ok", { status: 200 }));
          init!.signal!.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );
    const turn = new AbortController();
    const send = egress.turnFetch(ANTHROPIC, turn.signal);
    await send("https://api.anthropic.com/v1/models", { method: "GET" });
    const pending = send(MESSAGES, { method: "POST" });
    turn.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(lines.map((line) => line.replace(/ms=\d+/, "ms=N"))).toEqual([
      "info [core:egress:fetch] start\n",
      "info [core:egress:fetch] success status=200 ms=N\n",
      "info [core:egress:fetch] start\n",
      "info [core:egress:fetch] abandoned ms=N\n",
    ]);
  });

  test("refuses preconnect", () => {
    const { egress, sent } = runtime();
    const send = egress.turnFetch(ANTHROPIC, new AbortController().signal);
    expect(() => send.preconnect("https://api.anthropic.com")).toThrow(EgressDeniedError);
    expect(sent).toEqual([]);
    expect(lines).toEqual([refused("fetch", "preconnect")]);
  });
});

describe("a base URL", () => {
  test.each([
    ["https://api.anthropic.com/v1", "https://api.anthropic.com"],
    [
      "https://generativelanguage.googleapis.com/v1beta",
      "https://generativelanguage.googleapis.com",
    ],
    ["https://models.example:8443/openai/v1/", "https://models.example:8443"],
    ["https://models.example:443/v1", "https://models.example"],
    ["HTTPS://Models.Example/v1", "https://models.example"],
    ["https://models.example", "https://models.example"],
  ])("%s allows %s", (baseURL, origin) => {
    expect(allowedOrigin(baseURL)).toBe(origin);
    expect(lines).toEqual([]);
  });

  test.each([
    ["http://localhost:11434/v1", "not_https"],
    ["http://127.0.0.1:1234/v1", "not_https"],
    ["ftp://models.example/v1", "not_https"],
    ["https://key:secret@models.example/v1", "userinfo"],
    ["https://models.example/v1?api-version=1", "query"],
    ["https://models.example/v1?", "query"],
    ["https://models.example/v1#models", "fragment"],
    ["https://models.example/v1#", "fragment"],
    ["models.example/v1", "invalid_url"],
    ["", "invalid_url"],
  ] as const)("%s is refused (%s)", (baseURL, reason) => {
    expect(() => allowedOrigin(baseURL)).toThrow(
      expect.objectContaining({ name: "EgressDeniedError", reason }),
    );
    expect(lines).toEqual([refused("base-url", reason)]);
  });

  test("its origin admits every path there and nothing on another port", async () => {
    const { egress, sent } = runtime();
    const send = egress.turnFetch(
      allowedOrigin("https://models.example:8443/openai/v1"),
      new AbortController().signal,
    );
    await send("https://models.example:8443/openai/v1/chat/completions", { method: "POST" });
    await send("https://models.example:8443/other");
    await expect(send("https://models.example/openai/v1/chat/completions")).rejects.toMatchObject({
      reason: "other_origin",
    });
    expect(sent.map((entry) => entry.input)).toEqual([
      "https://models.example:8443/openai/v1/chat/completions",
      "https://models.example:8443/other",
    ]);
  });
});

describe(`Bun ${Bun.version}'s certificate authorities`, () => {
  // A provider's certificate is valid when this store holds its root (ADR-0012 위험 9, contract
  // §7.1). Each child runs in / without this process's environment, as the app starts the core.
  // Where the system store holds nothing beyond the bundled roots, both halves pass trivially.
  const STORES = ["default", "bundled", "system", "extra"] as const;
  const SCRIPT = `const tls = require("node:tls");
console.log(JSON.stringify({ bun: Bun.version, ...Object.fromEntries(${JSON.stringify(STORES)}.map((store) => [store, tls.getCACertificates(store)])) }));`;

  function stores(
    flags: string[],
    env: Record<string, string> = {},
  ): Record<(typeof STORES)[number], string[]> & { bun: string } {
    const child = Bun.spawnSync({
      cmd: [process.execPath, ...flags, "-e", SCRIPT],
      cwd: "/",
      env: { HOME: "/var/empty", PATH: "/usr/bin:/bin", ...env },
    });
    expect(child.stderr.toString()).toBe("");
    return JSON.parse(child.stdout.toString());
  }

  test("are its bundled ones, never the system's unless --use-system-ca or NODE_USE_SYSTEM_CA asks", () => {
    const plain = stores([]);
    expect(plain.bun).toBe(Bun.version);
    expect(plain.extra).toEqual([]);
    expect(new Set(plain.default)).toEqual(new Set(plain.bundled));
    for (const system of [stores(["--use-system-ca"]), stores([], { NODE_USE_SYSTEM_CA: "1" })]) {
      expect(new Set(system.default)).toEqual(new Set([...system.bundled, ...system.system]));
    }
  });
});
