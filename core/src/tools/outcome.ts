/**
 * The outcome envelope of every tool call (app-connection-v1 §10.5), whichever surface made it
 * (ADR-0012 "도구"). Each surface fits it to its own limit; `mcp/outcome.ts` holds MCP's form.
 */
import { z } from "zod";
import { codes, SherpaError } from "../cli/errors.ts";
import { JournaledMutationError } from "../journal/journal.ts";
import type { PlannerReply, PlannerRequest } from "../planner/port.ts";

/** The `sherpa.mcp.tool-outcome.v1` envelope of every tool result (app-connection-v1 §10.5). */
export const OUTCOME_SCHEMA = "sherpa.mcp.tool-outcome.v1";

export type OutcomeStatus = "succeeded" | "failed" | "partial" | "uncertain";
export type EffectKind =
  | "none"
  | "authorization_prompt"
  | "native_mutation"
  | "outbound_dispatch"
  | "local_state";
export type EffectState = "not_applicable" | "not_started" | "applied" | "may_have_applied";
export type Retry = "never" | "safe" | "after_backoff" | "after_user_action";

export interface Effect {
  kind: EffectKind;
  state: EffectState;
}
export interface Evidence {
  kind: string;
  state: string;
}
export interface OutcomeError {
  code: string;
  retry: Retry;
  remedy?: string;
}

export interface ToolOutcome {
  schema: typeof OUTCOME_SCHEMA;
  status: OutcomeStatus;
  summary: string;
  capability: string;
  operation_id: string | null;
  effect: Effect;
  evidence: Evidence | null;
  error: OutcomeError | null;
  journal_error: string | null;
  warnings: unknown[];
  result: Record<string, unknown> | null;
}

/** The fixed sentence for each status. */
export const summaries: Record<OutcomeStatus, string> = {
  succeeded: "The operation completed.",
  failed: "Nothing was changed. See error.code and error.retry.",
  partial:
    "The change was applied but its verification or result is incomplete. Do not repeat it; report operation_id to the user.",
  uncertain:
    "The change may have been applied. Do not repeat it; check operations_list or ask the user.",
};

const retrySchema = z.enum(["never", "safe", "after_backoff", "after_user_action"]);

/** `outputSchema` of every tool. `result` stays an open object in V1 (§10.5). */
export const toolOutcomeSchema = z.strictObject({
  schema: z.literal(OUTCOME_SCHEMA),
  status: z.enum(["succeeded", "failed", "partial", "uncertain"]),
  summary: z.string(),
  capability: z.string(),
  operation_id: z.string().nullable(),
  effect: z.strictObject({
    kind: z.enum([
      "none",
      "authorization_prompt",
      "native_mutation",
      "outbound_dispatch",
      "local_state",
    ]),
    state: z.enum(["not_applicable", "not_started", "applied", "may_have_applied"]),
  }),
  evidence: z
    .strictObject({
      kind: z.enum([
        "authorization_readback",
        "native_readback",
        "native_absence_readback",
        "application_acceptance",
      ]),
      state: z.enum(["matched", "mismatched", "unavailable"]),
    })
    .nullable(),
  error: z
    .strictObject({ code: z.string(), retry: retrySchema, remedy: z.string().optional() })
    .nullable(),
  journal_error: z.string().nullable(),
  warnings: z.array(z.unknown()).max(128),
  result: z.record(z.string(), z.unknown()).nullable(),
});

type OutcomeFields = Omit<ToolOutcome, "schema" | "summary" | "journal_error" | "warnings"> &
  Partial<Pick<ToolOutcome, "journal_error" | "warnings">>;

/** Builds an outcome with the contract's key order; `result` comes last so a cut text keeps the status. */
export function outcome(fields: OutcomeFields): ToolOutcome {
  return {
    schema: OUTCOME_SCHEMA,
    status: fields.status,
    summary: summaries[fields.status],
    capability: fields.capability,
    operation_id: fields.operation_id,
    effect: { kind: fields.effect.kind, state: fields.effect.state },
    evidence: fields.evidence ? { kind: fields.evidence.kind, state: fields.evidence.state } : null,
    error: fields.error ? orderedError(fields.error) : null,
    journal_error: fields.journal_error ?? null,
    warnings: fields.warnings ?? [],
    result: fields.result,
  };
}

function orderedError(error: OutcomeError): OutcomeError {
  return {
    code: error.code,
    retry: error.retry,
    ...(error.remedy === undefined ? {} : { remedy: error.remedy }),
  };
}

export const NARROW_READ_REMEDY = "Narrow the range or lower the limit and call again.";

/** An outcome that fits its surface's limit, with the text that carries it. */
export interface FittedOutcome {
  outcome: ToolOutcome;
  text: string;
}

/**
 * The worker-protocol fitting rule on the serialized text, for a surface whose
 * limit is `limit` bytes (§10.5 gives MCP's): drop `result` and `warnings`,
 * keep correlation, effect and (for a started effect) evidence; a started
 * effect becomes `partial` (an `uncertain` one stays), anything else
 * `failed`, both with `protocol.result_too_large` and `retry: never`.
 */
export function fit(value: ToolOutcome, read: boolean, limit: number): FittedOutcome {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) <= limit) return { outcome: value, text };
  const started = value.effect.state === "applied" || value.effect.state === "may_have_applied";
  const bounded = outcome({
    status: started ? (value.status === "uncertain" ? "uncertain" : "partial") : "failed",
    capability: value.capability,
    operation_id: value.operation_id,
    effect: value.effect,
    evidence: started ? value.evidence : null,
    error: {
      code: "protocol.result_too_large",
      retry: "never",
      ...(read ? { remedy: NARROW_READ_REMEDY } : {}),
    },
    journal_error: value.journal_error,
    result: null,
  });
  return { outcome: bounded, text: JSON.stringify(bounded) };
}

/** Maps a planner answer (§10.5). `aborted` has no outcome: the call is not answered. */
export function plannerOutcome(
  capability: string,
  request: PlannerRequest,
  reply: PlannerReply,
): ToolOutcome | null {
  const mutation = request.policy.effect !== "read";
  const kind: EffectKind = mutation ? "native_mutation" : "none";
  switch (reply.kind) {
    case "aborted":
      return null;
    case "response": {
      const { response } = reply;
      return outcome({
        status: response.status,
        capability,
        operation_id: response.operation_id,
        effect: response.effect,
        evidence: response.evidence ?? null,
        error: response.error ?? null,
        warnings: response.warnings,
        result: response.result ?? null,
      });
    }
    case "report": {
      const failed = reply.report.status === "failed";
      return outcome({
        status: failed ? "failed" : "uncertain",
        capability,
        operation_id: reply.report.operation_id ?? request.operation_id,
        effect: { kind, state: failed ? "not_started" : "may_have_applied" },
        evidence: null,
        error: { code: reply.report.error ?? codes.internal, retry: "never" },
        journal_error: reply.report.journal_error ?? null,
        result: null,
      });
    }
    case "timeout":
      return outcome({
        status: mutation ? "uncertain" : "failed",
        capability,
        operation_id: request.operation_id,
        effect: { kind, state: mutation ? "may_have_applied" : "not_started" },
        evidence: null,
        error: { code: "app.worker_timeout", retry: mutation ? "never" : "after_backoff" },
        result: null,
      });
  }
}

/** A core command's JSON output as `result`: an object as it is, an array or JSON lines as `items`. */
export function commandResult(
  output: string | Uint8Array,
  shape: "json" | "lines",
): Record<string, unknown> {
  const text = typeof output === "string" ? output : new TextDecoder().decode(output);
  if (shape === "lines") {
    return {
      items: text
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line): unknown => JSON.parse(line)),
    };
  }
  const value: unknown = JSON.parse(text);
  if (Array.isArray(value)) return { items: value };
  if (typeof value === "object" && value !== null) return value as Record<string, unknown>;
  throw new Error("command output is not a JSON object or array");
}

/** Maps a core command failure (§10.5); anything without a Sherpa code is an internal failure. */
export function coreFailure(capability: string, kind: EffectKind, error: unknown): ToolOutcome {
  if (error instanceof JournaledMutationError) {
    const uncertain = error.status === "uncertain";
    return outcome({
      status: error.status,
      capability,
      operation_id: error.operationID,
      effect: { kind, state: uncertain ? "may_have_applied" : "not_started" },
      evidence: null,
      error: { code: error.stableCode, retry: "never" },
      journal_error: error.journalFailure,
      result: null,
    });
  }
  if (error instanceof SherpaError) {
    const uncertain = error.mayHaveApplied;
    return outcome({
      status: uncertain ? "uncertain" : "failed",
      capability,
      operation_id: null,
      effect: { kind, state: uncertain ? "may_have_applied" : "not_started" },
      evidence: null,
      error: {
        code: error.code,
        retry: uncertain || error.remedy === undefined ? "never" : "after_user_action",
        ...(error.remedy === undefined ? {} : { remedy: error.remedy }),
      },
      result: null,
    });
  }
  return outcome({
    status: "failed",
    capability,
    operation_id: null,
    effect: { kind, state: "not_started" },
    evidence: null,
    error: { code: codes.internal, retry: "never" },
    result: null,
  });
}
