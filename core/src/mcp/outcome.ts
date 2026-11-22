import type { CallToolResult } from "@modelcontextprotocol/server";
import type { FittedOutcome } from "../tools/outcome.ts";

/** The serialized text block of an MCP result may hold at most 1 MiB (§10.5). */
export const RESULT_TEXT_LIMIT = 1024 * 1024;

/** The MCP result: `structuredContent` and one text block of the same object; `isError` only for `failed`. */
export function callToolResult(fitted: FittedOutcome): CallToolResult {
  return {
    content: [{ type: "text", text: fitted.text }],
    structuredContent: fitted.outcome as unknown as Record<string, unknown>,
    isError: fitted.outcome.status === "failed",
  };
}
