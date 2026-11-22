import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import {
  ControlChannel,
  ControlChannelConfirmations,
  ControlChannelPlanner,
} from "../src/app/control.ts";
import { allowedOrigin, type Fetch, installEgress } from "../src/chat/egress.ts";
import { INSTRUCTIONS } from "../src/chat/instructions.ts";
import { chatLimits } from "../src/chat/protocol.ts";
import { type ChatOptions, ChatSessions } from "../src/chat/session.ts";
import { ChatTurn } from "../src/chat/turn.ts";
import { installWarningLog } from "../src/chat/warnings.ts";
import type { CoreCommands } from "../src/commands.ts";
import { type CapabilityDescriptor, reconcile } from "../src/mcp/registry.ts";
import { resolveTools } from "../src/mcp/tools.ts";
import { SHERPA_VERSION } from "../src/version.ts";
import { FakeChannel, openStream, sse } from "./support/chat.ts";
import { ManualTimers } from "./support/pipes.ts";
import { defaultPlanner, plannerDescriptors } from "./support/planner.ts";
import {
  anthropic,
  anthropicCalls,
  chat,
  chatCalls,
  chunk,
  failure,
  google,
  googleCalls,
  type ModelCall,
  openai,
  openaiCalls,
} from "./support/provider-events.ts";

// app-connection-v1 §7.11 and ADR-0012 "도구", "중단": a chat turn whose model calls the core's
// tools, built from the planner's descriptors as `sherpa app serve` builds them, through the AI
// SDK 7.0.179 and the four providers against hand-written server-sent events. The planner and the
// confirmation windows answer on channel 0 as the app does; the core's commands are the test's.
// Nothing leaves the process: the global fetch refuses, as in the core.
installEgress();
installWarningLog();

const KEY = "sk-sherpa-tools-key";
const TEXT = "내일 일정 정리해줘";
const BASE = "https://models.example/v1";
const AT = new Date("2026-11-22T12:56:31Z");
const ZONE = "Asia/Seoul";

interface Sent {
  url: string;
  body: Record<string, unknown>;
  signal: AbortSignal | null | undefined;
}

/** A frame the core wrote on channel 0, its body read. */
interface Frame {
  type: string;
  body: Record<string, unknown>;
}

/** What the app does with a frame of channel 0. */
type App = (frame: Frame, control: ControlChannel) => void;

const capability = (frame: Frame) => (frame.body.request as { capability: string }).capability;

/** The planner's answer to a `request` frame, as `EventKitWorker` gives it, with `fields` changed. */
function answerPlanner(
  frame: Frame,
  control: ControlChannel,
  fields: Record<string, unknown> = {},
): void {
  const { id, request } = frame.body as { id: number; request: Record<string, unknown> };
  const { response } = defaultPlanner(request) as { response: Record<string, unknown> };
  control.onResponse({ id, response: { ...response, ...fields } });
}

/** The app of most tests: the planner answers, and the person allows every window. */
const allowing: App = (frame, control) => {
  if (frame.type === "request") answerPlanner(frame, control);
  if (frame.type === "confirm") control.onConfirmation({ id: frame.body.id, decision: "approved" });
};

/** An app that holds the frames `pick` chooses for the test to answer, and answers the rest. */
class Held {
  readonly frames: Frame[] = [];
  private waiters: { n: number; resolve: (frame: Frame) => void }[] = [];

  constructor(private readonly pick: (frame: Frame) => boolean) {}

  readonly app: App = (frame, control) => {
    if (!this.pick(frame)) {
      allowing(frame, control);
      return;
    }
    this.frames.push(frame);
    const held = this.frames.length;
    const ready = this.waiters.filter((waiter) => waiter.n <= held);
    this.waiters = this.waiters.filter((waiter) => waiter.n > held);
    for (const waiter of ready) waiter.resolve(this.frames[waiter.n - 1]!);
  };

  /** The nth frame it held, from 1, once the core has written it. */
  nth(n: number): Promise<Frame> {
    if (n <= this.frames.length) return Promise.resolve(this.frames[n - 1]!);
    return new Promise((resolve) => this.waiters.push({ n, resolve }));
  }
}

const unexpected = (): never => {
  throw new Error("unexpected command");
};
const noCommands: CoreCommands = {
  imessageChats: unexpected,
  imessageHistory: unexpected,
  imessageChat: unexpected,
  imessageSend: unexpected,
  kakaotalkStatus: unexpected,
  kakaotalkSearch: unexpected,
  kakaotalkHistory: unexpected,
  kakaotalkArchive: unexpected,
  kakaotalkCheckpoint: unexpected,
  mailAuthorizationStatus: unexpected,
  mailList: unexpected,
  mailRead: unexpected,
  mailSend: unexpected,
  operationsList: unexpected,
};
const family = { name: "Family", participants: ["+15555550100"] };
/** A send the app accepted, with what the command printed. */
const accepted = (operationID: string | undefined, output = '{"accepted":true}') => ({
  operationID: operationID!,
  output: new TextEncoder().encode(output),
  journalFailure: null,
});

/** Most tests read a whole answer as one `delta`: it goes when the turn ends, under 4 KiB. */
const WHOLE: ChatOptions = { turn: { deltaMs: 60_000 } };

/**
 * Chat channels whose model requests reach `answer`, the nth of them numbered from 1, with the
 * tools of a core whose planner reported `EventKitWorker`'s descriptors.
 */
function world(
  answer: (sent: Sent, n: number) => Response | Promise<Response>,
  options: { app?: App; commands?: Partial<CoreCommands>; chat?: ChatOptions } = {},
) {
  const sent: Sent[] = [];
  const frames: Frame[] = [];
  const timers = new ManualTimers();
  const app = options.app ?? allowing;
  const control: ControlChannel = new ControlChannel(
    async (type, body) => {
      const frame = { type, body: JSON.parse(body) as Record<string, unknown> };
      frames.push(frame);
      queueMicrotask(() => app(frame, control));
    },
    { timers },
  );
  let minted = 0;
  const tools = resolveTools(
    reconcile({
      kind: "discovered",
      descriptors: plannerDescriptors() as unknown as CapabilityDescriptor[],
    }),
    {
      planner: new ControlChannelPlanner(control),
      confirmations: new ControlChannelConfirmations(control),
      commands: { ...noCommands, ...options.commands },
      newOperationID: () => `op-${++minted}`,
    },
  );
  const fetch: Fetch = Object.assign(
    async (input: string | URL | Request, init?: BunFetchRequestInit) => {
      if (typeof input !== "string") throw new TypeError("expected the checked URL");
      if (typeof init?.body !== "string") throw new TypeError("expected a JSON body");
      const request: Sent = {
        url: input,
        body: JSON.parse(init.body) as Record<string, unknown>,
        signal: init.signal,
      };
      sent.push(request);
      return answer(request, sent.length);
    },
    { preconnect: () => {} },
  );
  const sessions = new ChatSessions(installEgress({ fetch }), async () => tools, {
    clock: () => AT,
    timeZone: () => ZONE,
    ...WHOLE,
    ...options.chat,
  });
  const open = (id = 1) => {
    const channel = new FakeChannel(id);
    sessions.serve(channel);
    return channel;
  };
  /** The capabilities the app was asked for, in order. */
  const asked = () => frames.filter((frame) => frame.type === "request").map(capability);
  return { sent, frames, timers, control, tools, open, asked };
}

const turn = (provider: string, model: string, text = TEXT) => ({
  type: "turn",
  provider,
  model,
  api_key: KEY,
  text,
});
const compatible = (text = TEXT) => ({
  type: "turn",
  provider: "openai-compatible",
  base_url: BASE,
  api_key: KEY,
  model: "m-1",
  text,
});

const WEEK = { from: "2026-11-23T00:00:00+09:00", to: "2026-11-30T00:00:00+09:00" };
const list = (id = "call_1"): ModelCall => ({ id, name: "event_list", input: WEEK });
const create = (id = "call_1"): ModelCall => ({
  id,
  name: "event_create",
  input: { title: "Lunch", start: "2026-11-23T12:00:00+09:00", end: "2026-11-23T13:00:00+09:00" },
});
/** A call the AI SDK refuses before it runs: `event_list` needs its `to`. */
const badly = (id = "call_1"): ModelCall => ({
  id,
  name: "event_list",
  input: { from: WEEK.from },
});
const remove = (id = "call_1"): ModelCall => ({
  id,
  name: "event_delete",
  input: { native_locator: "event-1", span: "this" },
});

/** A model that calls these tools after each of the person's texts, and answers with their results. */
const calling =
  (...calls: ModelCall[]) =>
  (sent: Sent) =>
    sse(
      (sent.body.messages as { role: string }[]).at(-1)!.role === "user"
        ? chatCalls(calls)
        : chat(["Done"]),
    );

const tool = (
  callID: number,
  name: string | null,
  status: string,
  code: string | null = null,
  operationID: string | null = null,
) => ({ type: "tool", call_id: callID, name, status, code, operation_id: operationID });
/** The `done` of a turn of two model requests, each 11 tokens in and 3 out. */
const done = (reason = "stop", input: number | null = 22, output: number | null = 6) => ({
  type: "done",
  reason,
  input_tokens: input,
  output_tokens: output,
});
const answered = (text = "Done") => ({ type: "delta", text });

/** The messages of a turn up to and including the `done` or `error` that ends it. */
async function ending(channel: FakeChannel): Promise<Record<string, unknown>[]> {
  const messages: Record<string, unknown>[] = [];
  for (;;) {
    const message = await channel.next();
    messages.push(message);
    if (message.type === "done" || message.type === "error") return messages;
  }
}

/** The outcomes an OpenAI-compatible request gives the model, each with its call's id. */
function outcomes(sent: Sent): Record<string, unknown>[] {
  return (sent.body.messages as { role: string; tool_call_id?: string; content: string }[])
    .filter((message) => message.role === "tool")
    .map((message) => ({
      id: message.tool_call_id,
      ...(JSON.parse(message.content) as Record<string, unknown>),
    }));
}

const pause = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  // No test meets a warning it does not expect: a tool the SDK could not hand over as the core
  // gave it, a setting that did not take, or one the SDK changed (ADR-0012 "제공자 면").
  expect(warnings).toEqual([]);
});

const logged = (start: string) => lines.some((line) => line.startsWith(start));

describe("a turn whose model calls a tool", () => {
  test("the call runs through the tool lifecycle, the app hears of it in two tool messages, and the next request carries its outcome", async () => {
    const { sent, open, asked } = world((_sent, n) =>
      sse(n === 1 ? chatCalls([list()]) : chat(["Done"])),
    );
    const channel = open();
    channel.write(compatible());
    expect(await ending(channel)).toEqual([
      tool(1, "event_list", "started"),
      tool(1, "event_list", "succeeded", null, "op-1"),
      answered(),
      done(),
    ]);
    expect(asked()).toEqual(["event.list"]);
    expect(sent).toHaveLength(2);
    expect(outcomes(sent[1]!)).toMatchObject([
      { id: "call_1", status: "succeeded", capability: "event.list", operation_id: "op-1" },
    ]);
    expect(lines).toContain("info [core:chat:tool-call] start channel=1 tool=event_list\n");
    expect(
      logged(
        "info [core:chat:tool-call] success channel=1 tool=event_list status=succeeded code=none operation_id=op-1 ms=",
      ),
    ).toBe(true);
    expect(
      logged(
        "info [core:chat:turn] success channel=1 provider=openai-compatible reason=stop steps=2 input_tokens=22 output_tokens=6 ms=",
      ),
    ).toBe(true);
  });

  test("text before a call reaches the app before the call's messages", async () => {
    const { open } = world((_sent, n) =>
      sse(n === 1 ? chatCalls([list()], ["Let me ", "look."]) : chat(["Done"])),
    );
    const channel = open();
    channel.write(compatible());
    expect(await ending(channel)).toEqual([
      answered("Let me look."),
      tool(1, "event_list", "started"),
      tool(1, "event_list", "succeeded", null, "op-1"),
      answered(),
      done(),
    ]);
  });

  test("a step's calls run one at a time, in the order the model gave them", async () => {
    const held = new Held((frame) => frame.type === "request");
    const milk: ModelCall = { id: "call_2", name: "reminder_create", input: { title: "Milk" } };
    const { open, control } = world(
      (_sent, n) => sse(n === 1 ? chatCalls([create(), milk]) : chat(["Done"])),
      { app: held.app },
    );
    const channel = open();
    channel.write(compatible());
    const first = await held.nth(1);
    await pause();
    expect(held.frames.map(capability)).toEqual(["event.create"]);
    answerPlanner(first, control);
    answerPlanner(await held.nth(2), control);
    expect(held.frames.map(capability)).toEqual(["event.create", "reminder.create"]);
    expect(await ending(channel)).toEqual([
      tool(1, "event_create", "started"),
      tool(1, "event_create", "succeeded", null, "op-1"),
      tool(2, "reminder_create", "started"),
      tool(2, "reminder_create", "succeeded", null, "op-2"),
      answered(),
      done(),
    ]);
  });

  test("a request that fails after a tool step is sent again, and the tool does not run again", async () => {
    const { sent, open, asked } = world((_sent, n) => {
      if (n === 1) return sse(chatCalls([create()]));
      return n === 2 ? failure(503) : sse(chat(["Done"]));
    });
    const channel = open();
    channel.write(compatible());
    expect(await ending(channel)).toEqual([
      tool(1, "event_create", "started"),
      tool(1, "event_create", "succeeded", null, "op-1"),
      answered(),
      done(),
    ]);
    expect(asked()).toEqual(["event.create"]);
    expect(sent).toHaveLength(3);
    expect(sent[2]!.body).toEqual(sent[1]!.body);
  });

  test("a turn ends with step-limit after 20 model requests, and the next turn follows the last result", async () => {
    const { sent, open, asked } = world((_sent, n) =>
      sse(n <= chatLimits.steps ? chatCalls([list(`call_${n}`)]) : chat(["Done"])),
    );
    const channel = open();
    channel.write(compatible());
    const messages = await ending(channel);
    expect(messages.at(-1)).toEqual(done("step-limit", 220, 60));
    expect(messages.slice(0, -1)).toEqual(
      Array.from({ length: 20 }, (_, index) => [
        tool(index + 1, "event_list", "started"),
        tool(index + 1, "event_list", "succeeded", null, `op-${index + 1}`),
      ]).flat(),
    );
    expect(chatLimits.steps).toBe(20);
    expect(sent).toHaveLength(20);
    expect(asked()).toHaveLength(20);
    expect(
      logged(
        "info [core:chat:turn] success channel=1 provider=openai-compatible reason=step-limit steps=20 input_tokens=220 output_tokens=60 ms=",
      ),
    ).toBe(true);
    channel.write(compatible("계속해줘"));
    expect(await ending(channel)).toEqual([answered(), done("stop", 11, 3)]);
    const next = sent[20]!.body.messages as { role: string; tool_call_id?: string }[];
    expect(next.slice(-2).map((message) => [message.role, message.tool_call_id])).toEqual([
      ["tool", "call_20"],
      ["user", undefined],
    ]);
  });

  test("a result over 64 KiB fails a read with what to narrow, and leaves a change that happened partial", async () => {
    const big = { schema: "x", items: ["e".repeat(chatLimits.toolResultBytes)] };
    const { sent, open } = world(
      (_sent, n) => sse(n === 1 ? chatCalls([list("call_1"), create("call_2")]) : chat(["Done"])),
      {
        app: (frame, control) => {
          if (frame.type === "request") answerPlanner(frame, control, { result: big });
        },
      },
    );
    const channel = open();
    channel.write(compatible());
    expect(await ending(channel)).toEqual([
      tool(1, "event_list", "started"),
      tool(1, "event_list", "failed", "protocol.result_too_large", "op-1"),
      tool(2, "event_create", "started"),
      tool(2, "event_create", "partial", "protocol.result_too_large", "op-2"),
      answered(),
      done(),
    ]);
    expect(chatLimits.toolResultBytes).toBe(64 * 1024);
    const [read, change] = outcomes(sent[1]!);
    expect(read).toMatchObject({
      status: "failed",
      result: null,
      error: { code: "protocol.result_too_large", retry: "never", remedy: expect.any(String) },
    });
    expect(change).toMatchObject({
      status: "partial",
      effect: { kind: "native_mutation", state: "applied" },
      evidence: { state: "matched" },
      result: null,
    });
    expect(Buffer.byteLength(JSON.stringify(sent[1]!.body))).toBeLessThan(
      chatLimits.toolResultBytes,
    );
  });

  test("a call the model forms badly, or to a tool the core does not have, fails without running", async () => {
    const { sent, open, asked } = world((_sent, n) =>
      sse(
        n === 1
          ? chatCalls([
              { id: "call_1", name: "event_list", input: { from: WEEK.from } },
              { id: "call_2", name: "shell_exec_now", input: {} },
            ])
          : chat(["Done"]),
      ),
    );
    const channel = open();
    channel.write(compatible());
    expect(await ending(channel)).toEqual([
      tool(1, "event_list", "started"),
      tool(1, "event_list", "failed", "chat.invalid_call"),
      tool(2, null, "started"),
      tool(2, null, "failed", "chat.invalid_call"),
      answered(),
      done(),
    ]);
    expect(asked()).toEqual([]);
    expect(lines).toContain("warn [core:chat:tool-call] invalid channel=1 tool=event_list\n");
    expect(lines).toContain("warn [core:chat:tool-call] invalid channel=1 tool=unknown\n");
    // A name the model made up is its output, which no log line carries.
    expect(lines.join("")).not.toContain("shell_exec_now");
    // The model reads why each failed as the call's result.
    const results = (sent[1]!.body.messages as { role: string; tool_call_id?: string }[]).filter(
      (message) => message.role === "tool",
    );
    expect(results.map((message) => message.tool_call_id)).toEqual(["call_1", "call_2"]);
  });

  test("each channel numbers its calls from 1, and its later turns count on", async () => {
    const { open } = world(calling(list()));
    const first = open(1);
    const second = open(3);
    first.write(compatible());
    second.write(compatible());
    const numbers = (messages: Record<string, unknown>[]) =>
      messages.filter((message) => message.type === "tool").map((message) => message.call_id);
    const [a, b] = await Promise.all([ending(first), ending(second)]);
    expect([numbers(a), numbers(b)]).toEqual([
      [1, 1],
      [1, 1],
    ]);
    first.write(compatible("또 정리해줘"));
    expect(numbers(await ending(first))).toEqual([2, 2]);
  });

  test("no limit runs while a call runs: a change the app answers after 11 minutes goes on to the answer", async () => {
    vi.useFakeTimers();
    // Waiting with `vi.waitFor` would move the fake clock as well.
    const held = new Held((frame) => frame.type === "request");
    const { open, control } = world(
      (_sent, n) => sse(n === 1 ? chatCalls([create()]) : chat(["Done"])),
      { app: held.app },
    );
    const channel = open();
    channel.write(compatible());
    const request = await held.nth(1);
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(channel.sent).toEqual([tool(1, "event_create", "started")]);
    answerPlanner(request, control);
    expect(await ending(channel)).toEqual([
      tool(1, "event_create", "started"),
      tool(1, "event_create", "succeeded", null, "op-1"),
      answered(),
      done(),
    ]);
  });
});

describe("a call the AI SDK did not run (§7.11)", () => {
  test.each([
    {
      name: "an OpenAI-compatible answer cut at its length limit",
      message: compatible(),
      calls: () => chatCalls([list()], [], "length"),
      answer: chat,
      reason: "length",
    },
    {
      name: "an Anthropic answer cut at max_tokens",
      message: turn("anthropic", "claude-sonnet-5-5"),
      calls: () => anthropicCalls([list()], [], "max_tokens"),
      answer: anthropic,
      reason: "length",
    },
    {
      name: "an OpenAI-compatible answer that ends for a reason its package does not know",
      message: compatible(),
      calls: () => chatCalls([list()], [], "eos"),
      answer: chat,
      reason: "other",
    },
  ])(
    "$name: the call reads chat.not_run, the app hears of it, and the next turn's request goes out",
    async ({ message, calls, answer, reason }) => {
      const { sent, open, asked } = world((_sent, n) => sse(n === 1 ? calls() : answer(["Done"])));
      const channel = open();
      channel.write(message);
      expect(await ending(channel)).toEqual([
        tool(1, "event_list", "started"),
        tool(1, "event_list", "failed", "chat.not_run"),
        done(reason, 11, 3),
      ]);
      expect(asked()).toEqual([]);
      expect(lines).toContain("warn [core:chat:tool-call] not_run channel=1 tool=event_list\n");
      // The step stays with a result for the call, so the next request carries both.
      channel.write({ ...message, text: "다시" });
      expect(await ending(channel)).toEqual([answered(), done("stop", 11, 3)]);
      expect(sent).toHaveLength(2);
      const next = JSON.stringify(sent[1]!.body);
      expect(next).toContain("call_1");
      expect(next).toContain("chat.not_run");
    },
  );

  test("the text before a call the AI SDK did not run reaches the app first", async () => {
    const { open } = world((_sent, n) =>
      sse(n === 1 ? chatCalls([list()], ["Let me ", "look."], "length") : chat(["Done"])),
    );
    const channel = open();
    channel.write(compatible());
    expect(await ending(channel)).toEqual([
      answered("Let me look."),
      tool(1, "event_list", "started"),
      tool(1, "event_list", "failed", "chat.not_run"),
      done("length", 11, 3),
    ]);
  });

  test("the model reads that nothing changed and that it may call again", async () => {
    const { sent, open, asked } = world((_sent, n) =>
      sse(n === 1 ? chatCalls([create()], [], "length") : chat(["Done"])),
    );
    const channel = open();
    channel.write(compatible());
    await ending(channel);
    channel.write(compatible("다시"));
    await ending(channel);
    expect(asked()).toEqual([]);
    expect(outcomes(sent[1]!)).toEqual([
      {
        id: "call_1",
        schema: "sherpa.mcp.tool-outcome.v1",
        status: "failed",
        summary: "Nothing was changed. See error.code and error.retry.",
        capability: "event.create",
        operation_id: null,
        effect: { kind: "native_mutation", state: "not_started" },
        evidence: null,
        error: { code: "chat.not_run", retry: "safe" },
        journal_error: null,
        warnings: [],
        result: null,
      },
    ]);
  });

  test("in a step cut at its length limit, a call formed badly keeps the SDK's error, the other reads chat.not_run, and the results follow the calls' order", async () => {
    const { sent, open, asked } = world((_sent, n) =>
      sse(n === 1 ? chatCalls([list("call_1"), badly("call_2")], [], "length") : chat(["Done"])),
    );
    const channel = open();
    channel.write(compatible());
    // The app hears of each as the core learns of it: the bad call while the answer streams, the
    // other once the step has ended.
    expect(await ending(channel)).toEqual([
      tool(1, "event_list", "started"),
      tool(1, "event_list", "failed", "chat.invalid_call"),
      tool(2, "event_list", "started"),
      tool(2, "event_list", "failed", "chat.not_run"),
      done("length", 11, 3),
    ]);
    expect(asked()).toEqual([]);
    channel.write(compatible("다시"));
    expect(await ending(channel)).toEqual([answered(), done("stop", 11, 3)]);
    const results = (
      sent[1]!.body.messages as { role: string; tool_call_id?: string; content: string }[]
    ).filter((message) => message.role === "tool");
    expect(results.map((message) => message.tool_call_id)).toEqual(["call_1", "call_2"]);
    expect(JSON.parse(results[0]!.content)).toMatchObject({
      error: { code: "chat.not_run", retry: "safe" },
    });
    expect(results[1]!.content).toMatch(
      /^AI_InvalidToolInputError: Invalid input for tool event_list: /,
    );
  });

  test.each([
    {
      name: "OpenAI-compatible",
      message: compatible(),
      calls: chatCalls,
      finish: "length",
      answer: chat,
    },
    {
      name: "Anthropic",
      message: turn("anthropic", "claude-sonnet-5-5"),
      calls: anthropicCalls,
      finish: "max_tokens",
      answer: anthropic,
    },
  ])(
    "an $name call cut in the middle of its arguments reads as one formed badly: the turn ends at the length limit, and the next turn's request carries the call and why",
    async ({ message, calls, finish, answer }) => {
      const cut: ModelCall = { id: "call_1", name: "event_list", input: '{"from":"2026-11-23T0' };
      const { sent, open, asked } = world((_sent, n) =>
        sse(n === 1 ? calls([cut], [], finish) : answer(["Done"])),
      );
      const channel = open();
      channel.write(message);
      // Every call of the step has a result, the SDK's error, so the SDK would take the next step
      // whatever the step ended with (ai 7.0.179 stream-text.ts): the turn stops it.
      expect(await ending(channel)).toEqual([
        tool(1, "event_list", "started"),
        tool(1, "event_list", "failed", "chat.invalid_call"),
        done("length", 11, 3),
      ]);
      expect(sent).toHaveLength(1);
      expect(asked()).toEqual([]);
      expect(lines).toContain("warn [core:chat:tool-call] invalid channel=1 tool=event_list\n");
      expect(lines.some((line) => line.includes("not_run"))).toBe(false);
      channel.write({ ...message, text: "다시" });
      expect(await ending(channel)).toEqual([answered(), done("stop", 11, 3)]);
      expect(sent).toHaveLength(2);
      const next = JSON.stringify(sent[1]!.body);
      expect(next).toContain("call_1");
      expect(next).toContain("Invalid input for tool event_list");
    },
  );

  test.each([
    {
      name: "an OpenAI-compatible answer its content filter stopped",
      message: compatible(),
      calls: () => chatCalls([badly()], [], "content_filter"),
      answer: chat,
    },
    {
      name: "an Anthropic refusal",
      message: turn("anthropic", "claude-sonnet-5-5"),
      calls: () => anthropicCalls([badly()], [], "refusal"),
      answer: anthropic,
    },
  ])(
    "$name with a call formed badly ends the turn with content-filter: no request follows, and the conversation keeps nothing of the step",
    async ({ message, calls, answer }) => {
      const { sent, open } = world((_sent, n) => sse(n === 1 ? calls() : answer(["Done"])));
      const channel = open();
      channel.write(message);
      expect(await ending(channel)).toEqual([
        tool(1, "event_list", "started"),
        tool(1, "event_list", "failed", "chat.invalid_call"),
        done("content-filter", 11, 3),
      ]);
      expect(sent).toHaveLength(1);
      channel.write({ ...message, text: "다시" });
      expect(await ending(channel)).toEqual([answered(), done("stop", 11, 3)]);
      const next = JSON.stringify(sent[1]!.body);
      expect(next).not.toContain("call_1");
      expect(next).not.toContain("Invalid input for tool event_list");
    },
  );

  test("an OpenAI-compatible answer that ends for a reason its package does not know, with a call formed badly, ends the turn with other and keeps the call and why", async () => {
    const { sent, open } = world((_sent, n) =>
      sse(n === 1 ? chatCalls([badly()], [], "eos") : chat(["Done"])),
    );
    const channel = open();
    channel.write(compatible());
    expect(await ending(channel)).toEqual([
      tool(1, "event_list", "started"),
      tool(1, "event_list", "failed", "chat.invalid_call"),
      done("other", 11, 3),
    ]);
    expect(sent).toHaveLength(1);
    channel.write(compatible("다시"));
    expect(await ending(channel)).toEqual([answered(), done("stop", 11, 3)]);
    const next = JSON.stringify(sent[1]!.body);
    expect(next).toContain("call_1");
    expect(next).toContain("Invalid input for tool event_list");
  });

  test("an error the stream reports after a call formed badly ends the turn: no request follows, and the conversation keeps nothing of the step", async () => {
    const upstream = { data: { error: { message: "Upstream failed", code: 502 } } };
    const { sent, open } = world((_sent, n) =>
      sse(n === 1 ? [...chatCalls([badly()]).slice(0, 1), upstream] : chat(["Done"])),
    );
    const channel = open();
    channel.write(compatible());
    expect(await ending(channel)).toEqual([
      tool(1, "event_list", "started"),
      tool(1, "event_list", "failed", "chat.invalid_call"),
      {
        type: "error",
        in_reply_to: "turn",
        code: "provider_unavailable",
        retryable: true,
        status: 502,
      },
    ]);
    expect(sent).toHaveLength(1);
    channel.write(compatible("다시"));
    expect(await ending(channel)).toEqual([answered(), done("stop", 11, 3)]);
    const next = JSON.stringify(sent[1]!.body);
    expect(next).not.toContain("call_1");
    expect(next).not.toContain("Invalid input for tool event_list");
  });

  test("the channel's next call takes the number after the one chat.not_run took", async () => {
    const { open } = world((_sent, n) => {
      if (n === 1) return sse(chatCalls([list()], [], "length"));
      return sse(n === 2 ? chatCalls([list("call_2")]) : chat(["Done"]));
    });
    const channel = open();
    channel.write(compatible());
    expect(await ending(channel)).toEqual([
      tool(1, "event_list", "started"),
      tool(1, "event_list", "failed", "chat.not_run"),
      done("length", 11, 3),
    ]);
    channel.write(compatible("다시"));
    expect(await ending(channel)).toEqual([
      tool(2, "event_list", "started"),
      tool(2, "event_list", "succeeded", null, "op-1"),
      answered(),
      done(),
    ]);
  });
});

describe("a prompt the core built wrong", () => {
  // The conversation is the core's: a prompt the AI SDK refuses before its request is the core's
  // defect, which ends the turn as `internal` with an error line, so that the next hole shows.
  test("a call without its result fails the turn as internal before any request, with an error line", async () => {
    let requests = 0;
    const egress = installEgress({
      fetch: Object.assign(
        async () => {
          requests += 1;
          return sse(chat(["Done"]));
        },
        { preconnect: () => {} },
      ),
    });
    const events: Record<string, unknown>[] = [];
    const { firstOutputMs, chunkMs, deltaBytes, failureBodyBytes, steps } = chatLimits;
    const chatTurn = new ChatTurn({
      channel: 1,
      provider: "openai-compatible",
      fetch: (signal) => egress.turnFetch(allowedOrigin(BASE), signal),
      send: (event) => events.push(event),
      ended: new AbortController().signal,
      limits: { firstOutputMs, chunkMs, deltaMs: 60_000, deltaBytes, failureBodyBytes, steps },
      tools: async () => world(() => sse(chat(["Done"]))).tools,
      callNumber: () => 1,
    });
    const kept: unknown[] = [];
    const end = await chatTurn.run(
      {
        target: { provider: "openai-compatible", baseURL: BASE, apiKey: KEY, model: "m-1" },
        messages: [
          { role: "user", content: TEXT },
          {
            role: "assistant",
            content: [
              { type: "tool-call", toolCallId: "call_1", toolName: "event_list", input: WEEK },
            ],
          },
          { role: "user", content: "다시" },
        ],
      },
      (messages) => kept.push(messages),
    );
    expect(end).toEqual({
      type: "error",
      in_reply_to: "turn",
      code: "internal",
      retryable: false,
      status: null,
    });
    expect(requests).toBe(0);
    expect(events).toEqual([]);
    expect(kept).toEqual([]);
    expect(lines.filter((line) => line.startsWith("error "))).toEqual([
      expect.stringMatching(
        /^error \[core:chat:turn\] failure channel=1 provider=openai-compatible code=internal error_type=AI_MissingToolResultsError steps=0 ms=\d+\n$/,
      ),
    ]);
  });
});

describe("confirmation windows (§9)", () => {
  test("a delete the person declines ends declined, and the model reads that nothing changed", async () => {
    const { sent, open, asked, frames } = world(
      (_sent, n) => sse(n === 1 ? chatCalls([remove()]) : chat(["Done"])),
      {
        app: (frame, control) => {
          if (frame.type !== "confirm") return allowing(frame, control);
          control.onConfirmation({ id: frame.body.id, decision: "declined" });
        },
      },
    );
    const channel = open();
    channel.write(compatible());
    expect(await ending(channel)).toEqual([
      tool(1, "event_delete", "started"),
      tool(1, "event_delete", "declined", "confirmation.declined", "op-1"),
      answered(),
      done(),
    ]);
    expect(asked()).toEqual(["event.get"]);
    // The window names the chat's channel, and the chat as who asks.
    expect(frames.find((frame) => frame.type === "confirm")!.body).toMatchObject({
      tool: "event_delete",
      operation_id: "op-1",
      channel: 1,
      client: { name: "sherpa-chat", version: SHERPA_VERSION },
    });
    expect(outcomes(sent[1]!)).toMatchObject([
      {
        status: "failed",
        effect: { kind: "native_mutation", state: "not_started" },
        error: { code: "confirmation.declined", retry: "after_user_action" },
      },
    ]);
  });

  test("a window nobody answers in its 30 s ends timed out and is withdrawn", async () => {
    const held = new Held((frame) => frame.type === "confirm");
    const { open, timers, frames, asked } = world(
      (_sent, n) => sse(n === 1 ? chatCalls([remove()]) : chat(["Done"])),
      { app: held.app },
    );
    const channel = open();
    channel.write(compatible());
    const confirm = await held.nth(1);
    timers.fire(confirm.body.timeout_ms as number);
    expect(await ending(channel)).toEqual([
      tool(1, "event_delete", "started"),
      tool(1, "event_delete", "failed", "confirmation.timed_out", "op-1"),
      answered(),
      done(),
    ]);
    expect(frames.map((frame) => frame.type)).toEqual(["request", "confirm", "withdraw"]);
    expect(asked()).toEqual(["event.get"]);
  });
});

describe("a cancel while a step's calls run (§7.11)", () => {
  test("withdraws a window that waits: nothing changed, the turn ends aborted with its tokens, and no request follows", async () => {
    const held = new Held((frame) => frame.type === "confirm");
    const { sent, open, asked, frames } = world(
      (_sent, n) => sse(n === 1 ? chatCalls([remove()]) : chat(["Done"])),
      { app: held.app },
    );
    const channel = open();
    channel.write(compatible());
    await held.nth(1);
    channel.write({ type: "cancel" });
    expect(await ending(channel)).toEqual([
      tool(1, "event_delete", "started"),
      tool(1, "event_delete", "withdrawn", "chat.cancelled"),
      done("aborted", 11, 3),
    ]);
    expect(frames.map((frame) => frame.type)).toEqual(["request", "confirm", "withdraw"]);
    expect(asked()).toEqual(["event.get"]);
    expect(sent).toHaveLength(1);
    expect(logged("info [core:chat:tool-call] abandoned channel=1 tool=event_delete ms=")).toBe(
      true,
    );
    expect(
      logged("info [core:chat:turn] cancelled channel=1 provider=openai-compatible steps=1 ms="),
    ).toBe(true);
    // The step stays with the call taken back, and the next turn follows it.
    channel.write(compatible("그냥 둬"));
    expect(await ending(channel)).toEqual([answered(), done("stop", 11, 3)]);
    expect(outcomes(sent[1]!)).toMatchObject([
      {
        id: "call_1",
        status: "failed",
        operation_id: null,
        effect: { kind: "native_mutation", state: "not_started" },
        error: { code: "chat.cancelled", retry: "after_user_action" },
      },
    ]);
  });

  test("cuts a read the planner runs", async () => {
    const held = new Held((frame) => frame.type === "request");
    const { sent, open, control } = world(() => sse(chatCalls([list()])), { app: held.app });
    const channel = open();
    channel.write(compatible());
    const request = await held.nth(1);
    channel.write({ type: "cancel" });
    expect(await ending(channel)).toEqual([
      tool(1, "event_list", "started"),
      tool(1, "event_list", "withdrawn", "chat.cancelled"),
      done("aborted", 11, 3),
    ]);
    expect(sent).toHaveLength(1);
    // The answer that comes after is late.
    answerPlanner(request, control);
    expect(lines).toContain("warn [core:control:response] late id=1\n");
  });

  test("waits for a change the planner was asked for, and withdraws the call after it", async () => {
    const held = new Held((frame) => frame.type === "request");
    const { sent, open, asked, control } = world(
      () => sse(chatCalls([create("call_1"), list("call_2")])),
      { app: held.app },
    );
    const channel = open();
    channel.write(compatible());
    const request = await held.nth(1);
    channel.write({ type: "cancel" });
    // The app runs the request to its end (§7.8), so the model and the person learn what it did.
    await pause();
    expect(channel.sent).toEqual([tool(1, "event_create", "started")]);
    answerPlanner(request, control);
    expect(await ending(channel)).toEqual([
      tool(1, "event_create", "started"),
      tool(1, "event_create", "succeeded", null, "op-1"),
      tool(2, "event_list", "started"),
      tool(2, "event_list", "withdrawn", "chat.cancelled"),
      done("aborted", 11, 3),
    ]);
    expect(asked()).toEqual(["event.create"]);
    expect(sent).toHaveLength(1);
    expect(lines).toContain("info [core:chat:tool-call] withdrawn channel=1 tool=event_list\n");
  });

  test.each([
    {
      name: "a send the core runs",
      call: { id: "call_1", name: "imessage_send", input: { chat_id: 7, text: "곧 도착" } },
      operationID: "op-1",
    },
    {
      name: "a read the core runs itself",
      call: { id: "call_1", name: "imessage_chats", input: { limit: 5 } },
      operationID: null,
    },
  ])("lets $name end, and the app hears what it did", async ({ call, operationID }) => {
    const running = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const { sent, open } = world(() => sse(chatCalls([call, { ...list(), id: "call_2" }])), {
      commands: {
        imessageChat: async () => family,
        imessageSend: async ({ operationID: id }) => {
          running.resolve();
          await finish.promise;
          return accepted(id);
        },
        imessageChats: async () => {
          running.resolve();
          await finish.promise;
          return "";
        },
      },
    });
    const channel = open();
    channel.write(compatible());
    await running.promise;
    channel.write({ type: "cancel" });
    await pause();
    expect(channel.sent).toEqual([tool(1, call.name, "started")]);
    finish.resolve();
    expect(await ending(channel)).toEqual([
      tool(1, call.name, "started"),
      tool(1, call.name, "succeeded", null, operationID),
      tool(2, "event_list", "started"),
      tool(2, "event_list", "withdrawn", "chat.cancelled"),
      done("aborted", 11, 3),
    ]);
    expect(sent).toHaveLength(1);
  });

  test("after the model called a tool and before its answer ended, runs no tool and keeps nothing of the step", async () => {
    let stream: ReturnType<typeof openStream> | undefined;
    const { sent, open, frames } = world(
      (request, n) => {
        if (n > 1) return sse(anthropic(["Done"]));
        stream = openStream(request.signal);
        return stream.response;
      },
      { chat: { turn: { deltaMs: 1 } } },
    );
    const channel = open();
    channel.write(turn("anthropic", "claude-sonnet-5-5"));
    await vi.waitFor(() => expect(stream).toBeDefined());
    // The call's block is read: only the end of the answer is missing.
    stream!.send(...anthropicCalls([create()], ["Adding it."]).slice(0, -2));
    expect(await channel.next()).toEqual(answered("Adding it."));
    await pause();
    channel.write({ type: "cancel" });
    expect(await ending(channel)).toEqual([done("aborted", null, null)]);
    expect(frames).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.signal?.aborted).toBe(true);
    // The next turn sends the two texts, and nothing of the call.
    channel.write(turn("anthropic", "claude-sonnet-5-5", "다시"));
    expect(await ending(channel)).toEqual([answered(), done("stop", 11, 3)]);
    const conversation = JSON.stringify(sent[1]!.body.messages);
    expect(conversation).not.toContain("tool_use");
    expect(conversation).not.toContain("Adding it.");
  });

  test("closing the channel while a call runs ends the turn without a word, and its result reaches nobody", async () => {
    const held = new Held((frame) => frame.type === "request");
    const { sent, open } = world(() => sse(chatCalls([create()])), { app: held.app });
    const channel = open();
    channel.write(compatible());
    await held.nth(1);
    channel.onclose?.();
    await vi.waitFor(() =>
      expect(
        logged("info [core:chat:turn] abandoned channel=1 provider=openai-compatible ms="),
      ).toBe(true),
    );
    expect(logged("info [core:chat:tool-call] abandoned channel=1 tool=event_create ms=")).toBe(
      true,
    );
    expect(channel.sent).toEqual([tool(1, "event_create", "started")]);
    expect(sent).toHaveLength(1);
  });
});

// §7.11 "다시 보내기": the rows of the contract's table with a tool in them, each a test; the rows
// without are in tests/chat-turn.test.ts.
describe("a turn without text after a turn that called tools", () => {
  /** JSON leaves out a key whose value is undefined. */
  const again = () => ({ ...compatible(), text: undefined });
  /** The roles of the messages an OpenAI-compatible request sends, in order. */
  const roles = (request: Sent) =>
    (request.body.messages as { role: string }[]).map((message) => message.role);

  test.each([
    {
      name: "done length, whose call the AI SDK did not run",
      calls: () => chatCalls([list()], [], "length"),
      reason: "length",
      code: "chat.not_run",
    },
    {
      name: "done other, whose call the model formed badly",
      calls: () => chatCalls([badly()], [], "eos"),
      reason: "other",
      code: "chat.invalid_call",
    },
    {
      name: "done length, whose call was cut in the middle of its arguments",
      calls: () =>
        chatCalls(
          [{ id: "call_1", name: "event_list", input: '{"from":"2026-11-23T0' }],
          [],
          "length",
        ),
      reason: "length",
      code: "chat.invalid_call",
    },
  ])(
    "after $name sends the conversation again, which ends with the call's result",
    async ({ calls, reason, code }) => {
      const { sent, open, asked } = world((_sent, n) => sse(n === 1 ? calls() : chat(["Done"])));
      const channel = open();
      channel.write(compatible());
      expect(await ending(channel)).toEqual([
        tool(1, "event_list", "started"),
        tool(1, "event_list", "failed", code),
        done(reason, 11, 3),
      ]);
      channel.write(again());
      expect(await ending(channel)).toEqual([answered(), done("stop", 11, 3)]);
      expect(asked()).toEqual([]);
      expect(roles(sent[1]!)).toEqual(["system", "user", "assistant", "tool"]);
    },
  );

  test("after done aborted while a call waited sends the conversation again, which ends with the call taken back", async () => {
    const held = new Held((frame) => frame.type === "confirm");
    const { sent, open } = world(
      (_sent, n) => sse(n === 1 ? chatCalls([remove()]) : chat(["Done"])),
      { app: held.app },
    );
    const channel = open();
    channel.write(compatible());
    await held.nth(1);
    channel.write({ type: "cancel" });
    expect(await ending(channel)).toEqual([
      tool(1, "event_delete", "started"),
      tool(1, "event_delete", "withdrawn", "chat.cancelled"),
      done("aborted", 11, 3),
    ]);
    channel.write(again());
    expect(await ending(channel)).toEqual([answered(), done("stop", 11, 3)]);
    expect(roles(sent[1]!)).toEqual(["system", "user", "assistant", "tool"]);
    expect(outcomes(sent[1]!)).toMatchObject([
      { id: "call_1", error: { code: "chat.cancelled", retry: "after_user_action" } },
    ]);
  });

  test("after done step-limit sends the conversation again, and the tools may take 20 more requests", async () => {
    const { sent, open } = world((_sent, n) =>
      sse(n <= 2 * chatLimits.steps ? chatCalls([list(`call_${n}`)]) : chat(["Done"])),
    );
    const channel = open();
    channel.write(compatible());
    expect((await ending(channel)).at(-1)).toEqual(done("step-limit", 220, 60));
    channel.write(again());
    expect((await ending(channel)).at(-1)).toEqual(done("step-limit", 220, 60));
    expect(sent).toHaveLength(40);
    // The second turn's first request follows the twentieth call's result, and no text after it.
    const next = sent[20]!.body.messages as { role: string; tool_call_id?: string }[];
    expect(next.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_20" });
    expect(next.filter((message) => message.role === "user")).toHaveLength(1);
    channel.write(again());
    expect(await ending(channel)).toEqual([answered(), done("stop", 11, 3)]);
    expect(sent).toHaveLength(41);
  });

  test("after an error that followed a tool step sends the conversation again, which ends with the step's result, and the tool does not run again", async () => {
    const { sent, open, asked } = world((_sent, n) => {
      if (n === 1) return sse(chatCalls([list()]));
      return n === 2 ? failure(400) : sse(chat(["Done"]));
    });
    const channel = open();
    channel.write(compatible());
    expect(await ending(channel)).toEqual([
      tool(1, "event_list", "started"),
      tool(1, "event_list", "succeeded", null, "op-1"),
      {
        type: "error",
        in_reply_to: "turn",
        code: "provider_rejected",
        retryable: false,
        status: 400,
      },
    ]);
    channel.write(again());
    expect(await ending(channel)).toEqual([answered(), done("stop", 11, 3)]);
    expect(asked()).toEqual(["event.list"]);
    expect(sent).toHaveLength(3);
    expect(roles(sent[2]!)).toEqual(["system", "user", "assistant", "tool"]);
  });

  test("after a step of reasoning alone that followed a tool step and ended with done length has nothing to send again, though the app heard of a tool last", async () => {
    const reasoning = [
      chunk({ role: "assistant", reasoning_content: "Let me see" }),
      ...chat([], "length"),
    ];
    const { sent, open } = world((_sent, n) => sse(n === 1 ? chatCalls([list()]) : reasoning));
    const channel = open();
    channel.write(compatible());
    expect(await ending(channel)).toEqual([
      tool(1, "event_list", "started"),
      tool(1, "event_list", "succeeded", null, "op-1"),
      done("length"),
    ]);
    channel.write(again());
    expect(await channel.next()).toEqual({
      type: "error",
      in_reply_to: "turn",
      code: "invalid_message",
      retryable: false,
      status: null,
    });
    expect(lines).toContain("warn [core:chat:turn] refused channel=1 reason=nothing_to_retry\n");
    expect(sent).toHaveLength(2);
  });

  test.each([
    {
      name: "Anthropic, whose package tells of the call when its block ends",
      message: turn("anthropic", "claude-sonnet-5-5"),
      first: () => {
        const calls = anthropicCalls([badly()], [], "max_tokens");
        const text = [
          {
            event: "content_block_start",
            data: {
              type: "content_block_start",
              index: 1,
              content_block: { type: "text", text: "" },
            },
          },
          {
            event: "content_block_delta",
            data: {
              type: "content_block_delta",
              index: 1,
              delta: { type: "text_delta", text: "After" },
            },
          },
          { event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
        ];
        return [...calls.slice(0, 4), ...text, ...calls.slice(4)];
      },
      frames: [
        tool(1, "event_list", "started"),
        tool(1, "event_list", "failed", "chat.invalid_call"),
        answered("After"),
        done("length", 11, 3),
      ],
      answer: anthropic,
    },
    {
      name: "OpenAI-compatible, whose package tells of the call when the response ends",
      message: compatible(),
      first: () => {
        const events = chatCalls([badly()], [], "length");
        events.splice(1, 0, chunk({ content: "After" }));
        return events;
      },
      frames: [
        answered("After"),
        tool(1, "event_list", "started"),
        tool(1, "event_list", "failed", "chat.invalid_call"),
        done("length", 11, 3),
      ],
      answer: chat,
    },
  ])(
    "after a step with text after a call formed badly, on $name, sends the conversation again, which ends with the call's result",
    async ({ message, first, frames, answer }) => {
      const { sent, open } = world((_sent, n) => sse(n === 1 ? first() : answer(["Done"])));
      const channel = open();
      channel.write(message);
      expect(await ending(channel)).toEqual(frames);
      channel.write({ ...message, text: undefined });
      expect(await ending(channel)).toEqual([answered(), done("stop", 11, 3)]);
      expect(sent).toHaveLength(2);
      expect(JSON.stringify(sent[1]!.body)).toContain("Invalid input for tool event_list");
    },
  );

  test("whose conversation grew past its limit in the turn before is conversation_limit, and the chat takes no later turn", async () => {
    // Only a turn's start reads the limit, so the step that passes it stays.
    const big = "가".repeat(Math.ceil((2 * 1024 * 1024) / 3));
    const { sent, open } = world((_sent, n) =>
      n === 1 ? sse(chatCalls([list()], [big])) : failure(400),
    );
    const channel = open();
    channel.write(compatible());
    expect((await ending(channel)).at(-1)).toMatchObject({
      type: "error",
      code: "provider_rejected",
    });
    const limit = {
      type: "error",
      in_reply_to: "turn",
      code: "conversation_limit",
      retryable: false,
      status: null,
    };
    channel.write(again());
    expect(await channel.next()).toEqual(limit);
    expect(lines).toContain("warn [core:chat:turn] refused channel=1 reason=conversation_limit\n");
    channel.write(compatible("그리고"));
    expect(await channel.next()).toEqual(limit);
    expect(sent).toHaveLength(2);
  });
});

describe("each provider's request", () => {
  test.each([
    {
      name: "anthropic",
      message: turn("anthropic", "claude-sonnet-5-5"),
      calls: anthropicCalls,
      answer: anthropic,
    },
    { name: "openai", message: turn("openai", "gpt-5.1"), calls: openaiCalls, answer: openai },
    {
      name: "google",
      message: turn("google", "gemini-3.5-flash"),
      calls: googleCalls,
      answer: google,
    },
    { name: "openai-compatible", message: compatible(), calls: chatCalls, answer: chat },
  ])(
    "$name gets the 35 tools without a schema dialect or the safe-integer bounds, and the outcome back",
    async ({ message, calls, answer }) => {
      const { sent, open, tools } = world((_sent, n) =>
        sse(n === 1 ? calls([list()]) : answer(["Done"])),
      );
      const channel = open();
      channel.write(message);
      expect(await ending(channel)).toEqual([
        tool(1, "event_list", "started"),
        tool(1, "event_list", "succeeded", null, "op-1"),
        answered(),
        done(),
      ]);
      expect(tools).toHaveLength(35);
      expect(sent[0]!.body.tools).toHaveLength(35);
      const definitions = JSON.stringify(sent[0]!.body.tools);
      expect(definitions).not.toContain("$schema");
      expect(definitions).not.toContain(String(Number.MAX_SAFE_INTEGER));
      // The second request answers the call by its id with the outcome.
      const second = JSON.stringify(sent[1]!.body);
      expect(second).toContain("call_1");
      expect(second).toContain("event.list");
    },
  );

  test("anthropic caches the instructions and the conversation, and marks no tool", async () => {
    const { sent, open } = world(() => sse(anthropic(["Hi"])));
    const channel = open();
    channel.write(turn("anthropic", "claude-sonnet-5-5"));
    await ending(channel);
    const body = sent[0]!.body;
    // The cached prefix runs tools, system, then messages: the instructions' breakpoint covers the
    // tools, and the top-level one moves to the conversation's last block (ADR-0012 "비용과 모델 선택").
    expect(body.system).toEqual([
      { type: "text", text: INSTRUCTIONS, cache_control: { type: "ephemeral" } },
    ]);
    expect(body.cache_control).toEqual({ type: "ephemeral" });
    expect(
      (body.tools as Record<string, unknown>[]).filter((item) => "cache_control" in item),
    ).toEqual([]);
  });
});

describe("the log", () => {
  test("a tool-call line names the channel, the tool and how it ended, never what it was given or gave back", async () => {
    const secrets = {
      to: "dana.private@example.com",
      subject: "SUBJECT-7f3a",
      body: "BODY-9c2e",
      text: "MESSAGE-4b1d",
      result: "RESULT-5e8f",
    };
    const { open } = world(
      calling(
        {
          id: "call_1",
          name: "mail_send",
          input: {
            to: [secrets.to],
            cc: [],
            bcc: [],
            subject: secrets.subject,
            body: secrets.body,
          },
        },
        { id: "call_2", name: "imessage_send", input: { chat_id: 7, text: secrets.text } },
        list("call_3"),
      ),
      {
        app: (frame, control) => {
          if (frame.type !== "request") return allowing(frame, control);
          answerPlanner(frame, control, {
            result: { schema: "x", events: [{ title: secrets.result }] },
          });
        },
        commands: {
          imessageChat: async () => family,
          imessageSend: async ({ operationID }) =>
            accepted(operationID, JSON.stringify({ text: secrets.text })),
          mailSend: async ({ operationID }) =>
            accepted(operationID, JSON.stringify({ subject: secrets.subject })),
        },
      },
    );
    const channel = open();
    channel.write(compatible());
    expect((await ending(channel)).at(-1)).toEqual(done());
    expect(
      lines
        .filter((line) => line.includes("[core:chat:tool-call]"))
        .map((line) => line.replace(/ ms=\d+/, "").trimEnd()),
    ).toEqual([
      "info [core:chat:tool-call] start channel=1 tool=mail_send",
      "info [core:chat:tool-call] success channel=1 tool=mail_send status=succeeded code=none operation_id=op-1",
      "info [core:chat:tool-call] start channel=1 tool=imessage_send",
      "info [core:chat:tool-call] success channel=1 tool=imessage_send status=succeeded code=none operation_id=op-2",
      "info [core:chat:tool-call] start channel=1 tool=event_list",
      "info [core:chat:tool-call] success channel=1 tool=event_list status=succeeded code=none operation_id=op-3",
    ]);
    // Nor any other line, at debug either.
    const log = lines.join("");
    for (const secret of Object.values(secrets)) expect(log).not.toContain(secret);
    expect(log).not.toContain(KEY);
  });
});
