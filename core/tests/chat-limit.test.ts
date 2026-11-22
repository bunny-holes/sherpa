import {
  type ModelMessage,
  streamText,
  type ToolModelMessage,
  type ToolResultPart,
  wrapLanguageModel,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { type ChatIdentity, Conversation, TurnRoom } from "../src/chat/conversation.ts";
import { installEgress } from "../src/chat/egress.ts";
import { ChatFailure } from "../src/chat/errors.ts";
import { chatLimits } from "../src/chat/protocol.ts";
import { AnswerCount, answerLimit, type ModelPart } from "../src/chat/sdk/answer.ts";
import { issueText, type ToolRunner, toolSet } from "../src/chat/sdk/tools.ts";
import { installWarningLog } from "../src/chat/warnings.ts";
import { type CapabilityDescriptor, reconcile } from "../src/mcp/registry.ts";
import { resolveTools } from "../src/mcp/tools.ts";
import type { ToolOutcome } from "../src/tools/outcome.ts";
import { plannerDescriptors } from "./support/planner.ts";

// app-connection-v1 §7.11 "대화 한도": the room a turn has before its conversation passes 2 MiB,
// the count of an answer as it streams against what the AI SDK 7.0.179 keeps of its step, the
// middleware that cuts an answer past the limit, and the core's words on why a schema refused a
// call ("도구"), which bound what the SDK keeps of its error. The models here are the SDK's mock,
// which sends no request; the global fetch refuses, as in the core.
installEgress();
installWarningLog();

const LIMIT = chatLimits.conversationBytes;
const IDENTITY: ChatIdentity = {
  provider: "openai-compatible",
  baseURL: "https://models.example/v1",
  model: "m-1",
};
const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
/** A string's bytes as JSON writes it, without its quotes. */
const textBytes = (text: string) => jsonBytes(text) - 2;
/** What ends a line the core cut (src/chat/sdk/tools.ts). */
const CUT = "... (truncated)";
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
  const resolved = resolveTools(
    reconcile({
      kind: "discovered",
      descriptors: plannerDescriptors() as unknown as CapabilityDescriptor[],
    }),
    { planner: {} as never, confirmations: {} as never, commands: {} as never },
  );
  const tools = toolSet(resolved, runner);
  const schemaOf = (name: string) =>
    resolved.find((item) => item.entry.name === name)!.entry.inputSchema;
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
    {
      name: "a call that runs with the provider's metadata, which its result carries again",
      tool: "event_list",
      input: JSON.stringify(WEEK),
      runs: true,
      metadata: { google: { thoughtSignature: "s".repeat(10_000) } },
    },
    {
      name: "a call its schema refuses, whose error writes its numbers longer than the input did",
      tool: "event_create",
      // JSON writes 9e20 in its 21 digits: 10,012 bytes as the model sent them, 44,012 again.
      input: `{"alarms":[${Array(2000).fill("9e20").join(",")}]}`,
      runs: false,
    },
  ])(
    "bounds what the AI SDK keeps of $name, the result of one that runs besides",
    async ({ tool, input, runs, metadata }) => {
      const parts: ModelPart[] = [
        { type: "stream-start", warnings: [] },
        { type: "tool-input-start", id: "call_1", toolName: tool },
        { type: "tool-input-delta", id: "call_1", delta: input.slice(0, 7) },
        { type: "tool-input-delta", id: "call_1", delta: input.slice(7) },
        { type: "tool-input-end", id: "call_1" },
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: tool,
          input,
          ...(metadata ? { providerMetadata: metadata } : {}),
        },
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

  /** The AI SDK's frame of the error for a call to `tool` its schema refused, the input as parsed. */
  const frame = (tool: string, input: unknown) =>
    `AI_InvalidToolInputError: Invalid input for tool ${tool}: AI_TypeValidationError: Type validation failed: Value: ${JSON.stringify(input)}.\nError message: `;
  /** The error the model reads for one call the AI SDK refused, and what its step keeps and counts. */
  async function refused(tool: string, input: string) {
    const parts: ModelPart[] = [
      { type: "stream-start", warnings: [] },
      { type: "tool-input-start", id: "call_1", toolName: tool },
      { type: "tool-input-delta", id: "call_1", delta: input },
      { type: "tool-input-end", id: "call_1" },
      { type: "tool-call", toolCallId: "call_1", toolName: tool, input },
      finish("tool-calls"),
    ];
    const messages = await kept(parts, tools);
    const result = (messages[1] as ToolModelMessage).content[0] as ToolResultPart;
    expect(result.output.type).toBe("error-text");
    const error = (result.output as { value: string }).value;
    return { error, exact: added(messages), count: counted(parts) };
  }

  // The two calls whose step kept 106,223 and 409,491 bytes while the AI SDK wrote zod's own
  // message, every issue as indented JSON (§7.11 "도구").
  const unknown = {
    ...WEEK,
    ...Object.fromEntries(Array.from({ length: 2000 }, (_, index) => [`k${index}`, 0])),
  };
  const alarms = {
    title: "Lunch",
    start: "2026-11-23T12:00:00+09:00",
    end: "2026-11-23T13:00:00+09:00",
    alarms: Array(2000).fill(1),
  };

  test("bounds why a schema refused 2,000 alarms that are numbers: the first issues, and a count of the rest", async () => {
    const { error, exact, count } = await refused("event_create", JSON.stringify(alarms));
    const before = frame("event_create", alarms);
    expect(error.startsWith(before)).toBe(true);
    const words = error.slice(before.length);
    expect(textBytes(words)).toBeLessThanOrEqual(chatLimits.toolIssueBytes);
    const issue = (index: number) =>
      `alarms[${index}]: Invalid input: expected object, received number`;
    const lines = words.split("\n");
    const shown = lines.slice(0, -1);
    expect(shown[0]).toBe(issue(0));
    const rest = Number(/^and (\d+) more issues$/.exec(lines.at(-1)!)?.[1]);
    expect(shown.length + rest).toBe(2000);
    // Whole lines in zod's order, the last of them perhaps cut to the room left.
    for (const [index, line] of shown.entries()) {
      if (line.endsWith(CUT) && index === shown.length - 1) {
        expect(issue(index).startsWith(line.slice(0, -CUT.length))).toBe(true);
      } else {
        expect(line).toBe(issue(index));
      }
    }
    expect(count).toBeGreaterThanOrEqual(exact);
    // One reason of the three the count leaves room for, not all of them: not far above the step.
    expect(count - exact).toBeLessThan(512);
  });

  test("bounds why a schema refused 2,000 keys it does not know: one issue, cut", async () => {
    const { error, exact, count } = await refused("event_list", JSON.stringify(unknown));
    const before = frame("event_list", unknown);
    expect(error.startsWith(before)).toBe(true);
    const words = error.slice(before.length);
    expect(textBytes(words)).toBeLessThanOrEqual(chatLimits.toolIssueBytes);
    // zod finds one issue, at the input's root, whose message names every key: none is left out.
    const message = schemaOf("event_list").safeParse(unknown).error!.issues[0]!.message;
    expect(words.startsWith('Unrecognized keys: "k0", "k1", ')).toBe(true);
    expect(words.endsWith(CUT)).toBe(true);
    expect(message.startsWith(words.slice(0, -CUT.length))).toBe(true);
    expect(words).not.toContain("\n");
    expect(count).toBeGreaterThanOrEqual(exact);
    expect(count - exact).toBeLessThan(512);
  });

  test("bounds why a schema refused a key of characters of four bytes, cut before the one 2 KiB falls in", async () => {
    const input = { ...WEEK, ["😀".repeat(1000)]: 0 };
    const { error, exact, count } = await refused("event_list", JSON.stringify(input));
    const words = error.slice(frame("event_list", input).length);
    // "Unrecognized key: \"" and 503 emoji are 2,031 bytes; the 504th would pass the room the
    // mark leaves.
    expect(words).toBe(`Unrecognized key: "${"😀".repeat(503)}${CUT}`);
    expect(textBytes(words)).toBeLessThanOrEqual(chatLimits.toolIssueBytes);
    expect(count).toBeGreaterThanOrEqual(exact);
    expect(count - exact).toBeLessThan(512);
  });

  test("bounds why a schema refused a key of quotes and control characters, in the bytes JSON writes them", async () => {
    // The model makes up its keys: JSON writes a quote in two bytes and a control character in six.
    const input = { ...WEEK, ['"\u0001'.repeat(1000)]: 0 };
    const { error, exact, count } = await refused("event_list", JSON.stringify(input));
    const words = error.slice(frame("event_list", input).length);
    expect(words).toBe(`Unrecognized key: "${'"\u0001'.repeat(251)}"${CUT}`);
    expect(textBytes(words)).toBeLessThanOrEqual(chatLimits.toolIssueBytes);
    expect(Buffer.byteLength(words)).toBeLessThan(600);
    expect(count).toBeGreaterThanOrEqual(exact);
    expect(count - exact).toBeLessThan(512);
  });

  test("keeps the AI SDK's words for input that does not parse, which it writes again as given", async () => {
    const input = '{"from":"a';
    const { error, exact, count } = await refused("event_list", input);
    expect(error).toBe(
      `AI_InvalidToolInputError: Invalid input for tool event_list: AI_JSONParseError: JSON parsing failed: Text: ${input}.\nError message: SyntaxError: JSON Parse error: Unterminated string`,
    );
    expect(count).toBeGreaterThanOrEqual(exact);
  });

  test("keeps Bun's words on input that does not parse, which cut the identifier they quote", async () => {
    const input = `{"from":${"x".repeat(10_000)}}`;
    const { error, exact, count } = await refused("event_list", input);
    const words = error.slice(error.lastIndexOf("Error message: ") + "Error message: ".length);
    expect(words).toMatch(/^SyntaxError: JSON Parse error: Unexpected identifier "x+\.\.\."$/);
    // The longest words Bun 1.4.5 writes, which the answer's count leaves room for
    // (src/chat/sdk/answer.ts).
    expect(words).toHaveLength(258);
    expect(textBytes(words)).toBe(260);
    expect(count).toBeGreaterThanOrEqual(exact);
  });

  test("keeps the AI SDK's words for a tool the core does not have, the names of its 35 tools", async () => {
    const { error, exact, count } = await refused("event_lists", JSON.stringify(WEEK));
    const names = Object.keys(tools).join(", ");
    expect(error).toBe(
      `AI_NoSuchToolError: Model tried to call unavailable tool 'event_lists'. Available tools: ${names}.`,
    );
    // What the answer's count leaves room for (src/chat/sdk/answer.ts).
    expect(Object.keys(tools)).toHaveLength(35);
    expect(textBytes(names)).toBe(658);
    expect(count).toBeGreaterThanOrEqual(exact);
  });
});

// §7.11 "도구": why a schema refused a call, in the core's words (src/chat/sdk/tools.ts).
describe("the words on why a schema refused a call", () => {
  const issue = (message: string, path: PropertyKey[] = []) =>
    ({ code: "custom", path, message, input: undefined }) as z.core.$ZodIssue;

  test("are a line for each issue, in zod's order and notation, the same each time", () => {
    const schema = z.strictObject({
      a: z.number(),
      "b c": z.array(z.string()),
      d: z.object({ e: z.boolean() }),
    });
    const input = { a: "x", "b c": [1, "y", 2], d: { e: 1 }, f: 0 };
    const text = issueText(schema.safeParse(input).error!.issues);
    expect(text.split("\n")).toEqual([
      "a: Invalid input: expected number, received string",
      '["b c"][0]: Invalid input: expected string, received number',
      '["b c"][2]: Invalid input: expected string, received number',
      "d.e: Invalid input: expected boolean, received number",
      'Unrecognized key: "f"',
    ]);
    expect(issueText(schema.safeParse(input).error!.issues)).toBe(text);
  });

  test("count the issues left out after those that fit", () => {
    const issues = z.array(z.number()).safeParse(Array(200).fill("n")).error!.issues;
    const text = issueText(issues);
    const lines = text.split("\n");
    const rest = Number(/^and (\d+) more issues$/.exec(lines.at(-1)!)?.[1]);
    expect(lines.length - 1 + rest).toBe(200);
    expect(textBytes(text)).toBeLessThanOrEqual(chatLimits.toolIssueBytes);
    expect(chatLimits.toolIssueBytes).toBe(2 * 1024);
  });

  test("cut a line where 2 KiB falls inside a character of four bytes, before that character", () => {
    // "x: " and 507 emoji are 2,031 bytes; the 508th would pass the room the mark leaves.
    expect(issueText([issue("😀".repeat(1000), ["x"])])).toBe(`x: ${"😀".repeat(507)}${CUT}`);
  });

  test("cut the first line that does not fit to the room left beside the count of those after it", () => {
    const text = issueText([
      issue("short", ["a"]),
      issue("b".repeat(5000), ["y"]),
      issue("short", ["c"]),
      issue("short", ["d"]),
    ]);
    expect(text).toBe(`a: short\ny: ${"b".repeat(2001)}${CUT}\nand 2 more issues`);
    expect(textBytes(text)).toBe(chatLimits.toolIssueBytes);
  });

  test("count a line of which not one character fits", () => {
    expect(issueText([issue("a".repeat(2029)), issue("😀".repeat(10))])).toBe(
      `${"a".repeat(2029)}\nand 1 more issue`,
    );
  });

  test("measure in the bytes JSON writes them in, which a quote doubles and a control character sextuples", () => {
    const text = issueText([issue('"\u0001'.repeat(1000), ["k"])]);
    expect(text).toBe(`k: ${'"\u0001'.repeat(253)}"${CUT}`);
    expect(textBytes(text)).toBeLessThanOrEqual(chatLimits.toolIssueBytes);
    expect(Buffer.byteLength(text)).toBeLessThan(600);
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
