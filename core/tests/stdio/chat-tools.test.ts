import { afterEach, expect, test } from "vite-plus/test";
import type { ConfirmHandler, CoreFrame, FakeApp } from "./fake-app.ts";
import { cleanHomes, launch } from "./launch.ts";
import { trustedCertificate } from "./tls.ts";

// app-connection-v1 §7.11 "도구", §9 and ADR-0012 "시험으로 지키기": a chat whose model calls a tool
// that changes something, through the built core and a fake app. The planner's discovery answered,
// the model, a server of the test process on an https loopback origin the core trusts, calls
// `event_delete`: its window opens on channel 0 and names the chat's channel and the chat as who
// asks, and what the person does there reaches the model in the call's result.
const apps: FakeApp[] = [];
const servers: Bun.Server<undefined>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) app.stop();
  for (const server of servers.splice(0)) await server.stop(true);
  cleanHomes();
});

/** Markers that must reach no log line: the key, the person's text, the answer and the target. */
const KEY = "sk-sherpa-stdio-chat-marker";
const TEXT = "stdio-chat-text-marker";
const ANSWER = "stdio-chat-answer-marker";
const LOCATOR = "stdio-chat-locator-marker";

/** A message of the chat other than the conversation's `state` (tests/stdio/egress.test.ts). */
const isChat = (frame: CoreFrame) =>
  frame.channel === 1 &&
  frame.type === "data" &&
  (frame.body as { type?: unknown } | null)?.type !== "state";
const isConfirm = (frame: CoreFrame) => frame.channel === 0 && frame.type === "confirm";
const isWithdraw = (frame: CoreFrame) => frame.channel === 0 && frame.type === "withdraw";

interface ModelMessage {
  role: string;
  content: unknown;
}

/**
 * An OpenAI-compatible server that calls `event_delete` after the person's text and answers once
 * it reads a result, each request's messages kept.
 */
async function modelServer() {
  const { ca, ...tls } = await trustedCertificate();
  const requests: ModelMessage[][] = [];
  const encoder = new TextEncoder();
  const event = (data: unknown) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
  const chunk = (fields: Record<string, unknown>) =>
    event({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m-1", ...fields });
  const delta = (value: Record<string, unknown>, finish: string | null = null) =>
    chunk({ choices: [{ index: 0, delta: value, finish_reason: finish }] });
  const call = {
    index: 0,
    id: "call_1",
    type: "function",
    function: {
      name: "event_delete",
      arguments: JSON.stringify({ native_locator: LOCATOR, span: "this" }),
    },
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    tls,
    fetch: async (request) => {
      const { messages } = (await request.json()) as { messages: ModelMessage[] };
      requests.push(messages);
      const answer =
        messages.at(-1)!.role === "user"
          ? [delta({ role: "assistant", tool_calls: [call] }), delta({}, "tool_calls")]
          : [delta({ role: "assistant", content: ANSWER }), delta({}, "stop")];
      const usage = chunk({
        choices: [],
        usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 },
      });
      return new Response(Buffer.concat([...answer, usage, encoder.encode("data: [DONE]\n\n")]), {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  servers.push(server);
  return { ca, requests, base_url: `https://127.0.0.1:${server.port}/v1` };
}

/** The built core with a chat on channel 1 whose turn has been sent, the app's window answering. */
async function chat(confirm: ConfirmHandler) {
  const { ca, requests, base_url } = await modelServer();
  const app = launch({ LOG_LEVEL: "debug", NODE_EXTRA_CA_CERTS: ca });
  apps.push(app);
  app.confirm = confirm;
  const hello = await app.handshake();
  const version = (hello.body as { version: string }).version;
  const message = {
    type: "turn",
    provider: "openai-compatible",
    base_url,
    api_key: KEY,
    model: "m-1",
    text: TEXT,
  };
  app.frame(1, "open", { kind: "chat" });
  app.frame(1, "data", message);
  return { app, version, requests, message };
}

/** The chat's messages up to and including the `done` or `error` that ends the turn. */
async function ending(app: FakeApp): Promise<Record<string, unknown>[]> {
  const messages: Record<string, unknown>[] = [];
  for (;;) {
    const body = (await app.next(isChat)).body as Record<string, unknown>;
    messages.push(body);
    if (body.type === "done" || body.type === "error") return messages;
  }
}

const tool = (status: string, code: string | null = null, operationID: string | null = null) => ({
  type: "tool",
  call_id: 1,
  name: "event_delete",
  status,
  code,
  operation_id: operationID,
});

/** What the model read of the call, the last message of the request after it. */
const outcome = (messages: ModelMessage[]) => {
  const last = messages.at(-1)!;
  expect(last.role).toBe("tool");
  return JSON.parse(String(last.content)) as Record<string, unknown>;
};

/** No line of the core's standard error holds the key, the text, the answer or the target. */
function quiet(app: FakeApp): void {
  const stderr = app.stderr.join("");
  for (const marker of [KEY, TEXT, ANSWER, LOCATOR]) expect(stderr).not.toContain(marker);
}

test("a delete the person approves runs under the operation id of the window the chat's call opened, and the model reads it", async () => {
  const { app, version, requests } = await chat(() => "approved");
  const frames = await ending(app);
  const confirm = app.log.find(isConfirm)!.body as Record<string, unknown>;
  expect(confirm).toMatchObject({
    tool: "event_delete",
    channel: 1,
    client: { name: "sherpa-chat", version },
  });
  expect(confirm.timeout_ms).toBeLessThanOrEqual(30_000);
  expect(app.requested()).toEqual(["capabilities", "event.get", "event.delete"]);
  const id = confirm.operation_id as string;
  expect(frames).toEqual([
    tool("started"),
    tool("succeeded", null, id),
    { type: "delta", text: ANSWER },
    { type: "done", reason: "stop", input_tokens: 22, output_tokens: 6, resend: false },
  ]);
  expect(requests).toHaveLength(2);
  expect(outcome(requests[1]!)).toMatchObject({ status: "succeeded", operation_id: id });
  quiet(app);
});

test("a delete the person declines asks the planner for nothing more, and the model reads that nothing changed", async () => {
  const { app, requests } = await chat(() => "declined");
  const frames = await ending(app);
  const confirm = app.log.find(isConfirm)!.body as Record<string, unknown>;
  expect(confirm).toMatchObject({ tool: "event_delete", channel: 1 });
  expect(app.requested()).toEqual(["capabilities", "event.get"]);
  expect(frames).toEqual([
    tool("started"),
    tool("declined", "confirmation.declined", confirm.operation_id as string),
    { type: "delta", text: ANSWER },
    { type: "done", reason: "stop", input_tokens: 22, output_tokens: 6, resend: false },
  ]);
  expect(outcome(requests[1]!)).toMatchObject({
    status: "failed",
    effect: { kind: "native_mutation", state: "not_started" },
    error: { code: "confirmation.declined", retry: "after_user_action" },
  });
  quiet(app);
});

test("a cancel while the window is open withdraws it on channel 0, and a turn without text then sends the call taken back", async () => {
  const { app, requests, message } = await chat(() => null);
  const confirm = await app.next(isConfirm);
  app.frame(1, "data", { type: "cancel" });
  expect((await app.next(isWithdraw)).body).toEqual({ id: (confirm.body as { id: number }).id });
  expect(await ending(app)).toEqual([
    tool("started"),
    tool("withdrawn", "chat.cancelled"),
    { type: "done", reason: "aborted", input_tokens: 11, output_tokens: 3, resend: true },
  ]);
  expect(app.requested()).toEqual(["capabilities", "event.get"]);
  expect(requests).toHaveLength(1);
  // §7.11 "다시 보내기": the conversation ends with the call's result, so it is sent again as it is,
  // as the done's resend said.
  app.frame(1, "data", { ...message, text: undefined });
  expect(await ending(app)).toEqual([
    { type: "delta", text: ANSWER },
    { type: "done", reason: "stop", input_tokens: 11, output_tokens: 3, resend: false },
  ]);
  expect(requests).toHaveLength(2);
  expect(requests[1]!.filter((item) => item.role === "user")).toHaveLength(1);
  expect(outcome(requests[1]!)).toMatchObject({
    status: "failed",
    error: { code: "chat.cancelled", retry: "after_user_action" },
  });
  quiet(app);
});
