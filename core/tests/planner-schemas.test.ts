import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vite-plus/test";
import { z } from "zod";
import * as schemas from "../src/mcp/planner-schemas.ts";
import { type CapabilityDescriptor, plannerEntries, reconcile } from "../src/mcp/registry.ts";
import { resolveTools } from "../src/mcp/tools.ts";
import type { CoreCommands } from "../src/commands.ts";
import { HelperProcessPlanner } from "../src/planner/helper-process.ts";
import {
  newOperationID,
  type PlannerReply,
  type PlannerRequest,
  plannerRequest,
} from "../src/planner/port.ts";
import { plannerDescriptors } from "./support/planner.ts";

// app-connection-v1 §13.1: the MCP arguments plus `schema` are the keys the
// Swift request types take. Read from the Swift sources the gate builds.
const sources = join(import.meta.dirname, "../../apple/eventkit-service/Sources");
const worker = await Bun.file(join(sources, "SherpaEventKitAdapter/EventKitWorker.swift")).text();
const contract = (
  await Promise.all(
    ["PlannerContract.swift", "ReminderItems.swift"].map((name) =>
      Bun.file(join(sources, "SherpaPlannerContract", name)).text(),
    ),
  )
).join("\n");

function body(source: string, start: number): string {
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  throw new Error("unbalanced Swift source");
}

const strings = (text: string) => [...text.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]!);

const capabilityNames = new Map(
  [
    ...body(contract, contract.indexOf("enum PlannerCapability")).matchAll(
      /case (\w+) = "([a-z.]+)"/g,
    ),
  ].map((match) => [match[1]!, match[2]!]),
);

/** `allowedKeys` and `requiredKeys` (default: allowed) of every capability `EventKitWorker` decodes. */
const workerKeys = new Map<string, { allowed: string[]; required: string[] }>();
for (const block of worker.split("if request.capability == ").slice(1)) {
  const head = block.slice(0, block.indexOf("{"));
  const allowed = /allowedKeys: \[([^\]]*)\]/.exec(block);
  if (!allowed) continue;
  const required = /requiredKeys: \[([^\]]*)\]/.exec(block);
  for (const match of head.matchAll(/PlannerCapability\.(\w+)\.rawValue/g)) {
    const capability = capabilityNames.get(match[1]!);
    if (!capability) throw new Error(`unknown capability case ${match[1]}`);
    workerKeys.set(capability, {
      allowed: strings(allowed[1]!).sort(),
      required: strings((required ?? allowed)[1]!).sort(),
    });
  }
}

/** The JSON keys of a Swift type: its `CodingKeys`, or its property names. */
function swiftKeys(type: string): string[] {
  const start = contract.search(new RegExp(`(struct|enum) ${type}\\b`));
  if (start < 0) throw new Error(`no Swift type ${type}`);
  const text = body(contract, start);
  const coding = /enum CodingKeys: String, CodingKey \{([^}]*)\}/.exec(text);
  if (coding) {
    return coding[1]!
      .split(/[;\n]/)
      .map((part) => part.trim())
      .filter((part) => part.startsWith("case "))
      .flatMap((part) => part.slice(5).split(","))
      .map((item) => {
        const match = /(\w+)(?:\s*=\s*"([^"]+)")?/.exec(item.trim())!;
        return match[2] ?? match[1]!;
      })
      .sort();
  }
  return [...text.matchAll(/public (?:let|var) ([\w, ]+):/g)]
    .flatMap((match) => match[1]!.split(",").map((name) => name.trim()))
    .sort();
}

function unwrap(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return unwrap(schema.unwrap() as z.ZodType);
  }
  if (schema instanceof z.ZodArray) return unwrap(schema.element as z.ZodType);
  return schema;
}

function objects(schema: z.ZodType): z.ZodObject[] {
  const inner = unwrap(schema);
  if (inner instanceof z.ZodObject) return [inner];
  if (inner instanceof z.ZodUnion) return (inner.options as z.ZodType[]).flatMap(objects);
  throw new Error("not an object schema");
}

function keys(schema: z.ZodType): { allowed: string[]; required: string[] } {
  const allowed = new Set<string>();
  const required = new Set<string>();
  for (const object of objects(schema)) {
    for (const [key, field] of Object.entries(object.shape as Record<string, z.ZodType>)) {
      allowed.add(key);
      if (!field.safeParse(undefined).success) required.add(key);
    }
  }
  return { allowed: [...allowed].sort(), required: [...required].sort() };
}

const withSchema = (set: { allowed: string[]; required: string[] }) => ({
  allowed: ["schema", ...set.allowed].sort(),
  required: ["schema", ...set.required].sort(),
});

const shape = (schema: z.ZodType, key: string) =>
  (unwrap(schema) as z.ZodObject).shape[key] as z.ZodType;

test("the Swift sources were read", () => {
  expect(capabilityNames.size).toBe(24);
  expect(workerKeys.size).toBe(24);
});

describe("top-level keys equal what EventKitWorker accepts", () => {
  test.each(plannerEntries.map((entry) => [entry.capability, entry.inputSchema] as const))(
    "%s",
    (capability, schema) => {
      expect(withSchema(keys(schema))).toEqual(workerKeys.get(capability));
    },
  );
});

describe("nested keys equal the Swift request types", () => {
  const rule = shape(schemas.eventCreate, "recurrence_rules");
  const table: [string, z.ZodType, string][] = [
    ["event alarms", shape(schemas.eventCreate, "alarms"), "EventAlarm"],
    ["recurrence rules", rule, "EventRecurrenceRule"],
    ["recurrence days", shape(rule, "days_of_week"), "EventRecurrenceDay"],
    ["recurrence end", shape(rule, "end"), "EventRecurrenceEnd"],
    ["event changes", shape(schemas.eventUpdate, "changes"), "EventPatch"],
    ["reminder due", shape(schemas.reminderCreate, "due"), "ReminderDate"],
    ["reminder start", shape(schemas.reminderCreate, "start"), "ReminderDate"],
    ["reminder alarms", shape(schemas.reminderCreate, "alarms"), "EventAlarm"],
    ["reminder changes", shape(schemas.reminderUpdate, "changes"), "ReminderPatch"],
    ["event commands", shape(schemas.eventCommandValidate, "commands"), "EventValidatedCommand"],
    [
      "reminder commands",
      shape(schemas.reminderCommandValidate, "commands"),
      "ReminderValidationCommand",
    ],
  ];
  test.each(table)("%s", (_name, schema, type) => {
    expect(keys(schema).allowed).toEqual(swiftKeys(type));
  });

  test.each([
    ["event", schemas.eventCommandValidate],
    ["reminder", schemas.reminderCommandValidate],
  ] as const)("every %s validation payload has the keys of its capability", (_domain, schema) => {
    for (const option of objects(shape(schema, "commands"))) {
      const capability = (option.shape.capability as z.ZodLiteral).value as string;
      expect(keys(option.shape.payload as z.ZodType)).toEqual(workerKeys.get(capability));
    }
  });
});

const instant = "2026-11-22T09:00:00+09:00";
const later = "2026-11-22T10:00:00+09:00";
const recurrence = [
  {
    frequency: "weekly",
    interval: 1,
    days_of_week: [{ day_of_week: 2, week_number: 0 }],
    end: { kind: "count", count: 3 },
  },
];
const alarms = [
  { kind: "relative", offset_seconds: -600 },
  { kind: "absolute", date: instant },
];
const day = { year: 2026, month: 11, day: 22, hour: 9, minute: 0 };

/** Example arguments for every planner tool, each key filled. */
const examples: Record<string, Record<string, unknown>> = {
  event_authorization_status: {},
  reminder_authorization_status: {},
  event_source_list: {},
  reminder_source_list: {},
  event_list: { from: instant, to: later, limit: 10, collection_native_locator: "c" },
  event_get: { native_locator: "e" },
  event_command_validate: {
    commands: [
      {
        capability: "event.create",
        payload: {
          schema: "sherpa.planner.event-create.request.v2",
          title: "Lunch",
          start: instant,
          end: later,
        },
      },
      {
        capability: "event.delete",
        payload: {
          schema: "sherpa.planner.event-delete.request.v2",
          native_locator: "e",
          span: "this",
        },
      },
    ],
  },
  reminder_list: { collection_native_locator: "c", limit: 10, completed: false },
  reminder_get: { native_locator: "r" },
  reminder_command_validate: {
    commands: [
      {
        capability: "reminder.create",
        payload: { schema: "sherpa.planner.reminder-create.request.v2", title: "Milk" },
      },
      {
        capability: "reminder.complete",
        payload: { schema: "sherpa.planner.reminder-complete.request.v2", native_locator: "r" },
      },
    ],
  },
  event_create: {
    title: "Lunch",
    start: instant,
    end: later,
    all_day: false,
    collection_native_locator: "c",
    notes: "n",
    location: "l",
    url: "https://example.com",
    time_zone: "Asia/Seoul",
    alarms,
    recurrence_rules: recurrence,
  },
  event_collection_create: { title: "Work", source_native_locator: "s" },
  reminder_create: {
    title: "Milk",
    collection_native_locator: "c",
    notes: "n",
    url: "https://example.com",
    priority: 1,
    due: day,
    start: day,
    alarms,
    recurrence_rules: recurrence,
  },
  reminder_collection_create: { title: "Groceries", source_native_locator: "s" },
  event_update: {
    native_locator: "e",
    span: "this",
    changes: { title: "Late lunch", notes: null },
  },
  reminder_update: { native_locator: "r", changes: { title: "Oat milk", due: null } },
  reminder_complete: { native_locator: "r" },
  reminder_reopen: { native_locator: "r" },
  event_delete: { native_locator: "e", span: "future" },
  event_collection_delete: { collection_native_locator: "c" },
  reminder_delete: { native_locator: "r" },
  reminder_collection_delete: { collection_native_locator: "c" },
};

/** The V2 requests the planner tools build from the examples, confirmations approved. */
async function examplePayloads(
  descriptors = plannerDescriptors() as unknown as CapabilityDescriptor[],
): Promise<Map<string, PlannerRequest>> {
  const sent = new Map<string, PlannerRequest>();
  const tools = resolveTools(reconcile({ kind: "discovered", descriptors }), {
    planner: {
      request: async (request): Promise<PlannerReply> => {
        sent.set(request.capability, request);
        return { kind: "report", report: { status: "failed", error: "test.stop" } };
      },
    },
    confirmations: { confirm: async () => "approved" },
    commands: {} as CoreCommands,
  });
  for (const entry of plannerEntries) {
    const tool = tools.find((item) => item.entry.name === entry.name)!;
    expect(entry.inputSchema.safeParse(examples[entry.name]).success).toBe(true);
    // A delete stops at its failed preview read; its own payload is checked directly.
    if (entry.confirmation === "app") continue;
    await tool.handle(examples[entry.name], {
      signal: new AbortController().signal,
      channel: 1,
      client: { name: "t", version: "0" },
    });
  }
  return sent;
}

test("every planner tool has an example and its request has keys EventKitWorker accepts", async () => {
  expect(Object.keys(examples).sort()).toEqual(plannerEntries.map((entry) => entry.name).sort());
  const sent = await examplePayloads();
  for (const entry of plannerEntries) {
    const accepted = workerKeys.get(entry.capability)!;
    const payload = Object.keys(
      sent.get(entry.capability)?.payload ?? { schema: "", ...examples[entry.name] },
    ).sort();
    expect(payload).toEqual(accepted.allowed);
  }
});

const helper = process.env.SHERPA_APPLE_BIN;

describe.skipIf(!helper)("the built sherpa-apple helper (SHERPA_APPLE_BIN)", () => {
  // Built here: the body is collected even when the block is skipped.
  let planner: HelperProcessPlanner;
  const read = { effect: "read", required_evidence: "none", artifact_directory: null } as const;
  let descriptors: CapabilityDescriptor[] = [];

  beforeAll(async () => {
    planner = new HelperProcessPlanner(helper);
    const reply = await planner.request(
      plannerRequest(
        "capabilities",
        { schema: "sherpa.planner.capabilities.request.v2" },
        read,
        newOperationID(),
      ),
    );
    if (reply.kind !== "response") throw new Error(`capabilities answered ${reply.kind}`);
    descriptors = (reply.response.result as { capabilities: CapabilityDescriptor[] }).capabilities;
  });

  test("its descriptors are the test fixture and keep every planner tool", () => {
    const byName = (rows: object[]) =>
      [...rows].sort((a, b) =>
        String((a as CapabilityDescriptor).capability).localeCompare(
          String((b as CapabilityDescriptor).capability),
        ),
      );
    expect(byName(descriptors)).toEqual(byName(plannerDescriptors()));
    expect(reconcile({ kind: "discovered", descriptors }).map((item) => item.entry.name)).toEqual(
      plannerEntries.map((entry) => entry.name),
    );
  });

  async function answer(name: string) {
    const sent = await examplePayloads(descriptors);
    const entry = plannerEntries.find((item) => item.name === name)!;
    const example = sent.get(entry.capability)!;
    return planner.request(
      plannerRequest(entry.capability, example.payload, example.policy, newOperationID()),
    );
  }

  // Paths that need no permission only; the owner's Mac has access, so changes would apply.
  test.each([
    "event_authorization_status",
    "reminder_authorization_status",
    "event_command_validate",
    "reminder_command_validate",
  ])("%s is accepted", async (name) => {
    const reply = await answer(name);
    expect(reply.kind).toBe("response");
    if (reply.kind !== "response") return;
    expect(reply.response.error?.code).not.toBe("protocol.invalid_payload");
    expect(reply.response.status).toBe("succeeded");
  });
});
