/** A change dispatched before its step was saved (§7.11 "대화 상태"). */
import { z } from "zod";
import { type MutationStatus, MutationJournal } from "../journal/journal.ts";
import { log } from "../log.ts";

export const pendingChange = z.strictObject({
  tool: z.string().regex(/^[a-z][a-z0-9_]{0,127}$/),
  operation_id: z
    .string()
    .regex(/^[a-zA-Z0-9_.:-]{1,128}$/)
    .nullable(),
});
export type PendingChange = z.infer<typeof pendingChange>;
export type ReadMutationStatuses = (ids: readonly string[]) => ReadonlyMap<string, MutationStatus>;

function description(status: MutationStatus | undefined): string {
  switch (status) {
    case "completed":
      return "applied";
    case "failed":
      return "not applied";
    case "partial":
      return "applied incompletely";
    default:
      return "may have been applied";
  }
}

/** The model sees local journal status, with no mutation arguments, stored result, or diagnosis. */
export function recoveryNote(
  changes: readonly PendingChange[],
  channel: number,
  read: ReadMutationStatuses = MutationJournal.readStatuses,
): string {
  const ids = changes.flatMap(({ operation_id }) => (operation_id === null ? [] : [operation_id]));
  let statuses: ReadonlyMap<string, MutationStatus>;
  try {
    statuses = read(ids);
  } catch (error) {
    log.warn(
      `[core:chat:pending] read_failure channel=${channel} count=${ids.length} error_type=${error instanceof Error ? error.name : typeof error}`,
    );
    statuses = new Map();
  }
  const effects = changes.map(({ tool, operation_id: id }) =>
    id === null
      ? `${tool} ${description(undefined)}`
      : `${tool} ${id} ${description(statuses.get(id))}`,
  );
  return `[Before this message the conversation was interrupted while these changes ran: ${effects.join("; ")}. Do not repeat any without checking operations_list or asking the person.]`;
}
