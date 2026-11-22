import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { type Fetch, installEgress } from "../src/chat/egress.ts";
import { INSTRUCTIONS } from "../src/chat/instructions.ts";
import { timeNote } from "../src/chat/now.ts";
import { chatLimits } from "../src/chat/protocol.ts";
import { type ChatOptions, ChatSessions } from "../src/chat/session.ts";
import { installWarningLog } from "../src/chat/warnings.ts";
import { FakeChannel, openStream, type ServerEvent, sse } from "./support/chat.ts";
import { anthropic, chat, chunk, failure, google, openai } from "./support/provider-events.ts";

// app-connection-v1 §7.11 and ADR-0012 "스트리밍", "중단", "재시도": a turn through the AI SDK
// 7.0.179 and the four providers, against a runtime fetch that answers with hand-written
// server-sent events. Nothing leaves the process: the global fetch refuses, as in the core.
installEgress();
installWarningLog();

const KEY = "sk-sherpa-turn-key";
const TEXT = "내일 일정 알려줘";
const BASE = "https://models.example/v1";
/** The time every turn's text is sent at, in this zone, and what the model reads before the text. */
const AT = new Date("2026-11-22T12:56:31Z");
const ZONE = "Asia/Seoul";
const said = (text: string) => `${timeNote(AT, ZONE)}\n\n${text}`;

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
  signal: AbortSignal | null | undefined;
}

/** Most tests read a whole answer as one `delta`: it goes when the turn ends, under 4 KiB. */
const WHOLE: ChatOptions = { turn: { deltaMs: 60_000 } };

/** Chat channels whose provider requests reach `answer`, the nth of them numbered from 1. */
function turns(
  answer: (sent: Sent, n: number) => Response | Promise<Response>,
  options: ChatOptions = WHOLE,
) {
  const sent: Sent[] = [];
  const fetch: Fetch = Object.assign(
    async (input: string | URL | Request, init?: BunFetchRequestInit) => {
      if (typeof input !== "string") throw new TypeError("expected the checked URL");
      const request: Sent = {
        url: input,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: typeof init?.body === "string" ? (JSON.parse(init.body) as Sent["body"]) : null,
        signal: init?.signal,
      };
      sent.push(request);
      return answer(request, sent.length);
    },
    { preconnect: () => {} },
  );
  // These turns carry no tools; tests/chat-tools.test.ts gives a chat the core's.
  const sessions = new ChatSessions(installEgress({ fetch }), async () => [], {
    clock: () => AT,
    timeZone: () => ZONE,
    ...options,
  });
  const open = (id = 1) => {
    const channel = new FakeChannel(id);
    sessions.serve(channel);
    return channel;
  };
  return { sent, open };
}

const turn = (provider: string, model: string, extra: Record<string, unknown> = {}) => ({
  type: "turn",
  provider,
  model,
  api_key: KEY,
  text: TEXT,
  ...extra,
});
const compatible = (extra: Record<string, unknown> = {}) =>
  turn("openai-compatible", "m-1", { base_url: BASE, ...extra });

/** The error OpenAI streams when its server fails before any output. */
const serverError: ServerEvent = {
  data: {
    type: "error",
    code: "server_error",
    message: "The server had an error.",
    param: null,
    sequence_number: 1,
  },
};

const done = (reason = "stop", input: number | null = 11, output: number | null = 3) => ({
  type: "done",
  reason,
  input_tokens: input,
  output_tokens: output,
});
const error = (code: string, retryable = false, status: number | null = null) => ({
  type: "error",
  in_reply_to: "turn",
  code,
  retryable,
  status,
});

/** What Bun's fetch throws when a connection fails (Bun 1.4.5). */
const refused = () =>
  Object.assign(
    new TypeError("ECONNREFUSED: Unable to connect. Is the computer able to access the url?"),
    {
      code: "ECONNREFUSED",
    },
  );

let lines: string[];
beforeEach(() => {
  lines = [];
  vi.stubEnv("LOG_LEVEL", "debug");
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
});
const isWarning = (line: string) => line.includes("[core:chat:sdk-warning]");

/** The AI SDK's warnings so far, which the test takes as it expects them. */
function takeWarnings(): string[] {
  const warnings = lines.filter(isWarning);
  lines = lines.filter((line) => !isWarning(line));
  return warnings;
}

afterEach(() => {
  const warnings = takeWarnings();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  // No test meets a warning it does not expect: a deprecated name, a setting the core sent that
  // did not take, or one the SDK changed (ADR-0012 "제공자 면"). The model ids are ones the
  // providers' packages know, so a warning names a defect rather than an id.
  expect(warnings).toEqual([]);
});

const logged = (start: string) => lines.some((line) => line.startsWith(start));

describe("a turn on each provider", () => {
  test.each([
    {
      name: "anthropic",
      message: turn("anthropic", "claude-sonnet-5-5"),
      url: "https://api.anthropic.com/v1/messages",
      header: ["x-api-key", KEY],
      events: anthropic,
    },
    {
      name: "openai",
      message: turn("openai", "gpt-5.1"),
      url: "https://api.openai.com/v1/responses",
      header: ["authorization", `Bearer ${KEY}`],
      events: openai,
    },
    {
      name: "google",
      message: turn("google", "gemini-3.5-flash"),
      url: "https://generativelanguage.googleapis.com/v1beta/interactions",
      header: ["x-goog-api-key", KEY],
      events: google,
    },
    {
      name: "openai-compatible",
      message: compatible(),
      url: `${BASE}/chat/completions`,
      header: ["authorization", `Bearer ${KEY}`],
      events: chat,
    },
  ])(
    "$name streams the answer as delta, ends with done and its token counts, and keeps the key in one header",
    async ({ name, message, url, header, events }) => {
      const { sent, open } = turns(() => sse(events(["Hel", "lo"])));
      const channel = open();
      channel.write(message);
      expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "Hello" }, done()]);
      expect(sent.map((request) => request.url)).toEqual([url]);
      expect(sent[0]!.headers[header[0]!]).toBe(header[1]);
      // The key is in that header only: not in the body, a log line or a frame, at debug either.
      expect(JSON.stringify(sent[0]!.body)).not.toContain(KEY);
      const log = lines.join("");
      expect(log).not.toContain(KEY);
      expect(JSON.stringify(channel.sent)).not.toContain(KEY);
      // Neither the person's text nor the answer is in the log.
      expect(log).not.toContain(TEXT);
      expect(log).not.toContain("Hello");
      expect(lines).toContain(`info [core:chat:turn] start channel=1 provider=${name}\n`);
      expect(
        logged(
          `info [core:chat:turn] success channel=1 provider=${name} reason=stop steps=1 input_tokens=11 output_tokens=3 ms=`,
        ),
      ).toBe(true);
    },
  );

  test("anthropic names API version 2026-10-21, caches the instructions and the conversation, and sends no sampling setting", async () => {
    const { sent, open } = turns(() => sse(anthropic(["Hi"])));
    const channel = open();
    channel.write(turn("anthropic", "claude-sonnet-5-5"));
    await channel.untilEnd();
    expect(sent[0]!.headers["anthropic-version"]).toBe("2026-10-21");
    const body = sent[0]!.body!;
    expect(body.system).toEqual([
      { type: "text", text: INSTRUCTIONS, cache_control: { type: "ephemeral" } },
    ]);
    // Automatic caching: a breakpoint at the request's top that moves to its last block, both with
    // the default 5 minutes (ADR-0012 "비용과 모델 선택").
    expect(body.cache_control).toEqual({ type: "ephemeral" });
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: said(TEXT) }] },
    ]);
    for (const setting of ["temperature", "top_p", "top_k"])
      expect(body).not.toHaveProperty(setting);
    // Nor any thinking: today's Claude thinks by its own default, its thinking omitted from the
    // stream (contract §7.11).
    expect(body).not.toHaveProperty("thinking");
    // The core sets no output limit: the package sends the most its model takes (4.0.107).
    expect(body.max_tokens).toBe(128_000);
  });

  test("openai stores nothing, and the SDK adds the old include value for a reasoning model only (owner, 2026-11-22)", async () => {
    const { sent, open } = turns(() => sse(openai(["Hi"])));
    const reasoning = open(1);
    reasoning.write(turn("openai", "gpt-5.1"));
    await reasoning.untilEnd();
    const plain = open(2);
    plain.write(turn("openai", "gpt-4.1"));
    await plain.untilEnd();
    expect(sent.map(({ body }) => [body!.store, body!.include])).toEqual([
      [false, ["reasoning.encrypted_content"]],
      [false, undefined],
    ]);
    // A reasoning model takes the instructions as a developer message (`@ai-sdk/openai` 4.0.122).
    expect(sent.map(({ body }) => (body!.input as unknown[])[0])).toEqual([
      { role: "developer", content: INSTRUCTIONS },
      { role: "system", content: INSTRUCTIONS },
    ]);
    expect((sent[0]!.body!.input as unknown[])[1]).toEqual({
      role: "user",
      content: [{ type: "input_text", text: said(TEXT) }],
    });
  });

  test("google uses the Interactions API, stores nothing and takes the instructions as its system instruction", async () => {
    const { sent, open } = turns(() => sse(google(["Hi"])));
    const channel = open();
    channel.write(turn("google", "gemini-3.5-flash"));
    await channel.untilEnd();
    expect(sent[0]!.body).toMatchObject({
      model: "gemini-3.5-flash",
      store: false,
      stream: true,
      system_instruction: INSTRUCTIONS,
    });
  });

  test("an OpenAI-compatible server is asked for token counts, and gets no key when the turn has none", async () => {
    const { sent, open } = turns(() => sse(chat(["Hi"])));
    const channel = open();
    channel.write(compatible({ api_key: undefined, base_url: `${BASE}/` }));
    expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "Hi" }, done()]);
    expect(sent[0]!.url).toBe(`${BASE}/chat/completions`);
    expect(sent[0]!.headers).not.toHaveProperty("authorization");
    expect(sent[0]!.body).toMatchObject({
      model: "m-1",
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: INSTRUCTIONS },
        { role: "user", content: said(TEXT) },
      ],
    });
    // The person's host is not in the log either (§12).
    expect(lines.join("")).not.toContain("models.example");
  });

  test("a turn that stops at the length limit or on a refusal ends with that reason", async () => {
    const { open } = turns((_sent, n) =>
      sse(anthropic(["Hi"], n === 1 ? "max_tokens" : "refusal")),
    );
    const channel = open();
    channel.write(turn("anthropic", "claude-sonnet-5-5"));
    expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "Hi" }, done("length")]);
    channel.write(turn("anthropic", "claude-sonnet-5-5", { text: "again" }));
    expect(await channel.untilEnd()).toEqual([
      { type: "delta", text: "Hi" },
      done("content-filter"),
    ]);
  });

  // `@ai-sdk/anthropic` 4.0.107 reads a model id it does not know with `claude-` in it as the
  // Claude of today and any other as an old model (`resolveRuntimeDefinition`), and says so.
  test.each([
    ["claude-next-1", 128_000],
    ["sonnet-next", 4_096],
  ])(
    "an Anthropic model the package does not know, %s, gets %i output tokens and a warning, and an answer cut there ends with length",
    async (model, tokens) => {
      const { sent, open } = turns(() => sse(anthropic(["Hi"], "max_tokens")));
      const channel = open();
      channel.write(turn("anthropic", model));
      expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "Hi" }, done("length")]);
      expect(sent[0]!.body!.max_tokens).toBe(tokens);
      expect(takeWarnings()).toEqual([
        "warn [core:chat:sdk-warning] type=compatibility subject=maxOutputTokens provider=anthropic.messages\n",
      ]);
    },
  );
});

describe("the conversation", () => {
  const second = "그리고 모레는?";

  test("the next turn sends the person's text, the answer, then the new text", async () => {
    const { sent, open } = turns(() => sse(chat(["Hello"])));
    const channel = open();
    channel.write(compatible());
    await channel.untilEnd();
    channel.write(compatible({ text: second }));
    await channel.untilEnd();
    expect(sent[1]!.body!.messages).toEqual([
      { role: "system", content: INSTRUCTIONS },
      { role: "user", content: said(TEXT) },
      { role: "assistant", content: "Hello" },
      { role: "user", content: said(second) },
    ]);
  });

  test("a turn that failed or was refused keeps the person's text and no answer", async () => {
    const { sent, open } = turns((_sent, n) =>
      n === 1 ? Response.json({}, { status: 400 }) : sse(chat(["Nope"], "content_filter")),
    );
    const channel = open();
    channel.write(compatible());
    expect(await channel.untilEnd()).toEqual([error("provider_rejected", false, 400)]);
    channel.write(compatible({ text: second }));
    expect(await channel.untilEnd()).toEqual([
      { type: "delta", text: "Nope" },
      done("content-filter"),
    ]);
    channel.write(compatible({ text: "셋째" }));
    await channel.untilEnd();
    expect(sent[2]!.body!.messages).toEqual([
      { role: "system", content: INSTRUCTIONS },
      { role: "user", content: said(TEXT) },
      { role: "user", content: said(second) },
      { role: "user", content: said("셋째") },
    ]);
  });

  test("reasoning stays in the conversation, with its signature, and never reaches the app", async () => {
    const thinking: ServerEvent[] = [
      {
        event: "content_block_start",
        data: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "" },
        },
      },
      {
        event: "content_block_delta",
        data: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "Let me see" },
        },
      },
      {
        event: "content_block_delta",
        data: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "signature_delta", signature: "sig-1" },
        },
      },
      { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
    ];
    const events = anthropic(["Hi"]).map((event) => {
      const data = event.data as { index?: number };
      return data.index === 0 ? { ...event, data: { ...data, index: 1 } } : event;
    });
    const { sent, open } = turns((_sent, n) =>
      sse(n === 1 ? [events[0]!, ...thinking, ...events.slice(1)] : anthropic(["Bye"])),
    );
    const channel = open();
    channel.write(turn("anthropic", "claude-sonnet-5-5"));
    expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "Hi" }, done()]);
    channel.write(turn("anthropic", "claude-sonnet-5-5", { text: second }));
    await channel.untilEnd();
    expect(JSON.stringify(channel.sent)).not.toContain("Let me see");
    expect((sent[1]!.body!.messages as unknown[])[1]).toEqual({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Let me see", signature: "sig-1" },
        { type: "text", text: "Hi" },
      ],
    });
  });

  test("an answer whose stream closes before the provider says it finished ends with network and is not kept", async () => {
    const { sent, open } = turns((_sent, n) =>
      sse(n === 1 ? anthropic(["Hi"]).slice(0, 3) : anthropic(["Bye"])),
    );
    const channel = open();
    channel.write(turn("anthropic", "claude-sonnet-5-5"));
    expect(await channel.untilEnd()).toEqual([
      { type: "delta", text: "Hi" },
      error("network", true),
    ]);
    channel.write(turn("anthropic", "claude-sonnet-5-5", { text: second }));
    await channel.untilEnd();
    // Anthropic takes the two texts in one user block (`@ai-sdk/anthropic` `groupIntoBlocks`).
    expect(sent[1]!.body!.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: said(TEXT) },
          { type: "text", text: said(second) },
        ],
      },
    ]);
  });

  // How an answer that closes early ends follows what its package reports: OpenAI's and Google's
  // say `interrupted`, Anthropic's only after output, and OpenAI-compatible's sends an error that
  // the stream ended without a finish reason (§7.11 "오류").
  const hi = { type: "delta", text: "Hi" };
  test.each([
    {
      provider: "openai",
      model: "gpt-5.1",
      when: "after its output",
      events: openai(["Hi"]).slice(0, 4),
      frames: [hi, error("network", true)],
    },
    {
      provider: "openai",
      model: "gpt-5.1",
      when: "before any output",
      events: openai(["Hi"]).slice(0, 2),
      frames: [error("network", true)],
    },
    {
      provider: "google",
      model: "gemini-3.5-flash",
      when: "after its output",
      events: google(["Hi"]).slice(0, 3),
      frames: [hi, error("network", true)],
    },
    {
      provider: "google",
      model: "gemini-3.5-flash",
      when: "before any output",
      events: google(["Hi"]).slice(0, 1),
      frames: [error("network", true)],
    },
    {
      provider: "openai-compatible",
      model: "m-1",
      when: "after its output",
      events: chat(["Hi"]).slice(0, 1),
      frames: [hi, error("provider_invalid_response")],
    },
    {
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      when: "before any output",
      events: anthropic(["Hi"]).slice(0, 1),
      frames: [error("provider_invalid_response")],
    },
  ])("an answer from $provider that closes $when ends as its package reports it", async (row) => {
    const { sent, open } = turns(() => sse(row.events));
    const channel = open();
    const extra = row.provider === "openai-compatible" ? { base_url: BASE } : {};
    channel.write(turn(row.provider, row.model, extra));
    expect(await channel.untilEnd()).toEqual(row.frames);
    expect(sent).toHaveLength(1);
  });

  test("a turn for another provider, base URL or model is not this chat's, and sends nothing", async () => {
    const { sent, open } = turns(() => sse(chat(["Hello"])));
    const channel = open();
    channel.write(compatible());
    await channel.untilEnd();
    for (const other of [
      compatible({ model: "m-2" }),
      compatible({ base_url: "https://other.example/v1" }),
      turn("openai", "m-1"),
    ]) {
      channel.write(other);
      expect(await channel.next()).toEqual(error("invalid_message"));
    }
    expect(lines).toContain("warn [core:chat:turn] refused channel=1 reason=other_chat\n");
    // The key may change: the app reads it from the keychain for every message.
    channel.write(compatible({ text: second, api_key: "sk-rotated" }));
    await channel.untilEnd();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.headers.authorization).toBe("Bearer sk-rotated");
    expect(sent[1]!.body!.messages).toHaveLength(4);
  });

  test("a conversation past its limit is not sent, and the chat takes no later turn", async () => {
    // Each answer is a mebibyte: the third turn would pass the 2 MiB of the conversation.
    const big = "가".repeat(Math.ceil((1024 * 1024) / 3));
    const { sent, open } = turns(() => sse(chat([big])));
    const channel = open();
    for (const text of ["one", "two"]) {
      channel.write(compatible({ text }));
      const answer = await channel.untilEnd();
      expect(answer.at(-1)).toEqual(done());
      expect(
        answer
          .slice(0, -1)
          .map((delta) => delta.text)
          .join(""),
      ).toBe(big);
      // A delta carries at most 4 KiB, cut between characters.
      expect(
        Math.max(...answer.slice(0, -1).map((delta) => Buffer.byteLength(String(delta.text)))),
      ).toBeLessThanOrEqual(chatLimits.deltaBytes);
    }
    channel.write(compatible({ text: "three" }));
    expect(await channel.next()).toEqual(error("conversation_limit"));
    channel.write(compatible({ text: "4" }));
    expect(await channel.next()).toEqual(error("conversation_limit"));
    expect(sent).toHaveLength(2);
    expect(lines).toContain("warn [core:chat:turn] refused channel=1 reason=conversation_limit\n");
    expect(chatLimits.conversationBytes).toBe(2 * 1024 * 1024);
  });
});

// §7.11 "다시 보내기": a turn without text sends the conversation again as it is, when it ends with
// what a model answers. A test for each row of the contract's table without a tool in it; the rows
// with tools are in tests/chat-tools.test.ts.
describe("a turn without text", () => {
  /** JSON leaves out a key whose value is undefined. */
  const again = (extra: Record<string, unknown> = {}) => compatible({ text: undefined, ...extra });
  /** What a request sends of a conversation that holds the person's text alone. */
  const asked = [
    { role: "system", content: INSTRUCTIONS },
    { role: "user", content: said(TEXT) },
  ];
  const hello = [{ type: "delta", text: "Hello" }, done()];
  const nothing = "warn [core:chat:turn] refused channel=1 reason=nothing_to_retry\n";

  test("in a chat that has taken no turn has nothing to send, and fixes nothing of the chat", async () => {
    const { sent, open } = turns(() => sse(chat(["Hello"])));
    const channel = open();
    channel.write(again({ model: "m-2" }));
    expect(await channel.next()).toEqual(error("invalid_message"));
    expect(lines).toContain(nothing);
    expect(sent).toEqual([]);
    channel.write(compatible());
    expect(await channel.untilEnd()).toEqual(hello);
  });

  test.each([
    ["stop", "stop"],
    ["length", "length"],
    ["other", "eos"],
  ])(
    "after an answer that ends with done %s has nothing to send again, and the chat goes on",
    async (reason, finish) => {
      const { sent, open } = turns((_sent, n) => sse(chat(["Hello"], n === 1 ? finish : "stop")));
      const channel = open();
      channel.write(compatible());
      expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "Hello" }, done(reason)]);
      channel.write(again());
      expect(await channel.next()).toEqual(error("invalid_message"));
      expect(lines).toContain(nothing);
      channel.write(compatible({ text: "그리고?" }));
      expect(await channel.untilEnd()).toEqual(hello);
      expect(sent).toHaveLength(2);
      expect(sent[1]!.body!.messages).toEqual([
        ...asked,
        { role: "assistant", content: "Hello" },
        { role: "user", content: said("그리고?") },
      ]);
    },
  );

  test.each([
    ["stop", "stop"],
    ["length", "length"],
    ["other", "eos"],
  ])(
    "after an answer with nothing in it, done %s, sends the person's text again: the AI SDK keeps no message of it",
    async (reason, finish) => {
      const { sent, open } = turns((_sent, n) => sse(n === 1 ? chat([], finish) : chat(["Hello"])));
      const channel = open();
      channel.write(compatible());
      expect(await channel.untilEnd()).toEqual([done(reason)]);
      channel.write(again());
      expect(await channel.untilEnd()).toEqual(hello);
      expect(sent[1]!.body!.messages).toEqual(asked);
    },
  );

  test("after an answer of reasoning alone has nothing to send again, though the app saw nothing of it", async () => {
    const { sent, open } = turns(() =>
      sse([chunk({ role: "assistant", reasoning_content: "Let me see" }), ...chat([])]),
    );
    const channel = open();
    channel.write(compatible());
    expect(await channel.untilEnd()).toEqual([done()]);
    channel.write(again());
    expect(await channel.next()).toEqual(error("invalid_message"));
    expect(lines).toContain(nothing);
    expect(sent).toHaveLength(1);
  });

  test("after done content-filter sends the person's text again, and nothing of the answer refused", async () => {
    const { sent, open } = turns((_sent, n) =>
      sse(n === 1 ? chat(["Nope"], "content_filter") : chat(["Hello"])),
    );
    const channel = open();
    channel.write(compatible());
    expect(await channel.untilEnd()).toEqual([
      { type: "delta", text: "Nope" },
      done("content-filter"),
    ]);
    channel.write(again());
    expect(await channel.untilEnd()).toEqual(hello);
    expect(sent[1]!.body!.messages).toEqual(asked);
  });

  test("after done aborted sends the person's text again, and nothing of the answer the cancel cut", async () => {
    let stream: ReturnType<typeof openStream> | undefined;
    const { sent, open } = turns(
      (request, n) => {
        if (n > 1) return sse(chat(["Hello"]));
        stream = openStream(request.signal);
        return stream.response;
      },
      { turn: { deltaMs: 1 } },
    );
    const channel = open();
    channel.write(compatible());
    await vi.waitFor(() => expect(stream).toBeDefined());
    stream!.send(chunk({ role: "assistant", content: "par" }));
    expect(await channel.next()).toEqual({ type: "delta", text: "par" });
    channel.write({ type: "cancel" });
    expect(await channel.untilEnd()).toEqual([done("aborted", null, null)]);
    channel.write(again());
    expect(await channel.untilEnd()).toEqual(hello);
    expect(sent[1]!.body!.messages).toEqual(asked);
  });

  test.each([
    {
      name: "provider_rejected",
      fail: () => failure(400),
      requests: 1,
      frames: [error("provider_rejected", false, 400)],
    },
    {
      name: "provider_unavailable, which the AI SDK sent three times",
      fail: () => failure(503),
      requests: 3,
      frames: [error("provider_unavailable", true, 503)],
    },
    {
      name: "provider_invalid_response, after the text it had",
      fail: () => sse(chat(["Hi"]).slice(0, 1)),
      requests: 1,
      frames: [{ type: "delta", text: "Hi" }, error("provider_invalid_response")],
    },
  ])(
    "after error $name sends the person's text again, once, and nothing of the answer",
    async ({ fail, requests, frames }) => {
      const { sent, open } = turns((_sent, n) => (n <= requests ? fail() : sse(chat(["Hello"]))));
      const channel = open();
      channel.write(compatible());
      expect(await channel.untilEnd()).toEqual(frames);
      channel.write(again());
      expect(await channel.untilEnd()).toEqual(hello);
      expect(sent).toHaveLength(requests + 1);
      expect(sent[requests]!.body!.messages).toEqual(asked);
    },
  );

  test("after provider_auth goes with the key the app sends now", async () => {
    const { sent, open } = turns((_sent, n) => (n === 1 ? failure(401) : sse(chat(["Hello"]))));
    const channel = open();
    channel.write(compatible());
    expect(await channel.untilEnd()).toEqual([error("provider_auth", false, 401)]);
    channel.write(again({ api_key: "sk-rotated" }));
    expect(await channel.untilEnd()).toEqual(hello);
    expect(sent[1]!.headers.authorization).toBe("Bearer sk-rotated");
    expect(sent[1]!.body!.messages).toEqual(asked);
  });

  test("while a turn runs is busy, and what the turn ends with decides the next", async () => {
    let stream: ReturnType<typeof openStream> | undefined;
    const { sent, open } = turns((request) => {
      stream = openStream(request.signal);
      return stream.response;
    });
    const channel = open();
    channel.write(compatible());
    await vi.waitFor(() => expect(stream).toBeDefined());
    channel.write(again());
    expect(await channel.next()).toEqual(error("busy"));
    stream!.send(...chat(["ok"]));
    stream!.end();
    expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "ok" }, done()]);
    channel.write(again());
    expect(await channel.next()).toEqual(error("invalid_message"));
    expect(sent).toHaveLength(1);
  });

  test("for another chat or a base URL the egress refuses is refused as one with text is, and the conversation stays to send again", async () => {
    const { sent, open } = turns((_sent, n) => (n === 1 ? failure(400) : sse(chat(["Hello"]))));
    const channel = open();
    channel.write(compatible());
    expect(await channel.untilEnd()).toEqual([error("provider_rejected", false, 400)]);
    channel.write(again({ model: "m-2" }));
    expect(await channel.next()).toEqual(error("invalid_message"));
    expect(lines).toContain("warn [core:chat:turn] refused channel=1 reason=other_chat\n");
    channel.write(again({ base_url: "http://127.0.0.1:8080/v1" }));
    expect(await channel.next()).toEqual(error("egress_denied"));
    channel.write(again());
    expect(await channel.untilEnd()).toEqual(hello);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body!.messages).toEqual(asked);
  });

  test("in a chat past its limit is conversation_limit, as every later turn is", async () => {
    const big = "가".repeat(Math.ceil((1024 * 1024) / 3));
    const { sent, open } = turns(() => sse(chat([big])));
    const channel = open();
    for (const text of ["one", "two"]) {
      channel.write(compatible({ text }));
      expect((await channel.untilEnd()).at(-1)).toEqual(done());
    }
    channel.write(compatible({ text: "three" }));
    expect(await channel.next()).toEqual(error("conversation_limit"));
    channel.write(again());
    expect(await channel.next()).toEqual(error("conversation_limit"));
    expect(sent).toHaveLength(2);
  });
});

describe("the time a text was sent", () => {
  test.each([
    ["Asia/Seoul", "2026-11-22T21:56:31+09:00 (Sunday)"],
    ["America/New_York", "2026-11-22T07:56:31-05:00 (Sunday)"],
    ["Asia/Kolkata", "2026-11-22T18:26:31+05:30 (Sunday)"],
    ["UTC", "2026-11-22T12:56:31+00:00 (Sunday)"],
    ["Pacific/Kiritimati", "2026-11-23T02:56:31+14:00 (Monday)"],
  ])("reads in %s as %s", (timeZone, time) => {
    expect(timeNote(AT, timeZone)).toBe(`[Current time: ${time}, time zone: ${timeZone}]`);
  });

  test("goes before each of the person's texts, as each was sent and where", async () => {
    let now = AT;
    let zone = ZONE;
    const { sent, open } = turns(() => sse(chat(["Hello"])), {
      ...WHOLE,
      clock: () => now,
      timeZone: () => zone,
    });
    const channel = open();
    channel.write(compatible());
    await channel.untilEnd();
    // The person flew to New York, and their Mac took its time zone.
    now = new Date("2026-11-23T00:30:00Z");
    zone = "America/New_York";
    channel.write(compatible({ text: "그리고 모레는?" }));
    await channel.untilEnd();
    // Each is one string: the line and the text are one part, so an OpenAI-compatible server
    // that takes no array of parts reads it too.
    expect(sent[1]!.body!.messages).toEqual([
      { role: "system", content: INSTRUCTIONS },
      {
        role: "user",
        content: `[Current time: 2026-11-22T21:56:31+09:00 (Sunday), time zone: Asia/Seoul]\n\n${TEXT}`,
      },
      { role: "assistant", content: "Hello" },
      {
        role: "user",
        content:
          "[Current time: 2026-11-22T19:30:00-05:00 (Sunday), time zone: America/New_York]\n\n그리고 모레는?",
      },
    ]);
  });
});

describe("delta", () => {
  test("gathers the answer's text for up to 50 ms", async () => {
    const pieces = Array.from({ length: 20 }, (_, index) => `${index} `);
    const { open } = turns(() => sse(chat(pieces)), {});
    const channel = open();
    channel.write(compatible());
    expect(await channel.untilEnd()).toEqual([{ type: "delta", text: pieces.join("") }, done()]);
    expect(chatLimits.deltaMs).toBe(50);
  });

  test("goes when 50 ms pass, before the answer ends", async () => {
    let stream: ReturnType<typeof openStream> | undefined;
    const { open } = turns((sent) => {
      stream = openStream(sent.signal);
      return stream.response;
    }, {});
    const channel = open();
    channel.write(compatible());
    await vi.waitFor(() => expect(stream).toBeDefined());
    stream!.send(chunk({ role: "assistant", content: "first" }));
    expect(await channel.next()).toEqual({ type: "delta", text: "first" });
    stream!.send(...chat(["second"]).slice(1));
    stream!.end();
    expect(await channel.untilEnd()).toEqual([done()]);
  });

  test("cuts a long answer between characters, four-byte ones included", async () => {
    const text = `${"a".repeat(4095)}😀${"한".repeat(2000)}`;
    const { open } = turns(() => sse(chat([text])));
    const channel = open();
    channel.write(compatible());
    const answer = await channel.untilEnd();
    const deltas = answer.slice(0, -1).map((delta) => String(delta.text));
    expect(deltas.join("")).toBe(text);
    // The emoji does not fit after 4,095 bytes, so the first delta ends before it; the second
    // starts with it and fills the 4 KiB exactly.
    expect(deltas.map((piece) => Buffer.byteLength(piece))).toEqual([4095, 4096, 1908]);
  });
});

describe("a turn that ends early", () => {
  test("cancel ends it with done aborted after the text it had, and stops its request", async () => {
    let stream: ReturnType<typeof openStream> | undefined;
    // The text goes out at once, so the test knows the turn has it before it cancels.
    const { sent, open } = turns(
      (request) => {
        stream = openStream(request.signal);
        return stream.response;
      },
      { turn: { deltaMs: 1 } },
    );
    const channel = open();
    channel.write(compatible());
    await vi.waitFor(() => expect(stream).toBeDefined());
    stream!.send(chunk({ role: "assistant", content: "par" }));
    expect(await channel.next()).toEqual({ type: "delta", text: "par" });
    channel.write({ type: "cancel" });
    expect(await channel.untilEnd()).toEqual([done("aborted", null, null)]);
    expect(sent[0]!.signal?.aborted).toBe(true);
    expect(
      logged("info [core:chat:turn] cancelled channel=1 provider=openai-compatible steps=0 ms="),
    ).toBe(true);
    // A cancel with no turn to stop has no answer, and the chat goes on.
    channel.write({ type: "cancel" });
    stream = undefined;
    channel.write(compatible({ text: "again" }));
    await vi.waitFor(() => expect(stream).toBeDefined());
    stream!.send(...chat(["ok"]));
    stream!.end();
    expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "ok" }, done()]);
  });

  test("closing the channel stops it, and nothing is written after", async () => {
    const { sent, open } = turns((request) => openStream(request.signal).response);
    const channel = open();
    channel.write(compatible());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    channel.onclose?.();
    await vi.waitFor(() =>
      expect(
        logged("info [core:chat:turn] abandoned channel=1 provider=openai-compatible ms="),
      ).toBe(true),
    );
    expect(sent[0]!.signal?.aborted).toBe(true);
    expect(channel.sent).toEqual([]);
  });

  test("a second turn while one runs is busy, a model list is not, and the first turn still ends", async () => {
    let stream: ReturnType<typeof openStream> | undefined;
    const { sent, open } = turns((request) => {
      if (request.url === `${BASE}/models`) return Response.json({ data: [{ id: "m-1" }] });
      stream = openStream(request.signal);
      return stream.response;
    });
    const channel = open();
    channel.write(compatible());
    await vi.waitFor(() => expect(stream).toBeDefined());
    channel.write(compatible({ text: "second" }));
    expect(await channel.next()).toEqual(error("busy"));
    expect(lines).toContain("warn [core:chat:turn] refused channel=1 reason=busy\n");
    // A model list does not wait for the turn.
    channel.write({ type: "list_models", provider: "openai-compatible", base_url: BASE });
    expect(await channel.next()).toEqual({ type: "models", models: ["m-1"], truncated: false });
    stream!.send(...chat(["ok"]));
    stream!.end();
    expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "ok" }, done()]);
    expect(sent.map((request) => request.url)).toEqual([
      `${BASE}/chat/completions`,
      `${BASE}/models`,
    ]);
  });
});

describe("retries", () => {
  test.each([
    [[503, 500, 429], "provider_rate_limited"],
    [[429, 429, 503], "provider_unavailable"],
  ])(
    "failures %j are sent three times by the AI SDK, and the turn ends with the last one's %s",
    async (statuses, code) => {
      const { sent, open } = turns((_sent, n) => failure(statuses[n - 1]!));
      const channel = open();
      channel.write(compatible());
      const last = statuses.at(-1)!;
      expect(await channel.untilEnd()).toEqual([error(code, true, last)]);
      expect(sent).toHaveLength(3);
      expect(
        logged(
          `warn [core:chat:turn] failure channel=1 provider=openai-compatible code=${code} status=${last} steps=0 ms=`,
        ),
      ).toBe(true);
    },
  );

  test("a 503 and then a 200 answer the turn as if the first had, after the wait the 503 names", async () => {
    const at: number[] = [];
    const { sent, open } = turns((_sent, n) => {
      at.push(performance.now());
      return n === 1 ? failure(503, 50) : sse(chat(["ok"]));
    });
    const channel = open();
    channel.write(compatible());
    expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "ok" }, done()]);
    expect(sent).toHaveLength(2);
    // Its retry-after-ms, not the 2 s the AI SDK waits when an answer names no time.
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(45);
    expect(at[1]! - at[0]!).toBeLessThan(1_000);
  });

  test("a cancel while the AI SDK waits to send again ends the turn with done aborted at once, and nothing more is sent", async () => {
    const { sent, open } = turns(() => failure(503, 30_000));
    const channel = open();
    channel.write(compatible());
    // The egress logs the answer as it comes in; the SDK then reads it and waits 30 s.
    await vi.waitFor(() =>
      expect(logged("info [core:egress:fetch] success status=503")).toBe(true),
    );
    const cancelled = performance.now();
    channel.write({ type: "cancel" });
    expect(await channel.untilEnd()).toEqual([done("aborted", null, null)]);
    expect(performance.now() - cancelled).toBeLessThan(1_000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sent).toHaveLength(1);
    expect(
      logged("info [core:chat:turn] cancelled channel=1 provider=openai-compatible steps=0 ms="),
    ).toBe(true);
  });

  test.each([
    [401, "provider_auth"],
    [403, "provider_auth"],
    [400, "provider_rejected"],
    [404, "provider_rejected"],
  ])("a %i is not sent again, and ends with %s", async (status, code) => {
    const { sent, open } = turns(() => failure(status));
    const channel = open();
    channel.write(compatible());
    expect(await channel.untilEnd()).toEqual([error(code, false, status)]);
    expect(sent).toHaveLength(1);
  });

  test("a connection that fails is tried three times, 2 s then 4 s apart, and ends with network", async () => {
    vi.useFakeTimers();
    // Waiting with `vi.waitFor` would move the fake clock as well.
    const first = Promise.withResolvers<void>();
    const { sent, open } = turns(() => {
      first.resolve();
      return Promise.reject(refused());
    });
    const channel = open();
    channel.write(compatible());
    await first.promise;
    await vi.advanceTimersByTimeAsync(1_999);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(3);
    expect(await channel.untilEnd()).toEqual([error("network", true)]);
  });

  test("a certificate the core does not trust and a redirect are not tried again", async () => {
    const certificate = Object.assign(new TypeError("self signed certificate"), {
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    const redirect = Object.assign(new TypeError("unexpected redirect"), {
      code: "UnexpectedRedirect",
    });
    const { sent, open } = turns((_sent, n) => Promise.reject(n === 1 ? certificate : redirect));
    const channel = open();
    channel.write(compatible());
    expect(await channel.untilEnd()).toEqual([error("provider_certificate")]);
    channel.write(compatible());
    expect(await channel.untilEnd()).toEqual([error("egress_denied")]);
    expect(sent).toHaveLength(2);
  });

  test.each([
    {
      name: "openai",
      message: turn("openai", "gpt-5.1"),
      events: [openai([]).at(0)!, serverError],
      status: 500,
    },
    {
      name: "anthropic",
      message: turn("anthropic", "claude-sonnet-5-5"),
      events: [
        {
          event: "error",
          data: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
        },
      ],
      status: 529,
    },
  ])(
    "an error the $name stream reports before output is sent again by the AI SDK, twice",
    async ({ message, events, status }) => {
      // The provider's package reads the stream's first events before it hands the stream over.
      const { sent, open } = turns(() => sse(events, { "retry-after-ms": "0" }));
      const channel = open();
      channel.write(message);
      expect(await channel.untilEnd()).toEqual([error("provider_unavailable", true, status)]);
      expect(sent).toHaveLength(3);
    },
  );

  test.each([
    [{ message: "Upstream failed", code: 502 }, error("provider_unavailable", true, 502)],
    [{ message: "Something broke", type: "server_error" }, error("provider_rejected")],
  ])(
    "an error an OpenAI-compatible stream sends after output reads by the status it names: %j",
    async (body, expected) => {
      const { sent, open } = turns(() =>
        sse([chunk({ role: "assistant", content: "Hi" }), { data: { error: body } }]),
      );
      const channel = open();
      channel.write(compatible());
      expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "Hi" }, expected]);
      expect(sent).toHaveLength(1);
    },
  );

  test("an error in the stream after output is not sent again, though the turn passes onError, and the text before it reaches the app", async () => {
    const overloaded: ServerEvent = {
      event: "error",
      data: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
    };
    const { sent, open } = turns(() => sse([...anthropic(["Hi"]).slice(0, 3), overloaded]));
    const channel = open();
    channel.write(turn("anthropic", "claude-sonnet-5-5"));
    expect(await channel.untilEnd()).toEqual([
      { type: "delta", text: "Hi" },
      error("provider_unavailable", true, 529),
    ]);
    expect(sent).toHaveLength(1);
  });

  test("a base URL the egress refuses ends the turn with egress_denied before anything leaves", async () => {
    const { sent, open } = turns(() => sse(chat(["Hi"])));
    const channel = open();
    channel.write(compatible({ base_url: "http://127.0.0.1:8080/v1" }));
    expect(await channel.next()).toEqual(error("egress_denied"));
    expect(sent).toEqual([]);
    expect(lines).toContain("warn [core:chat:turn] refused channel=1 reason=egress_denied\n");
    // A refused first turn fixes nothing: the chat may still start on another origin.
    channel.write(compatible());
    expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "Hi" }, done()]);
  });
});

describe("time limits", () => {
  const SHORT: ChatOptions = { turn: { firstOutputMs: 100, chunkMs: 100, deltaMs: 60_000 } };

  test.each([
    ["sends no headers", () => new Promise<Response>(() => {})],
    ["sends headers and then nothing", (request: Sent) => openStream(request.signal).response],
    [
      "sends a failure status and then not the rest of its body",
      (request: Sent) => openStream(request.signal, { status: 503 }).response,
    ],
  ])(
    "a request that %s ends the turn with timeout, and is not sent again",
    async (_name, answer) => {
      const { sent, open } = turns(answer, SHORT);
      const channel = open();
      channel.write(compatible());
      expect(await channel.untilEnd()).toEqual([error("timeout", true)]);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.signal?.aborted).toBe(true);
      expect(chatLimits.firstOutputMs).toBe(600_000);
    },
  );

  test("an OpenAI response that is accepted and then says nothing ends the turn with timeout", async () => {
    const { sent, open } = turns((request) => {
      const stream = openStream(request.signal);
      stream.send(openai([]).at(0)!);
      return stream.response;
    }, SHORT);
    const channel = open();
    channel.write(turn("openai", "gpt-5.1"));
    expect(await channel.untilEnd()).toEqual([error("timeout", true)]);
    expect(sent).toHaveLength(1);
  });

  test("an answer that stops between two outputs ends with timeout after the text it had", async () => {
    const { open } = turns((request) => {
      const stream = openStream(request.signal);
      stream.send(chunk({ role: "assistant", content: "half" }));
      return stream.response;
    }, SHORT);
    const channel = open();
    channel.write(compatible());
    expect(await channel.untilEnd()).toEqual([
      { type: "delta", text: "half" },
      error("timeout", true),
    ]);
    // As long as the wait for the first output: a model may think quietly after it wrote (§7.11).
    expect(chatLimits.chunkMs).toBe(600_000);
  });

  test("between two outputs the limit is 600 s on a fake clock, and each output starts it anew", async () => {
    vi.useFakeTimers();
    // Waiting with `vi.waitFor` would move the fake clock as well.
    const opened = Promise.withResolvers<ReturnType<typeof openStream>>();
    const { open } = turns((request) => {
      const stream = openStream(request.signal);
      opened.resolve(stream);
      return stream.response;
    });
    const channel = open();
    channel.write(compatible());
    const stream = await opened.promise;
    stream.send(chunk({ role: "assistant", content: "one" }));
    await vi.advanceTimersByTimeAsync(chatLimits.chunkMs - 1);
    stream.send(chunk({ content: " two" }));
    await vi.advanceTimersByTimeAsync(chatLimits.chunkMs - 1);
    expect(channel.sent.filter((message) => message.type !== "delta")).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await channel.untilEnd()).toEqual([
      { type: "delta", text: "one" },
      { type: "delta", text: " two" },
      error("timeout", true),
    ]);
  });

  test("the wait after a failure status is not under the limit", async () => {
    const slow = () => Response.json({}, { status: 503, headers: { "retry-after-ms": "250" } });
    const { sent, open } = turns((_sent, n) => (n === 1 ? slow() : sse(chat(["ok"]))), SHORT);
    const channel = open();
    channel.write(compatible());
    expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "ok" }, done()]);
    expect(sent).toHaveLength(2);
  });

  test("an OpenAI answer that reports an error before its output is sent again, and the next request starts the limit anew", async () => {
    vi.useFakeTimers();
    // Waiting with `vi.waitFor` would move the fake clock as well.
    const requests = [
      Promise.withResolvers<ReturnType<typeof openStream>>(),
      Promise.withResolvers<ReturnType<typeof openStream>>(),
    ];
    const { sent, open } = turns((request, n) => {
      // The first answer is 2xx, so its limit runs on until the AI SDK sends again 100 ms after it.
      const stream = openStream(
        request.signal,
        n === 1
          ? { headers: { "content-type": "text/event-stream", "retry-after-ms": "100" } }
          : {},
      );
      stream.send(openai([]).at(0)!);
      requests[n - 1]!.resolve(stream);
      return stream.response;
    });
    const channel = open();
    channel.write(turn("openai", "gpt-5.1"));
    const first = await requests[0]!.promise;
    // The OpenAI package reads on for an output or an error until a second before the limit.
    await vi.advanceTimersByTimeAsync(chatLimits.firstOutputMs - 1_000);
    expect(channel.sent).toEqual([]);
    first.send(serverError);
    first.end();
    await vi.advanceTimersByTimeAsync(100);
    const second = await requests[1]!.promise;
    // Past the first request's limit and within the second's.
    await vi.advanceTimersByTimeAsync(1_900);
    expect(channel.sent).toEqual([]);
    second.send(...openai(["ok"]).slice(1));
    second.end();
    expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "ok" }, done()]);
    expect(sent).toHaveLength(2);
  });

  /**
   * What Bun's fetch throws when its socket gets no byte for its idle timeout, five minutes by
   * default, before the headers and in the body alike (Bun 1.4.5, measured).
   */
  const idle = () => new DOMException("The operation timed out.", "TimeoutError");
  const failing = (request: Sent, ...events: ServerEvent[]) => {
    const stream = openStream(request.signal);
    stream.send(...events);
    setTimeout(() => stream.fail(idle()), 10);
    return stream.response;
  };

  test.each([
    ["before its headers", () => Promise.reject(idle()), []],
    ["after its headers", (request: Sent) => failing(request), []],
    [
      "after its output",
      (request: Sent) => failing(request, chunk({ role: "assistant", content: "half" })),
      [{ type: "delta", text: "half" }],
    ],
  ])(
    "Bun's idle timeout %s ends the turn with timeout, and the AI SDK does not send it again",
    async (_name, answer, before) => {
      const { sent, open } = turns(answer);
      const channel = open();
      channel.write(compatible());
      expect(await channel.untilEnd()).toEqual([...before, error("timeout", true)]);
      expect(sent).toHaveLength(1);
    },
  );
});

describe("a turn the channel cannot read", () => {
  test.each([
    ["a text that is null", compatible({ text: null })],
    ["an empty text", compatible({ text: "" })],
    ["a text over 64 KiB", compatible({ text: "a".repeat(chatLimits.textBytes + 1) })],
    ["no model", compatible({ model: undefined })],
    ["a model with a control character", compatible({ model: "m\n1" })],
    ["a model over 256 bytes", compatible({ model: "m".repeat(chatLimits.modelIdBytes + 1) })],
    [
      "a base URL for a provider whose origin is fixed",
      turn("openai", "gpt-5.1", { base_url: BASE }),
    ],
    [
      "no key for a provider that needs one",
      turn("anthropic", "claude-sonnet-5-5", { api_key: undefined }),
    ],
    ["a key it does not know", compatible({ stream: true })],
  ])("%s is invalid_message answering turn, and nothing leaves", async (_name, message) => {
    const { sent, open } = turns(() => sse(chat(["Hi"])));
    const channel = open();
    channel.write(message);
    expect(await channel.next()).toEqual(error("invalid_message"));
    expect(sent).toEqual([]);
  });

  test("the longest text is read", async () => {
    const { sent, open } = turns(() => sse(chat(["Hi"])));
    const channel = open();
    channel.write(compatible({ text: "가".repeat(Math.floor(chatLimits.textBytes / 3)) }));
    expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "Hi" }, done()]);
    expect(sent).toHaveLength(1);
  });

  test("a cancel with a key is invalid_message answering cancel", async () => {
    const { open } = turns(() => sse(chat(["Hi"])));
    const channel = open();
    channel.write({ type: "cancel", now: true });
    expect(await channel.next()).toEqual({ ...error("invalid_message"), in_reply_to: "cancel" });
  });
});
