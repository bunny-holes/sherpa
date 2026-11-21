import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { SherpaError } from "../src/cli/errors.ts";
import { JournaledMutationError } from "../src/journal/journal.ts";
import {
  callToolResult,
  commandResult,
  coreFailure,
  type Effect,
  type Evidence,
  NARROW_READ_REMEDY,
  outcome,
  type OutcomeError,
  type OutcomeStatus,
  plannerOutcome,
  RESULT_TEXT_LIMIT,
  summaries,
  toolOutcomeSchema,
} from "../src/mcp/outcome.ts";
import { plannerRequest } from "../src/planner/port.ts";

const contract = await Bun.file(
  join(import.meta.dirname, "../../docs/contracts/app-connection-v1.md"),
).text();

/** The key order of §10.5. */
const KEYS = [
  "schema",
  "status",
  "summary",
  "capability",
  "operation_id",
  "effect",
  "evidence",
  "error",
  "journal_error",
  "warnings",
  "result",
];

function text(result: ReturnType<typeof callToolResult>): string {
  const [block] = result.content;
  if (block?.type !== "text") throw new Error("no text block");
  return block.text;
}

const combinations: [OutcomeStatus, Effect, Evidence | null, OutcomeError | null][] = [
  ["succeeded", { kind: "none", state: "not_applicable" }, null, null],
  [
    "succeeded",
    { kind: "native_mutation", state: "applied" },
    { kind: "native_readback", state: "matched" },
    null,
  ],
  [
    "succeeded",
    { kind: "outbound_dispatch", state: "applied" },
    { kind: "application_acceptance", state: "matched" },
    null,
  ],
  ["succeeded", { kind: "local_state", state: "applied" }, null, null],
  [
    "failed",
    { kind: "none", state: "not_started" },
    null,
    { code: "protocol.invalid_payload", retry: "never" },
  ],
  [
    "failed",
    { kind: "native_mutation", state: "not_started" },
    null,
    { code: "confirmation.declined", retry: "after_user_action" },
  ],
  [
    "failed",
    { kind: "none", state: "not_started" },
    null,
    { code: "mail.automation_denied", retry: "after_user_action", remedy: "Allow it." },
  ],
  [
    "partial",
    { kind: "native_mutation", state: "applied" },
    { kind: "native_absence_readback", state: "mismatched" },
    { code: "eventkit.readback_mismatch", retry: "never" },
  ],
  [
    "uncertain",
    { kind: "outbound_dispatch", state: "may_have_applied" },
    null,
    { code: "uncertain", retry: "never" },
  ],
];

describe("the outcome envelope (§10.5)", () => {
  test.each(combinations)("%s with %o", (status, effect, evidence, error) => {
    const value = outcome({
      status,
      capability: "x.y",
      operation_id: "op-1",
      effect,
      evidence,
      error,
      result: { a: 1 },
    });
    const result = callToolResult(value, effect.kind === "none");
    expect(result.isError).toBe(status === "failed");
    expect(JSON.parse(text(result))).toEqual(result.structuredContent);
    expect(Object.keys(JSON.parse(text(result)) as object)).toEqual(KEYS);
    expect(toolOutcomeSchema.safeParse(result.structuredContent).success).toBe(true);
    expect((result.structuredContent as { summary?: string } | undefined)?.summary).toBe(
      summaries[status],
    );
  });

  test("the summaries are the contract's sentences", () => {
    for (const sentence of Object.values(summaries)) {
      expect(contract.replace(/\n\s+/g, " ")).toContain(`"${sentence}"`);
    }
  });

  test("a V2 response is carried over, with absent keys as null", () => {
    const request = plannerRequest(
      "event.get",
      {},
      { effect: "read", required_evidence: "none", artifact_directory: null },
      "op-1",
    );
    const value = plannerOutcome("event.get", request, {
      kind: "response",
      response: {
        kind: "response",
        protocol_version: "2.0.0",
        application_contract: "sherpa.planner.v2",
        request_id: "op-1",
        operation_id: "op-1",
        capability: "event.get",
        status: "failed",
        effect: { kind: "none", state: "not_started" },
        error: { code: "eventkit.not_found", retry: "never" },
        warnings: ["w"],
      },
    });
    expect(value).toMatchObject({
      status: "failed",
      operation_id: "op-1",
      evidence: null,
      result: null,
      warnings: ["w"],
      error: { code: "eventkit.not_found", retry: "never" },
    });
    expect(toolOutcomeSchema.safeParse(value).success).toBe(true);
  });
});

describe("fitting into 1 MiB (§10.5)", () => {
  const base = (
    status: OutcomeStatus,
    effect: Effect,
    evidence: Evidence | null,
    result: Record<string, unknown>,
  ) =>
    outcome({
      status,
      capability: "x.y",
      operation_id: "op-1",
      effect,
      evidence,
      error: null,
      warnings: ["w"],
      result,
    });
  const padded = (bytes: number) => {
    const empty = JSON.stringify(
      base("succeeded", { kind: "none", state: "not_applicable" }, null, { p: "" }),
    );
    return { p: "x".repeat(bytes - Buffer.byteLength(empty)) };
  };

  test("a text block of exactly 1 MiB is kept, one byte more is cut", () => {
    const kept = callToolResult(
      base("succeeded", { kind: "none", state: "not_applicable" }, null, padded(RESULT_TEXT_LIMIT)),
      true,
    );
    expect(Buffer.byteLength(text(kept))).toBe(RESULT_TEXT_LIMIT);
    expect(kept.isError).toBe(false);
    const cut = callToolResult(
      base(
        "succeeded",
        { kind: "none", state: "not_applicable" },
        null,
        padded(RESULT_TEXT_LIMIT + 1),
      ),
      true,
    );
    expect(cut.structuredContent).toMatchObject({
      status: "failed",
      operation_id: "op-1",
      error: { code: "protocol.result_too_large", retry: "never", remedy: NARROW_READ_REMEDY },
      warnings: [],
      result: null,
    });
    expect(cut.isError).toBe(true);
  });

  test("an applied change that is too large is partial and keeps its evidence", () => {
    const evidence: Evidence = { kind: "native_readback", state: "matched" };
    const cut = callToolResult(
      base(
        "succeeded",
        { kind: "native_mutation", state: "applied" },
        evidence,
        padded(RESULT_TEXT_LIMIT + 10),
      ),
      false,
    );
    expect(cut.structuredContent).toMatchObject({
      status: "partial",
      effect: { kind: "native_mutation", state: "applied" },
      evidence,
      error: { code: "protocol.result_too_large", retry: "never" },
      result: null,
    });
    expect((cut.structuredContent as { error: OutcomeError }).error.remedy).toBeUndefined();
    expect(cut.isError).toBe(false);
    expect(toolOutcomeSchema.safeParse(cut.structuredContent).success).toBe(true);
  });

  test("an uncertain change stays uncertain", () => {
    const cut = callToolResult(
      base(
        "uncertain",
        { kind: "outbound_dispatch", state: "may_have_applied" },
        null,
        padded(RESULT_TEXT_LIMIT + 10),
      ),
      false,
    );
    expect(cut.structuredContent).toMatchObject({
      status: "uncertain",
      error: { code: "protocol.result_too_large" },
    });
    expect(Buffer.byteLength(text(cut))).toBeLessThan(RESULT_TEXT_LIMIT);
  });
});

describe("core command results (§10.5)", () => {
  test("an object stays, an array and JSON lines become items", () => {
    expect(commandResult('{"a":1}', "json")).toEqual({ a: 1 });
    expect(commandResult("[1,2]", "json")).toEqual({ items: [1, 2] });
    expect(commandResult('{"a":1}\n{"b":2}\n', "lines")).toEqual({ items: [{ a: 1 }, { b: 2 }] });
    expect(commandResult("", "lines")).toEqual({ items: [] });
    expect(commandResult(new TextEncoder().encode('{"a":1}'), "json")).toEqual({ a: 1 });
    expect(() => commandResult('"text"', "json")).toThrow();
  });

  test("errors keep their stable code, remedy and journal state", () => {
    expect(
      coreFailure(
        "mail.list",
        "none",
        new SherpaError("mail.envelope_index_unreadable", { remedy: "Grant Full Disk Access." }),
      ),
    ).toMatchObject({
      status: "failed",
      effect: { kind: "none", state: "not_started" },
      error: {
        code: "mail.envelope_index_unreadable",
        retry: "after_user_action",
        remedy: "Grant Full Disk Access.",
      },
    });
    expect(coreFailure("operations.list", "none", new SherpaError("invalidRequest")).error).toEqual(
      { code: "invalidRequest", retry: "never" },
    );
    expect(
      coreFailure(
        "kakaotalk.checkpoint",
        "local_state",
        new SherpaError("failed", { mayHaveApplied: true }),
      ),
    ).toMatchObject({
      status: "uncertain",
      effect: { kind: "local_state", state: "may_have_applied" },
    });
    expect(
      coreFailure(
        "imessage.send",
        "outbound_dispatch",
        new JournaledMutationError("op-9", "uncertain", "uncertain", "journal.finish_failed"),
      ),
    ).toMatchObject({
      status: "uncertain",
      operation_id: "op-9",
      effect: { kind: "outbound_dispatch", state: "may_have_applied" },
      error: { code: "uncertain", retry: "never" },
      journal_error: "journal.finish_failed",
    });
    expect(coreFailure("mail.read", "none", new TypeError("boom"))).toMatchObject({
      status: "failed",
      error: { code: "sherpa.internal_failure", retry: "never" },
    });
  });
});
