/** Planner answers for tests, shaped like `EventKitWorker`'s (app-connection-v1 §8, §10.2). */

export type PlannerHandler = (request: Record<string, unknown>) => unknown;

const destinations: Record<string, string> = {
  "event.collection.create": "event_collection",
  "event.create": "event_collection",
  "event.update": "event_collection",
  "reminder.collection.create": "reminder_collection",
  "reminder.create": "reminder_collection",
  "reminder.update": "reminder_collection",
};

/** The descriptors `EventKitWorker` reports (`capabilityDescriptor`); a helper test keeps them equal. */
export function plannerDescriptors(): Record<string, unknown>[] {
  const capabilities = [
    "event.authorization.status",
    "event.authorization.request",
    "event.source.list",
    "event.collection.create",
    "event.collection.delete",
    "event.command.validate",
    "event.list",
    "event.get",
    "event.create",
    "event.update",
    "event.delete",
    "reminder.authorization.status",
    "reminder.authorization.request",
    "reminder.source.list",
    "reminder.collection.create",
    "reminder.collection.delete",
    "reminder.command.validate",
    "reminder.list",
    "reminder.get",
    "reminder.create",
    "reminder.update",
    "reminder.complete",
    "reminder.reopen",
    "reminder.delete",
  ];
  return capabilities.map((capability) => {
    const prompt = capability.endsWith("authorization.request");
    const remove = capability.endsWith(".delete");
    const mutation =
      prompt ||
      remove ||
      [".create", ".update", ".complete", ".reopen"].some((s) => capability.endsWith(s));
    return {
      capability,
      application_contract: "sherpa.planner.v2",
      request_schema: `sherpa.planner.${capability}.request.v2`,
      success_schema: `sherpa.planner.${capability}.success.v2`,
      effect: prompt ? "authorization_prompt" : mutation ? "mutation" : "read",
      required_evidence: prompt
        ? "authorization_readback"
        : remove
          ? "native_absence_readback"
          : mutation
            ? "native_readback"
            : "none",
      artifact_policy: "none",
      destination: destinations[capability] ?? "none",
      state: "supported",
      ...(prompt || mutation
        ? {
            partial_schema: `sherpa.planner.${capability}.partial.v2`,
            uncertain_schema: `sherpa.planner.${capability}.uncertain.v2`,
          }
        : {}),
    };
  });
}

/** A V2 response correlated with `request`. */
export function v2Response(
  value: object,
  fields: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  const request = value as Record<string, unknown>;
  const policy = request.policy as { effect: string; required_evidence: string };
  const mutation = policy.effect === "mutation";
  return {
    application_contract: request.application_contract,
    capability: request.capability,
    effect: mutation
      ? { kind: "native_mutation", state: "applied" }
      : { kind: "none", state: "not_applicable" },
    ...(mutation ? { evidence: { kind: policy.required_evidence, state: "matched" } } : {}),
    kind: "response",
    operation_id: request.operation_id,
    protocol_version: "2.0.0",
    request_id: request.request_id,
    result: { schema: `${String(request.capability)}.success` },
    status: "succeeded",
    warnings: [],
    ...fields,
  };
}

/** Targets of the delete previews (§9): the reads `*.get` and `*.source.list` answer with these. */
export const previewResults: Record<string, Record<string, unknown>> = {
  "event.get": {
    schema: "sherpa.planner.event.get.success.v2",
    event: {
      title: "Dentist",
      event_collection: { title: "Home" },
      start: "2026-11-22T09:00:00+09:00",
      end: "2026-11-22T10:00:00+09:00",
    },
  },
  "reminder.get": {
    schema: "sherpa.planner.reminder.get.success.v2",
    reminder: { title: "Milk", reminder_collection: { title: "Groceries" } },
  },
  "event.source.list": {
    schema: "sherpa.planner.event.source.list.success.v2",
    sources: [{ title: "iCloud", event_collections: [{ native_locator: "c-1", title: "Work" }] }],
  },
  "reminder.source.list": {
    schema: "sherpa.planner.reminder.source.list.success.v2",
    sources: [
      { title: "iCloud", reminder_collections: [{ native_locator: "c-1", title: "Groceries" }] },
    ],
  },
};

/** The default planner: discovery succeeds, preview reads find their target, everything else succeeds. */
export const defaultPlanner: PlannerHandler = (request) => {
  const capability = String(request.capability);
  if (capability === "capabilities") {
    return {
      response: v2Response(request, {
        result: {
          schema: "sherpa.worker-capabilities.v2",
          worker: "eventkit",
          capabilities: plannerDescriptors(),
        },
      }),
    };
  }
  const preview = previewResults[capability];
  return { response: v2Response(request, preview ? { result: preview } : {}) };
};
