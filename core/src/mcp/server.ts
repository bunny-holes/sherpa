import { McpServer } from "@modelcontextprotocol/server";
import { log } from "../log.ts";
import { callToolResult, coreFailure, type ToolOutcome, toolOutcomeSchema } from "./outcome.ts";
import { annotationTable } from "./registry.ts";
import type { ResolvedTool } from "./tools.ts";

/** Calls still running, so a shutdown can let them finish (app-connection-v1 §7.10). */
export const activeCalls = new Set<Promise<unknown>>();

/**
 * One MCP session's server (§10.1): name `sherpa`, the core version, and only
 * `{"tools":{"listChanged":false}}`. Every tool has the same output schema
 * and all four annotation hints of its effect class.
 */
export function createSherpaServer(
  tools: readonly ResolvedTool[],
  options: { version: string; channel: number },
): McpServer {
  const server = new McpServer(
    { name: "sherpa", version: options.version },
    { capabilities: { tools: { listChanged: false } } },
  );
  for (const tool of tools) {
    const { entry } = tool;
    const read = entry.effectClass === "read";
    server.registerTool(
      entry.name,
      {
        description: entry.description,
        inputSchema: entry.inputSchema,
        outputSchema: toolOutcomeSchema,
        annotations: annotationTable[entry.effectClass],
      },
      async (args, ctx) => {
        const started = Date.now();
        const fields = `channel=${options.channel} tool=${entry.name}`;
        log.info(`[core:mcp:tool-call] start ${fields}`);
        const info = server.server.getClientVersion();
        const call = tool.handle(args, {
          signal: ctx.mcpReq.signal,
          client: { name: info?.name ?? "unknown", version: info?.version ?? "unknown" },
        });
        activeCalls.add(call);
        let result: ToolOutcome | null;
        try {
          result = await call;
        } catch (error) {
          log.error(
            `[core:mcp:tool-call] failure ${fields} error_type=${error instanceof Error ? error.name : typeof error}`,
          );
          result = coreFailure(entry.capability, "none", error);
        } finally {
          activeCalls.delete(call);
        }
        const ms = Date.now() - started;
        if (result === null) {
          // The SDK does not answer an aborted request; this value is never written.
          log.info(`[core:mcp:tool-call] abandoned ${fields} ms=${ms}`);
          return { content: [], isError: true };
        }
        const answer = callToolResult(result, read);
        const outcome = answer.structuredContent as unknown as ToolOutcome;
        const end = `${fields} status=${outcome.status} code=${outcome.error?.code ?? "none"} operation_id=${outcome.operation_id ?? "none"} ms=${ms}`;
        if (outcome.status === "failed") log.warn(`[core:mcp:tool-call] failure ${end}`);
        else log.info(`[core:mcp:tool-call] success ${end}`);
        return answer;
      },
    );
  }
  return server;
}
