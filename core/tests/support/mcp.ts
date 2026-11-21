/**
 * What a 2026-07-28 agent writes (app-connection-v1 §10.1, ADR-0011), taken from
 * the MCP specification rather than the SDK: there is no `initialize`, and every
 * request names its protocol revision, its client capabilities and, optionally,
 * its client in `params._meta`.
 */
export const MCP_REVISION = "2026-07-28";

export interface AgentInfo {
  name: string;
  version: string;
}

/** The per-request `_meta` envelope; `null` leaves out the optional `clientInfo`. */
export function envelope(client: AgentInfo | null): Record<string, unknown> {
  return {
    "io.modelcontextprotocol/protocolVersion": MCP_REVISION,
    "io.modelcontextprotocol/clientCapabilities": {},
    ...(client ? { "io.modelcontextprotocol/clientInfo": client } : {}),
  };
}

/** `params` of one request, its `_meta` set to the envelope. */
export function withEnvelope(
  params: Record<string, unknown>,
  client: AgentInfo | null,
): Record<string, unknown> {
  return { ...params, _meta: envelope(client) };
}
