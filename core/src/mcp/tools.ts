import { codes } from "../cli/errors.ts";
import type { CoreCommands } from "../commands.ts";
import { log } from "../log.ts";
import { newOperationID, type PlannerPort, plannerRequest } from "../planner/port.ts";
import type { ToolCall } from "../tools/call.ts";
import {
  commandResult,
  coreFailure,
  type EffectKind,
  effectKindOf,
  outcome,
  type OutcomeError,
  plannerOutcome,
  type ToolOutcome,
} from "../tools/outcome.ts";
import {
  CONFIRMATION_TIMEOUT_MS,
  type ConfirmationDecision,
  type ConfirmationLine,
  type ConfirmationPort,
  type ConfirmationPrompt,
  PREVIEW_DEADLINE_MS,
} from "./confirmation.ts";
import { type CoreEntry, type CoreRun, coreEntries } from "./core-tools.ts";
import type { ConfirmedPlannerEntry, RegistryEntry } from "./registry.ts";

/** A registry entry with its handler. `null` means the call was abandoned and is not answered. */
export interface ResolvedTool {
  entry: RegistryEntry;
  handle(args: unknown, call: ToolCall): Promise<ToolOutcome | null>;
}

export interface ToolDependencies {
  planner: PlannerPort;
  confirmations: ConfirmationPort;
  commands: CoreCommands;
  newOperationID?: () => string;
  /** Monotonic milliseconds for the §9 budget. */
  now?: () => number;
}

/**
 * The tools of one core process: confirmed planner entries, then every core
 * entry. An entry confirmed in the app without a preview is refused here, so
 * no such tool is ever served.
 */
export function resolveTools(
  planner: readonly ConfirmedPlannerEntry[],
  dependencies: ToolDependencies,
): ResolvedTool[] {
  const mint = dependencies.newOperationID ?? newOperationID;
  return [
    ...planner.map((confirmed) => plannerTool(confirmed, dependencies, mint)),
    ...coreEntries.map((entry) => coreTool(entry, dependencies, mint)),
  ];
}

type Preview =
  | { kind: "ready"; title: string; lines: ConfirmationLine[] }
  | { kind: "ended"; outcome: ToolOutcome | null };

/** Starts the §9 clock before the preview read; the result gives what is left of it. */
function budget(dependencies: ToolDependencies): () => number {
  const now = dependencies.now ?? (() => performance.now());
  const started = now();
  return () => Math.floor(CONFIRMATION_TIMEOUT_MS - (now() - started));
}

/** Asks the app for the rest of the budget; a spent budget times out without asking. */
function ask(
  dependencies: ToolDependencies,
  prompt: ConfirmationPrompt,
  signal: AbortSignal,
  remainingMs: number,
): Promise<ConfirmationDecision> {
  if (remainingMs < 1) {
    log.warn(
      `[core:mcp:confirm] timeout tool=${prompt.tool} operation_id=${prompt.operation_id} reason=preview_spent_budget`,
    );
    return Promise.resolve("timed_out");
  }
  return dependencies.confirmations.confirm(prompt, signal, remainingMs);
}

const confirmationErrors: Record<
  Exclude<ConfirmationDecision, "approved" | "withdrawn">,
  OutcomeError
> = {
  declined: { code: "confirmation.declined", retry: "after_user_action" },
  timed_out: { code: "confirmation.timed_out", retry: "after_user_action" },
  unavailable: { code: "confirmation.unavailable", retry: "after_backoff" },
};

/** A refused confirmation: nothing ran (§9). */
function confirmationOutcome(
  capability: string,
  operationID: string,
  kind: EffectKind,
  decision: Exclude<ConfirmationDecision, "approved" | "withdrawn">,
): ToolOutcome {
  return outcome({
    status: "failed",
    capability,
    operation_id: operationID,
    effect: { kind, state: "not_started" },
    evidence: null,
    error: confirmationErrors[decision],
    result: null,
  });
}

function plannerTool(
  confirmed: ConfirmedPlannerEntry,
  dependencies: ToolDependencies,
  mint: () => string,
): ResolvedTool {
  const { entry } = confirmed;
  const kind = effectKindOf(entry.effectClass);
  if (entry.confirmation === "app" && !confirmed.preview) {
    throw new Error(`${entry.name} is confirmed in the app but has no preview read`);
  }
  return {
    entry,
    async handle(args, call) {
      const operationID = mint();
      if (entry.confirmation === "app") {
        const remaining = budget(dependencies);
        const preview = await plannerPreview(
          confirmed,
          args as Record<string, unknown>,
          call,
          dependencies,
          mint,
        );
        if (preview.kind === "ended") return preview.outcome;
        const decision = await ask(
          dependencies,
          {
            tool: entry.name,
            operation_id: operationID,
            channel: call.channel,
            client: call.client,
            title: preview.title,
            lines: preview.lines,
          },
          call.signal,
          remaining(),
        );
        if (decision === "withdrawn" || call.signal.aborted) return null;
        if (decision !== "approved") {
          return confirmationOutcome(entry.capability, operationID, kind, decision);
        }
      }
      const request = plannerRequest(
        entry.capability,
        { schema: confirmed.requestSchema, ...(args as Record<string, unknown>) },
        confirmed.policy,
        operationID,
      );
      // The request is the step nothing takes back: the app runs it to its end (§7.8).
      const committed = call.committed?.(operationID);
      if (committed) await committed;
      return plannerOutcome(
        entry.capability,
        request,
        await dependencies.planner.request(request, call.signal),
      );
    },
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function reminderDate(value: unknown): string {
  const date = record(value);
  if (!date) return "";
  const pad = (part: unknown) => String(part).padStart(2, "0");
  const day = `${String(date.year)}-${pad(date.month)}-${pad(date.day)}`;
  return typeof date.hour === "number" ? `${day} ${pad(date.hour)}:${pad(date.minute ?? 0)}` : day;
}

/**
 * Reads the delete target through `*.get` or `*.source.list` within
 * `PREVIEW_DEADLINE_MS` (§9). A failed read ends the call.
 */
async function plannerPreview(
  confirmed: ConfirmedPlannerEntry,
  args: Record<string, unknown>,
  call: ToolCall,
  dependencies: ToolDependencies,
  mint: () => string,
): Promise<Preview> {
  const preview = confirmed.preview!;
  const capability = confirmed.entry.capability;
  const locator = text(args.native_locator ?? args.collection_native_locator);
  const readArgs: Record<string, unknown> = preview.capability.endsWith(".get")
    ? { native_locator: locator }
    : {};
  const request = plannerRequest(
    preview.capability,
    { schema: preview.requestSchema, ...readArgs },
    preview.policy,
    mint(),
    PREVIEW_DEADLINE_MS,
  );
  const reply = await dependencies.planner.request(request, call.signal);
  if (reply.kind !== "response" || reply.response.status !== "succeeded") {
    return { kind: "ended", outcome: plannerOutcome(capability, request, reply) };
  }
  const result = record(reply.response.result) ?? {};
  const lines = previewLines(capability, result, args, locator);
  if (!lines) {
    const missing = capability.includes(".collection.");
    log.warn(
      `[core:mcp:preview] failure capability=${capability} reason=${missing ? "not_found" : "result_shape"}`,
    );
    return {
      kind: "ended",
      outcome: outcome({
        status: "failed",
        capability,
        operation_id: request.operation_id,
        effect: { kind: "none", state: "not_started" },
        evidence: null,
        error: missing
          ? { code: "eventkit.not_found", retry: "never" }
          : { code: codes.internal, retry: "never" },
        result: null,
      }),
    };
  }
  return lines;
}

function previewLines(
  capability: string,
  result: Record<string, unknown>,
  args: Record<string, unknown>,
  locator: string,
): Preview | null {
  switch (capability) {
    case "event.delete": {
      const event = record(result.event);
      if (!event) return null;
      return {
        kind: "ready",
        title:
          args.span === "future"
            ? "Delete this event and its later occurrences?"
            : "Delete this event?",
        lines: [
          { label: "Event", value: text(event.title) },
          { label: "Calendar", value: text(record(event.event_collection)?.title) },
          { label: "Starts", value: text(event.start) },
          { label: "Ends", value: text(event.end) },
          { label: "Occurrences", value: args.span === "future" ? "This and later" : "This one" },
        ],
      };
    }
    case "reminder.delete": {
      const reminder = record(result.reminder);
      if (!reminder) return null;
      const due = reminderDate(reminder.due);
      const notes = text(reminder.notes);
      return {
        kind: "ready",
        title: "Delete this reminder?",
        lines: [
          { label: "Reminder", value: text(reminder.title) },
          { label: "List", value: text(record(reminder.reminder_collection)?.title) },
          ...(due ? [{ label: "Due", value: due }] : []),
          ...(notes ? [{ label: "Notes", value: notes }] : []),
        ],
      };
    }
    case "event.collection.delete":
    case "reminder.collection.delete": {
      const key = capability.startsWith("event.") ? "event_collections" : "reminder_collections";
      const sources = Array.isArray(result.sources) ? result.sources : [];
      for (const source of sources.map(record)) {
        const collections = Array.isArray(source?.[key]) ? (source[key] as unknown[]) : [];
        const found = collections
          .map(record)
          .find((collection) => collection?.native_locator === locator);
        if (!found) continue;
        const calendar = key === "event_collections";
        return {
          kind: "ready",
          title: calendar
            ? "Delete this calendar and all its events?"
            : "Delete this list and all its reminders?",
          lines: [
            { label: calendar ? "Calendar" : "List", value: text(found.title) },
            { label: "Account", value: text(source?.title) },
          ],
        };
      }
      return null;
    }
    default:
      return null;
  }
}

function coreTool(
  entry: CoreEntry,
  dependencies: ToolDependencies,
  mint: () => string,
): ResolvedTool {
  const kind = effectKindOf(entry.effectClass);
  const preview = entry.confirmation === "app" ? entry.preview : null;
  if (preview === undefined) {
    throw new Error(`${entry.name} is confirmed in the app but has no preview`);
  }
  return {
    entry,
    async handle(args, call) {
      const operationID = preview ? mint() : "";
      try {
        if (preview) {
          const remaining = budget(dependencies);
          const shown = await preview(dependencies.commands, args);
          if (call.signal.aborted) return null;
          const decision = await ask(
            dependencies,
            {
              tool: entry.name,
              operation_id: operationID,
              channel: call.channel,
              client: call.client,
              ...shown,
            },
            call.signal,
            remaining(),
          );
          if (decision === "withdrawn" || call.signal.aborted) return null;
          if (decision !== "approved") {
            return confirmationOutcome(entry.capability, operationID, kind, decision);
          }
        }
        // The command is the step nothing takes back: it runs to its own limit.
        const committed = call.committed?.(operationID || null);
        if (committed) await committed;
        return coreSuccess(entry, kind, await entry.run(dependencies.commands, args, operationID));
      } catch (error) {
        return coreFailure(entry.capability, kind, error);
      }
    },
  };
}

function coreSuccess(entry: CoreEntry, kind: EffectKind, run: CoreRun): ToolOutcome {
  if (run.kind === "output") {
    return outcome({
      status: "succeeded",
      capability: entry.capability,
      operation_id: null,
      effect: { kind, state: kind === "none" ? "not_applicable" : "applied" },
      evidence: null,
      error: null,
      result: commandResult(run.output, entry.output),
    });
  }
  // The send happened: an unreadable acceptance output must not turn it into a failure.
  let result: Record<string, unknown> | null = null;
  try {
    result = commandResult(run.result.output, "json");
  } catch {
    log.error(
      `[core:mcp:tool-call] unreadable_output capability=${entry.capability} operation_id=${run.result.operationID}`,
    );
  }
  return outcome({
    status: "succeeded",
    capability: entry.capability,
    operation_id: run.result.operationID,
    effect: { kind, state: "applied" },
    evidence: { kind: "application_acceptance", state: "matched" },
    error: null,
    journal_error: run.result.journalFailure,
    result,
  });
}
