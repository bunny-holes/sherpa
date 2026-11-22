import { type ModelMessage, streamText, wrapLanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { type ChatIdentity, Conversation, TurnRoom } from "../src/chat/conversation.ts";
import { installEgress } from "../src/chat/egress.ts";
import { ChatFailure } from "../src/chat/errors.ts";
import { chatLimits } from "../src/chat/protocol.ts";
import { AnswerCount, answerLimit, type ModelPart } from "../src/chat/sdk/answer.ts";
import { type ToolRunner, toolSet } from "../src/chat/sdk/tools.ts";
import { installWarningLog } from "../src/chat/warnings.ts";
import { type CapabilityDescriptor, reconcile } from "../src/mcp/registry.ts";
import { resolveTools } from "../src/mcp/tools.ts";
import type { ToolOutcome } from "../src/tools/outcome.ts";
import { plannerDescriptors } from "./support/planner.ts";

// app-connection-v1 §7.11 "대화 한도": the room a turn has before its conversation passes 2 MiB,
// the count of an answer as it streams against what the AI SDK 7.0.179 keeps of its step, and the
// middleware that cuts an answer past the limit. The models here are the SDK's mock, which sends
// no request; the global fetch refuses, as in the core.
installEgress();
installWarningLog();

const LIMIT = chatLimits.conversationBytes;
const IDENTITY: ChatIdentity = {
  provider: "openai-compatible",
  baseURL: "https://models.example/v1",
  model: "m-1",
};
const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
/** What a step's messages add to the conversation's JSON, each after its comma. */
const added = (messages: ModelMessage[]) =>
  messages.reduce((sum, message) => sum + jsonBytes(message) + 1, 0);

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
/** A stream of these parts that closes after them. */
const streamOf = (parts: ModelPart[]) =>
  new ReadableStream<ModelPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
const finish = (unified: "stop" | "tool-calls"): ModelPart => ({
  type: "finish",
  usage,
  finishReason: { unified, raw: unified },
});

let lines: string[];
beforeEach(() => {
  lines = [];
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
});
afterEach(() => {
  vi.restoreAllMocks();
  // No AI SDK warning: the parts are ones the SDK reads as a provider's.
  expect(lines.filter((line) => line.includes("[core:chat:sdk-warning]"))).toEqual([]);
});

describe("a turn's room", () => {
  const step: ModelMessage[] = [
    {
      role: "assistant",
      content: [
        { type: "text", text: 'a "quoted" 가\n' },
        { type: "tool-call", toolCallId: "call_1", toolName: "event_list", input: { from: "a" } },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call_1",
          toolName: "event_list",
          output: { type: "json", value: { status: "succeeded" } },
        },
      ],
    },
  ];

  test("keeps a step's messages to the byte, as the turn's start measures the conversation", () => {
    const conversation = new Conversation();
    const start = conversation.start(IDENTITY, "hello", "[time]");
    if (start.type !== "started") throw new Error("expected the turn to start");
    const before = jsonBytes(start.messages);
    const after = jsonBytes([...start.messages, ...step]);
    const filled: string[] = [];
    // The conversation ends the step at the limit exactly, and then a byte past it.
    const at = new TurnRoom(before + LIMIT - after, () => filled.push("at"));
    at.keep(step);
    expect(at.passed).toBe(false);
    const past = new TurnRoom(before + LIMIT - after + 1, () => filled.push("past"));
    past.keep(step);
    expect(past.passed).toBe(true);
    expect(filled).toEqual(["past"]);
  });

  test("passes at the first byte past the limit, fills the chat once and stays past", () => {
    let filled = 0;
    const room = new TurnRoom(LIMIT - 10, () => (filled += 1));
    room.request();
    expect(room.answers(10)).toBe(true);
    expect(room.answers(1)).toBe(false);
    room.request();
    expect(room.answers(0)).toBe(false);
    expect(room.admits()).toBe(false);
    expect(room.passed).toBe(true);
    expect(filled).toBe(1);
  });

  test("admits a call while the largest result still fits beside the answer and the results before it", () => {
    let filled = 0;
    const room = new TurnRoom(LIMIT - chatLimits.toolResultBytes - 100, () => (filled += 1));
    room.request();
    room.answers(50);
    expect(room.admits()).toBe(true);
    room.result(50);
    expect(room.admits()).toBe(true);
    room.result(1);
    expect(room.admits()).toBe(false);
    expect(room.passed).toBe(true);
    expect(filled).toBe(1);
    // A request counts its answer and its results from nothing.
    const next = new TurnRoom(LIMIT - chatLimits.toolResultBytes, () => (filled += 1));
    next.answers(10);
    next.request();
    expect(next.admits()).toBe(true);
    expect(chatLimits.toolResultBytes).toBe(64 * 1024);
  });

  test("that passes fills its chat: no later turn starts, with text or without", () => {
    const conversation = new Conversation();
    const start = conversation.start(IDENTITY, "hello", "[time]");
    if (start.type !== "started") throw new Error("expected the turn to start");
    expect(conversation.resendable()).toBe(true);
    start.room.request();
    expect(start.room.answers(LIMIT)).toBe(false);
    expect(conversation.resendable()).toBe(false);
    expect(conversation.start(IDENTITY, "more", "[time]")).toEqual({
      type: "refused",
      reason: "conversation_limit",
    });
    expect(conversation.again(IDENTITY)).toEqual({
      type: "refused",
      reason: "conversation_limit",
    });
  });
});

/** A model that streams `parts` once, and the step's messages the AI SDK keeps of them. */
async function kept(parts: ModelPart[], tools?: Parameters<typeof streamText>[0]["tools"]) {
  const model = new MockLanguageModelV4({
    doStream: async () => ({ stream: streamOf(parts) }),
  });
  let messages: ModelMessage[] = [];
  const result = streamText({
    model,
    prompt: "hi",
    ...(tools ? { tools } : {}),
    stopWhen: () => true,
    onStepEnd: (step) => {
      messages = step.response.messages;
    },
  });
  for await (const part of result.stream) {
    if (part.type === "error") throw part.error;
  }
  return messages;
}

/** What the answer's count says of `parts`, part by part. */
function counted(parts: ModelPart[]): number {
  const count = new AnswerCount();
  return parts.reduce((sum, part) => sum + count.bytes(part), 0);
}

describe("an answer's count", () => {
  test.each<{ name: string; parts: ModelPart[] }>([
    {
      name: "text in pieces that JSON escapes, an emoji cut between its halves",
      parts: [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t" },
        ...[
          'Hello "world"\\',
          "\n\t\u0001",
          "😀".slice(0, 1),
          "😀".slice(1),
          "한국어 ",
          "x".repeat(5000),
        ].map((delta): ModelPart => ({ type: "text-delta", id: "t", delta })),
        { type: "text-end", id: "t" },
        finish("stop"),
      ],
    },
    {
      name: "reasoning whose signature comes last, and text whose metadata changes as it streams",
      parts: [
        { type: "reasoning-start", id: "r" },
        { type: "reasoning-delta", id: "r", delta: "thinking ".repeat(100) },
        {
          type: "reasoning-delta",
          id: "r",
          delta: "",
          providerMetadata: { anthropic: { signature: "s".repeat(400) } },
        },
        { type: "reasoning-end", id: "r" },
        { type: "text-start", id: "0" },
        {
          type: "text-delta",
          id: "0",
          delta: "first",
          providerMetadata: { google: { thoughtSignature: "g".repeat(300) } },
        },
        {
          type: "text-delta",
          id: "0",
          delta: " second",
          providerMetadata: { google: { thoughtSignature: "g".repeat(20) } },
        },
        { type: "text-end", id: "0" },
        // A block that takes an id again is a part of its own.
        { type: "text-start", id: "0", providerMetadata: { openai: { itemId: "msg_2" } } },
        { type: "text-delta", id: "0", delta: "third" },
        { type: "text-end", id: "0", providerMetadata: { openai: { itemId: "msg_2" } } },
        finish("stop"),
      ],
    },
    {
      name: "files and a part of the provider's own",
      parts: [
        {
          type: "file",
          mediaType: "image/png",
          data: { type: "data", data: new Uint8Array(1000).fill(7) },
          providerMetadata: { google: { id: "f1" } },
        },
        {
          type: "reasoning-file",
          mediaType: "image/png",
          data: { type: "data", data: Buffer.from("x".repeat(200)).toString("base64") },
        },
        { type: "custom", kind: "openai.compaction", providerMetadata: { openai: { id: "c" } } },
        finish("stop"),
      ],
    },
  ])("bounds what the AI SDK keeps of $name", async ({ parts }) => {
    const exact = added(await kept(parts));
    const count = counted(parts);
    expect(count).toBeGreaterThanOrEqual(exact);
    // Not by much: an answer near the limit is not cut for keys it does not add.
    expect(count - exact).toBeLessThan(512);
  });

  // The core's 35 tools as `app serve` builds them, whose calls the AI SDK checks before they run.
  const outcome = { status: "succeeded", result: { items: ["e".repeat(100)] } };
  const runner: ToolRunner = { run: async () => outcome as unknown as ToolOutcome };
  const tools = toolSet(
    resolveTools(
      reconcile({
        kind: "discovered",
        descriptors: plannerDescriptors() as unknown as CapabilityDescriptor[],
      }),
      { planner: {} as never, confirmations: {} as never, commands: {} as never },
    ),
    runner,
  );
  const WEEK = { from: "2026-11-23T00:00:00+09:00", to: "2026-11-30T00:00:00+09:00" };
  test.each([
    {
      name: "a call that runs, its input streamed with spaces",
      tool: "event_list",
      input: JSON.stringify(WEEK, null, 2),
      runs: true,
    },
    {
      name: "a call to a tool the core does not have",
      tool: "event_lists",
      input: JSON.stringify(WEEK),
      runs: false,
    },
    {
      name: "a call whose input does not parse",
      tool: "event_list",
      input: `{"from":"${"a".repeat(10_000)}`,
      runs: false,
    },
    {
      name: "a call its schema refuses",
      tool: "event_list",
      input: JSON.stringify({ from: WEEK.from }),
      runs: false,
    },
    {
      name: "a call whose input is no object",
      tool: "event_list",
      input: JSON.stringify("hello"),
      runs: false,
    },
  ])(
    "bounds what the AI SDK keeps of $name, the result of one that runs besides",
    async ({ tool, input, runs }) => {
      const parts: ModelPart[] = [
        { type: "stream-start", warnings: [] },
        { type: "tool-input-start", id: "call_1", toolName: tool },
        { type: "tool-input-delta", id: "call_1", delta: input.slice(0, 7) },
        { type: "tool-input-delta", id: "call_1", delta: input.slice(7) },
        { type: "tool-input-end", id: "call_1" },
        { type: "tool-call", toolCallId: "call_1", toolName: tool, input },
        finish("tool-calls"),
      ];
      const messages = await kept(parts, tools);
      expect(messages.map((message) => message.role)).toEqual(["assistant", "tool"]);
      const result = runs ? jsonBytes(outcome) : 0;
      const exact = added(messages);
      expect(counted(parts) + result).toBeGreaterThanOrEqual(exact);
      expect(JSON.stringify(messages.at(-1))).toContain(runs ? '"succeeded"' : '"error-text"');
    },
  );

  test("leaves out the issues of a schema that refuses many, which only the step's end measures", async () => {
    // The limit §7.11 "대화 한도" names: the SDK's error writes every issue zod found.
    const unknown = Object.fromEntries(
      Array.from({ length: 2000 }, (_, index) => [`k${index}`, 0]),
    );
    const alarms = {
      title: "Lunch",
      start: "2026-11-23T12:00:00+09:00",
      end: "2026-11-23T13:00:00+09:00",
      alarms: Array(2000).fill(1),
    };
    for (const { tool, input, bytes, keeps } of [
      {
        tool: "event_list",
        input: JSON.stringify({ ...WEEK, ...unknown }),
        bytes: 18_959,
        keeps: 106_223,
      },
      { tool: "event_create", input: JSON.stringify(alarms), bytes: 4_098, keeps: 409_491 },
    ]) {
      const parts: ModelPart[] = [
        { type: "stream-start", warnings: [] },
        { type: "tool-input-start", id: "call_1", toolName: tool },
        { type: "tool-input-delta", id: "call_1", delta: input },
        { type: "tool-input-end", id: "call_1" },
        { type: "tool-call", toolCallId: "call_1", toolName: tool, input },
        finish("tool-calls"),
      ];
      expect(Buffer.byteLength(input)).toBe(bytes);
      const exact = added(await kept(parts, tools));
      expect(exact).toBe(keeps);
      expect(counted(parts)).toBeLessThan(exact);
    }
  });
});

describe("the middleware that cuts an answer", () => {
  /** A response that streams `parts` and stays open, as a provider's does, and whether it was cancelled. */
  function response(parts: ModelPart[]) {
    const state = { cancelled: false };
    const stream = new ReadableStream<ModelPart>({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
      },
      cancel() {
        state.cancelled = true;
      },
    });
    return { stream, state };
  }
  const text = (delta: string): ModelPart => ({ type: "text-delta", id: "t", delta });
  const unexpected = () => Promise.reject(new Error("unexpected"));

  async function through(room: TurnRoom, parts: ModelPart[]) {
    const { stream, state } = response(parts);
    const wrapped = await answerLimit(room).wrapStream!({
      doStream: async () => ({ stream }),
      doGenerate: unexpected,
      params: {} as never,
      model: {} as never,
    });
    const out: ModelPart[] = [];
    for await (const part of wrapped.stream) out.push(part);
    return { out, state };
  }

  test("passes what fits, then one error part, the ChatFailure conversation_limit, and cancels the response", async () => {
    let filled = 0;
    // The two messages and the block's keys, 64 bytes each, and 150 bytes of room for the text.
    const room = new TurnRoom(LIMIT - 64 - 64 - 150, () => (filled += 1));
    const start: ModelPart = { type: "stream-start", warnings: [] };
    const block: ModelPart = { type: "text-start", id: "t" };
    const { out, state } = await through(room, [
      start,
      block,
      text("a".repeat(100)),
      text("b".repeat(100)),
      finish("stop"),
    ]);
    expect(out.slice(0, 3)).toEqual([start, block, text("a".repeat(100))]);
    expect(out).toHaveLength(4);
    const cut = out[3]!;
    expect(cut.type).toBe("error");
    const failure = (cut as { error: unknown }).error;
    expect(failure).toBeInstanceOf(ChatFailure);
    expect((failure as ChatFailure).code).toBe("conversation_limit");
    expect(state.cancelled).toBe(true);
    expect(room.passed).toBe(true);
    expect(filled).toBe(1);
  });

  test("cuts before anything when the response's first part already passes", async () => {
    const room = new TurnRoom(LIMIT - 10, () => {});
    const { out, state } = await through(room, [
      { type: "stream-start", warnings: [] },
      finish("stop"),
    ]);
    expect(out.map((part) => part.type)).toEqual(["error"]);
    expect(state.cancelled).toBe(true);
  });

  test("is not sent again by the AI SDK, which passes the ChatFailure on and keeps nothing of the step", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: streamOf([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t" },
          text("x".repeat(chatLimits.conversationBytes)),
          { type: "text-end", id: "t" },
          finish("stop"),
        ]),
      }),
    });
    const room = new TurnRoom(100, () => {});
    const reasons: string[] = [];
    const result = streamText({
      model: wrapLanguageModel({ model, middleware: answerLimit(room) }),
      prompt: "hi",
      maxRetries: 2,
      onError: () => {},
      onStepEnd: (step) => {
        reasons.push(step.finishReason);
      },
    });
    const errors: unknown[] = [];
    let texts = 0;
    for await (const part of result.stream) {
      if (part.type === "error") errors.push(part.error);
      if (part.type === "text-delta") texts += 1;
    }
    expect(model.doStreamCalls).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(ChatFailure);
    expect((errors[0] as ChatFailure).code).toBe("conversation_limit");
    expect(texts).toBe(0);
    // A step that ended in an error leaves nothing in the conversation (src/chat/sdk/turn.ts).
    expect(reasons).toEqual(["error"]);
  });
});
