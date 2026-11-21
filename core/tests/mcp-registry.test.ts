import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { ToolBasis } from "../src/app/serve.ts";
import type { CoreCommands } from "../src/commands.ts";
import { coreEntries } from "../src/mcp/core-tools.ts";
import {
  annotationTable,
  type CapabilityDescriptor,
  plannerEntries,
  reconcile,
  TOOL_NAME,
} from "../src/mcp/registry.ts";
import { resolveTools } from "../src/mcp/tools.ts";
import type { PlannerPort, PlannerReply } from "../src/planner/port.ts";
import { plannerDescriptors, v2Response } from "./support/planner.ts";

const contract = await Bun.file(
  join(import.meta.dirname, "../../docs/contracts/app-connection-v1.md"),
).text();

/** The rows of the first table after `heading`. */
function table(heading: string): string[][] {
  const section = contract.slice(contract.indexOf(heading));
  const rows: string[][] = [];
  for (const line of section.split("\n").slice(1)) {
    if (!line.startsWith("|")) {
      if (rows.length > 0) break;
      continue;
    }
    rows.push(
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    );
  }
  return rows.slice(2);
}

const descriptors = plannerDescriptors() as unknown as CapabilityDescriptor[];
const all = [...plannerEntries, ...coreEntries];

describe("tool names (§10.3)", () => {
  test("follow the name rule and are unique", () => {
    for (const entry of all) expect(entry.name).toMatch(TOOL_NAME);
    expect(new Set(all.map((entry) => entry.name)).size).toBe(all.length);
  });

  test("are the V1 list of the contract, with its sources, effect classes and confirmations", () => {
    const listed = table("### 10.2").flatMap(([tools, source, effectClass, confirmation]) =>
      [...tools!.matchAll(/`([a-z_]+)`/g)].map((match) => ({
        name: match[1],
        source,
        effectClass,
        confirmation: confirmation === "" ? "none" : confirmation === "예" ? "app" : "argument",
      })),
    );
    expect(
      all.map((entry) => ({
        name: entry.name,
        source: entry.source,
        effectClass: entry.effectClass,
        confirmation: entry.confirmation,
      })),
    ).toEqual(expect.arrayContaining(listed));
    expect(all).toHaveLength(listed.length);
  });
});

test("annotations are the contract's table for every effect class (§10.6)", () => {
  const rows = table("### 10.6");
  expect(rows).toHaveLength(Object.keys(annotationTable).length);
  for (const [effectClass, readOnly, destructive, idempotent, openWorld] of rows) {
    expect(annotationTable[effectClass as keyof typeof annotationTable]).toEqual({
      readOnlyHint: readOnly === "true",
      destructiveHint: destructive === "true",
      idempotentHint: idempotent === "true",
      openWorldHint: openWorld === "true",
    });
  }
});

describe("reconciling with the app's descriptors (§10.2)", () => {
  test("every planner tool is kept when the descriptors match", () => {
    const confirmed = reconcile({ kind: "discovered", descriptors });
    expect(confirmed.map((item) => item.entry.name)).toEqual(
      plannerEntries.map((entry) => entry.name),
    );
    const remove = confirmed.find((item) => item.entry.capability === "event.delete");
    expect(remove).toMatchObject({
      requestSchema: "sherpa.planner.event.delete.request.v2",
      policy: {
        effect: "mutation",
        required_evidence: "native_absence_readback",
        artifact_directory: null,
      },
      preview: { capability: "event.get", requestSchema: "sherpa.planner.event.get.request.v2" },
    });
  });

  test("a descriptor that does not match drops only its tool, and a delete needs its preview read", () => {
    const changed = descriptors
      .filter((row) => row.capability !== "reminder.get")
      .map((row) => {
        if (row.capability === "event.create") return { ...row, required_evidence: "none" };
        if (row.capability === "event.list") return { ...row, state: "unsupported" };
        if (row.capability === "event.get") return { ...row, application_contract: "other.v1" };
        return row;
      });
    const kept = reconcile({ kind: "discovered", descriptors: changed }).map(
      (item) => item.entry.capability,
    );
    for (const dropped of [
      "event.create",
      "event.list",
      "event.get",
      "event.delete",
      "reminder.get",
      "reminder.delete",
    ]) {
      expect(kept).not.toContain(dropped);
    }
    expect(kept).toHaveLength(plannerEntries.length - 6);
  });

  test("the request schema and policy come from the descriptor", () => {
    const renamed = descriptors.map((row) =>
      row.capability === "event.list"
        ? { ...row, request_schema: "sherpa.planner.event.list.request.v9" }
        : row,
    );
    const confirmed = reconcile({ kind: "discovered", descriptors: renamed });
    expect(confirmed.find((item) => item.entry.capability === "event.list")?.requestSchema).toBe(
      "sherpa.planner.event.list.request.v9",
    );
  });

  test("a failed discovery leaves only the core tools", () => {
    const tools = resolveTools(reconcile({ kind: "failed", reason: "report" }), {
      planner: { request: () => Promise.reject(new Error("unused")) },
      confirmations: { confirm: () => Promise.reject(new Error("unused")) },
      commands: {} as CoreCommands,
    });
    expect(tools.map((tool) => tool.entry.name)).toEqual(coreEntries.map((entry) => entry.name));
  });
});

describe("the tool list of a process (§10.1)", () => {
  const build = (basis: Parameters<typeof reconcile>[0]) =>
    resolveTools(reconcile(basis), {
      planner: { request: () => Promise.reject(new Error("unused")) },
      confirmations: { confirm: () => Promise.reject(new Error("unused")) },
      commands: {} as CoreCommands,
    });

  function planner(
    answer: (request: Parameters<PlannerPort["request"]>[0]) => Promise<PlannerReply>,
  ) {
    const seen: string[] = [];
    const port: PlannerPort = {
      request: (request) => {
        seen.push(request.capability);
        return answer(request);
      },
    };
    return { port, seen };
  }

  test("a discovered list is fixed for every session", async () => {
    const basis = new ToolBasis(build, 1_000);
    const { port, seen } = planner(async (request) => ({
      kind: "response",
      response: v2Response(request, {
        result: {
          schema: "sherpa.worker-capabilities.v2",
          worker: "eventkit",
          capabilities: descriptors,
        },
      }) as never,
    }));
    basis.discover(port);
    const first = await basis.resolved();
    expect(first).toHaveLength(all.length);
    expect(await basis.resolved()).toBe(first);
    expect(seen).toEqual(["capabilities"]);
  });

  test("a session that waited past the limit fixes the list without planner tools", async () => {
    const basis = new ToolBasis(build, 20);
    let late: ((reply: PlannerReply) => void) | undefined;
    let abandoned = false;
    basis.discover({
      request: (_request, signal) => {
        signal?.addEventListener("abort", () => {
          abandoned = true;
        });
        return new Promise((resolve) => {
          late = resolve;
        });
      },
    });
    const tools = await basis.resolved();
    expect(tools).toHaveLength(coreEntries.length);
    expect(abandoned).toBe(true);
    late?.({ kind: "aborted" });
    expect(await basis.resolved()).toBe(tools);
  });

  test.each([
    [
      "a failed response",
      {
        kind: "response",
        response: {
          status: "failed",
          error: { code: "protocol.unsupported_capability", retry: "never" },
        },
      },
    ],
    [
      "a report",
      { kind: "report", report: { status: "failed", error: "sherpa.internal_failure" } },
    ],
    ["a timeout", { kind: "timeout" }],
    [
      "another result shape",
      { kind: "response", response: { status: "succeeded", result: { schema: "x" } } },
    ],
  ])("%s fails discovery for the process", async (_name, reply) => {
    const basis = new ToolBasis(build, 1_000);
    basis.discover({ request: async () => reply as PlannerReply });
    expect(await basis.resolved()).toHaveLength(coreEntries.length);
  });

  test("an app without the planner worker gets the core tools", async () => {
    const basis = new ToolBasis(build, 1_000);
    basis.fail("planner_worker_missing");
    expect(await basis.resolved()).toHaveLength(coreEntries.length);
  });
});
