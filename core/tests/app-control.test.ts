import { describe, expect, test } from "vite-plus/test";
import { ControlChannel } from "../src/app/control.ts";
import { FrameViolation } from "../src/app/frame.ts";
import type { ConfirmationPrompt } from "../src/mcp/confirmation.ts";
import { plannerOutcome } from "../src/mcp/outcome.ts";
import { type PlannerPolicy, plannerRequest } from "../src/planner/port.ts";
import { ManualTimers } from "./support/pipes.ts";
import { v2Response } from "./support/planner.ts";

const READ: PlannerPolicy = { effect: "read", required_evidence: "none", artifact_directory: null };
const MUTATION: PlannerPolicy = {
  effect: "mutation",
  required_evidence: "native_readback",
  artifact_directory: null,
};
const prompt: ConfirmationPrompt = {
  tool: "reminder_delete",
  operation_id: "op-2",
  client: { name: "agent", version: "1" },
  title: "Delete this reminder?",
  lines: [{ label: "Reminder", value: "x" }],
};

function control() {
  const written: { type: string; body: Record<string, unknown> }[] = [];
  const timers = new ManualTimers();
  const channel = new ControlChannel(
    async (type, body) => {
      written.push({ type, body: JSON.parse(body) as Record<string, unknown> });
    },
    { timers },
  );
  return { channel, written, timers };
}

describe("work requests (§8)", () => {
  test("answers are correlated by id, in any order", async () => {
    const { channel, written } = control();
    const first = plannerRequest("event.list", {}, READ, "op-1");
    const second = plannerRequest("event.get", {}, READ, "op-2");
    const a = channel.request("planner", first);
    const b = channel.request("planner", second);
    expect(written.map((frame) => [frame.type, frame.body.id, frame.body.worker])).toEqual([
      ["request", 1, "planner"],
      ["request", 2, "planner"],
    ]);
    channel.onResponse({ id: 2, response: v2Response(second) });
    channel.onResponse({ id: 1, response: v2Response(first) });
    expect(await a).toMatchObject({ kind: "response", response: { operation_id: "op-1" } });
    expect(await b).toMatchObject({ kind: "response", response: { operation_id: "op-2" } });
  });

  test("a response after the wait is dropped", async () => {
    const { channel, timers } = control();
    const request = plannerRequest("event.list", {}, READ, "op-1");
    const reply = channel.request("planner", request);
    timers.fire(request.deadline_ms + 5_000);
    expect(await reply).toEqual({ kind: "timeout" });
    expect(() => channel.onResponse({ id: 1, response: v2Response(request) })).not.toThrow();
  });

  test("an abandoned call drops its later response", async () => {
    const { channel } = control();
    const request = plannerRequest("event.list", {}, READ, "op-1");
    const cancel = new AbortController();
    const reply = channel.request("planner", request, cancel.signal);
    cancel.abort();
    expect(await reply).toEqual({ kind: "aborted" });
    expect(() => channel.onResponse({ id: 1, response: v2Response(request) })).not.toThrow();
  });

  test("a timed-out read failed, a timed-out mutation may have applied", async () => {
    const { channel, timers } = control();
    const read = plannerRequest("event.list", {}, READ, "op-r");
    const change = plannerRequest("event.create", {}, MUTATION, "op-m");
    const readReply = channel.request("planner", read);
    const changeReply = channel.request("planner", change);
    timers.fire(25_000);
    expect(plannerOutcome("event.list", read, await readReply)).toMatchObject({
      status: "failed",
      operation_id: "op-r",
      effect: { kind: "none", state: "not_started" },
      error: { code: "app.worker_timeout", retry: "after_backoff" },
    });
    expect(plannerOutcome("event.create", change, await changeReply)).toMatchObject({
      status: "uncertain",
      operation_id: "op-m",
      effect: { kind: "native_mutation", state: "may_have_applied" },
      error: { code: "app.worker_timeout", retry: "never" },
    });
  });

  test("a report keeps the helper command's meaning", async () => {
    const { channel } = control();
    const read = plannerRequest("event.list", {}, READ, "op-r");
    const change = plannerRequest("event.create", {}, MUTATION, "op-m");
    const readReply = channel.request("planner", read);
    const changeReply = channel.request("planner", change);
    channel.onResponse({ id: 1, report: { error: "sherpa.internal_failure", status: "failed" } });
    channel.onResponse({
      id: 2,
      report: {
        status: "uncertain",
        error: "journal.finish_failed",
        operation_id: "op-m",
        journal_error: "journal.finish_failed",
      },
    });
    expect(plannerOutcome("event.list", read, await readReply)).toMatchObject({
      status: "failed",
      operation_id: "op-r",
      effect: { kind: "none", state: "not_started" },
      error: { code: "sherpa.internal_failure", retry: "never" },
    });
    expect(plannerOutcome("event.create", change, await changeReply)).toMatchObject({
      status: "uncertain",
      operation_id: "op-m",
      effect: { kind: "native_mutation", state: "may_have_applied" },
      error: { code: "journal.finish_failed", retry: "never" },
      journal_error: "journal.finish_failed",
    });
  });

  test("a response that does not correlate or is not V2 is a frame violation", () => {
    const { channel } = control();
    const request = plannerRequest("event.list", {}, READ, "op-1");
    void channel.request("planner", request);
    const other = { ...v2Response(request), operation_id: "op-other" };
    expect(() => channel.onResponse({ id: 1, response: other })).toThrow(FrameViolation);
    expect(() => channel.onResponse({ id: 1, response: { status: "succeeded" } })).toThrow(
      FrameViolation,
    );
    expect(() => channel.onResponse({ id: 1, report: { status: 1 } })).toThrow(FrameViolation);
    expect(() => channel.onResponse({ id: 1, response: {}, report: {} })).toThrow(FrameViolation);
  });

  test("a request over 64 KiB is not sent and fails like the helper's", async () => {
    const { channel, written } = control();
    const request = plannerRequest("event.create", { notes: "x".repeat(70_000) }, MUTATION, "op-1");
    expect(await channel.request("planner", request)).toEqual({
      kind: "report",
      report: { status: "failed", error: "protocol.request_too_large" },
    });
    expect(written).toEqual([]);
  });

  test("shutdown ends every wait as abandoned", async () => {
    const { channel } = control();
    const reply = channel.request("planner", plannerRequest("event.list", {}, READ, "op-1"));
    const decision = channel.confirm(prompt, new AbortController().signal, 30_000);
    channel.closeAll();
    expect(await reply).toEqual({ kind: "aborted" });
    expect(await decision).toBe("withdrawn");
  });
});

describe("confirmations (§9)", () => {
  test.each(["approved", "declined", "unavailable"] as const)(
    "the app's %s is the decision",
    async (answer) => {
      const { channel, written } = control();
      const decision = channel.confirm(prompt, new AbortController().signal, 30_000);
      expect(written[0]).toEqual({
        type: "confirm",
        body: { id: 1, ...prompt, timeout_ms: 30_000 },
      });
      channel.onConfirmation({ id: 1, decision: answer });
      expect(await decision).toBe(answer);
      expect(written).toHaveLength(1);
    },
  );

  test("the wait is the time the caller gives, and timeout_ms says so", async () => {
    const { channel, written, timers } = control();
    const decision = channel.confirm(prompt, new AbortController().signal, 21_500);
    expect(written[0]?.body.timeout_ms).toBe(21_500);
    timers.fire(30_000);
    expect(written).toHaveLength(1);
    timers.fire(21_500);
    expect(await decision).toBe("timed_out");
    expect(written.at(-1)).toEqual({ type: "withdraw", body: { id: 1 } });
  });

  test("no answer within 30 s withdraws the request", async () => {
    const { channel, written, timers } = control();
    const decision = channel.confirm(prompt, new AbortController().signal, 30_000);
    timers.fire(30_000);
    expect(await decision).toBe("timed_out");
    expect(written.at(-1)).toEqual({ type: "withdraw", body: { id: 1 } });
  });

  test("cancelling the call withdraws the request and a later approval is ignored", async () => {
    const { channel, written } = control();
    const cancel = new AbortController();
    const decision = channel.confirm(prompt, cancel.signal, 30_000);
    cancel.abort();
    expect(await decision).toBe("withdrawn");
    expect(written.at(-1)).toEqual({ type: "withdraw", body: { id: 1 } });
    expect(() => channel.onConfirmation({ id: 1, decision: "approved" })).not.toThrow();
    expect(written).toHaveLength(2);
  });

  test("requests and confirmations share one id counter", () => {
    const { channel, written } = control();
    void channel.request("planner", plannerRequest("event.list", {}, READ, "op-1"));
    void channel.confirm(prompt, new AbortController().signal, 30_000);
    void channel.request("planner", plannerRequest("event.list", {}, READ, "op-3"));
    expect(written.map((frame) => frame.body.id)).toEqual([1, 2, 3]);
  });

  test("prompt fields are bounded before they are written", async () => {
    const { channel, written } = control();
    const long = {
      ...prompt,
      title: "t".repeat(300),
      lines: Array.from({ length: 20 }, () => ({
        label: "l".repeat(80),
        value: "가".repeat(5_000),
      })),
    };
    void channel.confirm(long, new AbortController().signal, 30_000);
    const body = written[0]!.body as unknown as ConfirmationPrompt;
    expect(Array.from(body.title)).toHaveLength(100);
    expect(body.lines).toHaveLength(12);
    expect(Array.from(body.lines[0]!.label)).toHaveLength(40);
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(64 * 1024);
  });
});
