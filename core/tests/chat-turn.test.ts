import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { type Fetch, installEgress } from "../src/chat/egress.ts";
import { INSTRUCTIONS } from "../src/chat/instructions.ts";
import { systemTimeZone, timeNote } from "../src/chat/now.ts";
import { chatLimits } from "../src/chat/protocol.ts";
import { type ChatOptions, ChatSessions } from "../src/chat/session.ts";
import { installWarningLog } from "../src/chat/warnings.ts";
import { FakeChannel, openStream, type ServerEvent, sse } from "./support/chat.ts";

// app-connection-v1 §7.11 and ADR-0012 "스트리밍", "중단", "재시도": a turn through the AI SDK
// 7.0.179 and the four providers, against a runtime fetch that answers with hand-written
// server-sent events. Nothing leaves the process: the global fetch refuses, as in the core.
installEgress();
installWarningLog();

const KEY = "sk-sherpa-turn-key";
const TEXT = "내일 일정 알려줘";
const BASE = "https://models.example/v1";
/** The time every turn's text is sent at, and what the model reads of it before the text. */
const AT = new Date("2026-11-22T12:56:31Z");
const said = (text: string) => `${timeNote(AT, systemTimeZone())}\n\n${text}`;

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
  const sessions = new ChatSessions(installEgress({ fetch }), { clock: () => AT, ...options });
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

// The events each provider streams for a text answer, as its package 4.x reads them.
const anthropic = (texts: string[], stop = "end_turn"): ServerEvent[] => [
  {
    event: "message_start",
    data: {
      type: "message_start",
      message: {
        id: "msg_1",
        model: "claude-sonnet-5-5",
        role: "assistant",
        usage: { input_tokens: 11 },
      },
    },
  },
  {
    event: "content_block_start",
    data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  },
  ...texts.map((text) => ({
    event: "content_block_delta",
    data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
  })),
  { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
  {
    event: "message_delta",
    data: { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 3 } },
  },
  { event: "message_stop", data: { type: "message_stop" } },
];
const created = { id: "resp_1", created_at: 1, model: "gpt-5.1" };
const openai = (texts: string[]): ServerEvent[] => [
  { data: { type: "response.created", response: created } },
  { data: { type: "response.in_progress", response: created } },
  {
    data: {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "message", id: "msg_1" },
    },
  },
  ...texts.map((delta) => ({
    data: {
      type: "response.output_text.delta",
      item_id: "msg_1",
      output_index: 0,
      content_index: 0,
      delta,
      logprobs: [],
    },
  })),
  {
    data: {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "message",
        id: "msg_1",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: texts.join(""), annotations: [] }],
      },
    },
  },
  {
    data: {
      type: "response.completed",
      response: {
        ...created,
        usage: {
          input_tokens: 11,
          output_tokens: 3,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      },
    },
  },
];
const google = (texts: string[]): ServerEvent[] => [
  { data: { event_type: "interaction.created", interaction: { status: "in_progress" } } },
  { data: { event_type: "step.start", index: 0, step: { type: "model_output", content: [] } } },
  ...texts.map((text) => ({
    data: { event_type: "step.delta", index: 0, delta: { type: "text", text } },
  })),
  { data: { event_type: "step.stop", index: 0 } },
  {
    data: {
      event_type: "interaction.completed",
      interaction: {
        status: "completed",
        usage: { total_input_tokens: 11, total_output_tokens: 3 },
      },
    },
  },
];
const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
  data: {
    id: "c1",
    object: "chat.completion.chunk",
    created: 1,
    model: "m-1",
    choices: [{ index: 0, delta, finish_reason: finish }],
  },
});
const chat = (texts: string[], finish = "stop"): ServerEvent[] => [
  ...texts.map((content, index) =>
    chunk(index === 0 ? { role: "assistant", content } : { content }),
  ),
  chunk({}, finish),
  {
    data: {
      id: "c1",
      object: "chat.completion.chunk",
      created: 1,
      model: "m-1",
      choices: [],
      usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 },
    },
  },
  { data: "[DONE]" },
];

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

/** A failure answer the AI SDK sends again at once. */
const failure = (status: number) =>
  Response.json(
    { error: { message: "try later" } },
    { status, headers: { "retry-after-ms": "0" } },
  );

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
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
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
      message: turn("google", "gemini-3-pro"),
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
      // The AI SDK warned of nothing, a deprecated name least of all (ADR-0012 "제공자 면").
      expect(lines.filter((line) => line.includes("[core:chat:sdk-warning]"))).toEqual([]);
    },
  );

  test("anthropic names API version 2026-10-21, caches the instructions and sends no sampling setting", async () => {
    const { sent, open } = turns(() => sse(anthropic(["Hi"])));
    const channel = open();
    channel.write(turn("anthropic", "claude-sonnet-5-5"));
    await channel.untilEnd();
    expect(sent[0]!.headers["anthropic-version"]).toBe("2026-10-21");
    const body = sent[0]!.body!;
    expect(body.system).toEqual([
      { type: "text", text: INSTRUCTIONS, cache_control: { type: "ephemeral" } },
    ]);
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: said(TEXT) }] },
    ]);
    for (const setting of ["temperature", "top_p", "top_k"])
      expect(body).not.toHaveProperty(setting);
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
    channel.write(turn("google", "gemini-3-pro"));
    await channel.untilEnd();
    expect(sent[0]!.body).toMatchObject({
      model: "gemini-3-pro",
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

  test("goes before each of the person's texts, as each was sent", async () => {
    let now = AT;
    const { sent, open } = turns(() => sse(chat(["Hello"])), { ...WHOLE, clock: () => now });
    const channel = open();
    channel.write(compatible());
    await channel.untilEnd();
    now = new Date("2026-11-23T00:30:00Z");
    channel.write(compatible({ text: "그리고 모레는?" }));
    await channel.untilEnd();
    const zone = systemTimeZone();
    expect(sent[1]!.body!.messages).toEqual([
      { role: "system", content: INSTRUCTIONS },
      { role: "user", content: `${timeNote(AT, zone)}\n\n${TEXT}` },
      { role: "assistant", content: "Hello" },
      { role: "user", content: `${timeNote(now, zone)}\n\n그리고 모레는?` },
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
    [503, "provider_unavailable"],
    [429, "provider_rate_limited"],
  ])("a %i is sent again twice by the AI SDK, then ends with %s", async (status, code) => {
    const { sent, open } = turns(() => failure(status));
    const channel = open();
    channel.write(compatible());
    expect(await channel.untilEnd()).toEqual([error(code, true, status)]);
    expect(sent).toHaveLength(3);
    expect(
      logged(
        `warn [core:chat:turn] failure channel=1 provider=openai-compatible code=${code} status=${status} steps=0 ms=`,
      ),
    ).toBe(true);
  });

  test("a request that succeeds when sent again answers as if it had the first time", async () => {
    const { sent, open } = turns((_sent, n) => (n < 3 ? failure(503) : sse(chat(["ok"]))));
    const channel = open();
    channel.write(compatible());
    expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "ok" }, done()]);
    expect(sent).toHaveLength(3);
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
      events: [
        openai([]).at(0)!,
        {
          data: {
            type: "error",
            code: "server_error",
            message: "The server had an error.",
            param: null,
            sequence_number: 1,
          },
        },
      ],
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

  test("an error in the stream after output is not sent again, and the text before it reaches the app", async () => {
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
      expect(chatLimits.firstOutputMs).toBe(120_000);
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
    expect(chatLimits.chunkMs).toBe(120_000);
  });

  test("the wait after a failure status is not under the limit", async () => {
    const slow = () => Response.json({}, { status: 503, headers: { "retry-after-ms": "250" } });
    const { sent, open } = turns((_sent, n) => (n === 1 ? slow() : sse(chat(["ok"]))), SHORT);
    const channel = open();
    channel.write(compatible());
    expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "ok" }, done()]);
    expect(sent).toHaveLength(2);
  });
});

describe("a turn the channel cannot read", () => {
  test.each([
    ["no text", compatible({ text: undefined })],
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
