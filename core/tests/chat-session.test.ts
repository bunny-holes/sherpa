import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { type Fetch, installEgress } from "../src/chat/egress.ts";
import { chatLimits } from "../src/chat/protocol.ts";
import { type ChatOptions, ChatSessions } from "../src/chat/session.ts";
import { FakeChannel } from "./support/chat.ts";
import { tick } from "./support/pipes.ts";

// app-connection-v1 §7.11 on a channel of its own: what a chat channel reads, what it answers,
// its limits, and how it ends. The runtime fetch behind the egress is a fake that records what
// reaches it and answers as a provider would.
const KEY = "sk-sherpa-session-key";

interface Reached {
  url: string;
  headers: Record<string, string>;
  signal: AbortSignal | null | undefined;
}

function chats(
  answer: (reached: Reached) => Response | Promise<Response> = () =>
    Response.json({ data: [{ id: "m-1" }] }),
  options: ChatOptions = {},
) {
  const reached: Reached[] = [];
  const fetch: Fetch = Object.assign(
    async (input: string | URL | Request, init?: BunFetchRequestInit) => {
      // The egress hands on the URL it checked, as a string.
      if (typeof input !== "string") throw new TypeError("expected the checked URL");
      const request = {
        url: input,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        signal: init?.signal,
      };
      reached.push(request);
      return answer(request);
    },
    { preconnect: () => {} },
  );
  const sessions = new ChatSessions(installEgress({ fetch }), async () => [], options);
  const open = (id: number) => {
    const channel = new FakeChannel(id);
    sessions.serve(channel);
    return channel;
  };
  return { reached, open };
}

/** A fetch that answers only when the test says, or ends when its request's signal aborts. */
function held() {
  let release: (response: Response) => void = () => {};
  const answer = (reached: Reached) =>
    new Promise<Response>((resolve, reject) => {
      release = resolve;
      reached.signal?.addEventListener("abort", () => reject(reached.signal?.reason), {
        once: true,
      });
    });
  return { answer, release: (response: Response) => release(response) };
}

const error = (
  inReplyTo: string | null,
  code: string,
  retryable = false,
  status: number | null = null,
) => ({
  type: "error",
  in_reply_to: inReplyTo,
  code,
  retryable,
  status,
});

const compatible = (base_url: string, extra: Record<string, unknown> = {}) => ({
  type: "list_models",
  provider: "openai-compatible",
  base_url,
  ...extra,
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

describe("list_models", () => {
  test("answers models from the chosen origin, and the key goes only into its request's header", async () => {
    const { reached, open } = chats();
    const channel = open(1);
    channel.write(compatible("https://models.example/v1/", { api_key: KEY }));
    expect(await channel.next()).toEqual({ type: "models", models: ["m-1"], truncated: false });
    expect(reached.map(({ url, headers }) => [url, headers])).toEqual([
      ["https://models.example/v1/models", { authorization: `Bearer ${KEY}` }],
    ]);
    expect(lines).toContain(
      "info [core:chat:list-models] start channel=1 provider=openai-compatible\n",
    );
    expect(
      lines.some((line) =>
        line.startsWith(
          "info [core:chat:list-models] success channel=1 provider=openai-compatible models=1 pages=1 skipped=0 truncated=false ms=",
        ),
      ),
    ).toBe(true);
    // Neither the key nor the person's host is in a log line or another frame, at debug either.
    expect(lines.join("")).not.toContain(KEY);
    expect(lines.join("")).not.toContain("models.example");
    expect(JSON.stringify(channel.sent)).not.toContain(KEY);
  });

  test.each([
    ["anthropic", "https://api.anthropic.com/v1/models?limit=1000"],
    ["openai", "https://api.openai.com/v1/models"],
    ["google", "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000"],
  ])("%s goes to the origin Sherpa fixes", async (provider, url) => {
    const { reached, open } = chats(() =>
      Response.json({ data: [], has_more: false, last_id: null, models: [] }),
    );
    const channel = open(1);
    channel.write({ type: "list_models", provider, api_key: KEY });
    expect(await channel.next()).toEqual({ type: "models", models: [], truncated: false });
    expect(reached.map((request) => request.url)).toEqual([url]);
  });

  test("an HTTPS loopback origin is not refused by its name (owner, 2026-11-22)", async () => {
    const { reached, open } = chats();
    const channel = open(1);
    channel.write(compatible("https://localhost:8443/v1"));
    expect(await channel.next()).toEqual({ type: "models", models: ["m-1"], truncated: false });
    expect(reached.map(({ url, headers }) => [url, headers])).toEqual([
      ["https://localhost:8443/v1/models", {}],
    ]);
  });

  test.each([
    ["plain HTTP on the loopback", "http://127.0.0.1:8080/v1", "not_https"],
    ["plain HTTP on a name", "http://localhost/v1", "not_https"],
    ["userinfo", "https://user:secret@models.example/v1", "userinfo"],
    ["a query", "https://models.example/v1?key=x", "query"],
    ["a fragment", "https://models.example/v1#x", "fragment"],
    ["no URL at all", "models.example/v1", "invalid_url"],
  ])(
    "a base URL with %s ends with egress_denied before anything leaves",
    async (_name, base, reason) => {
      const { reached, open } = chats();
      const channel = open(1);
      channel.write(compatible(base, { api_key: KEY }));
      expect(await channel.next()).toEqual(error("list_models", "egress_denied"));
      expect(reached).toEqual([]);
      expect(lines).toContain(`warn [core:egress:base-url] refused reason=${reason}\n`);
      expect(
        lines.some((line) =>
          line.startsWith(
            "warn [core:chat:list-models] failure channel=1 provider=openai-compatible code=egress_denied status=none ms=",
          ),
        ),
      ).toBe(true);
    },
  );

  test("a provider's refusal carries its HTTP status, and whether trying again may help", async () => {
    const { open } = chats(() => Response.json({}, { status: 429 }));
    const channel = open(1);
    channel.write({ type: "list_models", provider: "openai", api_key: KEY });
    expect(await channel.next()).toEqual(error("list_models", "provider_rate_limited", true, 429));
    channel.write({ type: "list_models", provider: "openai", api_key: KEY });
    expect(await channel.next()).toMatchObject({ code: "provider_rate_limited" });
  });

  test("a second list_models while one runs is busy, and the first still answers", async () => {
    const provider = held();
    const { reached, open } = chats(provider.answer);
    const channel = open(1);
    channel.write({ type: "list_models", provider: "openai", api_key: KEY });
    await tick();
    channel.write({ type: "list_models", provider: "anthropic", api_key: KEY });
    expect(await channel.next()).toEqual(error("list_models", "busy"));
    provider.release(Response.json({ data: [{ id: "m-1" }] }));
    expect(await channel.next()).toEqual({ type: "models", models: ["m-1"], truncated: false });
    expect(reached).toHaveLength(1);
    expect(lines).toContain("warn [core:chat:list-models] refused channel=1 reason=busy\n");
    // Once answered, the channel takes the next one.
    channel.write({ type: "list_models", provider: "openai", api_key: KEY });
    await tick();
    provider.release(Response.json({ data: [] }));
    expect(await channel.next()).toEqual({ type: "models", models: [], truncated: false });
  });

  test("a list that outlasts its limit ends with timeout and stops its request", async () => {
    const provider = held();
    const { reached, open } = chats(provider.answer, { listMs: 20 });
    const channel = open(1);
    channel.write({ type: "list_models", provider: "openai", api_key: KEY });
    expect(await channel.next()).toEqual(error("list_models", "timeout", true));
    expect(reached[0]?.signal?.aborted).toBe(true);
    expect(chatLimits.listMs).toBe(30_000);
  });

  test("closing the channel stops the list in flight, and nothing is written after", async () => {
    const provider = held();
    const { reached, open } = chats(provider.answer);
    const channel = open(1);
    channel.write({ type: "list_models", provider: "openai", api_key: KEY });
    await tick();
    channel.onclose?.();
    await tick();
    await tick();
    expect(reached[0]?.signal?.aborted).toBe(true);
    expect(channel.sent).toEqual([]);
    expect(
      lines.some((line) =>
        line.startsWith("info [core:chat:list-models] abandoned channel=1 provider=openai ms="),
      ),
    ).toBe(true);
  });
});

describe("a message the channel cannot read", () => {
  test.each([
    ["not UTF-8", new Uint8Array([0x7b, 0xff, 0x7d]), "not_json"],
    ["not JSON", "list_models", "not_json"],
    ["an array", "[]", "unknown_type"],
    ["an object without a type", "{}", "unknown_type"],
    ["a type only the core writes", '{"type":"models","models":[]}', "unknown_type"],
  ])(
    "%s is invalid_message answering nothing, and the channel goes on",
    async (_name, body, reason) => {
      const { open } = chats();
      const channel = open(1);
      if (typeof body === "string") channel.write(body);
      else channel.writeBytes(body);
      expect(await channel.next()).toEqual(error(null, "invalid_message"));
      expect(lines).toContain(
        `warn [core:chat:message] refused channel=1 reason=${reason} bytes=${typeof body === "string" ? Buffer.byteLength(body) : body.byteLength}\n`,
      );
      channel.write({ type: "list_models", provider: "openai", api_key: KEY });
      expect(await channel.next()).toMatchObject({ type: "models" });
      expect(channel.closed).toBeNull();
    },
  );

  const base = "https://models.example/v1";
  test.each([
    [
      "a key it does not know",
      { type: "list_models", provider: "openai", api_key: KEY, model: "m" },
    ],
    ["no key for a provider that needs one", { type: "list_models", provider: "anthropic" }],
    [
      "a base URL for a provider whose origin is fixed",
      { type: "list_models", provider: "openai", api_key: KEY, base_url: base },
    ],
    [
      "no base URL for an OpenAI-compatible server",
      { type: "list_models", provider: "openai-compatible" },
    ],
    ["a provider it does not know", { type: "list_models", provider: "mistral", api_key: KEY }],
    ["an empty key", compatible(base, { api_key: "" })],
    ["a key with a space", compatible(base, { api_key: "sk two" })],
    ["a key with a line break", compatible(base, { api_key: "sk\r\nx-evil: 1" })],
    ["a key that is not ASCII", compatible(base, { api_key: "sk-키" })],
    ["a key over 512 bytes", compatible(base, { api_key: "k".repeat(chatLimits.apiKeyBytes + 1) })],
    ["a null key", compatible(base, { api_key: null })],
    ["a base URL with a control character", compatible("https://models.example/v1\n")],
    [
      "a base URL over 2 KiB",
      compatible(`https://models.example/${"p".repeat(chatLimits.baseURLBytes)}`),
    ],
  ])(
    "list_models with %s is invalid_message answering list_models, and nothing leaves",
    async (_name, message) => {
      const { reached, open } = chats();
      const channel = open(1);
      channel.write(message);
      expect(await channel.next()).toEqual(error("list_models", "invalid_message"));
      expect(reached).toEqual([]);
      expect(lines.join("")).not.toContain(KEY);
    },
  );

  test("the longest key and base URL are read", async () => {
    const { reached, open } = chats();
    const channel = open(1);
    const longest = `https://models.example/${"p".repeat(chatLimits.baseURLBytes - "https://models.example/".length)}`;
    channel.write(compatible(longest, { api_key: "k".repeat(chatLimits.apiKeyBytes) }));
    expect(await channel.next()).toMatchObject({ type: "models" });
    expect(reached).toHaveLength(1);
  });
});

describe("chat channels", () => {
  test("a fifth one is closed with chat_limit, and a channel that ended frees its place", async () => {
    const { open } = chats();
    const four = [1, 2, 3, 4].map(open);
    const fifth = open(5);
    expect(four.map((channel) => channel.closed)).toEqual([null, null, null, null]);
    expect(fifth.closed).toBe("chat_limit");
    expect(fifth.onmessage).toBeUndefined();
    expect(lines).toContain("warn [core:chat:open] refused channel=5 reason=chat_limit chats=4\n");
    four[0]!.onclose?.();
    const sixth = open(6);
    expect(sixth.closed).toBeNull();
    sixth.write({ type: "list_models", provider: "openai", api_key: KEY });
    expect(await sixth.next()).toMatchObject({ type: "models" });
  });

  test("each channel answers its own messages", async () => {
    const { open } = chats();
    const [first, second] = [open(1), open(2)];
    first.write("{}");
    second.write({ type: "list_models", provider: "openai", api_key: KEY });
    expect(await first.next()).toEqual(error(null, "invalid_message"));
    expect(await second.next()).toMatchObject({ type: "models" });
    expect(first.sent).toHaveLength(1);
    expect(second.sent).toHaveLength(1);
  });
});
