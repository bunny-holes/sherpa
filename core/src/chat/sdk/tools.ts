/**
 * The core's tools as the AI SDK takes them (ADR-0012 "도구"): each entry's description, its input
 * schema in JSON Schema for the model, checked by the entry's own zod schema, and an `execute`
 * that runs the call through the chat (src/chat/calls.ts).
 */
import { type JSONSchema7, jsonSchema, type Schema, type ToolSet, tool } from "ai";
import { z } from "zod";
import type { ModelTool } from "../../tools/call.ts";
import type { ToolOutcome } from "../../tools/outcome.ts";

/** What an `execute` needs of the chat: the call, which never throws. */
export interface ToolRunner {
  run(name: string, input: unknown, signal: AbortSignal): Promise<ToolOutcome>;
}

/** Drops the bounds zod writes for every integer, those of a safe integer, which it checks anyway. */
function withoutSafeBounds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSafeBounds);
  if (typeof value !== "object" || value === null) return value;
  const node = value as Record<string, unknown>;
  const safe =
    node.minimum === -Number.MAX_SAFE_INTEGER && node.maximum === Number.MAX_SAFE_INTEGER;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => !(safe && (key === "minimum" || key === "maximum")))
      .map(([key, item]) => [key, withoutSafeBounds(item)]),
  );
}

/**
 * The schema the model reads: zod's JSON Schema without its `$schema` and the bounds of a safe
 * integer, which are no use to a model (35 keys and 145 pairs across the 35 tools).
 */
export function modelSchema(schema: z.ZodObject): JSONSchema7 {
  const root = { ...z.toJSONSchema(schema) } as Record<string, unknown>;
  delete root.$schema;
  return withoutSafeBounds(root) as JSONSchema7;
}

/** Each tool's schema, built once in a process: the tools are settled once (§10.1). */
const schemas = new WeakMap<ModelTool, Schema>();

function inputSchema(item: ModelTool): Schema {
  let schema = schemas.get(item);
  if (!schema) {
    const zod = item.entry.inputSchema;
    // The AI SDK refuses a call whose input fails this, and the model reads why (InvalidToolInputError).
    schema = jsonSchema(modelSchema(zod), {
      validate: (value) => {
        const parsed = zod.safeParse(value);
        return parsed.success
          ? { success: true, value: parsed.data }
          : { success: false, error: parsed.error };
      },
    });
    schemas.set(item, schema);
  }
  return schema;
}

/** The tools of one turn, each `execute` running its call through `runner`. */
export function toolSet(tools: readonly ModelTool[], runner: ToolRunner): ToolSet {
  return Object.fromEntries(
    tools.map((item) => [
      item.entry.name,
      tool({
        description: item.entry.description,
        inputSchema: inputSchema(item),
        execute: (input, { abortSignal }) =>
          runner.run(item.entry.name, input, abortSignal ?? new AbortController().signal),
      }),
    ]),
  );
}
