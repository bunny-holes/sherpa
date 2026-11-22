/**
 * A fake Sherpa.app for driving the built `sherpa app serve` through its pipes,
 * written from app-connection-v1 alone (§7–§10, §14). It reads the core's frames,
 * answers `request` and `confirm` through replaceable handlers, and speaks
 * MCP 2026-07-28 JSON-RPC on numbered channels.
 */
import type { Subprocess } from "bun";
import { type AgentInfo, withEnvelope } from "../support/mcp.ts";
import { defaultPlanner, type PlannerHandler } from "../support/planner.ts";

export interface CoreFrame {
  channel: number;
  type: string;
  body: unknown;
}

export type ConfirmHandler = (confirm: Record<string, unknown>) => string | null;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class FakeApp {
  /** Frames not yet taken by `next`. */
  readonly frames: CoreFrame[] = [];
  /** Every frame the core wrote, in order. */
  readonly log: CoreFrame[] = [];
  readonly stderr: string[] = [];
  planner: PlannerHandler = defaultPlanner;
  confirm: ConfirmHandler = () => "approved";
  readonly exited: Promise<number>;
  private buffer = "";
  private waiters: { match: (frame: CoreFrame) => boolean; resolve: (frame: CoreFrame) => void }[] =
    [];
  private nextRPC = 1000;
  /** The client each channel's requests name in their envelope. */
  private readonly clients = new Map<number, AgentInfo>();

  private constructor(readonly child: Subprocess<"pipe", "pipe", "pipe">) {
    this.exited = child.exited;
    void this.pump();
    void this.drainStderr();
  }

  get pid(): number {
    return this.child.pid;
  }

  static launch(binary: string, env: Record<string, string>): FakeApp {
    const child = Bun.spawn([binary, "app", "serve"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", ...env },
    });
    return new FakeApp(child);
  }

  /** Waits for the core hello and answers it with `mux` (Mux 2 unless a test says otherwise, §7.5). */
  async handshake(workers: string[] = ["planner"], mux = 2): Promise<CoreFrame> {
    const hello = await this.next((frame) => frame.channel === 0 && frame.type === "hello");
    const version = (hello.body as { version: string }).version;
    this.write(`0\thello\t${JSON.stringify({ mux, version, workers })}\n`);
    return hello;
  }

  write(text: string | Uint8Array): void {
    void this.child.stdin.write(typeof text === "string" ? encoder.encode(text) : text);
    void this.child.stdin.flush();
  }

  frame(channel: number, type: string, body?: unknown): void {
    this.write(
      body === undefined
        ? `${channel}\t${type}\n`
        : `${channel}\t${type}\t${JSON.stringify(body)}\n`,
    );
  }

  closeInput(): void {
    void this.child.stdin.end();
  }

  /** Resolves with the first frame (already received or later) that matches. */
  next(match: (frame: CoreFrame) => boolean, timeoutMs = 10_000): Promise<CoreFrame> {
    const index = this.frames.findIndex(match);
    if (index >= 0) return Promise.resolve(this.frames.splice(index, 1)[0]!);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no matching frame within ${timeoutMs} ms`)),
        timeoutMs,
      );
      this.waiters.push({
        match,
        resolve: (frame) => {
          clearTimeout(timer);
          resolve(frame);
        },
      });
    });
  }

  /** True when no matching frame arrives within `ms`. */
  async absent(match: (frame: CoreFrame) => boolean, ms: number): Promise<boolean> {
    return this.next(match, ms).then(
      () => false,
      () => true,
    );
  }

  /** Opens a relay (`mcp`) channel and asks `server/discover` (2026-07-28 has no `initialize`). */
  async open(
    channel: number,
    client: AgentInfo = { name: "fake-agent", version: "1.0.0" },
  ): Promise<Record<string, unknown>> {
    this.frame(channel, "open", { kind: "mcp" });
    return this.discover(channel, client);
  }

  /** `server/discover` on an open channel; later requests there name `client`. */
  async discover(
    channel: number,
    client: AgentInfo = { name: "fake-agent", version: "1.0.0" },
  ): Promise<Record<string, unknown>> {
    this.clients.set(channel, client);
    return this.rpc(channel, "server/discover", {});
  }

  /** Sends one request and returns its `result` (throws on a JSON-RPC error). */
  async rpc(
    channel: number,
    method: string,
    params: Record<string, unknown>,
    timeoutMs = 10_000,
  ): Promise<Record<string, unknown>> {
    const response = await this.request(channel, method, params, timeoutMs);
    if ("error" in response) throw new Error(`json-rpc error ${JSON.stringify(response.error)}`);
    return response.result as Record<string, unknown>;
  }

  /** Sends one request and returns the whole response message. */
  async request(
    channel: number,
    method: string,
    params: Record<string, unknown>,
    timeoutMs = 10_000,
  ): Promise<Record<string, unknown>> {
    const id = this.send(channel, method, params);
    return this.reply(channel, id, timeoutMs);
  }

  /** Sends one request with the 2026-07-28 envelope naming the channel's client. */
  send(channel: number, method: string, params: Record<string, unknown>): number {
    return this.post(channel, method, withEnvelope(params, this.clients.get(channel) ?? null));
  }

  /** Sends one request without an envelope, as a 2025-era client does, and returns the response. */
  async requestBare(
    channel: number,
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.reply(channel, this.post(channel, method, params));
  }

  private post(channel: number, method: string, params: Record<string, unknown>): number {
    const id = this.nextRPC++;
    this.frame(channel, "data", { jsonrpc: "2.0", id, method, params });
    return id;
  }

  async reply(channel: number, id: number, timeoutMs = 10_000): Promise<Record<string, unknown>> {
    const frame = await this.next(
      (f) => f.channel === channel && f.type === "data" && (f.body as { id?: unknown }).id === id,
      timeoutMs,
    );
    return frame.body as Record<string, unknown>;
  }

  /** `tools/call` and its `structuredContent` plus `isError`. */
  async call(channel: number, name: string, args: Record<string, unknown>, timeoutMs = 10_000) {
    const result = await this.rpc(channel, "tools/call", { name, arguments: args }, timeoutMs);
    return result as {
      structuredContent?: Record<string, unknown>;
      isError?: boolean;
      content: { type: string; text: string }[];
    };
  }

  /** Capabilities of the work requests the core sent so far. */
  requested(): string[] {
    return this.log
      .filter((frame) => frame.channel === 0 && frame.type === "request")
      .map((frame) =>
        String((frame.body as { request: { capability: string } }).request.capability),
      );
  }

  /** Writes raw bytes, ignoring a pipe the core already closed. */
  writeRaw(bytes: Uint8Array): void {
    try {
      this.write(bytes);
    } catch {
      // The core exits on a violation and may close its input first.
    }
  }

  stop(): void {
    this.child.kill("SIGKILL");
  }

  private async pump(): Promise<void> {
    for await (const chunk of this.child.stdout) {
      this.buffer += decoder.decode(chunk, { stream: true });
      let end: number;
      while ((end = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        this.receive(line);
      }
    }
  }

  private async drainStderr(): Promise<void> {
    for await (const chunk of this.child.stderr) this.stderr.push(decoder.decode(chunk));
  }

  private receive(line: string): void {
    const [channel, type, ...rest] = line.split("\t");
    const raw = rest.join("\t");
    const frame: CoreFrame = {
      channel: Number(channel),
      type: type!,
      body: raw === "" ? null : JSON.parse(raw),
    };
    this.log.push(frame);
    if (frame.channel === 0 && frame.type === "request") {
      const body = frame.body as { id: number; request: Record<string, unknown> };
      const answer = this.planner(body.request);
      if (answer !== null && answer !== undefined)
        this.frame(0, "response", { id: body.id, ...(answer as object) });
    }
    if (frame.channel === 0 && frame.type === "confirm") {
      const body = frame.body as Record<string, unknown>;
      const decision = this.confirm(body);
      if (decision !== null) this.frame(0, "confirmation", { id: body.id, decision });
    }
    const waiter = this.waiters.findIndex((w) => w.match(frame));
    if (waiter >= 0) {
      this.waiters.splice(waiter, 1)[0]!.resolve(frame);
      return;
    }
    this.frames.push(frame);
  }
}
