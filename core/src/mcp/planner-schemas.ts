import { z } from "zod";

/**
 * MCP arguments of the planner tools: the Worker Protocol V2 `payload`
 * without `schema` (app-connection-v1 §10.4), copied from the Swift request
 * types in `SherpaPlannerContract` and the key sets `EventKitWorker` accepts.
 * The schemas carry the key set, types and required keys only; value rules
 * stay in the app's V2 validation, so a bad value gets the same
 * `protocol.invalid_payload` as `sherpa planner request`.
 */

const text = z.string();
const locator = z.string().describe("native_locator returned by a list or get tool");
const instant = z.string().describe("RFC 3339 date-time, for example 2026-11-21T09:00:00+09:00");

/** `EventAlarm`: `kind` decides which of `date` or `offset_seconds` it has. */
const alarm = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("absolute"), date: instant }),
  z.strictObject({
    kind: z.literal("relative"),
    offset_seconds: z.int().describe("seconds relative to the start; negative is before"),
  }),
]);

const recurrenceRule = z.strictObject({
  frequency: z.string().describe("daily, weekly, monthly or yearly"),
  interval: z.int(),
  days_of_week: z.array(z.strictObject({ day_of_week: z.int(), week_number: z.int() })).optional(),
  days_of_month: z.array(z.int()).optional(),
  months_of_year: z.array(z.int()).optional(),
  weeks_of_year: z.array(z.int()).optional(),
  days_of_year: z.array(z.int()).optional(),
  set_positions: z.array(z.int()).optional(),
  end: z
    .strictObject({ kind: z.string(), date: z.string().optional(), count: z.int().optional() })
    .optional(),
});

/** `ReminderDate`: calendar components, with hour and minute together or not at all. */
const reminderDate = z.strictObject({
  year: z.int(),
  month: z.int(),
  day: z.int(),
  hour: z.int().optional(),
  minute: z.int().optional(),
  second: z.int().optional(),
  time_zone: z.string().optional(),
});

const span = z.string().describe('"this" occurrence or "future" occurrences of a recurring event');

export const empty = z.strictObject({});

export const eventList = z.strictObject({
  from: instant,
  to: instant,
  limit: z.int().optional(),
  collection_native_locator: locator.optional(),
});
export const eventGet = z.strictObject({ native_locator: locator });

const eventCreateFields = {
  title: text,
  start: instant,
  end: instant,
  all_day: z.boolean().optional(),
  collection_native_locator: locator.optional(),
  notes: text.optional(),
  location: text.optional(),
  url: text.optional(),
  time_zone: text.optional(),
  alarms: z.array(alarm).optional(),
  recurrence_rules: z.array(recurrenceRule).optional(),
};
export const eventCreate = z.strictObject(eventCreateFields);

/** `EventPatch`: an omitted key is unchanged and null clears it. */
const eventPatch = z.strictObject({
  title: text.nullable().optional(),
  start: instant.nullable().optional(),
  end: instant.nullable().optional(),
  all_day: z.boolean().nullable().optional(),
  collection_native_locator: locator.nullable().optional(),
  notes: text.nullable().optional(),
  location: text.nullable().optional(),
  url: text.nullable().optional(),
  time_zone: text.nullable().optional(),
  alarms: z.array(alarm).nullable().optional(),
  recurrence_rules: z.array(recurrenceRule).nullable().optional(),
});
const eventUpdateFields = { native_locator: locator, span, changes: eventPatch };
export const eventUpdate = z.strictObject(eventUpdateFields);
const eventDeleteFields = { native_locator: locator, span };
export const eventDelete = z.strictObject(eventDeleteFields);
export const eventCollectionCreate = z.strictObject({
  title: text,
  source_native_locator: locator.optional(),
});
export const eventCollectionDelete = z.strictObject({ collection_native_locator: locator });

/** Nested payloads of a validation batch keep their own `schema`, as `EventValidatedCommand` decodes them. */
const payloadSchema = z
  .string()
  .describe(
    "the request schema of that capability, for example sherpa.planner.event-create.request.v2",
  );
export const eventCommandValidate = z.strictObject({
  commands: z.array(
    z.discriminatedUnion("capability", [
      z.strictObject({
        capability: z.literal("event.create"),
        payload: z.strictObject({ schema: payloadSchema, ...eventCreateFields }),
      }),
      z.strictObject({
        capability: z.literal("event.update"),
        payload: z.strictObject({ schema: payloadSchema, ...eventUpdateFields }),
      }),
      z.strictObject({
        capability: z.literal("event.delete"),
        payload: z.strictObject({ schema: payloadSchema, ...eventDeleteFields }),
      }),
    ]),
  ),
});

export const reminderList = z.strictObject({
  collection_native_locator: locator.optional(),
  limit: z.int().optional(),
  completed: z.boolean().optional(),
});
const reminderTargetFields = { native_locator: locator };
export const reminderTarget = z.strictObject(reminderTargetFields);

const reminderCreateFields = {
  title: text,
  collection_native_locator: locator.optional(),
  notes: text.optional(),
  url: text.optional(),
  priority: z.int().optional().describe("0 none, 1 high … 9 low"),
  due: reminderDate.optional(),
  start: reminderDate.optional(),
  alarms: z.array(alarm).optional(),
  recurrence_rules: z.array(recurrenceRule).optional(),
};
export const reminderCreate = z.strictObject(reminderCreateFields);

/** `ReminderPatch`: an omitted key is unchanged and null clears it. */
const reminderPatch = z.strictObject({
  title: text.nullable().optional(),
  collection_native_locator: locator.nullable().optional(),
  notes: text.nullable().optional(),
  url: text.nullable().optional(),
  priority: z.int().nullable().optional(),
  due: reminderDate.nullable().optional(),
  start: reminderDate.nullable().optional(),
  alarms: z.array(alarm).nullable().optional(),
  recurrence_rules: z.array(recurrenceRule).nullable().optional(),
});
const reminderUpdateFields = { native_locator: locator, changes: reminderPatch };
export const reminderUpdate = z.strictObject(reminderUpdateFields);
export const reminderCollectionCreate = z.strictObject({
  title: text,
  source_native_locator: locator.optional(),
});
export const reminderCollectionDelete = z.strictObject({ collection_native_locator: locator });

export const reminderCommandValidate = z.strictObject({
  commands: z.array(
    z.discriminatedUnion("capability", [
      z.strictObject({
        capability: z.literal("reminder.create"),
        payload: z.strictObject({ schema: payloadSchema, ...reminderCreateFields }),
      }),
      z.strictObject({
        capability: z.literal("reminder.update"),
        payload: z.strictObject({ schema: payloadSchema, ...reminderUpdateFields }),
      }),
      ...(["reminder.delete", "reminder.complete", "reminder.reopen"] as const).map((capability) =>
        z.strictObject({
          capability: z.literal(capability),
          payload: z.strictObject({ schema: payloadSchema, ...reminderTargetFields }),
        }),
      ),
    ]),
  ),
});
