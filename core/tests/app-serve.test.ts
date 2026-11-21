import { InMemoryTransport, type JSONRPCMessage } from "@modelcontextprotocol/server";
import { describe, expect, test } from "vite-plus/test";
import { serveConnection } from "../src/app/serve.ts";
import type { CoreCommands } from "../src/commands.ts";
import type { MailMessage } from "../src/mail/outbound.ts";
import { coreEntries } from "../src/mcp/core-tools.ts";
import { createSherpaServer } from "../src/mcp/server.ts";
import type { ResolvedTool } from "../src/mcp/tools.ts";
import { CollectingSink, PushInput, tick } from "./support/pipes.ts";

// The whole `app serve` stack in one process (mux, control, transport, SDK, tools)
// with core commands that record instead of sending (app-connection-v1 §7, §9).

const unexpected = (): never => {
  throw new Error("unexpected command");
};

interface Frame {
  channel: number;
  type: string;
  body: Record<string, unknown> | null;
}

function parse(line: string): Frame {
  const [channel, type, ...rest] = line.split("\t");
  const raw = rest.join("\t");
  return {
    channel: Number(channel),
    type: type!,
    body: raw === "" ? null : (JSON.parse(raw) as Record<string, unknown>),
  };
}

const mail = { to: ["a@example.com"], cc: [], bcc: [], subject: "s", body: "b" };

function start() {
  const input = new PushInput();
  const sink = new CollectingSink();
  const sent: MailMessage[] = [];
  const commands: CoreCommands = {
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
    mailSend: async ({ message, operationID }) => {
      sent.push(message);
      return {
        operationID: operationID!,
        output: new TextEncoder().encode('{"accepted":true}'),
        journalFailure: null,
      };
    },
    operationsList: async () => "[]",
  };
  const exit = serveConnection({ input, output: sink, commands });
  const frames = () => sink.lines.map(parse);
  const next = async (match: (frame: Frame) => boolean) =>
    parse(await sink.next((line) => match(parse(line))));
  const data = (channel: number, message: object) =>
    input.push(`${channel}\tdata\t${JSON.stringify(message)}\n`);
  const call = (channel: number, id: number, name: string, args: object) =>
    data(channel, { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  const answer = (channel: number, id: number) =>
    next((frame) => frame.channel === channel && frame.type === "data" && frame.body?.id === id);
  /** The app hello without workers (core tools only), then channel 1 initialized. */
  const ready = async () => {
    await next((frame) => frame.type === "hello");
    input.push('0\thello\t{"mux":1,"version":"0.9.0","workers":[]}\n');
    input.push("1\topen\n");
    data(1, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "agent", version: "1.0" },
      },
    });
    await answer(1, 1);
    data(1, { jsonrpc: "2.0", method: "notifications/initialized" });
  };
  const confirms = () => frames().filter((frame) => frame.type === "confirm");
  return { input, sink, sent, exit, frames, next, data, call, answer, ready, confirms };
}

const isConfirm = (frame: Frame) => frame.channel === 0 && frame.type === "confirm";
const isWithdraw = (frame: Frame) => frame.channel === 0 && frame.type === "withdraw";

describe("sends wait for the app window in the call that asked (§9)", () => {
  test("notifications/cancelled withdraws a send and a later approval sends nothing", async () => {
    const app = start();
    await app.ready();
    app.call(1, 5, "mail_send", mail);
    const confirm = await app.next(isConfirm);
    app.data(1, {
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 5, reason: "user" },
    });
    const withdraw = await app.next(isWithdraw);
    expect(withdraw.body).toEqual({ id: confirm.body?.id });
    app.input.push(
      `0\tconfirmation\t${JSON.stringify({ id: confirm.body?.id, decision: "approved" })}\n`,
    );
    // The id of the cancelled call is free again and the session keeps answering.
    app.call(1, 5, "operations_list", { limit: 1 });
    expect((await app.answer(1, 5)).body).toMatchObject({
      result: { structuredContent: { status: "succeeded", capability: "operations.list" } },
    });
    expect(app.sent).toEqual([]);
    expect(
      app.frames().filter((frame) => frame.channel === 1 && frame.body?.id === 5),
    ).toHaveLength(1);
    app.input.end();
    expect(await app.exit).toBe(0);
  });

  test("a call under an id still in flight is refused, and closing the channel withdraws the first", async () => {
    const app = start();
    await app.ready();
    app.call(1, 5, "mail_send", mail);
    const confirm = await app.next(isConfirm);
    app.call(1, 5, "mail_send", { ...mail, subject: "other" });
    expect((await app.answer(1, 5)).body).toEqual({
      jsonrpc: "2.0",
      id: 5,
      error: { code: -32600, message: "Request id already in use" },
    });
    app.input.push("1\tclose\n");
    expect((await app.next(isWithdraw)).body).toEqual({ id: confirm.body?.id });
    app.input.push(
      `0\tconfirmation\t${JSON.stringify({ id: confirm.body?.id, decision: "approved" })}\n`,
    );
    await tick();
    await tick();
    expect(app.confirms()).toHaveLength(1);
    expect(app.sent).toEqual([]);
    app.input.end();
    expect(await app.exit).toBe(0);
  });

  test("an id is free again once its call was answered", async () => {
    const app = start();
    await app.ready();
    for (let round = 0; round < 2; round++) {
      app.call(1, 9, "operations_list", { limit: 1 });
      expect((await app.answer(1, 9)).body).toHaveProperty("result");
      await tick();
      app.sink.lines.length = 0;
    }
    app.input.end();
    expect(await app.exit).toBe(0);
  });

  test("EOF on standard input during the wait ends the core with 0 and sends nothing", async () => {
    const app = start();
    await app.ready();
    app.call(1, 5, "mail_send", mail);
    await app.next(isConfirm);
    app.input.end();
    expect(await app.exit).toBe(0);
    expect(app.sent).toEqual([]);
    expect(app.frames().filter((frame) => frame.channel === 1 && frame.body?.id === 5)).toEqual([]);
  });

  test("an approval runs the send once, under the shown operation id", async () => {
    const app = start();
    await app.ready();
    app.call(1, 5, "mail_send", mail);
    const confirm = await app.next(isConfirm);
    app.input.push(
      `0\tconfirmation\t${JSON.stringify({ id: confirm.body?.id, decision: "approved" })}\n`,
    );
    expect((await app.answer(1, 5)).body).toMatchObject({
      result: {
        isError: false,
        structuredContent: { status: "succeeded", operation_id: confirm.body?.operation_id },
      },
    });
    expect(app.sent).toEqual([{ sender: null, ...mail }]);
    app.input.end();
    expect(await app.exit).toBe(0);
  });
});

test("closing a session ends every waiting call, even two the SDK holds under one request id", async () => {
  const signals: AbortSignal[] = [];
  const tool: ResolvedTool = {
    entry: coreEntries.find((entry) => entry.name === "operations_list")!,
    handle: (_args, call) =>
      new Promise((resolve) => {
        signals.push(call.signal);
        call.signal.addEventListener("abort", () => resolve(null), { once: true });
      }),
  };
  const session = new AbortController();
  const server = createSherpaServer([tool], {
    version: "1.0.0",
    channel: 1,
    session: session.signal,
  });
  const [client, side] = InMemoryTransport.createLinkedPair();
  const received: JSONRPCMessage[] = [];
  client.onmessage = (message) => received.push(message);
  await server.connect(side);
  await client.start();
  await client.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "agent", version: "1.0" },
    },
  });
  await client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  // The transport of `app serve` refuses the second; this one does not, as a regression guard.
  for (const limit of [1, 2])
    await client.send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "operations_list", arguments: { limit } },
    });
  for (let i = 0; i < 20 && signals.length < 2; i++) await tick();
  expect(signals).toHaveLength(2);
  session.abort();
  await side.close();
  expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);
});
