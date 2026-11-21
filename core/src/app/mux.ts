import { z } from "zod";
import { log } from "../log.ts";
import { ControlChannel, type ControlTimers } from "./control.ts";
import {
  controlBody,
  encodeFrame,
  type Frame,
  FrameReader,
  FrameViolation,
  MUX_VERSION,
} from "./frame.ts";

/** Where frames go: the core's standard output, or a test sink. */
export interface FrameSink {
  write(chunk: Uint8Array): boolean;
  once(event: "drain", listener: () => void): unknown;
}

/** The app's `hello` body (§7.3). */
export interface AppHello {
  mux: number;
  version: string;
  workers: string[];
}

const appHello = z.strictObject({
  mux: z.number(),
  version: z.string().min(1).max(64),
  workers: z.array(z.string().max(64)).max(16),
});
const closeBody = z.strictObject({ reason: z.string().max(256) });

/**
 * Serialises frames onto the sink. A write the sink does not take at once
 * waits for `drain` before the next frame is written (§7.7), so frames never
 * interleave and the core's own buffer stays bounded.
 */
export class FrameWriter {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly sink: FrameSink) {}

  write(frame: Uint8Array): Promise<void> {
    const next = this.tail.then(
      () =>
        new Promise<void>((resolve) => {
          if (this.sink.write(frame)) resolve();
          else this.sink.once("drain", resolve);
        }),
    );
    this.tail = next;
    return next;
  }
}

/** One MCP connection (channel 1 and above) as the session sees it. */
export class MuxChannel {
  /** One `data` body from the app. */
  onmessage?: (body: Uint8Array) => void;
  /** The app closed the channel or the core is shutting down; no frame is written for it. */
  onclose?: () => void;
  private open = true;

  constructor(
    readonly id: number,
    private readonly connection: AppConnection,
  ) {}

  get isOpen(): boolean {
    return this.open;
  }

  /** Writes one `data` frame; a closed channel drops it. */
  send(body: string): Promise<void> {
    if (!this.open) {
      log.debug(`[core:mux:data] dropped channel=${this.id} reason=closed`);
      return Promise.resolve();
    }
    log.debug(`[core:mux:data] write channel=${this.id} bytes=${Buffer.byteLength(body)}`);
    return this.connection.writeFrame(encodeFrame(this.id, "data", body));
  }

  /** The core ends the session: `N\tclose\t{"reason":…}`. */
  close(reason: string): Promise<void> {
    if (!this.open) return Promise.resolve();
    this.open = false;
    this.connection.forget(this.id);
    log.info(`[core:mux:session-close] channel=${this.id} by=core reason=${reason}`);
    return this.connection.writeFrame(encodeFrame(this.id, "close", JSON.stringify({ reason })));
  }

  /** @internal The app closed it, or the core is stopping. */
  ended(by: "app" | "shutdown"): void {
    if (!this.open) return;
    this.open = false;
    log.info(`[core:mux:session-close] channel=${this.id} by=${by}`);
    this.onclose?.();
  }

  /** @internal */
  deliver(body: Uint8Array): void {
    this.onmessage?.(body);
  }
}

export interface AppConnectionHandlers {
  /** The app accepted the handshake; the control channel is usable from now on. */
  ready(hello: AppHello): void;
  /** The app opened an MCP connection. */
  open(channel: MuxChannel): void;
}

export interface AppConnectionOptions {
  version: string;
  input: AsyncIterable<Uint8Array>;
  output: FrameSink;
  handlers: AppConnectionHandlers;
  timers?: ControlTimers;
}

/** Exit codes of `sherpa app serve` (§7.8). */
export const EXIT_EOF = 0;
export const EXIT_FRAME_VIOLATION = 65;
export const EXIT_INTERNAL = 70;

/**
 * The core side of the pipe pair with Sherpa.app: the hello handshake,
 * channel 0, and one `MuxChannel` per MCP connection (§7). Reading never
 * waits for writing; a violation writes `fatal` and ends the run with 65.
 */
export class AppConnection {
  readonly control: ControlChannel;
  private readonly writer: FrameWriter;
  private readonly reader = new FrameReader();
  private readonly channels = new Map<number, MuxChannel>();
  private highestChannel = 0;
  private helloReceived = false;

  constructor(private readonly options: AppConnectionOptions) {
    this.writer = new FrameWriter(options.output);
    this.control = new ControlChannel(
      (type, body) => this.writeFrame(encodeFrame(0, type, body)),
      options.timers ? { timers: options.timers } : {},
    );
  }

  /** Runs until standard input ends (0) or a violation (65). */
  async run(): Promise<number> {
    log.info(`[core:mux:hello] start version=${this.options.version}`);
    await this.writeFrame(
      encodeFrame(0, "hello", JSON.stringify({ mux: MUX_VERSION, version: this.options.version })),
    );
    try {
      for await (const chunk of this.options.input) {
        this.reader.push(chunk, (frame) => this.dispatch(frame));
      }
    } catch (error) {
      if (!(error instanceof FrameViolation)) throw error;
      return this.fatal(error);
    }
    if (this.reader.pending)
      log.warn("[core:mux:read] eof inside a frame; the partial frame is dropped");
    log.info(`[core:mux:read] eof sessions=${this.channels.size}`);
    this.shutdown();
    return EXIT_EOF;
  }

  /** @internal */
  writeFrame(frame: Uint8Array): Promise<void> {
    return this.writer.write(frame);
  }

  /** @internal */
  forget(id: number): void {
    this.channels.delete(id);
  }

  get sessionCount(): number {
    return this.channels.size;
  }

  private async fatal(violation: FrameViolation): Promise<number> {
    log.error(`[core:mux:fatal] code=${violation.code} reason=${violation.reason}`);
    this.shutdown();
    await this.writeFrame(encodeFrame(0, "fatal", JSON.stringify({ code: violation.code })));
    return EXIT_FRAME_VIOLATION;
  }

  /** Ends every session and every control wait without writing frames for them. */
  private shutdown(): void {
    const open = [...this.channels.values()];
    this.channels.clear();
    for (const channel of open) channel.ended("shutdown");
    this.control.closeAll();
  }

  private dispatch(frame: Frame): void {
    log.debug(
      `[core:mux:frame] read channel=${frame.channel} type=${frame.type} bytes=${frame.body?.byteLength ?? 0}`,
    );
    if (!this.helloReceived) {
      if (frame.channel !== 0 || frame.type !== "hello") {
        throw new FrameViolation("mux.unexpected_frame", "before_hello");
      }
      this.acceptHello(controlBody(frame.body));
      return;
    }
    if (frame.channel === 0) {
      switch (frame.type) {
        case "response":
          this.control.onResponse(controlBody(frame.body));
          return;
        case "confirmation":
          this.control.onConfirmation(controlBody(frame.body));
          return;
        default:
          throw new FrameViolation("mux.unexpected_frame", "control_type");
      }
    }
    switch (frame.type) {
      case "open":
        this.openChannel(frame);
        return;
      case "data": {
        if (frame.body === null) throw new FrameViolation("mux.frame_invalid", "data_without_body");
        const channel = this.channels.get(frame.channel);
        if (!channel) {
          log.debug(`[core:mux:data] dropped channel=${frame.channel} reason=not_open`);
          return;
        }
        channel.deliver(frame.body);
        return;
      }
      case "close": {
        if (frame.body !== null && !closeBody.safeParse(controlBody(frame.body)).success) {
          throw new FrameViolation("mux.frame_invalid", "close_body");
        }
        const channel = this.channels.get(frame.channel);
        if (!channel) {
          log.debug(`[core:mux:close] dropped channel=${frame.channel} reason=not_open`);
          return;
        }
        this.channels.delete(frame.channel);
        channel.ended("app");
        return;
      }
      default:
        throw new FrameViolation("mux.unexpected_frame", "channel_type");
    }
  }

  private acceptHello(value: unknown): void {
    if (
      typeof value === "object" &&
      value !== null &&
      "mux" in value &&
      value.mux !== MUX_VERSION
    ) {
      throw new FrameViolation("mux.version_unsupported", "hello_mux");
    }
    const hello = appHello.safeParse(value);
    if (!hello.success) throw new FrameViolation("mux.frame_invalid", "hello_body");
    this.helloReceived = true;
    log.info(
      `[core:mux:hello] success app_version=${hello.data.version} workers=${hello.data.workers.join(",") || "none"}`,
    );
    this.options.handlers.ready(hello.data);
  }

  private openChannel(frame: Frame): void {
    if (frame.body !== null) throw new FrameViolation("mux.frame_invalid", "open_body");
    if (this.channels.has(frame.channel)) {
      throw new FrameViolation("mux.unexpected_frame", "second_open");
    }
    if (frame.channel <= this.highestChannel) {
      throw new FrameViolation("mux.unexpected_frame", "channel_reused");
    }
    this.highestChannel = frame.channel;
    const channel = new MuxChannel(frame.channel, this);
    this.channels.set(frame.channel, channel);
    log.info(`[core:mux:session-open] channel=${frame.channel} sessions=${this.channels.size}`);
    this.options.handlers.open(channel);
  }
}
