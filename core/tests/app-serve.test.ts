import { InMemoryTransport, type JSONRPCMessage } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { describe, expect, test } from "vite-plus/test";
import { serveConnection } from "../src/app/serve.ts";
import type { CoreCommands } from "../src/commands.ts";
import type { MailMessage } from "../src/mail/outbound.ts";
import { coreEntries } from "../src/mcp/core-tools.ts";
import { createSherpaServer } from "../src/mcp/server.ts";
import type { ResolvedTool } from "../src/mcp/tools.ts";
import { type AgentInfo, MCP_REVISION, withEnvelope } from "./support/mcp.ts";
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
const agent: AgentInfo = { name: "agent", version: "1.0" };

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
  const call = (
    channel: number,
    id: number,
    name: string,
    args: object,
    client: AgentInfo | null = agent,
  ) =>
    data(channel, {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: withEnvelope({ name, arguments: args }, client),
    });
  const answer = (channel: number, id: number) =>
    next((frame) => frame.channel === channel && frame.type === "data" && frame.body?.id === id);
  /** The app hello without workers (core tools only) and channel 1 open. */
  const opened = async () => {
    await next((frame) => frame.type === "hello");
    input.push('0\thello\t{"mux":2,"version":"0.9.0","workers":[]}\n');
    input.push('1\topen\t{"kind":"mcp"}\n');
  };
  /** Then `server/discover` on channel 1: 2026-07-28 has no `initialize`. */
  const ready = async () => {
    await opened();
    data(1, { jsonrpc: "2.0", id: 1, method: "server/discover", params: withEnvelope({}, agent) });
    await answer(1, 1);
  };
  const confirms = () => frames().filter((frame) => frame.type === "confirm");
  return { input, sink, sent, exit, frames, next, data, call, answer, opened, ready, confirms };
}

const isConfirm = (frame: Frame) => frame.channel === 0 && frame.type === "confirm";
const isWithdraw = (frame: Frame) => frame.channel === 0 && frame.type === "withdraw";

describe("protocol revision 2026-07-28 only (§10.1, ADR-0011)", () => {
  test.each(["2025-11-25", "2025-06-18"])(
    "initialize %s gets -32022, a request without an envelope too, and nothing runs",
    async (version) => {
      const app = start();
      await app.opened();
      app.data(1, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: version, capabilities: {}, clientInfo: agent },
      });
      expect((await app.answer(1, 1)).body).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32022,
          message: `Unsupported protocol version: ${version}`,
          data: { supported: [MCP_REVISION], requested: version },
        },
      });
      app.data(1, { jsonrpc: "2.0", method: "notifications/initialized" });
      app.data(1, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "mail_send", arguments: mail },
      });
      expect((await app.answer(1, 2)).body).toEqual({
        jsonrpc: "2.0",
        id: 2,
        error: {
          code: -32022,
          message: "Unsupported protocol version: the request did not name a protocol version",
          data: { supported: [MCP_REVISION] },
        },
      });
      // The notification got no answer, and the refused call asked nobody and sent nothing.
      expect(app.frames().filter((frame) => frame.channel === 1)).toHaveLength(2);
      expect(app.confirms()).toEqual([]);
      expect(app.sent).toEqual([]);
      app.input.end();
      expect(await app.exit).toBe(0);
    },
  );

  test("after a refused initialize the same channel opens with server/discover", async () => {
    const app = start();
    await app.opened();
    app.data(1, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: agent },
    });
    expect((await app.answer(1, 1)).body).toHaveProperty("error.code", -32022);
    app.data(1, {
      jsonrpc: "2.0",
      id: 2,
      method: "server/discover",
      params: withEnvelope({}, agent),
    });
    expect((await app.answer(1, 2)).body).toMatchObject({
      result: {
        supportedVersions: [MCP_REVISION],
        capabilities: { tools: { listChanged: false } },
        _meta: { "io.modelcontextprotocol/serverInfo": { name: "sherpa" } },
      },
    });
    app.data(1, { jsonrpc: "2.0", id: 3, method: "tools/list", params: withEnvelope({}, agent) });
    expect((await app.answer(1, 3)).body).toHaveProperty("result.tools");
    app.call(1, 4, "operations_list", { limit: 1 });
    expect((await app.answer(1, 4)).body).toMatchObject({
      result: { isError: false, structuredContent: { status: "succeeded" } },
    });
    // Pinned to 2026-07-28, a request without the envelope is malformed (-32602).
    app.data(1, { jsonrpc: "2.0", id: 5, method: "tools/list", params: {} });
    expect((await app.answer(1, 5)).body).toHaveProperty("error.code", -32602);
    app.input.end();
    expect(await app.exit).toBe(0);
  });

  test("each confirmation names the client of its own request's envelope", async () => {
    const app = start();
    await app.ready();
    app.call(1, 5, "mail_send", mail, { name: "claude-code", version: "2.1.326" });
    const first = await app.next(isConfirm);
    expect(first.body?.client).toEqual({ name: "claude-code", version: "2.1.326" });
    app.input.push(
      `0\tconfirmation\t${JSON.stringify({ id: first.body?.id, decision: "declined" })}\n`,
    );
    await app.answer(1, 5);
    // The same connection may carry another client; nothing is kept from an earlier request.
    app.call(1, 6, "mail_send", mail, { name: "codex-mcp-client", version: "0.171.0" });
    const second = await app.next((frame) => isConfirm(frame) && frame.body?.id !== first.body?.id);
    expect(second.body?.client).toEqual({ name: "codex-mcp-client", version: "0.171.0" });
    app.input.push(
      `0\tconfirmation\t${JSON.stringify({ id: second.body?.id, decision: "declined" })}\n`,
    );
    await app.answer(1, 6);
    // `clientInfo` is optional in the envelope.
    app.call(1, 7, "mail_send", mail, null);
    const third = await app.next(
      (frame) => isConfirm(frame) && ![first.body?.id, second.body?.id].includes(frame.body?.id),
    );
    expect(third.body?.client).toEqual({ name: "unknown", version: "unknown" });
    expect(app.sent).toEqual([]);
    app.input.end();
    expect(await app.exit).toBe(0);
  });
});

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
  serveStdio(() => server, { transport: side, legacy: "reject" });
  await client.start();
  await client.send({
    jsonrpc: "2.0",
    id: 1,
    method: "server/discover",
    params: withEnvelope({}, agent),
  });
  // The transport of `app serve` refuses the second; this one does not, as a regression guard.
  for (const limit of [1, 2])
    await client.send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: withEnvelope({ name: "operations_list", arguments: { limit } }, agent),
    });
  for (let i = 0; i < 20 && signals.length < 2; i++) await tick();
  expect(signals).toHaveLength(2);
  session.abort();
  await side.close();
  expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);
});
