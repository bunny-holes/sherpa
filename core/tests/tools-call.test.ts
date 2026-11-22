import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import {
  activeCalls,
  type CallableTool,
  type CallSurface,
  runToolCall,
  type ToolCall,
} from "../src/tools/call.ts";
import { NARROW_READ_REMEDY, outcome, type ToolOutcome } from "../src/tools/outcome.ts";

// ADR-0012 "도구": the lifecycle every surface runs a tool call through, here with MCP's module
// name and a small limit.
const SURFACE: CallSurface = { module: "mcp", channel: 3, limit: 1024 };
const CALL: ToolCall = {
  signal: new AbortController().signal,
  client: { name: "agent", version: "1.0" },
};

function tool(handle: CallableTool["handle"], effectClass = "read"): CallableTool {
  return { entry: { name: "event_list", capability: "event.list", effectClass }, handle };
}

function succeeded(result: Record<string, unknown>, operationID: string | null = null) {
  return outcome({
    status: "succeeded",
    capability: "event.list",
    operation_id: operationID,
    effect: { kind: "none", state: "not_applicable" },
    evidence: null,
    error: null,
    result,
  });
}

let lines: string[];
beforeEach(() => {
  lines = [];
  vi.stubEnv("LOG_LEVEL", "info");
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** The lines with the clock's part replaced. */
const logged = () => lines.map((line) => line.replace(/ms=\d+/, "ms=N"));
const START = "info [core:mcp:tool-call] start channel=3 tool=event_list\n";

describe("a tool call", () => {
  test("hands the handler its arguments and call, and logs its start and success", async () => {
    const value = succeeded({ items: [] }, "op-1");
    const seen: unknown[] = [];
    const fitted = await runToolCall(
      tool(async (args, call) => {
        seen.push(args, call);
        return value;
      }),
      { limit: 5 },
      CALL,
      SURFACE,
    );
    expect(seen).toEqual([{ limit: 5 }, CALL]);
    expect(fitted).toEqual({ outcome: value, text: JSON.stringify(value) });
    expect(logged()).toEqual([
      START,
      "info [core:mcp:tool-call] success channel=3 tool=event_list status=succeeded code=none operation_id=op-1 ms=N\n",
    ]);
  });

  test("is among the active calls while it runs, and not after", async () => {
    let finish!: (value: ToolOutcome) => void;
    const handled = new Promise<ToolOutcome>((resolve) => {
      finish = resolve;
    });
    const pending = runToolCall(
      tool(() => handled),
      {},
      CALL,
      SURFACE,
    );
    expect([...activeCalls]).toEqual([handled]);
    finish(succeeded({}));
    await pending;
    expect(activeCalls.size).toBe(0);
  });

  test("logs a failed outcome as a failure at warn, with its code", async () => {
    const value = outcome({
      status: "failed",
      capability: "event.list",
      operation_id: null,
      effect: { kind: "none", state: "not_started" },
      evidence: null,
      error: { code: "eventkit.not_found", retry: "never" },
      result: null,
    });
    const fitted = await runToolCall(
      tool(async () => value),
      {},
      CALL,
      SURFACE,
    );
    expect(fitted?.outcome).toEqual(value);
    expect(logged()).toEqual([
      START,
      "warn [core:mcp:tool-call] failure channel=3 tool=event_list status=failed code=eventkit.not_found operation_id=none ms=N\n",
    ]);
  });

  test("turns a thrown handler into a core failure and logs its type, never its message", async () => {
    const fitted = await runToolCall(
      tool(async () => {
        throw new TypeError("Cannot read the message from Alice");
      }),
      {},
      CALL,
      SURFACE,
    );
    expect(fitted?.outcome).toMatchObject({
      status: "failed",
      capability: "event.list",
      operation_id: null,
      effect: { kind: "none", state: "not_started" },
      error: { code: "sherpa.internal_failure", retry: "never" },
    });
    expect(logged()).toEqual([
      START,
      "error [core:mcp:tool-call] failure channel=3 tool=event_list error_type=TypeError\n",
      "warn [core:mcp:tool-call] failure channel=3 tool=event_list status=failed code=sherpa.internal_failure operation_id=none ms=N\n",
    ]);
    expect(lines.join("")).not.toContain("Alice");
    expect(activeCalls.size).toBe(0);
  });

  test("answers nothing for an abandoned call", async () => {
    const fitted = await runToolCall(
      tool(async () => null),
      {},
      CALL,
      SURFACE,
    );
    expect(fitted).toBeNull();
    expect(logged()).toEqual([
      START,
      "info [core:mcp:tool-call] abandoned channel=3 tool=event_list ms=N\n",
    ]);
    expect(activeCalls.size).toBe(0);
  });

  test("fits the outcome to the surface's limit and logs the fitted one", async () => {
    const read = await runToolCall(
      tool(async () => succeeded({ p: "x".repeat(2048) }, "op-2")),
      {},
      CALL,
      SURFACE,
    );
    expect(read?.outcome).toMatchObject({
      status: "failed",
      operation_id: "op-2",
      error: { code: "protocol.result_too_large", retry: "never", remedy: NARROW_READ_REMEDY },
      result: null,
    });
    expect(Buffer.byteLength(read!.text)).toBeLessThanOrEqual(SURFACE.limit);
    expect(logged()[1]).toBe(
      "warn [core:mcp:tool-call] failure channel=3 tool=event_list status=failed code=protocol.result_too_large operation_id=op-2 ms=N\n",
    );
    const applied = outcome({
      status: "succeeded",
      capability: "reminder.delete",
      operation_id: "op-3",
      effect: { kind: "native_mutation", state: "applied" },
      evidence: { kind: "native_absence_readback", state: "matched" },
      error: null,
      result: { p: "x".repeat(2048) },
    });
    const change = await runToolCall(
      tool(async () => applied, "delete"),
      {},
      CALL,
      SURFACE,
    );
    expect(change?.outcome).toMatchObject({
      status: "partial",
      evidence: { kind: "native_absence_readback", state: "matched" },
      error: { code: "protocol.result_too_large", retry: "never" },
    });
    expect(change?.outcome.error?.remedy).toBeUndefined();
  });
});
