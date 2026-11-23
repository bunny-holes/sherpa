/**
 * The lifecycle of one tool call, shared by every surface that calls a tool (ADR-0012 "도구"):
 * its start and end lines, the calls still running, a thrown handler turned into an outcome, and
 * the outcome fitted to the surface's limit. The surface keeps its own transport and form.
 */
import type { z } from "zod";
import { log } from "../log.ts";
import { coreFailure, type FittedOutcome, fit, type ToolOutcome } from "./outcome.ts";

/** What a tool call knows about the request that made it. */
export interface ToolCall {
  signal: AbortSignal;
  /**
   * The app channel the request came in on (app-connection-v1 §7.2). A confirmation names it, and
   * the app tells by that channel's kind who asks (§9).
   */
  channel: number;
  /** Who asked: on MCP, `clientInfo` of the request's 2026-07-28 `_meta` envelope, self-reported (§9). */
  client: { name: string; version: string };
  /**
   * Called once, right before the call asks the planner or runs its command: the step nothing
   * takes back, after which a change it asks for may happen whether or not anyone waits for it
   * (§7.8). The chat lets such a call end when the person cancels (§7.11); MCP passes none.
   */
  committed?(operationID: string | null): void | Promise<void>;
}

/** What the lifecycle needs of a tool. `null` means the call was abandoned and is not answered. */
export interface CallableTool {
  entry: { name: string; capability: string; effectClass: string };
  handle(args: unknown, call: ToolCall): Promise<ToolOutcome | null>;
}

/** A tool a model calls through the chat: what its lifecycle needs and what the model reads of it. */
export interface ModelTool extends CallableTool {
  entry: CallableTool["entry"] & { description: string; inputSchema: z.ZodObject };
}

/** The surface a call came in on: the module its lines name and its byte limit. */
export interface CallSurface {
  module: "mcp" | "chat";
  limit: number;
}

/** Calls still running, so a shutdown can let them finish (app-connection-v1 §7.10). */
export const activeCalls = new Set<Promise<unknown>>();

/**
 * Runs one call and logs it as `[core:<module>:tool-call]`: `start`, then `failure` for a
 * `failed` outcome or a thrown handler, `abandoned` for no outcome, or `success`. A thrown
 * handler becomes a core failure. The end line reads the outcome as fitted to the surface.
 */
export async function runToolCall(
  tool: CallableTool,
  args: unknown,
  call: ToolCall,
  surface: CallSurface,
): Promise<FittedOutcome | null> {
  const { entry } = tool;
  const started = Date.now();
  const action = `[core:${surface.module}:tool-call]`;
  const fields = `channel=${call.channel} tool=${entry.name}`;
  log.info(`${action} start ${fields}`);
  const running = tool.handle(args, call);
  activeCalls.add(running);
  let result: ToolOutcome | null;
  try {
    result = await running;
  } catch (error) {
    log.error(
      `${action} failure ${fields} error_type=${error instanceof Error ? error.name : typeof error}`,
    );
    result = coreFailure(entry.capability, "none", error);
  } finally {
    activeCalls.delete(running);
  }
  const ms = Date.now() - started;
  if (result === null) {
    log.info(`${action} abandoned ${fields} ms=${ms}`);
    return null;
  }
  const fitted = fit(result, entry.effectClass === "read", surface.limit);
  const { outcome } = fitted;
  const end = `${fields} status=${outcome.status} code=${outcome.error?.code ?? "none"} operation_id=${outcome.operation_id ?? "none"} ms=${ms}`;
  if (outcome.status === "failed") log.warn(`${action} failure ${end}`);
  else log.info(`${action} success ${end}`);
  return fitted;
}
