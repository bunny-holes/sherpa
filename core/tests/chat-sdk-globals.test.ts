import { embed, generateText, streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { EgressDeniedError, installEgress } from "../src/chat/egress.ts";
import { installWarningLog } from "../src/chat/warnings.ts";

// ADR-0012 "코드로 지키기" 3 and "제공자 면": the AI SDK 7.0.179 itself, on this process's globals as
// the core's entry point leaves them (vitest gives every test file a process of its own). A model id
// given as a string reaches the refusing default provider, not the AI Gateway, and the SDK's
// warnings reach the Sherpa log without their details.
installEgress();
installWarningLog();

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

const REFUSED = "warn [core:egress:default-provider] refused reason=string_model_id\n";
const denied = expect.objectContaining({ name: "EgressDeniedError", reason: "string_model_id" });

describe("a model id given as a string", () => {
  test("is refused by the default provider before any request, in generateText, streamText and embed", async () => {
    await expect(
      generateText({ model: "anthropic/claude-sonnet-4.5", prompt: "hi" }),
    ).rejects.toThrow(denied);
    expect(() => streamText({ model: "openai/gpt-5", prompt: "hi" })).toThrow(denied);
    await expect(embed({ model: "openai/text-embedding-3-small", value: "hi" })).rejects.toThrow(
      denied,
    );
    expect(lines).toEqual([REFUSED, REFUSED, REFUSED]);
  });

  test("cannot be sent elsewhere: the default provider and the warning log stay as installed", () => {
    expect(() => {
      globalThis.AI_SDK_DEFAULT_PROVIDER = undefined;
    }).toThrow(TypeError);
    expect(() => {
      globalThis.AI_SDK_LOG_WARNINGS = false;
    }).toThrow(TypeError);
    expect(() =>
      Object.defineProperty(globalThis, "AI_SDK_LOG_WARNINGS", { value: false }),
    ).toThrow(TypeError);
    const installed = globalThis.AI_SDK_LOG_WARNINGS;
    installWarningLog();
    expect(globalThis.AI_SDK_LOG_WARNINGS).toBe(installed);
    expect(() => installEgress()).toThrow(TypeError);
    expect(() => streamText({ model: "m", prompt: "hi" })).toThrow(EgressDeniedError);
  });
});

/** A model that answers once with these warnings, and no request of its own. */
function warningModel(warnings: unknown[]) {
  return new MockLanguageModelV4({
    provider: "anthropic.messages",
    doGenerate: async () => ({
      content: [{ type: "text", text: "Hello" }],
      finishReason: { unified: "stop", raw: "end_turn" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: warnings as never,
    }),
  });
}

describe("the AI SDK's warnings", () => {
  test("reach the Sherpa log as their kind, the feature or setting they name and the provider", async () => {
    const result = await generateText({
      model: warningModel([
        { type: "unsupported", feature: "topK", details: "sk-detail-marker" },
        { type: "compatibility", feature: 'function tool "event_list"', details: "detail" },
        { type: "deprecated", setting: "system", message: "message-marker" },
        { type: "other", message: "Hello from the body\nwarn [core:fake] line" },
      ]),
      prompt: "hi",
    });
    expect(result.text).toBe("Hello");
    expect(lines).toEqual([
      "warn [core:chat:sdk-warning] type=unsupported subject=topK provider=anthropic.messages\n",
      "warn [core:chat:sdk-warning] type=compatibility subject=function_tool__event_list_ provider=anthropic.messages\n",
      "warn [core:chat:sdk-warning] type=deprecated subject=system provider=anthropic.messages\n",
      "warn [core:chat:sdk-warning] type=other subject=none provider=anthropic.messages\n",
    ]);
  });

  test("leave nothing on the runtime's own warning channel", async () => {
    const emitted = vi.spyOn(process, "emitWarning");
    const warned = vi.spyOn(console, "warn");
    await generateText({
      model: warningModel([{ type: "unsupported", feature: "seed" }]),
      prompt: "hi",
    });
    expect(emitted).not.toHaveBeenCalled();
    expect(warned).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
  });
});
