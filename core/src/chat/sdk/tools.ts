/**
 * The core's tools as the AI SDK takes them (ADR-0012 "도구"): each entry's description, its input
 * schema in JSON Schema for the model, checked by the entry's own zod schema whose refusal the
 * model reads in a few lines, and an `execute` that runs the call through the chat
 * (src/chat/calls.ts).
 */
import { type JSONSchema7, jsonSchema, type Schema, type ToolSet, tool } from "ai";
import { z } from "zod";
import type { ModelTool } from "../../tools/call.ts";
import type { ToolOutcome } from "../../tools/outcome.ts";
import { chatLimits } from "../protocol.ts";

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

/** What ends a line cut to the room left. */
const CUT = "... (truncated)";

/** A string's bytes as the conversation's JSON writes it, without its quotes. */
const jsonTextBytes = (text: string) => Buffer.byteLength(JSON.stringify(text)) - 2;

/** The last line, which counts the issues left out. */
const more = (count: number) => `and ${count} more ${count === 1 ? "issue" : "issues"}`;

/** One issue: where in the input, in zod's own notation, and what zod says of it. */
function issueLine(issue: z.core.$ZodIssue): string {
  const path = z.core.toDotPath(issue.path);
  return path === "" ? issue.message : `${path}: ${issue.message}`;
}

/** The start of `line` in at most `room` bytes, cut between two code points. */
function head(line: string, room: number): string {
  let bytes = 0;
  let end = 0;
  for (const point of line) {
    bytes += jsonTextBytes(point);
    if (bytes > room) break;
    end += point.length;
  }
  return line.slice(0, end);
}

/**
 * Why a schema refused a call's input, as the model reads it (app-connection-v1 §7.11 "도구"):
 * zod's issues in its order, one line each, in at most `chatLimits.toolIssueBytes`. The first
 * line that does not fit is cut to the room left and says so, and a last line counts the issues
 * after it. zod's own message is every issue as indented JSON (zod 4.6.7 errors.js), which the AI
 * SDK would write whole: a call with 2,000 issues made its step keep 409,491 bytes.
 */
export function issueText(issues: readonly z.core.$ZodIssue[]): string {
  const lines: string[] = [];
  let used = 0;
  for (const [index, issue] of issues.entries()) {
    const line = issueLine(issue);
    let left = issues.length - index - 1;
    // Each line after the first follows a line break, which JSON writes in two bytes.
    const join = lines.length === 0 ? 0 : 2;
    const count = left === 0 ? 0 : 2 + jsonTextBytes(more(left));
    if (used + join + jsonTextBytes(line) + count <= chatLimits.toolIssueBytes) {
      lines.push(line);
      used += join + jsonTextBytes(line);
      continue;
    }
    const start = head(line, chatLimits.toolIssueBytes - used - join - jsonTextBytes(CUT) - count);
    // The line before this one left room for the count of the issues from this one on.
    if (start === "") left += 1;
    else lines.push(start + CUT);
    if (left > 0) lines.push(more(left));
    break;
  }
  return lines.join("\n");
}

/**
 * Why a schema refused a call's input. The AI SDK writes an error's `toString()` after the input
 * (@ai-sdk/provider 4.0.39 get-error-message.ts), here the words alone, as zod's error gives them.
 */
class InputIssues extends Error {
  override name = "InputIssues";

  override toString(): string {
    return this.message;
  }
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
          : { success: false, error: new InputIssues(issueText(parsed.error.issues)) };
      },
    });
    schemas.set(item, schema);
  }
  return schema;
}

/**
 * The tools as the model reads them, without running them: what a chat's state fingerprints
 * (./state.ts).
 */
export function toolDefinitions(tools: readonly ModelTool[]): ToolSet {
  return Object.fromEntries(
    tools.map((item) => [
      item.entry.name,
      tool({ description: item.entry.description, inputSchema: inputSchema(item) }),
    ]),
  );
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
