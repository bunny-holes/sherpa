import { z } from "zod";

/**
 * The core's planner port: one Worker Protocol V2 request to the app-side
 * planner and its answer. Two adapters implement it: the helper process
 * (`sherpa-apple planner request`) and the control channel of
 * `sherpa app serve` (app-connection-v1 §8, §11). The composition root picks one.
 */
export interface PlannerPort {
  request(request: PlannerRequest, signal?: AbortSignal): Promise<PlannerReply>;
}

export const PLANNER_CONTRACT = "sherpa.planner.v2";
export const PROTOCOL_VERSION = "2.0.0";
/** `deadline_ms` the core puts on every planner request it builds (§10.4). */
export const PLANNER_DEADLINE_MS = 20_000;
/** The worker request limit for EventKit (worker-protocol.md). */
export const PLANNER_REQUEST_LIMIT = 64 * 1024;
/** The worker response limit for EventKit (worker-protocol.md). */
export const PLANNER_RESPONSE_LIMIT = 8 * 1024 * 1024;
/** How long past `deadline_ms` the core waits for an answer (§8). */
export const PLANNER_GRACE_MS = 5_000;

export type PlannerEffect = "read" | "authorization_prompt" | "mutation" | "dispatch";
export type RequiredEvidence =
  | "none"
  | "authorization_readback"
  | "native_readback"
  | "native_absence_readback"
  | "application_acceptance";

export interface PlannerPolicy {
  effect: PlannerEffect;
  required_evidence: RequiredEvidence;
  artifact_directory: null;
}

export interface PlannerRequest {
  kind: "request";
  protocol_version: typeof PROTOCOL_VERSION;
  application_contract: typeof PLANNER_CONTRACT;
  request_id: string;
  operation_id: string;
  capability: string;
  payload: Record<string, unknown>;
  deadline_ms: number;
  idempotency_key: string;
  policy: PlannerPolicy;
}

/** A fresh `op-<UUIDv7>` used as request, operation and idempotency id of one call (§10.4). */
export function newOperationID(): string {
  return `op-${Bun.randomUUIDv7()}`;
}

/** Builds the V2 envelope; the key order is the one the contract's vectors use (§14). */
export function plannerRequest(
  capability: string,
  payload: Record<string, unknown>,
  policy: PlannerPolicy,
  operationID: string,
): PlannerRequest {
  return {
    kind: "request",
    protocol_version: PROTOCOL_VERSION,
    application_contract: PLANNER_CONTRACT,
    request_id: operationID,
    operation_id: operationID,
    capability,
    payload,
    deadline_ms: PLANNER_DEADLINE_MS,
    idempotency_key: operationID,
    policy,
  };
}

const retry = z.enum(["never", "safe", "after_backoff", "after_user_action"]);
export const effectSchema = z.strictObject({
  kind: z.enum(["none", "authorization_prompt", "native_mutation", "outbound_dispatch"]),
  state: z.enum(["not_applicable", "not_started", "applied", "may_have_applied"]),
});
export const evidenceSchema = z.strictObject({
  kind: z.enum([
    "authorization_readback",
    "native_readback",
    "native_absence_readback",
    "application_acceptance",
  ]),
  state: z.enum(["matched", "mismatched", "unavailable"]),
});

/**
 * A Worker Protocol V2 response. The Swift encoder omits nil keys, so
 * `result`, `evidence` and `error` may be absent as well as null.
 */
export const workerResponseSchema = z.strictObject({
  kind: z.literal("response"),
  protocol_version: z.literal(PROTOCOL_VERSION),
  application_contract: z.string(),
  request_id: z.string(),
  operation_id: z.string(),
  capability: z.string(),
  status: z.enum(["succeeded", "failed", "partial", "uncertain"]),
  result: z.record(z.string(), z.unknown()).nullable().optional(),
  effect: effectSchema,
  evidence: evidenceSchema.nullable().optional(),
  error: z.strictObject({ code: z.string(), retry }).nullable().optional(),
  warnings: z.array(z.unknown()).max(128),
});
export type WorkerResponse = z.infer<typeof workerResponseSchema>;

/** What `sherpa-apple planner request` writes when the command itself fails. */
export const commandReportSchema = z.strictObject({
  status: z.string(),
  error: z.string().nullable().optional(),
  operation_id: z.string().optional(),
  journal_error: z.string().optional(),
});
export type CommandReport = z.infer<typeof commandReportSchema>;

export type PlannerReply =
  | { kind: "response"; response: WorkerResponse }
  | { kind: "report"; report: CommandReport }
  /** No answer within `deadline_ms` + 5 s (§8). */
  | { kind: "timeout" }
  /** The caller's signal ended the wait; any later answer is discarded. */
  | { kind: "aborted" };

/** True when a V2 response echoes the request's correlation values (worker-protocol.md). */
export function correlates(request: PlannerRequest, response: WorkerResponse): boolean {
  return (
    response.application_contract === request.application_contract &&
    response.request_id === request.request_id &&
    response.operation_id === request.operation_id &&
    response.capability === request.capability
  );
}

/** The report the helper writes for a request above its limit, so both adapters answer alike. */
export const requestTooLarge: PlannerReply = {
  kind: "report",
  report: { status: "failed", error: "protocol.request_too_large" },
};

export function requestBytes(request: PlannerRequest): number {
  return Buffer.byteLength(JSON.stringify(request));
}
