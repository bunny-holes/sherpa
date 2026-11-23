import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { frameLimits } from "../src/app/frame.ts";
import { type Fetch, installEgress } from "../src/chat/egress.ts";
import { INSTRUCTIONS } from "../src/chat/instructions.ts";
import { timeNote } from "../src/chat/now.ts";
import { chatLimits } from "../src/chat/protocol.ts";
import { fingerprint } from "../src/chat/sdk/state.ts";
import { type ChatOptions, ChatSessions } from "../src/chat/session.ts";
import { installWarningLog } from "../src/chat/warnings.ts";
import type { ModelTool } from "../src/tools/call.ts";
import { FakeChannel, type ServerEvent, sse } from "./support/chat.ts";
import {
  anthropic,
  anthropicThinking,
  chat,
  chatReasoning,
  failure,
  google,
  googleThought,
  openai,
  openaiReasoning,
} from "./support/provider-events.ts";

// app-connection-v1 §7.11 "대화 상태", "이어 쓰기" and ADR-0012 "무엇을 저장하나", "상태를 넘기는
// 때", "이어 쓰기": the conversation's state a chat channel writes, and a new channel that takes it
// back, through the AI SDK 7.0.179 and the four providers against hand-written server-sent
// events. Nothing leaves the process: the global fetch refuses, as in the core.
installEgress();
installWarningLog();

const KEY = "sk-sherpa-state-key";
const TEXT = "내일 일정 알려줘";
const SECOND = "그다음은?";
const BASE = "https://models.example/v1";
const AT = new Date("2026-11-22T12:56:31Z");
const ZONE = "Asia/Seoul";
const said = (text: string) => `${timeNote(AT, ZONE)}\n\n${text}`;

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/**
 * Chat channels whose provider requests reach `answer`, the nth of them numbered from 1. A whole
 * answer goes as one `delta`, at its step's state or the turn's end.
 */
function chats(
  answer: (sent: Sent, n: number) => Response | Promise<Response>,
  options: ChatOptions = {},
  tools: () => Promise<readonly ModelTool[]> = async () => [],
) {
  const sent: Sent[] = [];
  const fetch: Fetch = Object.assign(
    async (input: string | URL | Request, init?: BunFetchRequestInit) => {
      if (typeof input !== "string") throw new TypeError("expected the checked URL");
      const request: Sent = {
        url: input,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body:
          typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {},
      };
      sent.push(request);
      return answer(request, sent.length);
    },
    { preconnect: () => {} },
  );
  const sessions = new ChatSessions(installEgress({ fetch }), tools, {
    clock: () => AT,
    timeZone: () => ZONE,
    turn: { deltaMs: 60_000 },
    ...options,
  });
  /** A channel; `states` puts the `state` messages among the others. */
  const open = (id = 1, states = false) => {
    const channel = new FakeChannel(id, { states });
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
/** A turn without text, which sends the conversation again. */
const again = (extra: Record<string, unknown> = {}) => ({
  type: "turn",
  provider: "openai-compatible",
  base_url: BASE,
  api_key: KEY,
  model: "m-1",
  ...extra,
});
const resume = (state: string) => ({ type: "resume", state });

const done = (
  reason = "stop",
  input: number | null = 11,
  output: number | null = 3,
  resend = false,
) => ({ type: "done", reason, input_tokens: input, output_tokens: output, resend });
const error = (code: string, retryable = false, status: number | null = null, resend = true) => ({
  type: "error",
  in_reply_to: "turn",
  code,
  retryable,
  status,
  resend,
});
const refused = (code: string) => ({
  type: "error",
  in_reply_to: "resume",
  code,
  retryable: false,
  status: null,
});

/** The JSON a state carries. */
const opened = (state: string) =>
  JSON.parse(Buffer.from(state, "base64").toString("utf8")) as Record<string, unknown>;
/** A state of this JSON, in the base64 the core writes. */
const sealed = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");

/** What a turn with no tools sends besides the conversation, as a state names it. */
const PRINT = await fingerprint([]);

const hi = { role: "assistant", content: [{ type: "text", text: "Hi" }] };
/** The state of an OpenAI-compatible chat with these messages. */
const compatibleState = (messages: unknown[], extra: Record<string, unknown> = {}) => ({
  format: "sherpa.chat.state.v1",
  provider: "openai-compatible",
  base_url: BASE,
  model: "m-1",
  fingerprint: PRINT,
  full: false,
  pending: [],
  messages,
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
  const warnings = lines.filter((line) => line.includes("[core:chat:sdk-warning]"));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  expect(warnings).toEqual([]);
});

const logged = (start: string) => lines.some((line) => line.startsWith(start));

/** The messages of a turn up to and including the `done` or `error` that ends it. */
async function ending(channel: FakeChannel): Promise<Record<string, unknown>[]> {
  const messages: Record<string, unknown>[] = [];
  for (;;) {
    const message = await channel.next();
    messages.push(message);
    if (message.type === "done" || message.type === "error") return messages;
  }
}

/** Whether each state the channel wrote says the chat is full. */
const fulls = (channel: FakeChannel) => channel.states.map((state) => opened(state).full);
/** The body of the `state` message that carries this state. */
const stateBytes = (state: string) => JSON.stringify({ type: "state", state }).length;

describe("the state a chat writes", () => {
  test("goes once the person's text is in the conversation, before the request, and after each step it keeps, after the step's text", async () => {
    let channel!: FakeChannel;
    const out: number[] = [];
    const { open } = chats(() => {
      out.push(channel.states.length);
      return sse(chat(["Hello"]));
    });
    channel = open(1, true);
    // The chat keeps its base URL without the `/` at its end.
    channel.write(compatible({ base_url: `${BASE}/` }));
    const first = await channel.next();
    expect(first.type).toBe("state");
    const start = opened(first.state as string);
    expect(start).toEqual(compatibleState([{ role: "user", content: said(TEXT) }]));
    expect(Object.keys(start)).toEqual([
      "format",
      "provider",
      "base_url",
      "model",
      "fingerprint",
      "full",
      "pending",
      "messages",
    ]);
    expect(await channel.next()).toEqual({ type: "delta", text: "Hello" });
    const step = await channel.next();
    expect(step.type).toBe("state");
    expect(opened(step.state as string).messages).toEqual([
      { role: "user", content: said(TEXT) },
      { role: "assistant", content: [{ type: "text", text: "Hello" }] },
    ]);
    expect(await channel.next()).toEqual(done());
    expect(out).toEqual([1]);
    expect(lines).toContain(
      `debug [core:chat:state] sent channel=1 bytes=${channel.bodies[0]!.length} messages=1 full=false pending=0\n`,
    );
    expect(lines).toContain(
      `debug [core:chat:state] sent channel=1 bytes=${channel.bodies[2]!.length} messages=2 full=false pending=0\n`,
    );
  });

  test("names no base URL for a provider whose origin Sherpa fixes, and holds no key", async () => {
    const { open } = chats(() => sse(anthropic(["Hi"])));
    const channel = open();
    channel.write(turn("anthropic", "claude-sonnet-5-5"));
    expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "Hi" }, done()]);
    const state = opened(channel.states.at(-1)!);
    expect(Object.keys(state)).toEqual([
      "format",
      "provider",
      "model",
      "fingerprint",
      "full",
      "pending",
      "messages",
    ]);
    expect(state).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5" });
    expect(channel.states.map((value) => JSON.stringify(opened(value))).join()).not.toContain(KEY);
    expect(channel.bodies.join()).not.toContain(KEY);
  });

  test("leaves out a step that failed, and a turn without text writes none before its request", async () => {
    const { open } = chats((_sent, n) => (n === 1 ? failure(400) : sse(chat(["Hello"]))));
    const channel = open(1, true);
    channel.write(compatible());
    expect((await channel.next()).type).toBe("state");
    expect(await channel.next()).toEqual(error("provider_rejected", false, 400, true));
    channel.write(again());
    expect(await channel.next()).toEqual({ type: "delta", text: "Hello" });
    const step = await channel.next();
    expect(opened(step.state as string).messages).toEqual([
      { role: "user", content: said(TEXT) },
      { role: "assistant", content: [{ type: "text", text: "Hello" }] },
    ]);
    expect(await channel.next()).toEqual(done());
    expect(channel.states).toHaveLength(2);
  });

  test("is not written for a turn refused before its request", async () => {
    const { sent, open } = chats(() => sse(chat(["Hi"])));
    const channel = open();
    channel.write(compatible());
    await channel.untilEnd();
    expect(channel.states).toHaveLength(2);
    channel.write(compatible({ model: "m-2" }));
    expect(await channel.next()).toEqual(error("invalid_message", false, null, false));
    channel.write(again());
    expect(await channel.next()).toEqual(error("invalid_message", false, null, false));
    expect(channel.states).toHaveLength(2);
    expect(sent).toHaveLength(1);
  });
});

describe("a state that would not fit one data", () => {
  test("is the limit of a data body", () => {
    expect(chatLimits.dataBytes).toBe(frameLimits.data);
  });

  test("at the turn's start ends it as internal before any request, and the chat takes no later turn", async () => {
    const { sent, open } = chats(() => sse(chat(["Hi"])), { dataBytes: 100 });
    const channel = open();
    channel.write(compatible());
    expect(await channel.next()).toEqual(error("internal", false, null, false));
    expect(sent).toEqual([]);
    expect(channel.states).toEqual([]);
    expect(lines.filter((line) => line.startsWith("error "))).toEqual([
      expect.stringMatching(
        /^error \[core:chat:state\] failure channel=1 bytes=\d+ reason=too_large\n$/,
      ),
      expect.stringMatching(
        /^error \[core:chat:turn\] failure channel=1 provider=openai-compatible code=internal error_type=StateTooLarge steps=0 ms=\d+\n$/,
      ),
    ]);
    channel.write(compatible({ text: "짧게" }));
    expect(await channel.next()).toEqual(error("conversation_limit", false, null, false));
    expect(sent).toEqual([]);
  });

  test("after a step ends the turn there as internal; the state before it fits to its last byte", async () => {
    const probe = chats(() => sse(chat(["Hi"]))).open();
    probe.write(compatible());
    await probe.untilEnd();
    const start = probe.bodies[0]!.length;
    const { sent, open } = chats(() => sse(chat(["Hi"])), { dataBytes: start });
    const channel = open();
    channel.write(compatible());
    expect(await channel.untilEnd()).toEqual([
      { type: "delta", text: "Hi" },
      error("internal", false, null, false),
    ]);
    expect(channel.bodies[0]!.length).toBe(start);
    expect(channel.states).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(
      logged(
        "error [core:chat:turn] failure channel=1 provider=openai-compatible code=internal error_type=StateTooLarge steps=1 ms=",
      ),
    ).toBe(true);
    channel.write(again());
    expect(await channel.next()).toEqual(error("conversation_limit", false, null, false));
    expect(sent).toHaveLength(1);
  });

  // A `resume` is read whatever its size, so its chat may hold a state larger than one `data`.
  test("that says a turn's start filled the chat answers the turn internal, and the state before it stays the app's", async () => {
    const { sent, open } = chats(() => sse(chat(["Hi"])), { dataBytes: 1000 });
    const channel = open(1, true);
    const room = [{ role: "user", content: "x".repeat(chatLimits.conversationBytes - 1000) }, hi];
    channel.write(resume(sealed(compatibleState(room))));
    expect(await channel.next()).toEqual({ type: "resumed", resend: false });
    channel.write(compatible({ text: "a".repeat(2000) }));
    expect(await channel.next()).toEqual(error("internal", false, null, false));
    expect(channel.states).toEqual([]);
    expect(lines.filter((line) => line.startsWith("error "))).toEqual([
      expect.stringMatching(
        /^error \[core:chat:state\] failure channel=1 bytes=\d+ reason=too_large\n$/,
      ),
    ]);
    channel.write(compatible({ text: "짧게" }));
    expect(await channel.next()).toEqual(error("conversation_limit", false, null, false));
    expect(channel.states).toEqual([]);
    expect(sent).toEqual([]);
  });

  test("that says a turn filled the chat ends the turn as internal, and the state before it stays the app's", async () => {
    // The answer passes the limit with its first piece, so none of it goes out.
    const { sent, open } = chats(() => sse(chat(["가".repeat(1000)])), { dataBytes: 1000 });
    const channel = open(1, true);
    const room = [{ role: "user", content: "x".repeat(chatLimits.conversationBytes - 1000) }];
    channel.write(resume(sealed(compatibleState(room))));
    expect(await channel.next()).toEqual({ type: "resumed", resend: true });
    // A turn without text writes no state before its request.
    channel.write(again());
    expect(await channel.next()).toEqual(error("internal", false, null, false));
    expect(channel.states).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(lines.filter((line) => line.startsWith("error "))).toEqual([
      expect.stringMatching(
        /^error \[core:chat:state\] failure channel=1 bytes=\d+ reason=too_large\n$/,
      ),
      expect.stringMatching(
        /^error \[core:chat:turn\] failure channel=1 provider=openai-compatible code=internal error_type=StateTooLarge steps=1 ms=\d+\n$/,
      ),
    ]);
    channel.write(again());
    expect(await channel.next()).toEqual(error("conversation_limit", false, null, false));
    expect(sent).toHaveLength(1);
  });
});

// §7.11 "대화 한도": the chat says once that it is full, in a `state` before the message that ends
// the turn that filled it, and a chat given back with that state takes no turn.
describe("a full chat's state", () => {
  const limit = error("conversation_limit", false, null, false);

  test("goes before the error of a turn that passed the limit; given back, the chat has nothing to send again and takes no turn", async () => {
    // The first piece fits; with the second the conversation would pass 2 MiB, so the answer is
    // cut there and its step leaves nothing.
    const first = "가".repeat(400_000);
    const { sent, open } = chats(() => sse(chat([first, "나".repeat(350_000)])));
    const channel = open(1, true);
    channel.write(compatible());
    const frames = await ending(channel);
    const others = frames.filter((frame) => frame.type !== "delta");
    expect(others.map((frame) => frame.type)).toEqual(["state", "state", "error"]);
    expect(others.at(-1)).toEqual(limit);
    // The text before the cut goes before the state.
    const at = frames.indexOf(others[1]!);
    expect(
      frames
        .slice(1, at)
        .map((frame) => frame.text)
        .join(""),
    ).toBe(first);
    expect(fulls(channel)).toEqual([false, true]);
    const full = channel.states[1]!;
    expect(opened(full)).toEqual(
      compatibleState([{ role: "user", content: said(TEXT) }], { full: true }),
    );
    expect(lines).toContain(
      `debug [core:chat:state] sent channel=1 bytes=${stateBytes(full)} messages=1 full=true pending=0\n`,
    );
    const resumed = open(2, true);
    resumed.write(resume(full));
    expect(await resumed.next()).toEqual({ type: "resumed", resend: false });
    expect(
      logged(
        `info [core:chat:resume] success channel=2 provider=openai-compatible messages=1 bytes=${full.length} fingerprint=same pruned=0 full=true ms=`,
      ),
    ).toBe(true);
    resumed.write(compatible({ text: SECOND }));
    expect(await resumed.next()).toEqual(limit);
    resumed.write(again());
    expect(await resumed.next()).toEqual(limit);
    expect(resumed.states).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  test("of a turn whose text would pass the limit goes alone before its error, without the text, and once", async () => {
    // The answer leaves less than the largest text: the next turn's text would pass the 2 MiB.
    const big = "가".repeat(Math.floor((chatLimits.conversationBytes - chatLimits.textBytes) / 3));
    const { sent, open } = chats(() => sse(chat([big])));
    const channel = open(1, true);
    channel.write(compatible({ text: "one" }));
    expect((await ending(channel)).at(-1)).toEqual(done());
    expect(fulls(channel)).toEqual([false, false]);
    const before = opened(channel.states[1]!);
    channel.write(compatible({ text: "a".repeat(chatLimits.textBytes) }));
    const state = await channel.next();
    expect(state.type).toBe("state");
    expect(opened(state.state as string)).toEqual({ ...before, full: true });
    expect(await channel.next()).toEqual(limit);
    expect(lines).toContain("warn [core:chat:turn] refused channel=1 reason=conversation_limit\n");
    // A chat full already writes no state when it refuses again.
    channel.write(compatible({ text: "4" }));
    expect(await channel.next()).toEqual(limit);
    channel.write(again());
    expect(await channel.next()).toEqual(limit);
    expect(fulls(channel)).toEqual([false, false, true]);
    expect(sent).toHaveLength(1);
    const resumed = open(2);
    resumed.write(resume(state.state as string));
    expect(await resumed.next()).toEqual({ type: "resumed", resend: false });
    resumed.write(compatible({ text: "4" }));
    expect(await resumed.next()).toEqual(limit);
    expect(resumed.states).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  test("is not written for a chat whose app holds no state of it", async () => {
    // Each turn fails before its first state, as the tools fail, and its text stays.
    const { sent, open } = chats(
      () => sse(chat(["Hi"])),
      {},
      async () => {
        throw new Error("no tools");
      },
    );
    const channel = open(1, true);
    const answers: Record<string, unknown>[] = [];
    while (answers.length < 40 && answers.at(-1)?.code !== "conversation_limit") {
      channel.write(compatible({ text: "a".repeat(chatLimits.textBytes) }));
      answers.push(await channel.next());
    }
    expect(answers.at(-1)).toEqual(limit);
    expect(new Set(answers.slice(0, -1).map((answer) => JSON.stringify(answer)))).toEqual(
      new Set([JSON.stringify(error("internal", false, null, true))]),
    );
    expect(channel.states).toEqual([]);
    expect(sent).toEqual([]);
  });
});

/** The v1 states a core wrote, one for each provider (tests/fixtures/chat-state). */
const WRITTEN = (await Bun.file(
  new URL("fixtures/chat-state/v1.json", import.meta.url),
).json()) as Record<string, Record<string, unknown>>;

describe("a state given back on a new channel", () => {
  const providers: {
    name: string;
    message: (text?: string) => Record<string, unknown>;
    answer: ServerEvent[];
    next: ServerEvent[];
    kept: string;
  }[] = [
    {
      name: "anthropic",
      message: (text = TEXT) => turn("anthropic", "claude-sonnet-5-5", { text }),
      answer: anthropicThinking(["Hi"]),
      next: anthropic(["Bye"]),
      kept: '"signature":"sig-1"',
    },
    {
      name: "openai",
      message: (text = TEXT) => turn("openai", "gpt-5.1", { text }),
      answer: openaiReasoning(["Hi"]),
      next: openai(["Bye"]),
      kept: '"encrypted_content":"enc-1"',
    },
    {
      name: "google",
      message: (text = TEXT) => turn("google", "gemini-3.5-flash", { text }),
      answer: googleThought(["Hi"]),
      next: google(["Bye"]),
      kept: '"signature":"sig-g"',
    },
    {
      name: "openai-compatible",
      message: (text = TEXT) => compatible({ text }),
      answer: chatReasoning(["Hi"]),
      next: chat(["Bye"]),
      kept: '"reasoning_content":"Let me see"',
    },
  ];

  test.each(providers)(
    "$name: the next request is the one the same channel sends, with what the provider takes back, and a state of this format the core wrote before reads the same",
    async ({ name, message, answer, next, kept }) => {
      const { sent, open } = chats((_sent, n) => sse(n === 1 ? answer : next));
      const first = open(1);
      first.write(message());
      expect(await first.untilEnd()).toEqual([{ type: "delta", text: "Hi" }, done()]);
      const state = first.states.at(-1)!;
      first.write(message(SECOND));
      expect(await first.untilEnd()).toEqual([{ type: "delta", text: "Bye" }, done()]);
      const second = open(2);
      second.write(resume(state));
      expect(await second.next()).toEqual({ type: "resumed", resend: false });
      second.write(message(SECOND));
      expect(await second.untilEnd()).toEqual([{ type: "delta", text: "Bye" }, done()]);
      expect(sent).toHaveLength(3);
      expect(sent[2]!.url).toBe(sent[1]!.url);
      expect(sent[2]!.body).toEqual(sent[1]!.body);
      expect(JSON.stringify(sent[1]!.body)).toContain(kept);
      expect(
        logged(
          `info [core:chat:resume] success channel=2 provider=${name} messages=2 bytes=${state.length} fingerprint=same pruned=0 full=false ms=`,
        ),
      ).toBe(true);
      // A state the core wrote with this format before reads as today's. Its fingerprint is of the
      // instructions as they were, which change apart from the AI SDK: it takes today's.
      const third = open(3);
      third.write(resume(sealed({ ...WRITTEN[name], fingerprint: PRINT })));
      expect(await third.next()).toEqual({ type: "resumed", resend: false });
      third.write(message(SECOND));
      expect(await third.untilEnd()).toEqual([{ type: "delta", text: "Bye" }, done()]);
      expect(sent[3]!.body).toEqual(sent[1]!.body);
      const states = [first, second, third].flatMap((channel) => channel.states);
      expect(states.map((value) => JSON.stringify(opened(value))).join()).not.toContain(KEY);
      expect(lines.join("")).not.toContain(KEY);
    },
  );

  test("is taken after a model list, and the chat goes on as the state's", async () => {
    const { sent, open } = chats((request) =>
      request.url.endsWith("/models")
        ? Response.json({ data: [{ id: "m-1" }] })
        : sse(chat(["Bye"])),
    );
    const channel = open();
    channel.write({ type: "list_models", provider: "openai-compatible", base_url: BASE });
    expect(await channel.next()).toEqual({ type: "models", models: ["m-1"], truncated: false });
    channel.write(resume(sealed(compatibleState([{ role: "user", content: said(TEXT) }, hi]))));
    expect(await channel.next()).toEqual({ type: "resumed", resend: false });
    channel.write(compatible({ text: SECOND }));
    expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "Bye" }, done()]);
    expect(sent.at(-1)!.body.messages).toEqual([
      { role: "system", content: INSTRUCTIONS },
      { role: "user", content: said(TEXT) },
      { role: "assistant", content: "Hi" },
      { role: "user", content: said(SECOND) },
    ]);
  });

  test("is taken only as the channel's first turn or resume", async () => {
    const valid = sealed(compatibleState([{ role: "user", content: said(TEXT) }, hi]));
    const { sent, open } = chats(() => sse(chat(["Hi"])));
    const afterTurn = open(1);
    afterTurn.write(compatible());
    await afterTurn.untilEnd();
    afterTurn.write(resume(valid));
    expect(await afterTurn.next()).toEqual(refused("invalid_message"));
    expect(sent).toHaveLength(1);
    const afterResume = open(2);
    afterResume.write(resume(valid));
    expect(await afterResume.next()).toEqual({ type: "resumed", resend: false });
    afterResume.write(resume(valid));
    expect(await afterResume.next()).toEqual(refused("invalid_message"));
    const afterRefusal = open(3);
    afterRefusal.write(resume("not a state"));
    expect(await afterRefusal.next()).toEqual(refused("chat_state_invalid"));
    afterRefusal.write(resume(valid));
    expect(await afterRefusal.next()).toEqual(refused("invalid_message"));
    expect(lines.filter((line) => line.includes("reason=not_first"))).toEqual([
      "warn [core:chat:resume] refused channel=1 reason=not_first\n",
      "warn [core:chat:resume] refused channel=2 reason=not_first\n",
      "warn [core:chat:resume] refused channel=3 reason=not_first\n",
    ]);
    // The chat of a refused resume starts empty: nothing to send again, and a text starts it.
    afterRefusal.write(again());
    expect(await afterRefusal.next()).toEqual(error("invalid_message", false, null, false));
    expect(sent).toHaveLength(1);
  });

  test("makes a turn that comes while it is checked busy, and a channel closed meanwhile hears nothing", async () => {
    const tools = Promise.withResolvers<readonly ModelTool[]>();
    const { sent, open } = chats(
      () => sse(chat(["Bye"])),
      {},
      () => tools.promise,
    );
    const valid = sealed(compatibleState([{ role: "user", content: said(TEXT) }, hi]));
    const channel = open(1);
    const closed = open(2);
    channel.write(resume(valid));
    closed.write(resume(valid));
    channel.write(compatible({ text: SECOND }));
    expect(await channel.next()).toEqual(error("busy", false, null, false));
    closed.onclose?.();
    tools.resolve([]);
    expect(await channel.next()).toEqual({ type: "resumed", resend: false });
    channel.write(compatible({ text: SECOND }));
    expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "Bye" }, done()]);
    expect(sent).toHaveLength(1);
    expect(closed.sent).toEqual([]);
    expect(logged("info [core:chat:resume] abandoned channel=2 ms=")).toBe(true);
  });

  test.each([
    ["no state", { type: "resume" }],
    ["a state that is no string", { type: "resume", state: 1 }],
    ["a key it does not know", { type: "resume", state: "", provider: "openai" }],
  ])(
    "a resume with %s is invalid_message answering resume, and a resume may follow",
    async (_name, message) => {
      const { open } = chats(() => sse(chat(["Hi"])));
      const channel = open();
      channel.write(message);
      expect(await channel.next()).toEqual(refused("invalid_message"));
      expect(logged("warn [core:chat:message] refused channel=1 reason=schema bytes=")).toBe(true);
      channel.write(resume(sealed(compatibleState([{ role: "user", content: said(TEXT) }]))));
      expect(await channel.next()).toEqual({ type: "resumed", resend: true });
    },
  );

  const user = { role: "user", content: said(TEXT) };
  const call = {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId: "call_1", toolName: "event_list", input: {} }],
  };
  const result = {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "call_1",
        toolName: "event_list",
        output: { type: "json", value: { status: "succeeded" } },
      },
    ],
  };
  const withFile = (part: Record<string, unknown>) => ({
    role: "user",
    content: [{ type: "text", text: said(TEXT) }, part],
  });
  test.each<[string, string, string]>([
    ["a value that is not base64", "%%%", "base64"],
    ["base64 without its padding", "eyJhIjoxfQ", "base64"],
    ["base64 with a line break", "eyJhIjox\nfQ==", "base64"],
    ["base64 whose last bits are not zero", "eyJhIjoxfR==", "base64"],
    // The URL-safe base64 of `"???"`, which the core writes `Ij8/PyI=`.
    ["base64 in the URL-safe alphabet", "Ij8_PyI=", "base64"],
    ["the base64 of no JSON", Buffer.from("not json").toString("base64"), "not_json"],
    [
      "a UTF-8 BOM before an otherwise valid envelope",
      Buffer.from(`\uFEFF${JSON.stringify(compatibleState([hi]))}`).toString("base64"),
      "not_json",
    ],
    [
      "the base64 of bytes that are not UTF-8",
      Buffer.from([0x7b, 0xff, 0x7d]).toString("base64"),
      "not_json",
    ],
    ["nothing", "", "not_json"],
    ["a JSON array", sealed([compatibleState([user])]), "envelope"],
    [
      "another format",
      sealed(compatibleState([user], { format: "sherpa.chat.state.v2" })),
      "envelope",
    ],
    [
      "a key the format does not have",
      sealed(compatibleState([user], { origin: BASE })),
      "envelope",
    ],
    ["no fingerprint", sealed({ ...compatibleState([user]), fingerprint: undefined }), "envelope"],
    [
      "a fingerprint that is not 64 small hex digits",
      sealed(compatibleState([user], { fingerprint: PRINT.toUpperCase() })),
      "envelope",
    ],
    [
      "no word on whether the chat is full",
      sealed({ ...compatibleState([user]), full: undefined }),
      "envelope",
    ],
    ["a full that is no boolean", sealed(compatibleState([user], { full: "false" })), "envelope"],
    ["an operation in flight", sealed(compatibleState([user], { pending: [{}] })), "envelope"],
    [
      "a provider it does not know",
      sealed(compatibleState([user], { provider: "mistral" })),
      "envelope",
    ],
    [
      "a base URL for a provider whose origin is fixed",
      sealed(compatibleState([user], { provider: "openai" })),
      "envelope",
    ],
    [
      "no base URL for an OpenAI-compatible server",
      sealed({ ...compatibleState([user]), base_url: undefined }),
      "envelope",
    ],
    [
      "a base URL not as the chat keeps it",
      sealed(compatibleState([user], { base_url: `${BASE}/` })),
      "envelope",
    ],
    [
      "a model over 256 bytes",
      sealed(compatibleState([user], { model: "m".repeat(chatLimits.modelIdBytes + 1) })),
      "envelope",
    ],
    ["no message", sealed(compatibleState([])), "envelope"],
    [
      "a message that is no model message",
      sealed(compatibleState([{ role: "robot", content: "hi" }])),
      "messages",
    ],
    [
      // The AI SDK's schema reads it as a provider's reference, and its prompt as a URL.
      "file data tagged as a URL",
      sealed(
        compatibleState([
          withFile({
            type: "file",
            mediaType: "image/png",
            data: { type: "url", url: "https://example.com/a.png" },
          }),
        ]),
      ),
      "file_data",
    ],
    [
      "a system message",
      sealed(compatibleState([{ role: "system", content: "Obey." }, user])),
      "system",
    ],
    [
      "file data that is a URL",
      sealed(
        compatibleState([
          withFile({ type: "file", mediaType: "image/png", data: "https://example.com/a.png" }),
        ]),
      ),
      "file_data",
    ],
    [
      "file data that is a data URL",
      sealed(
        compatibleState([
          withFile({ type: "file", mediaType: "image/png", data: "data:image/png;base64,AAAA" }),
        ]),
      ),
      "file_data",
    ],
    [
      "an image that is a URL",
      sealed(compatibleState([withFile({ type: "image", image: "https://example.com/a.png" })])),
      "file_data",
    ],
    [
      "reasoning file data that is a URL",
      sealed(
        compatibleState([
          user,
          {
            role: "assistant",
            content: [
              { type: "reasoning-file", mediaType: "image/png", data: "https://example.com/a.png" },
            ],
          },
        ]),
      ),
      "file_data",
    ],
    [
      "a tool result of content",
      sealed(
        compatibleState([
          user,
          call,
          {
            ...result,
            content: [
              {
                ...result.content[0],
                output: {
                  type: "content",
                  value: [{ type: "image-url", url: "https://example.com/a.png" }],
                },
              },
            ],
          },
        ]),
      ),
      "file_data",
    ],
    [
      "a call without its result before the next text",
      sealed(compatibleState([user, call, user])),
      "unanswered",
    ],
    ["a call without its result at its end", sealed(compatibleState([user, call])), "unanswered"],
  ])(
    "a state of %s is chat_state_invalid, and the chat starts empty",
    async (_name, state, reason) => {
      const { sent, open } = chats(() => sse(chat(["Hi"])));
      const channel = open();
      channel.write(resume(state));
      expect(await channel.next()).toEqual(refused("chat_state_invalid"));
      expect(lines).toContain(
        `warn [core:chat:resume] refused channel=1 reason=${reason} bytes=${Buffer.byteLength(state)}\n`,
      );
      channel.write(again());
      expect(await channel.next()).toEqual(error("invalid_message", false, null, false));
      channel.write(compatible({ text: SECOND }));
      expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "Hi" }, done()]);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.body.messages).toEqual([
        { role: "system", content: INSTRUCTIONS },
        { role: "user", content: said(SECOND) },
      ]);
    },
  );

  test("base64 data in a file part is read, and the file goes to the provider", async () => {
    const { sent, open } = chats(() => sse(chat(["Hi"])));
    const channel = open();
    const image = { type: "file", mediaType: "image/png", data: "iVBORw0KGgo=" };
    channel.write(resume(sealed(compatibleState([withFile(image)]))));
    expect(await channel.next()).toEqual({ type: "resumed", resend: true });
    channel.write(again());
    expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "Hi" }, done()]);
    expect(JSON.stringify(sent[0]!.body)).toContain("iVBORw0KGgo=");
  });

  test.each([
    ["another provider", turn("openai", "m-1")],
    ["another base URL", compatible({ base_url: "https://other.example/v1" })],
    ["another model", compatible({ model: "m-2" })],
  ])(
    "a turn for %s than the state's is chat_state_mismatch before any request",
    async (_name, message) => {
      const { sent, open } = chats(() => sse(chat(["Bye"])));
      const channel = open();
      channel.write(resume(sealed(compatibleState([{ role: "user", content: said(TEXT) }]))));
      expect(await channel.next()).toEqual({ type: "resumed", resend: true });
      channel.write(message);
      expect(await channel.next()).toEqual(error("chat_state_mismatch", false, null, true));
      expect(sent).toEqual([]);
      expect(lines).toContain("warn [core:chat:turn] refused channel=1 reason=state_mismatch\n");
    },
  );

  test("a turn with another key than the chat's first is taken", async () => {
    const { sent, open } = chats(() => sse(chat(["Bye"])));
    const channel = open();
    channel.write(resume(sealed(compatibleState([{ role: "user", content: said(TEXT) }, hi]))));
    expect(await channel.next()).toEqual({ type: "resumed", resend: false });
    channel.write(compatible({ text: SECOND, api_key: "sk-sherpa-other-key" }));
    expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "Bye" }, done()]);
    expect(sent[0]!.headers.authorization).toBe("Bearer sk-sherpa-other-key");
  });

  test.each([
    {
      name: "the model's answer",
      messages: [{ role: "user", content: said(TEXT) }, hi],
      resend: false,
      next: error("invalid_message", false, null, false),
      states: [],
    },
    {
      name: "the person's text",
      messages: [{ role: "user", content: said(TEXT) }],
      resend: true,
      next: null,
      states: [false],
    },
    {
      name: "the results of the tools",
      messages: [{ role: "user", content: said(TEXT) }, call, result],
      resend: true,
      next: null,
      states: [false],
    },
    {
      // Its state says it is not full, so the refusal fills it, and says so first.
      name: "the person's text past the conversation's limit",
      messages: [{ role: "user", content: "x".repeat(chatLimits.conversationBytes) }],
      resend: false,
      next: error("conversation_limit", false, null, false),
      states: [true],
    },
  ])(
    "resumed with a conversation that ends with $name says resend $resend, as the turn without text after it finds",
    async ({ messages, resend, next, states }) => {
      const { sent, open } = chats(() => sse(chat(["Hi"])));
      const channel = open();
      channel.write(resume(sealed(compatibleState(messages))));
      expect(await channel.next()).toEqual({ type: "resumed", resend });
      channel.write(again());
      if (next) {
        expect(await channel.next()).toEqual(next);
        expect(sent).toEqual([]);
      } else {
        expect(await channel.untilEnd()).toEqual([{ type: "delta", text: "Hi" }, done()]);
        expect(sent[0]!.body.messages).toHaveLength(messages.length + 1);
      }
      expect(fulls(channel)).toEqual(states);
    },
  );

  test("Anthropic's conversation goes without its reasoning once the instructions or tools changed, and the others' with theirs", async () => {
    const other = "0".repeat(64);
    const { sent, open } = chats((request) =>
      sse(request.url.includes("anthropic") ? anthropic(["Bye"]) : openai(["Bye"])),
    );
    const claude = open(1);
    const thinking = WRITTEN.anthropic!;
    const onlyThought = {
      role: "assistant",
      content: [
        { type: "reasoning", text: "Hmm", providerOptions: { anthropic: { signature: "sig-0" } } },
      ],
    };
    const messages = [
      ...(thinking.messages as unknown[]).slice(0, 1),
      onlyThought,
      ...(thinking.messages as unknown[]),
    ];
    claude.write(resume(sealed({ ...thinking, fingerprint: other, messages })));
    expect(await claude.next()).toEqual({ type: "resumed", resend: false });
    claude.write(turn("anthropic", "claude-sonnet-5-5", { text: SECOND }));
    expect(await claude.untilEnd()).toEqual([{ type: "delta", text: "Bye" }, done()]);
    const asked = JSON.stringify(sent[0]!.body);
    expect(asked).not.toContain("sig-1");
    expect(asked).not.toContain("sig-0");
    expect(asked).not.toContain('"thinking"');
    expect(
      logged("info [core:chat:resume] success channel=1 provider=anthropic messages=3 bytes="),
    ).toBe(true);
    expect(
      lines.some((line) => /fingerprint=changed pruned=2 full=false ms=\d+\n$/.test(line)),
    ).toBe(true);
    const gpt = open(2);
    gpt.write(resume(sealed({ ...WRITTEN.openai, fingerprint: other })));
    expect(await gpt.next()).toEqual({ type: "resumed", resend: false });
    gpt.write(turn("openai", "gpt-5.1", { text: SECOND }));
    expect(await gpt.untilEnd()).toEqual([{ type: "delta", text: "Bye" }, done()]);
    expect(JSON.stringify(sent[1]!.body)).toContain('"encrypted_content":"enc-1"');
    expect(
      logged("info [core:chat:resume] success channel=2 provider=openai messages=2 bytes="),
    ).toBe(true);
    expect(
      lines.some((line) =>
        /channel=2 .*fingerprint=changed pruned=0 full=false ms=\d+\n$/.test(line),
      ),
    ).toBe(true);
  });

  test("a check that fails in the core is internal, with an error line", async () => {
    const { open } = chats(
      () => sse(chat(["Hi"])),
      {},
      async () => {
        throw new Error("no tools");
      },
    );
    const channel = open();
    channel.write(resume(sealed(compatibleState([{ role: "user", content: said(TEXT) }]))));
    expect(await channel.next()).toEqual(refused("internal"));
    expect(lines.filter((line) => line.startsWith("error "))).toEqual([
      expect.stringMatching(
        /^error \[core:chat:resume\] failure channel=1 code=internal error_type=Error ms=\d+\n$/,
      ),
    ]);
  });
});

describe("the fingerprint", () => {
  const tool = (
    name: string,
    description = name,
    input: z.ZodObject = z.object({ q: z.string() }),
  ) => ({ entry: { name, description, inputSchema: input } }) as unknown as ModelTool;

  test("is the SHA-256 of the instructions and the tools' digests, in hex", async () => {
    expect(PRINT).toMatch(/^[0-9a-f]{64}$/);
    expect(PRINT).toBe(
      new Bun.CryptoHasher("sha256")
        .update(JSON.stringify({ instructions: INSTRUCTIONS, tools: [] }))
        .digest("hex"),
    );
  });

  test("changes with a tool's description, its schema, the tools' order, and only with them", async () => {
    const [a, b] = [tool("a"), tool("b")];
    const print = await fingerprint([a, b]);
    expect(await fingerprint([tool("a"), tool("b")])).toBe(print);
    expect(await fingerprint([tool("a", "another"), b])).not.toBe(print);
    expect(await fingerprint([tool("a", "a", z.object({ q: z.number() })), b])).not.toBe(print);
    expect(await fingerprint([b, a])).not.toBe(print);
    expect(print).not.toBe(PRINT);
  });
});
