import {
  INVALID_REQUEST,
  isJSONRPCErrorResponse,
  isJSONRPCNotification,
  isJSONRPCRequest,
  isJSONRPCResponse,
  type JSONRPCMessage,
  parseJSONRPCMessage,
  ProtocolErrorCode,
  type RequestId,
  type Transport,
} from "@modelcontextprotocol/server";
import { log } from "../log.ts";
import { frameLimits } from "./frame.ts";
import type { MuxChannel } from "./mux.ts";

const PARSE_ERROR = '{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}';
const decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * The MCP transport of one mux channel, handed to `serveStdio(factory, { transport })`
 * (§7.6). One `data` frame carries one JSON-RPC message each way. A body that
 * is not JSON is answered with -32700 and the connection stays open (§7.3).
 *
 * A request whose id is still in flight on this connection is answered with
 * -32600 and never reaches the SDK: the SDK keeps one abort controller per id,
 * so a second call under the same id could not be withdrawn on cancel or close (§9).
 */
export class MuxChannelTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private closed = false;
  private readonly session = new AbortController();
  private readonly inFlight = new Set<RequestId>();

  constructor(private readonly channel: MuxChannel) {
    channel.onmessage = (body) => this.receive(body);
    channel.onclose = () => this.end();
  }

  /** Aborted when the connection ends, from either side; every call of the session listens to it. */
  get signal(): AbortSignal {
    return this.session.signal;
  }

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) return;
    if (isJSONRPCResponse(message) && message.id !== undefined) this.inFlight.delete(message.id);
    if (
      isJSONRPCErrorResponse(message) &&
      message.error.code === ProtocolErrorCode.UnsupportedProtocolVersion
    ) {
      // A 2025-era agent (`initialize`, or a request without the 2026-07-28 envelope; ADR-0011).
      log.warn(
        `[core:mcp-transport:send] refused channel=${this.channel.id} reason=unsupported_protocol_version`,
      );
    }
    let body = JSON.stringify(message);
    if (Buffer.byteLength(body) > frameLimits.data) {
      // §10.5 keeps results far below this; reaching it is a core defect.
      log.error(`[core:mcp-transport:send] oversized channel=${this.channel.id}`);
      if (!("id" in message) || message.id === undefined || "method" in message) return;
      body = JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32603, message: "Response too large" },
      });
    }
    await this.channel.send(body);
  }

  /** The core ends the session (the SDK closed it). */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.session.abort();
    await this.channel.close("server_closed");
    this.onclose?.();
  }

  private end(): void {
    if (this.closed) return;
    this.closed = true;
    this.session.abort();
    this.onclose?.();
  }

  private receive(body: Uint8Array): void {
    if (this.closed) return;
    let value: unknown;
    try {
      value = JSON.parse(decoder.decode(body));
    } catch {
      log.warn(`[core:mcp-transport:receive] parse_error channel=${this.channel.id}`);
      this.channel.send(PARSE_ERROR).catch((error: unknown) => this.report(error));
      return;
    }
    let message: JSONRPCMessage;
    try {
      message = parseJSONRPCMessage(value);
    } catch (error) {
      // Same as the SDK's own stdio transport: reported and dropped.
      log.warn(`[core:mcp-transport:receive] invalid_message channel=${this.channel.id}`);
      this.report(error);
      return;
    }
    if (isJSONRPCRequest(message)) {
      if (this.inFlight.has(message.id)) {
        log.warn(`[core:mcp-transport:receive] duplicate_id channel=${this.channel.id}`);
        const answer = {
          jsonrpc: "2.0",
          id: message.id,
          error: { code: INVALID_REQUEST, message: "Request id already in use" },
        };
        this.channel.send(JSON.stringify(answer)).catch((error: unknown) => this.report(error));
        return;
      }
      this.inFlight.add(message.id);
    } else if (isJSONRPCNotification(message) && message.method === "notifications/cancelled") {
      // The SDK does not answer a cancelled request, so its id is free again.
      const requestId = (message.params as { requestId?: RequestId } | undefined)?.requestId;
      if (requestId !== undefined) this.inFlight.delete(requestId);
    }
    this.onmessage?.(message);
  }

  private report(error: unknown): void {
    this.onerror?.(error instanceof Error ? error : new Error(String(error)));
  }
}
