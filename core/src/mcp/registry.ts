import type { ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";
import { log } from "../log.ts";
import {
  PLANNER_CONTRACT,
  PLANNER_DEADLINE_MS,
  type PlannerEffect,
  type PlannerPolicy,
  type RequiredEvidence,
} from "../planner/port.ts";
import * as planner from "./planner-schemas.ts";

/**
 * The one tool registry of `sherpa app serve` (app-connection-v1 §10.2):
 * capability, source, name, description, input schema, effect class,
 * confirmation and deadline of every tool. `app:planner` entries are kept
 * only when the app's capability discovery confirms them.
 */
export type EffectClass = "read" | "create" | "update" | "toggle" | "delete" | "send" | "local";

/** How a call is confirmed: the app window (§9), the `confirm` argument, or not at all. */
export type Confirmation = "app" | "argument" | "none";

export interface RegistryEntry {
  capability: string;
  source: "app:planner" | "core";
  name: string;
  description: string;
  inputSchema: z.ZodObject;
  effectClass: EffectClass;
  confirmation: Confirmation;
  /** `deadline_ms` of the planner request; core commands carry their own runner bounds. */
  deadlineMs: number | null;
}

export interface PlannerEntry extends RegistryEntry {
  source: "app:planner";
  /** The descriptor must state this effect and evidence (`EventKitWorker.capabilityDescriptor`). */
  expected: { effect: PlannerEffect; requiredEvidence: RequiredEvidence };
  /** Delete tools read their target through this capability for the confirmation preview (§9). */
  previewCapability?: string;
}

export const TOOL_NAME = /^[a-z][a-z0-9_]{0,47}$/;

/** `event.collection.delete` → `event_collection_delete`, `mail.authorization-status` → `mail_authorization_status`. */
export function toolName(capability: string): string {
  return capability.replace(/[.-]/g, "_");
}

/** §10.6: all four hints, always written out. */
export const annotationTable: Record<EffectClass, Required<Omit<ToolAnnotations, "title">>> = {
  read: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  create: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  update: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  toggle: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  delete: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  send: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  local: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

/** Builds one planner entry; a delete, confirmed in the app, must name the read of its preview (§9). */
export function plannerEntry(
  capability: string,
  effectClass: Exclude<EffectClass, "send" | "local">,
  inputSchema: z.ZodObject,
  description: string,
  previewCapability?: string,
): PlannerEntry {
  if (effectClass === "delete" && !previewCapability) {
    throw new Error(`${capability} is confirmed in the app but has no preview read`);
  }
  const expected =
    effectClass === "read"
      ? { effect: "read" as const, requiredEvidence: "none" as const }
      : effectClass === "delete"
        ? { effect: "mutation" as const, requiredEvidence: "native_absence_readback" as const }
        : { effect: "mutation" as const, requiredEvidence: "native_readback" as const };
  return {
    capability,
    source: "app:planner",
    name: toolName(capability),
    description,
    inputSchema,
    effectClass,
    confirmation: effectClass === "delete" ? "app" : "none",
    deadlineMs: PLANNER_DEADLINE_MS,
    expected,
    ...(previewCapability ? { previewCapability } : {}),
  };
}

const RANGE = "The range is half-open [from, to).";
const LIMITS = "Values outside the documented ranges fail with protocol.invalid_payload.";
const DELETE_CONFIRM =
  "Each call waits up to 30 seconds for the person to allow it in the Sherpa app window.";

/** The planner tools of V1 (§10.2). `*.authorization.request` stays with the app menu. */
export const plannerEntries: readonly PlannerEntry[] = [
  plannerEntry(
    "event.authorization.status",
    "read",
    planner.empty,
    "Report Sherpa's Calendar access: full_access, write_only, denied, restricted or not_determined.",
  ),
  plannerEntry(
    "reminder.authorization.status",
    "read",
    planner.empty,
    "Report Sherpa's Reminders access: full_access, write_only, denied, restricted or not_determined.",
  ),
  plannerEntry(
    "event.source.list",
    "read",
    planner.empty,
    "List calendar accounts and their calendars with native_locator values.",
  ),
  plannerEntry(
    "event.list",
    "read",
    planner.eventList,
    `List events overlapping a time range. ${RANGE} limit is 1–10000. ${LIMITS}`,
  ),
  plannerEntry("event.get", "read", planner.eventGet, "Read one event by native_locator."),
  plannerEntry(
    "event.command.validate",
    "read",
    planner.eventCommandValidate,
    `Validate 1–64 event create, update or delete commands without changing anything. ${LIMITS}`,
  ),
  plannerEntry(
    "reminder.source.list",
    "read",
    planner.empty,
    "List reminder accounts and their lists with native_locator values.",
  ),
  plannerEntry(
    "reminder.list",
    "read",
    planner.reminderList,
    `List reminders, optionally of one list and by completion. limit is 1–10000. ${LIMITS}`,
  ),
  plannerEntry(
    "reminder.get",
    "read",
    planner.reminderTarget,
    "Read one reminder by native_locator.",
  ),
  plannerEntry(
    "reminder.command.validate",
    "read",
    planner.reminderCommandValidate,
    `Validate 1–1000 reminder commands without changing anything. ${LIMITS}`,
  ),
  plannerEntry(
    "event.create",
    "create",
    planner.eventCreate,
    `Create one event and read it back. start must be before end. ${LIMITS}`,
  ),
  plannerEntry(
    "event.collection.create",
    "create",
    planner.eventCollectionCreate,
    "Create a calendar, in the given account or the default one.",
  ),
  plannerEntry(
    "reminder.create",
    "create",
    planner.reminderCreate,
    `Create one reminder and read it back. priority is 0–9. ${LIMITS}`,
  ),
  plannerEntry(
    "reminder.collection.create",
    "create",
    planner.reminderCollectionCreate,
    "Create a reminder list, in the given account or the default one.",
  ),
  plannerEntry(
    "event.update",
    "update",
    planner.eventUpdate,
    `Change an event; omitted keys stay, null clears. span is this or future. ${LIMITS}`,
  ),
  plannerEntry(
    "reminder.update",
    "update",
    planner.reminderUpdate,
    `Change a reminder; omitted keys stay, null clears. ${LIMITS}`,
  ),
  plannerEntry("reminder.complete", "toggle", planner.reminderTarget, "Mark a reminder completed."),
  plannerEntry(
    "reminder.reopen",
    "toggle",
    planner.reminderTarget,
    "Mark a completed reminder incomplete.",
  ),
  plannerEntry(
    "event.delete",
    "delete",
    planner.eventDelete,
    `Delete an event occurrence (span this) or it and later ones (span future). ${DELETE_CONFIRM}`,
    "event.get",
  ),
  plannerEntry(
    "event.collection.delete",
    "delete",
    planner.eventCollectionDelete,
    `Delete a calendar with all its events. ${DELETE_CONFIRM}`,
    "event.source.list",
  ),
  plannerEntry(
    "reminder.delete",
    "delete",
    planner.reminderTarget,
    `Delete one reminder. ${DELETE_CONFIRM}`,
    "reminder.get",
  ),
  plannerEntry(
    "reminder.collection.delete",
    "delete",
    planner.reminderCollectionDelete,
    `Delete a reminder list with all its reminders. ${DELETE_CONFIRM}`,
    "reminder.source.list",
  ),
];

/** One `sherpa.worker-capabilities.v2` row (`WorkerCapabilityDescriptor`). */
export const descriptorSchema = z.object({
  capability: z.string(),
  application_contract: z.string(),
  request_schema: z.string(),
  effect: z.string(),
  required_evidence: z.string(),
  state: z.string(),
});
export type CapabilityDescriptor = z.infer<typeof descriptorSchema>;

export const discoveryResultSchema = z.object({
  schema: z.literal("sherpa.worker-capabilities.v2"),
  capabilities: z.array(descriptorSchema),
});

/** What the planner tools are built from: confirmed descriptors, or nothing. */
export type DiscoveryBasis =
  | { kind: "discovered"; descriptors: readonly CapabilityDescriptor[] }
  | { kind: "failed"; reason: string };

/** A planner entry the app confirmed, with the request schema and policy taken from its descriptor. */
export interface ConfirmedPlannerEntry {
  entry: PlannerEntry;
  requestSchema: string;
  policy: PlannerPolicy;
  preview?: { capability: string; requestSchema: string; policy: PlannerPolicy };
}

function matching(
  descriptors: readonly CapabilityDescriptor[],
  capability: string,
  expected: PlannerEntry["expected"],
): CapabilityDescriptor | string {
  const descriptor = descriptors.find((row) => row.capability === capability);
  if (!descriptor) return "descriptor_missing";
  if (descriptor.state !== "supported") return `state_${descriptor.state}`;
  if (descriptor.application_contract !== PLANNER_CONTRACT) return "contract_mismatch";
  if (
    descriptor.effect !== expected.effect ||
    descriptor.required_evidence !== expected.requiredEvidence
  ) {
    return "policy_mismatch";
  }
  return descriptor;
}

const READ = { effect: "read", requiredEvidence: "none" } as const;

function policy(descriptor: CapabilityDescriptor): PlannerPolicy {
  return {
    effect: descriptor.effect as PlannerEffect,
    required_evidence: descriptor.required_evidence as RequiredEvidence,
    artifact_directory: null,
  };
}

/**
 * Keeps each planner entry whose descriptor names the same capability,
 * `effect` and `required_evidence` with `state: supported`; a delete also
 * needs its preview read. Every dropped entry is logged as an error.
 */
export function reconcile(basis: DiscoveryBasis): ConfirmedPlannerEntry[] {
  if (basis.kind === "failed") {
    log.error(`[core:registry:reconcile] failure reason=${basis.reason} planner_tools=0`);
    return [];
  }
  const confirmed: ConfirmedPlannerEntry[] = [];
  for (const entry of plannerEntries) {
    const descriptor = matching(basis.descriptors, entry.capability, entry.expected);
    const preview = entry.previewCapability
      ? matching(basis.descriptors, entry.previewCapability, READ)
      : undefined;
    const problem =
      typeof descriptor === "string"
        ? descriptor
        : typeof preview === "string"
          ? `preview_${preview}`
          : null;
    if (problem !== null || typeof descriptor === "string" || typeof preview === "string") {
      log.error(
        `[core:registry:reconcile] dropped capability=${entry.capability} reason=${problem}`,
      );
      continue;
    }
    confirmed.push({
      entry,
      requestSchema: descriptor.request_schema,
      policy: policy(descriptor),
      ...(preview
        ? {
            preview: {
              capability: preview.capability,
              requestSchema: preview.request_schema,
              policy: policy(preview),
            },
          }
        : {}),
    });
  }
  log.info(`[core:registry:reconcile] success planner_tools=${confirmed.length}`);
  return confirmed;
}
