import {
  type JSONRPCMessage,
  parseJSONRPCMessage,
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
 */
export class MuxChannelTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private closed = false;

  constructor(private readonly channel: MuxChannel) {
    channel.onmessage = (body) => this.receive(body);
    channel.onclose = () => this.end();
  }

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) return;
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
    await this.channel.close("server_closed");
    this.onclose?.();
  }

  private end(): void {
    if (this.closed) return;
    this.closed = true;
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
    this.onmessage?.(message);
  }

  private report(error: unknown): void {
    this.onerror?.(error instanceof Error ? error : new Error(String(error)));
  }
}
