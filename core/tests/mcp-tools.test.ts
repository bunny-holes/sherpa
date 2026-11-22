import { describe, expect, test } from "vite-plus/test";
import {
  ControlChannel,
  ControlChannelConfirmations,
  ControlChannelPlanner,
} from "../src/app/control.ts";
import { SherpaError } from "../src/cli/errors.ts";
import { type CoreCommands, systemCommands } from "../src/commands.ts";
import { JournaledMutationError } from "../src/journal/journal.ts";
import type {
  ConfirmationDecision,
  ConfirmationPort,
  ConfirmationPrompt,
} from "../src/mcp/confirmation.ts";
import { type CapabilityDescriptor, plannerEntries, reconcile } from "../src/mcp/registry.ts";
import { resolveTools } from "../src/mcp/tools.ts";
import type {
  PlannerPort,
  PlannerReply,
  PlannerRequest,
  WorkerResponse,
} from "../src/planner/port.ts";
import type { ToolCall } from "../src/tools/call.ts";
import { plannerDescriptors, v2Response } from "./support/planner.ts";
import { ManualTimers, tick } from "./support/pipes.ts";

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

type Answer = (request: PlannerRequest) => PlannerReply | undefined;

function succeeded(request: PlannerRequest, result: Record<string, unknown>): PlannerReply {
  return { kind: "response", response: v2Response(request, { result }) as WorkerResponse };
}

const targets: Answer = (request) => {
  switch (request.capability) {
    case "event.get":
      return succeeded(request, {
        schema: "sherpa.planner.event-get.success.v2",
        event: {
          title: "Dentist",
          event_collection: { title: "Home" },
          start: "2026-11-22T09:00:00+09:00",
          end: "2026-11-22T10:00:00+09:00",
        },
      });
    case "reminder.get":
      return succeeded(request, {
        schema: "sherpa.planner.reminder-get.success.v2",
        reminder: {
          title: "Milk",
          reminder_collection: { title: "Groceries" },
          due: { year: 2026, month: 11, day: 22, hour: 9, minute: 5 },
        },
      });
    case "reminder.source.list":
      return succeeded(request, {
        schema: "sherpa.planner.reminder-source-list.success.v2",
        sources: [
          {
            title: "iCloud",
            reminder_collections: [{ native_locator: "list-1", title: "Groceries" }],
          },
        ],
      });
    default:
      return undefined;
  }
};

function harness(
  options: {
    decisions?: ConfirmationDecision[];
    answer?: Answer;
    commands?: Partial<CoreCommands>;
    confirmations?: ConfirmationPort;
    planner?: PlannerPort;
    now?: () => number;
  } = {},
) {
  const requests: PlannerRequest[] = [];
  const prompts: ConfirmationPrompt[] = [];
  const timeouts: number[] = [];
  const decisions = [...(options.decisions ?? [])];
  let minted = 0;
  const planner: PlannerPort = options.planner ?? {
    request: async (request) => {
      requests.push(request);
      return (
        options.answer?.(request) ??
        targets(request) ?? { kind: "response", response: v2Response(request) as WorkerResponse }
      );
    },
  };
  const confirmations: ConfirmationPort = options.confirmations ?? {
    confirm: async (prompt, _signal, timeoutMs) => {
      prompts.push(prompt);
      timeouts.push(timeoutMs);
      return decisions.shift() ?? "approved";
    },
  };
  const tools = resolveTools(
    reconcile({
      kind: "discovered",
      descriptors: plannerDescriptors() as unknown as CapabilityDescriptor[],
    }),
    {
      planner,
      confirmations,
      commands: { ...noCommands, imessageChat: async () => family, ...options.commands },
      newOperationID: () => `op-${++minted}`,
      ...(options.now ? { now: options.now } : {}),
    },
  );
  const call = (
    name: string,
    args: Record<string, unknown>,
    signal = new AbortController().signal,
  ) => {
    const tool = tools.find((item) => item.entry.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    const context: ToolCall = { signal, channel: 4, client: { name: "agent", version: "1.0" } };
    return tool.handle(args, context);
  };
  return { requests, prompts, timeouts, call };
}

/** A clock the planner and commands of a test move forward. */
function clock() {
  let ms = 1_000;
  return { now: () => ms, advance: (by: number) => void (ms += by) };
}

const family = { name: "Family", participants: ["+15555550100", "b@example.com"] };

describe("planner delete tools ask the app first (§9)", () => {
  test("approved: the target is read, shown, then deleted under the shown operation id", async () => {
    const { requests, prompts, call } = harness({ decisions: ["approved"] });
    const value = await call("event_delete", { native_locator: "event-1", span: "this" });
    expect(requests.map((request) => [request.capability, request.payload])).toEqual([
      ["event.get", { schema: "sherpa.planner.event-get.request.v2", native_locator: "event-1" }],
      [
        "event.delete",
        {
          schema: "sherpa.planner.event-delete.request.v2",
          native_locator: "event-1",
          span: "this",
        },
      ],
    ]);
    expect(prompts).toEqual([
      {
        tool: "event_delete",
        operation_id: "op-1",
        // The channel of the call, so the app can tell which kind of channel asks (§9).
        channel: 4,
        client: { name: "agent", version: "1.0" },
        title: "Delete this event?",
        lines: [
          { label: "Event", value: "Dentist" },
          { label: "Calendar", value: "Home" },
          { label: "Starts", value: "2026-11-22T09:00:00+09:00" },
          { label: "Ends", value: "2026-11-22T10:00:00+09:00" },
          { label: "Occurrences", value: "This one" },
        ],
      },
    ]);
    expect(requests[1]?.operation_id).toBe("op-1");
    expect(requests[1]?.policy).toEqual({
      effect: "mutation",
      required_evidence: "native_absence_readback",
      artifact_directory: null,
    });
    expect(value).toMatchObject({
      status: "succeeded",
      operation_id: "op-1",
      effect: { kind: "native_mutation", state: "applied" },
    });
  });

  test.each([
    ["declined", "confirmation.declined", "after_user_action"],
    ["timed_out", "confirmation.timed_out", "after_user_action"],
    ["unavailable", "confirmation.unavailable", "after_backoff"],
  ] as const)("%s: nothing is deleted", async (decision, code, retry) => {
    const { requests, call } = harness({ decisions: [decision] });
    const value = await call("reminder_delete", { native_locator: "rem-1" });
    expect(requests.map((request) => request.capability)).toEqual(["reminder.get"]);
    expect(value).toMatchObject({
      status: "failed",
      operation_id: "op-1",
      effect: { kind: "native_mutation", state: "not_started" },
      error: { code, retry },
    });
  });

  test("withdrawn: the call is not answered and nothing is deleted", async () => {
    const { requests, call } = harness({ decisions: ["withdrawn"] });
    expect(await call("reminder_delete", { native_locator: "rem-1" })).toBeNull();
    expect(requests.map((request) => request.capability)).toEqual(["reminder.get"]);
  });

  test("a failed preview read ends the call before the app is asked", async () => {
    const { requests, prompts, call } = harness({
      answer: (request) =>
        request.capability === "event.get"
          ? {
              kind: "response",
              response: v2Response(request, {
                status: "failed",
                effect: { kind: "none", state: "not_started" },
                error: { code: "eventkit.not_found", retry: "never" },
                result: null,
              }) as WorkerResponse,
            }
          : undefined,
    });
    const value = await call("event_delete", { native_locator: "gone", span: "future" });
    expect(prompts).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(value).toMatchObject({
      status: "failed",
      capability: "event.delete",
      error: { code: "eventkit.not_found" },
    });
  });

  test("a collection is found in the source list and shown with its account", async () => {
    const { prompts, requests, call } = harness();
    await call("reminder_collection_delete", { collection_native_locator: "list-1" });
    expect(prompts[0]?.title).toBe("Delete this list and all its reminders?");
    expect(prompts[0]?.lines).toEqual([
      { label: "List", value: "Groceries" },
      { label: "Account", value: "iCloud" },
    ]);
    expect(requests.map((request) => request.capability)).toEqual([
      "reminder.source.list",
      "reminder.collection.delete",
    ]);
  });

  test("a collection missing from the source list is not found and nobody is asked", async () => {
    const { prompts, requests, call } = harness();
    const value = await call("reminder_collection_delete", { collection_native_locator: "list-9" });
    expect(prompts).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(value).toMatchObject({
      status: "failed",
      error: { code: "eventkit.not_found", retry: "never" },
    });
  });

  test("an approval that arrives after the call was cancelled runs nothing", async () => {
    const written: { type: string; body: { id: number } }[] = [];
    const control = new ControlChannel(async (type, body) => {
      written.push({ type, body: JSON.parse(body) as { id: number } });
    });
    const { requests, call } = harness({ confirmations: new ControlChannelConfirmations(control) });
    const cancel = new AbortController();
    const pending = call(
      "event_delete",
      { native_locator: "event-1", span: "this" },
      cancel.signal,
    );
    await tick();
    await tick();
    const confirm = written.find((frame) => frame.type === "confirm");
    expect(confirm).toBeDefined();
    cancel.abort();
    expect(await pending).toBeNull();
    control.onConfirmation({ id: confirm!.body.id, decision: "approved" });
    await tick();
    expect(written.map((frame) => frame.type)).toEqual(["confirm", "withdraw"]);
    expect(requests.map((request) => request.capability)).toEqual(["event.get"]);
  });
});

describe("planner tools without confirmation", () => {
  test("a change carries the descriptor's request schema and policy", async () => {
    const { requests, prompts, call } = harness();
    const value = await call("event_create", {
      title: "Lunch",
      start: "2026-11-22T12:00:00Z",
      end: "2026-11-22T13:00:00Z",
    });
    expect(prompts).toEqual([]);
    expect(requests[0]).toMatchObject({
      capability: "event.create",
      operation_id: "op-1",
      request_id: "op-1",
      idempotency_key: "op-1",
      deadline_ms: 20_000,
      payload: { schema: "sherpa.planner.event-create.request.v2", title: "Lunch" },
      policy: {
        effect: "mutation",
        required_evidence: "native_readback",
        artifact_directory: null,
      },
    });
    expect(value).toMatchObject({
      status: "succeeded",
      evidence: { kind: "native_readback", state: "matched" },
    });
  });
});

describe("core tools (§10.4)", () => {
  test("a send asks the app and runs under the shown operation id", async () => {
    const sent: { chatID: bigint; text: string; operationID?: string }[] = [];
    const { prompts, call } = harness({
      commands: {
        imessageChat: async (chatID) => {
          expect(chatID).toBe(7n);
          return family;
        },
        imessageSend: async ({ chatID, text, operationID }) => {
          sent.push({
            chatID,
            text: new TextDecoder().decode(text),
            ...(operationID ? { operationID } : {}),
          });
          return {
            operationID: operationID!,
            output: new TextEncoder().encode('{"accepted":true}'),
            journalFailure: null,
          };
        },
      },
    });
    const value = await call("imessage_send", { chat_id: 7, text: "hello" });
    expect(prompts).toEqual([
      {
        tool: "imessage_send",
        operation_id: "op-1",
        channel: 4,
        client: { name: "agent", version: "1.0" },
        title: "Send this iMessage?",
        lines: [
          { label: "Chat", value: "Family" },
          { label: "Participants", value: "+15555550100, b@example.com" },
          { label: "Message", value: "hello" },
        ],
      },
    ]);
    expect(sent).toEqual([{ chatID: 7n, text: "hello", operationID: "op-1" }]);
    expect(value).toMatchObject({
      status: "succeeded",
      operation_id: "op-1",
      effect: { kind: "outbound_dispatch", state: "applied" },
      evidence: { kind: "application_acceptance", state: "matched" },
      journal_error: null,
      result: { accepted: true },
    });
  });

  test.each(["imessage.store_unreadable", "imessage.chat_not_found"])(
    "a chat read that fails with %s ends the send before the app is asked",
    async (code) => {
      const { prompts, call } = harness({
        commands: {
          imessageChat: async () => {
            throw new SherpaError(code);
          },
        },
      });
      expect(await call("imessage_send", { chat_id: 7, text: "x" })).toMatchObject({
        status: "failed",
        effect: { kind: "outbound_dispatch", state: "not_started" },
        error: { code },
      });
      expect(prompts).toEqual([]);
    },
  );

  test("a chat without other participants shows no participant line", async () => {
    const { prompts, call } = harness({
      decisions: ["declined"],
      commands: { imessageChat: async () => ({ name: "+15555550100", participants: [] }) },
    });
    await call("imessage_send", { chat_id: 7, text: "x" });
    expect(prompts[0]?.lines).toEqual([
      { label: "Chat", value: "+15555550100" },
      { label: "Message", value: "x" },
    ]);
  });

  test("a declined send is not sent", async () => {
    const { call } = harness({ decisions: ["declined"] });
    expect(
      await call("mail_send", { to: ["a@example.com"], cc: [], bcc: [], subject: "s", body: "b" }),
    ).toMatchObject({
      status: "failed",
      operation_id: "op-1",
      effect: { kind: "outbound_dispatch", state: "not_started" },
      error: { code: "confirmation.declined" },
    });
  });

  test("a send the CLI would reject is rejected before the app is asked", async () => {
    const { prompts, call } = harness();
    expect(await call("imessage_send", { chat_id: 7, text: "" })).toMatchObject({
      status: "failed",
      error: { code: "invalidRequest", retry: "never" },
    });
    expect(await call("imessage_send", { chat_id: -1, text: "x" })).toMatchObject({
      status: "failed",
      error: { code: "invalidRequest" },
    });
    expect(
      await call("mail_send", { to: [], cc: [], bcc: [], subject: "s", body: "b" }),
    ).toMatchObject({ status: "failed", error: { code: "invalidRequest" } });
    expect(prompts).toEqual([]);
  });

  test("a journaled send that may have applied is uncertain", async () => {
    const { call } = harness({
      commands: {
        imessageSend: async ({ operationID }) => {
          throw new JournaledMutationError(operationID ?? null, "uncertain", "uncertain", null);
        },
      },
    });
    expect(await call("imessage_send", { chat_id: 7, text: "x" })).toMatchObject({
      status: "uncertain",
      operation_id: "op-1",
      effect: { kind: "outbound_dispatch", state: "may_have_applied" },
      error: { code: "uncertain", retry: "never" },
    });
  });

  test("kakaotalk_checkpoint takes the CLI's confirmation value as an argument", async () => {
    const { prompts, call } = harness({
      commands: {
        kakaotalkCheckpoint: (confirm, token) => systemCommands.kakaotalkCheckpoint(confirm, token),
      },
    });
    expect(await call("kakaotalk_checkpoint", { token: "t", confirm: "yes" })).toMatchObject({
      status: "failed",
      effect: { kind: "local_state", state: "not_started" },
      error: { code: "invalidRequest", retry: "never" },
    });
    expect(prompts).toEqual([]);
  });

  test("line output becomes items and an empty one an empty list", async () => {
    let output = '{"chat_id":1}\n{"chat_id":2}\n';
    const { call } = harness({ commands: { imessageChats: async () => output } });
    expect(await call("imessage_chats", { limit: 2 })).toMatchObject({
      status: "succeeded",
      operation_id: null,
      effect: { kind: "none", state: "not_applicable" },
      result: { items: [{ chat_id: 1 }, { chat_id: 2 }] },
    });
    output = "";
    expect((await call("imessage_chats", { limit: 2 }))?.result).toEqual({ items: [] });
  });

  test("a command that throws without a Sherpa code is an internal failure", async () => {
    const { call } = harness({
      commands: {
        operationsList: async () => {
          throw new RangeError("x");
        },
      },
    });
    expect(await call("operations_list", { limit: 1 })).toMatchObject({
      status: "failed",
      error: { code: "sherpa.internal_failure" },
    });
  });
});

describe("the 30 s of §9 include the preview read", () => {
  test("a delete's preview read has a 5 s deadline and the app gets what is left", async () => {
    const time = clock();
    const { requests, timeouts, call } = harness({
      now: time.now,
      answer: (request) => {
        if (request.capability === "reminder.get") time.advance(7_250);
        return undefined;
      },
    });
    await call("reminder_delete", { native_locator: "rem-1" });
    expect(requests.map((request) => [request.capability, request.deadline_ms])).toEqual([
      ["reminder.get", 5_000],
      ["reminder.delete", 20_000],
    ]);
    expect(timeouts).toEqual([22_750]);
  });

  test("a send's chat read counts against the same 30 s", async () => {
    const time = clock();
    const { timeouts, call } = harness({
      now: time.now,
      decisions: ["declined"],
      commands: {
        imessageChat: async () => {
          time.advance(1_500);
          return family;
        },
      },
    });
    await call("imessage_send", { chat_id: 7, text: "hello" });
    expect(timeouts).toEqual([28_500]);
  });

  test("a preview that used up the 30 s times out without asking", async () => {
    const time = clock();
    const { prompts, requests, call } = harness({
      now: time.now,
      answer: () => {
        time.advance(30_000);
        return undefined;
      },
    });
    expect(await call("event_delete", { native_locator: "event-1", span: "this" })).toMatchObject({
      status: "failed",
      effect: { kind: "native_mutation", state: "not_started" },
      error: { code: "confirmation.timed_out", retry: "after_user_action" },
    });
    expect(prompts).toEqual([]);
    expect(requests.map((request) => request.capability)).toEqual(["event.get"]);
  });
});

describe("the preview read through the control channel", () => {
  function wired() {
    const written: { type: string; body: Record<string, unknown> }[] = [];
    const timers = new ManualTimers();
    const control = new ControlChannel(
      async (type, body) => {
        written.push({ type, body: JSON.parse(body) as Record<string, unknown> });
      },
      { timers },
    );
    const tools = harness({
      planner: new ControlChannelPlanner(control),
      confirmations: new ControlChannelConfirmations(control),
    });
    return { written, timers, control, call: tools.call };
  }

  test("an unanswered preview read ends after 5 + 5 s and nobody is asked", async () => {
    const { written, timers, call } = wired();
    const pending = call("reminder_delete", { native_locator: "rem-1" });
    await tick();
    expect(written).toEqual([
      {
        type: "request",
        body: expect.objectContaining({
          request: expect.objectContaining({ capability: "reminder.get", deadline_ms: 5_000 }),
        }),
      },
    ]);
    timers.fire(10_000);
    expect(await pending).toMatchObject({
      status: "failed",
      capability: "reminder.delete",
      error: { code: "app.worker_timeout", retry: "after_backoff" },
    });
    expect(written.map((frame) => frame.type)).toEqual(["request"]);
  });

  test("cancelling during the preview read leaves the call unanswered and asks nobody", async () => {
    const { written, control, call } = wired();
    const cancel = new AbortController();
    const pending = call("reminder_delete", { native_locator: "rem-1" }, cancel.signal);
    await tick();
    cancel.abort();
    expect(await pending).toBeNull();
    const read = written[0]!.body as { id: number; request: PlannerRequest };
    control.onResponse({ id: read.id, response: v2Response(read.request) });
    await tick();
    expect(written.map((frame) => frame.type)).toEqual(["request"]);
  });
});

describe("no tool runs without its confirmation window (§9)", () => {
  test("a delete confirmed in the app without its preview read is refused when the tools are built", () => {
    const entry = plannerEntries.find((item) => item.name === "reminder_delete")!;
    const unused: PlannerPort = { request: unexpected };
    expect(() =>
      resolveTools(
        [
          {
            entry,
            requestSchema: "sherpa.planner.reminder-delete.request.v2",
            policy: {
              effect: "mutation",
              required_evidence: "native_absence_readback",
              artifact_directory: null,
            },
          },
        ],
        { planner: unused, confirmations: { confirm: unexpected }, commands: noCommands },
      ),
    ).toThrow("reminder_delete is confirmed in the app but has no preview read");
  });
});
