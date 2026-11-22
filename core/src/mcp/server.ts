import { CLIENT_INFO_META_KEY, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { runToolCall, type ToolCall } from "../tools/call.ts";
import { toolOutcomeSchema } from "../tools/outcome.ts";
import { callToolResult, RESULT_TEXT_LIMIT } from "./outcome.ts";
import { annotationTable } from "./registry.ts";
import type { ResolvedTool } from "./tools.ts";

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
    server.registerTool(
      entry.name,
      {
        description: entry.description,
        inputSchema: entry.inputSchema,
        outputSchema: toolOutcomeSchema,
        annotations: annotationTable[entry.effectClass],
      },
      async (args, ctx) => {
        const fitted = await runToolCall(
          tool,
          args,
          {
            signal: AbortSignal.any([ctx.mcpReq.signal, options.session]),
            client: requestClient(ctx.mcpReq.envelope),
          },
          { module: "mcp", channel: options.channel, limit: RESULT_TEXT_LIMIT },
        );
        // The SDK does not answer an aborted request; this value is never written.
        return fitted === null ? { content: [], isError: true } : callToolResult(fitted);
      },
    );
  }
  return server;
}
