import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { allowedOrigin, installEgress } from "../src/chat/egress.ts";
import { ChatFailure } from "../src/chat/errors.ts";
import { listModels, type ModelSource } from "../src/chat/models.ts";
import { chatLimits } from "../src/chat/protocol.ts";
import { ANTHROPIC_VERSION } from "../src/chat/providers.ts";

// app-connection-v1 §7.11 and ADR-0012 "비용과 모델 선택" without a socket: the list request of
// each provider as it leaves the egress, and how the core reads the pages that come back. The
// runtime fetch behind the egress is a fake that records what reaches it.
interface Sent {
  url: string;
  headers: Record<string, string>;
  redirect: unknown;
}

const KEY = "sk-sherpa-test-key";

function provider(answer: (url: URL, call: number) => Response | Promise<Response>) {
  const sent: Sent[] = [];
  const fetch = Object.assign(
    async (input: string | URL | Request, init?: BunFetchRequestInit) => {
      // The egress hands on the URL it checked, as a string.
      if (typeof input !== "string") throw new TypeError("expected the checked URL");
      const url = input;
      sent.push({
        url,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        redirect: init?.redirect,
      });
      return answer(new URL(url), sent.length);
    },
    { preconnect: () => {} },
  );
  const egress = installEgress({ fetch });
  const list = (source: ModelSource) =>
    listModels(source, egress.turnFetch(allowedOrigin(source.base), new AbortController().signal));
  return { sent, list };
}

const anthropic: ModelSource = {
  provider: "anthropic",
  base: "https://api.anthropic.com/v1",
  apiKey: KEY,
};
const openai: ModelSource = { provider: "openai", base: "https://api.openai.com/v1", apiKey: KEY };
const google: ModelSource = {
  provider: "google",
  base: "https://generativelanguage.googleapis.com/v1beta",
  apiKey: KEY,
};
const compatible = (apiKey?: string): ModelSource => ({
  provider: "openai-compatible",
  base: "https://models.example/v1",
  apiKey,
});

let lines: string[];
beforeEach(() => {
  lines = [];
  vi.stubEnv("LOG_LEVEL", "debug");
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const failure = (code: string, status: number | null = null) =>
  expect.objectContaining({ name: "ChatFailure", code, status });

describe("each provider's list request", () => {
  test("Anthropic: x-api-key and the 2026-10-21 version, after_id pages on, active models only", async () => {
    const { sent, list } = provider((url) =>
      url.searchParams.has("after_id")
        ? Response.json({
            data: [
              { id: "claude-d", lifecycle: "retired" },
              { id: "claude-e", lifecycle: "active" },
            ],
            has_more: false,
            first_id: "claude-d",
            last_id: "claude-e",
          })
        : Response.json({
            data: [
              { type: "model", id: "claude-a", lifecycle: "active" },
              { type: "model", id: "claude-b", lifecycle: "deprecated" },
              { type: "model", id: "claude-c" },
            ],
            has_more: true,
            first_id: "claude-a",
            last_id: "claude-c",
          }),
    );
    expect(await list(anthropic)).toEqual({
      models: ["claude-a", "claude-c", "claude-e"],
      truncated: false,
      pages: 2,
      skipped: 0,
    });
    expect(sent.map(({ url }) => url)).toEqual([
      "https://api.anthropic.com/v1/models?limit=1000",
      "https://api.anthropic.com/v1/models?limit=1000&after_id=claude-c",
    ]);
    for (const request of sent) {
      expect(request.headers).toEqual({ "x-api-key": KEY, "anthropic-version": ANTHROPIC_VERSION });
      expect(request.redirect).toBe("error");
    }
    expect(ANTHROPIC_VERSION).toBe("2026-10-21");
  });

  test("OpenAI: a bearer key, one page, and every model kept as the provider lists it", async () => {
    const ids = ["gpt-5.5", "text-embedding-3-small", "dall-e-3"];
    const { sent, list } = provider(() =>
      Response.json({
        object: "list",
        data: ids.map((id) => ({ id, object: "model", owned_by: "openai" })),
      }),
    );
    expect(await list(openai)).toEqual({ models: ids, truncated: false, pages: 1, skipped: 0 });
    expect(sent).toEqual([
      {
        url: "https://api.openai.com/v1/models",
        headers: { authorization: `Bearer ${KEY}` },
        redirect: "error",
      },
    ]);
  });

  test("Google: x-goog-api-key and never ?key=, pageToken pages on, and models/ comes off each name", async () => {
    const { sent, list } = provider((url) =>
      url.searchParams.get("pageToken") === "p2"
        ? Response.json({ models: [{ name: "models/gemini-c" }], nextPageToken: "" })
        : Response.json({
            models: [
              { name: "models/gemini-a", displayName: "A" },
              { name: "tunedModels/mine" },
              { name: "models/gemini-b" },
            ],
            nextPageToken: "p2",
          }),
    );
    expect(await list(google)).toEqual({
      models: ["gemini-a", "gemini-b", "gemini-c"],
      truncated: false,
      pages: 2,
      skipped: 1,
    });
    expect(sent.map(({ url }) => url)).toEqual([
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&pageToken=p2",
    ]);
    for (const request of sent) {
      expect(request.headers).toEqual({ "x-goog-api-key": KEY });
      expect(new URL(request.url).searchParams.has("key")).toBe(false);
    }
  });

  test("Google: an answer without models is an empty list", async () => {
    const { list } = provider(() => Response.json({}));
    expect(await list(google)).toEqual({ models: [], truncated: false, pages: 1, skipped: 0 });
  });

  test.each([
    ["with a key", KEY, { authorization: `Bearer ${KEY}` }],
    ["without a key", undefined, {}],
  ])("OpenAI-compatible %s: /models under the base URL", async (_name, apiKey, headers) => {
    const { sent, list } = provider(() => Response.json({ data: [{ id: "local/model-1" }] }));
    expect((await list(compatible(apiKey))).models).toEqual(["local/model-1"]);
    expect(sent).toEqual([{ url: "https://models.example/v1/models", headers, redirect: "error" }]);
  });
});

describe("the ids of a list", () => {
  test("an id the app could not show or send back is left out and counted; a repeat is kept once", async () => {
    const longest = "m".repeat(chatLimits.modelIdBytes);
    const { list } = provider(() =>
      Response.json({
        data: [
          { id: "ok-1" },
          { id: "" },
          { id: `${longest}x` },
          { id: "tab\there" },
          { id: "lone\ud800" },
          { id: 7 },
          {},
          { id: "ok-1" },
          { id: longest },
          { id: "모델/한글 이름" },
        ],
      }),
    );
    expect(await list(openai)).toEqual({
      models: ["ok-1", longest, "모델/한글 이름"],
      truncated: false,
      pages: 1,
      skipped: 6,
    });
  });

  test("the list stops at 1,000 ids and says it was cut", async () => {
    const ids = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ id: `m-${index}` }));
    const exact = provider(() => Response.json({ data: ids(chatLimits.models) }));
    expect(await exact.list(openai)).toMatchObject({ truncated: false });
    const over = provider(() => Response.json({ data: ids(chatLimits.models + 1) }));
    const cut = await over.list(openai);
    expect(cut.models).toHaveLength(chatLimits.models);
    expect(cut.truncated).toBe(true);
  });

  test("the list stops after ten requests and says it was cut", async () => {
    const { sent, list } = provider((_url, call) =>
      Response.json({
        data: [{ id: `m-${call}`, lifecycle: "active" }],
        has_more: true,
        last_id: `m-${call}`,
      }),
    );
    const cut = await list(anthropic);
    expect(sent).toHaveLength(chatLimits.pages);
    expect(cut).toMatchObject({ truncated: true, pages: chatLimits.pages });
    expect(cut.models).toHaveLength(chatLimits.pages);
  });
});

describe("a list that fails", () => {
  test.each([
    [401, "provider_auth"],
    [403, "provider_auth"],
    [429, "provider_rate_limited"],
    [408, "provider_unavailable"],
    [409, "provider_unavailable"],
    [500, "provider_unavailable"],
    [503, "provider_unavailable"],
    [529, "provider_unavailable"],
    [400, "provider_rejected"],
    [404, "provider_rejected"],
    [422, "provider_rejected"],
  ])("HTTP %i is %s with its status", async (status, code) => {
    const { list } = provider(() => Response.json({ error: { message: "no" } }, { status }));
    await expect(list(compatible(KEY))).rejects.toEqual(failure(code, status));
  });

  test("a body over 4 MiB is refused unread when its length says so, and cut off when it does not", async () => {
    const declared = provider(
      () =>
        new Response('{"data":[]}', {
          headers: { "content-length": String(chatLimits.responseBytes + 1) },
        }),
    );
    await expect(declared.list(openai)).rejects.toEqual(failure("provider_invalid_response", 200));
    let pulled = 0;
    const endless = provider(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              pulled++;
              controller.enqueue(new Uint8Array(1024 * 1024).fill(0x20));
            },
          }),
        ),
    );
    await expect(endless.list(openai)).rejects.toEqual(failure("provider_invalid_response", 200));
    expect(pulled).toBeLessThan(10);
  });

  test("an encoded body is weighed by what it decodes to, not by its declared length", async () => {
    const { list } = provider(
      () =>
        new Response(JSON.stringify({ data: [{ id: "m-1" }] }), {
          headers: {
            "content-encoding": "gzip",
            "content-length": String(chatLimits.responseBytes + 1),
          },
        }),
    );
    expect((await list(openai)).models).toEqual(["m-1"]);
  });

  test("a body of exactly 4 MiB is read", async () => {
    const json = JSON.stringify({ data: [{ id: "m-1" }] });
    const body = json + " ".repeat(chatLimits.responseBytes - json.length);
    const { list } = provider(() => new Response(body));
    expect((await list(openai)).models).toEqual(["m-1"]);
  });

  test.each([
    ["not JSON", "<html>nope</html>"],
    ["not UTF-8", new Uint8Array([0x7b, 0xff, 0x7d])],
    ["another shape", JSON.stringify({ models: ["m-1"] })],
    ["a list entry that is not an object", JSON.stringify({ data: ["m-1"] })],
    ["empty", ""],
  ])("a 2xx body that is %s is provider_invalid_response", async (_name, body) => {
    const { list } = provider(() => new Response(body));
    await expect(list(openai)).rejects.toEqual(failure("provider_invalid_response", 200));
  });

  test("Anthropic saying there is more without a cursor is provider_invalid_response", async () => {
    const { list } = provider(() => Response.json({ data: [], has_more: true, last_id: null }));
    await expect(list(anthropic)).rejects.toEqual(failure("provider_invalid_response", 200));
  });

  const rejection = (code: string) => Object.assign(new TypeError("fetch failed"), { code });

  test.each([
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "CERT_HAS_EXPIRED",
    "HOSTNAME_MISMATCH",
    "ERR_TLS_CERT_ALTNAME_INVALID",
  ])("a certificate Bun does not trust (%s) is provider_certificate", async (code) => {
    const { list } = provider(() => Promise.reject(rejection(code)));
    await expect(list(openai)).rejects.toEqual(failure("provider_certificate"));
  });

  test.each(["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "ConnectionClosed"])(
    "a connection that fails (%s) is network",
    async (code) => {
      const { list } = provider(() => Promise.reject(rejection(code)));
      await expect(list(openai)).rejects.toEqual(failure("network"));
    },
  );

  test("a body that breaks off is network", async () => {
    const { list } = provider(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"data":['));
              controller.error(rejection("ECONNRESET"));
            },
          }),
        ),
    );
    await expect(list(openai)).rejects.toEqual(failure("network"));
  });

  test("a redirect the egress refuses is egress_denied", async () => {
    const { list } = provider(() =>
      Promise.reject(Object.assign(new TypeError("redirect"), { code: "UnexpectedRedirect" })),
    );
    await expect(list(openai)).rejects.toEqual(failure("egress_denied"));
  });

  test("no line names the key or a URL, at debug either", async () => {
    const { list } = provider(() => Response.json({ data: [{ id: "m-1" }] }, { status: 401 }));
    await expect(list(compatible(KEY))).rejects.toBeInstanceOf(ChatFailure);
    expect(lines.join("")).not.toContain(KEY);
    expect(lines.join("")).not.toContain("models.example");
  });
});
