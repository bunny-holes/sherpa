import { afterEach, describe, expect, test } from "vite-plus/test";
import type { FakeApp } from "./fake-app.ts";
import { cleanHomes, launch } from "./launch.ts";
import { defaultPlanner, v2Response } from "../support/planner.ts";

// app-connection-v1 §13.1: the built core driven through its pipes by a fake app.
const apps: FakeApp[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.stop();
  cleanHomes();
});

async function ready(env?: Record<string, string>): Promise<FakeApp> {
  const app = launch(env);
  apps.push(app);
  await app.handshake();
  return app;
}

const range = { from: "2026-11-21T00:00:00+09:00", to: "2026-11-22T00:00:00+09:00" };
const isConfirm = (frame: { channel: number; type: string }) =>
  frame.channel === 0 && frame.type === "confirm";
const isWithdraw = (frame: { channel: number; type: string }) =>
  frame.channel === 0 && frame.type === "withdraw";

describe("sessions", () => {
  test("three channels initialize, list tools and call a read at the same time", async () => {
    const app = await ready();
    const initialized = await Promise.all([1, 2, 3].map((channel) => app.open(channel)));
    for (const result of initialized) {
      expect(result).toEqual({
        protocolVersion: "2025-11-25",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "sherpa", version: expect.stringMatching(/^\d+\.\d+\.\d+$/) },
      });
    }
    const lists = await Promise.all([1, 2, 3].map((channel) => app.rpc(channel, "tools/list", {})));
    for (const list of lists) {
      const tools = list.tools as {
        name: string;
        inputSchema: { additionalProperties?: boolean };
        annotations: Record<string, boolean>;
        outputSchema: object;
      }[];
      expect(tools).toHaveLength(35);
      for (const tool of tools) {
        expect(tool.inputSchema.additionalProperties).toBe(false);
        expect(Object.keys(tool.annotations).sort()).toEqual([
          "destructiveHint",
          "idempotentHint",
          "openWorldHint",
          "readOnlyHint",
        ]);
        expect(tool.outputSchema).toBeDefined();
      }
    }
    const calls = await Promise.all(
      [1, 2, 3].map((channel) => app.call(channel, "event_list", range)),
    );
    const operations = calls.map((call) => {
      expect(call.isError).toBe(false);
      expect(call.structuredContent).toMatchObject({
        status: "succeeded",
        capability: "event.list",
      });
      expect(JSON.parse(call.content[0]!.text)).toEqual(call.structuredContent);
      return call.structuredContent!.operation_id;
    });
    expect(new Set(operations).size).toBe(3);
    expect(app.frames.filter((frame) => frame.type === "data")).toEqual([]);
  });

  test("closing one session in the middle of a call leaves the others answering", async () => {
    const app = await ready();
    await Promise.all([1, 2, 3].map((channel) => app.open(channel)));
    app.planner = (request) =>
      request.capability === "event.list" && request.request_id ? null : defaultPlanner(request);
    const id = app.send(2, "tools/call", { name: "event_list", arguments: range });
    await app.next((frame) => frame.type === "request");
    app.frame(2, "close");
    app.planner = defaultPlanner;
    const [one, three] = await Promise.all([
      app.call(1, "operations_list", { limit: 1 }),
      app.call(3, "event_list", range),
    ]);
    expect(one.structuredContent?.status).toBe("succeeded");
    expect(three.structuredContent?.status).toBe("succeeded");
    expect(
      await app.absent(
        (frame) =>
          frame.channel === 2 && frame.type === "data" && (frame.body as { id?: number }).id === id,
        500,
      ),
    ).toBe(true);
    // The late answer to the abandoned request is dropped, not a violation.
    const pending = app.log.find(
      (frame) =>
        frame.type === "request" &&
        (frame.body as { request: { capability: string } }).request.capability === "event.list",
    )!;
    const body = pending.body as { id: number; request: Record<string, unknown> };
    app.frame(0, "response", { id: body.id, response: v2Response(body.request) });
    expect((await app.call(1, "operations_list", { limit: 1 })).structuredContent?.status).toBe(
      "succeeded",
    );
  });

  test("data that is not JSON gets -32700 and the session keeps working", async () => {
    const app = await ready();
    await app.open(1);
    app.write("1\tdata\tnot json\n");
    const error = await app.next((frame) => frame.channel === 1 && frame.type === "data");
    expect(error.body).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
    expect((await app.call(1, "kakaotalk_status", {})).structuredContent?.capability).toBe(
      "kakaotalk.status",
    );
  });

  test("a response with an unknown id is dropped", async () => {
    const app = await ready();
    await app.open(1);
    app.frame(0, "response", { id: 99, report: { error: "x", status: "failed" } });
    expect((await app.call(1, "operations_list", { limit: 1 })).structuredContent?.status).toBe(
      "succeeded",
    );
  });
});

describe("confirmation (§9)", () => {
  test("an approved delete sends the request under the confirmed operation id", async () => {
    const app = await ready();
    await app.open(1);
    app.confirm = () => "approved";
    const call = await app.call(1, "reminder_delete", { native_locator: "r-1" });
    const confirm = app.log.find(isConfirm)!.body as Record<string, unknown>;
    expect(confirm).toMatchObject({
      tool: "reminder_delete",
      client: { name: "fake-agent", version: "1.0.0" },
      timeout_ms: 30_000,
    });
    expect(app.requested()).toEqual(["capabilities", "reminder.get", "reminder.delete"]);
    expect(call.structuredContent).toMatchObject({
      status: "succeeded",
      operation_id: confirm.operation_id,
    });
  });

  test("a declined delete sends nothing", async () => {
    const app = await ready();
    await app.open(1);
    app.confirm = () => "declined";
    const call = await app.call(1, "event_delete", { native_locator: "e-1", span: "this" });
    expect(app.requested()).toEqual(["capabilities", "event.get"]);
    expect(call.isError).toBe(true);
    expect(call.structuredContent).toMatchObject({
      status: "failed",
      error: { code: "confirmation.declined", retry: "after_user_action" },
    });
  });

  test("cancelling the call withdraws the request, leaves the call unanswered and ignores a late approval", async () => {
    const app = await ready();
    await app.open(1);
    app.confirm = () => null;
    const id = app.send(1, "tools/call", {
      name: "reminder_delete",
      arguments: { native_locator: "r-1" },
    });
    const confirm = await app.next(isConfirm);
    app.frame(1, "data", {
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: id, reason: "user" },
    });
    const withdraw = await app.next(isWithdraw);
    const confirmID = (confirm.body as { id: number }).id;
    expect(withdraw.body).toEqual({ id: confirmID });
    app.frame(0, "confirmation", { id: confirmID, decision: "approved" });
    expect(
      await app.absent(
        (frame) => frame.channel === 1 && (frame.body as { id?: number }).id === id,
        500,
      ),
    ).toBe(true);
    expect(app.requested()).toEqual(["capabilities", "reminder.get"]);
  });

  test("closing the connection withdraws its request and the core keeps running", async () => {
    const app = await ready();
    await Promise.all([app.open(1), app.open(2)]);
    app.confirm = () => null;
    app.send(1, "tools/call", {
      name: "imessage_send",
      arguments: { chat_id: 1, text: "a private message" },
    });
    const confirm = await app.next(isConfirm);
    expect(confirm.body).toMatchObject({
      tool: "imessage_send",
      lines: [
        { label: "Chat", value: "1" },
        { label: "Message", value: "a private message" },
      ],
    });
    app.frame(1, "close");
    expect((await app.next(isWithdraw)).body).toEqual({ id: (confirm.body as { id: number }).id });
    expect((await app.call(2, "operations_list", { limit: 5 })).structuredContent).toMatchObject({
      status: "succeeded",
      result: { items: [] },
    });
    // Nothing was journaled, so nothing was attempted.
    expect(app.stderr.join("")).not.toContain("a private message");
  });
});

describe("results (§10.5)", () => {
  test("a read result over 1 MiB fails with a remedy, a change over 1 MiB is partial", async () => {
    const app = await ready();
    await app.open(1);
    const big = { schema: "x", blob: "y".repeat(1_200_000) };
    app.planner = (request) =>
      request.capability === "capabilities"
        ? defaultPlanner(request)
        : { response: v2Response(request, { result: big }) };
    const read = await app.call(1, "event_list", range);
    expect(read.isError).toBe(true);
    expect(read.structuredContent).toMatchObject({
      status: "failed",
      result: null,
      error: {
        code: "protocol.result_too_large",
        retry: "never",
        remedy: "Narrow the range or lower the limit and call again.",
      },
    });
    const change = await app.call(1, "event_create", {
      title: "t",
      start: range.from,
      end: range.to,
    });
    expect(change.isError).toBe(false);
    expect(change.structuredContent).toMatchObject({
      status: "partial",
      effect: { kind: "native_mutation", state: "applied" },
      evidence: { kind: "native_readback", state: "matched" },
      error: { code: "protocol.result_too_large", retry: "never" },
    });
    expect(Buffer.byteLength(change.content[0]!.text)).toBeLessThan(1024 * 1024);
  });

  test("arguments outside the schema are an input validation error, values outside the range a failed outcome", async () => {
    const app = await ready();
    await app.open(1);
    const extra = await app.request(1, "tools/call", {
      name: "operations_list",
      arguments: { limit: 1, more: true },
    });
    expect(extra).toMatchObject({ result: { isError: true } });
    const range0 = await app.call(1, "operations_list", { limit: 0 });
    expect(range0.structuredContent).toMatchObject({
      status: "failed",
      error: { code: "invalidRequest" },
    });
    const checkpoint = await app.call(1, "kakaotalk_checkpoint", { token: "t", confirm: "no" });
    expect(checkpoint.structuredContent).toMatchObject({
      status: "failed",
      effect: { kind: "local_state", state: "not_started" },
      error: { code: "invalidRequest" },
    });
  });
});

describe("process (§7.8)", () => {
  test("a frame over its limit ends the core with fatal and 65", async () => {
    const app = await ready();
    app.writeRaw(new TextEncoder().encode(`1\tdata\t${"x".repeat(4 * 1024 * 1024 + 1)}\n`));
    expect(await app.exited).toBe(65);
    expect(app.log.at(-1)).toEqual({
      channel: 0,
      type: "fatal",
      body: { code: "mux.frame_too_large" },
    });
  });

  test("EOF on standard input exits 0 within 5 seconds", async () => {
    const app = await ready();
    await Promise.all([app.open(1), app.open(2)]);
    const started = Date.now();
    app.closeInput();
    expect(await app.exited).toBe(0);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test("a restarted core numbers channels from 1 again", async () => {
    const first = await ready();
    await first.open(1);
    first.closeInput();
    expect(await first.exited).toBe(0);
    const second = await ready();
    expect((await second.open(1)).serverInfo).toMatchObject({ name: "sherpa" });
  });

  test("logs carry no message bodies or tool arguments", async () => {
    const app = await ready({ LOG_LEVEL: "debug" });
    await app.open(1);
    app.confirm = () => "declined";
    await app.call(1, "mail_send", {
      to: ["secret-person@example.com"],
      cc: [],
      bcc: [],
      subject: "Secret subject",
      body: "Secret body",
    });
    await app.call(1, "event_list", { ...range, collection_native_locator: "secret-locator" });
    app.closeInput();
    await app.exited;
    const logs = app.stderr.join("");
    expect(logs).toContain("[core:mcp:tool-call]");
    for (const secret of ["secret-person", "Secret subject", "Secret body", "secret-locator"])
      expect(logs).not.toContain(secret);
  });
});
