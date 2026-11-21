import { CLIENT_INFO_META_KEY, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { log } from "../log.ts";
import { callToolResult, coreFailure, type ToolOutcome, toolOutcomeSchema } from "./outcome.ts";
import { annotationTable } from "./registry.ts";
import type { ResolvedTool, ToolCall } from "./tools.ts";

/** Calls still running, so a shutdown can let them finish (app-connection-v1 §7.10). */
export const activeCalls = new Set<Promise<unknown>>();

/** The `clientInfo` member of a 2026-07-28 request envelope; the SDK validated it before the handler runs. */
const clientInfoSchema = z.object({ name: z.string(), version: z.string() });

/**
 * The client a request names in its own `_meta` envelope (§9). Protocol
 * revision 2026-07-28 has no `initialize`: every request carries its client
 * identity, which is optional and self-reported, and a server must not carry
 * it over from an earlier request.
 */
function requestClient(envelope: Record<string, unknown> | undefined): ToolCall["client"] {
  const info = clientInfoSchema.safeParse(envelope?.[CLIENT_INFO_META_KEY]);
  return info.success ? info.data : { name: "unknown", version: "unknown" };
}

/**
 * The MCP server of one channel's connection (§10.1): name `sherpa`, the core
 * version, and only `{"tools":{"listChanged":false}}`. Every tool has the same
 * output schema and all four annotation hints of its effect class. `session`
 * ends with the connection, so every call still waiting is withdrawn when it
 * closes (§9), not only the one the SDK last registered under a request id.
 */
export function createSherpaServer(
  tools: readonly ResolvedTool[],
  options: { version: string; channel: number; session: AbortSignal },
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
        const call = tool.handle(args, {
          signal: AbortSignal.any([ctx.mcpReq.signal, options.session]),
          client: requestClient(ctx.mcpReq.envelope),
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
