import type { ChatChannel } from "../../src/chat/session.ts";

/** The app's side of one chat channel: what it writes, and what the core wrote back in order. */
export class FakeChannel implements ChatChannel {
  onmessage?: (body: Uint8Array) => void;
  onclose?: () => void;
  readonly sent: Record<string, unknown>[] = [];
  closed: string | null = null;
  private taken = 0;
  private waiter: ((message: Record<string, unknown>) => void) | null = null;

  constructor(readonly id: number) {}

  async send(body: string): Promise<void> {
    this.sent.push(JSON.parse(body) as Record<string, unknown>);
    const wake = this.waiter;
    this.waiter = null;
    wake?.(this.sent[this.taken++]!);
  }

  async close(reason: string): Promise<void> {
    this.closed = reason;
  }

  /** The app writes one `data` body. */
  write(message: unknown): void {
    const text = typeof message === "string" ? message : JSON.stringify(message);
    this.onmessage?.(new TextEncoder().encode(text));
  }

  writeBytes(bytes: Uint8Array): void {
    this.onmessage?.(bytes);
  }

  /** The first message the core wrote that the test has not taken, waiting for it if need be. */
  next(): Promise<Record<string, unknown>> {
    if (this.taken < this.sent.length) return Promise.resolve(this.sent[this.taken++]!);
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  /** The messages up to and including the first that is not a `delta`. */
  async untilEnd(): Promise<Record<string, unknown>[]> {
    const messages: Record<string, unknown>[] = [];
    for (;;) {
      const message = await this.next();
      messages.push(message);
      if (message.type !== "delta") return messages;
    }
  }
}

/** One server-sent event: its `event` line when it has one, and its `data`. */
export interface ServerEvent {
  event?: string;
  data: unknown;
}

const encoder = new TextEncoder();

function encoded(events: ServerEvent[]): Uint8Array {
  return encoder.encode(
    events
      .map(({ event, data }) => {
        const line = `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
        return event ? `event: ${event}\n${line}` : line;
      })
      .join(""),
  );
}

const STREAM_HEADERS = { "content-type": "text/event-stream" };

/** A response that streams these events and ends, with these headers besides its type. */
export function sse(events: ServerEvent[], headers: Record<string, string> = {}): Response {
  return new Response(encoded(events), { headers: { ...STREAM_HEADERS, ...headers } });
}

/**
 * A streamed response the test writes event by event and may leave open. Its body breaks off
 * with the reason when `signal` aborts, as Bun's fetch does.
 */
export function openStream(signal: AbortSignal | null | undefined, init: ResponseInit = {}) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let open = true;
  const body = new ReadableStream<Uint8Array>({
    start(stream) {
      controller = stream;
    },
  });
  signal?.addEventListener(
    "abort",
    () => {
      if (open) controller.error(signal.reason);
      open = false;
    },
    { once: true },
  );
  return {
    response: new Response(body, { headers: STREAM_HEADERS, ...init }),
    send(...events: ServerEvent[]) {
      if (open) controller.enqueue(encoded(events));
    },
    end() {
      if (open) controller.close();
      open = false;
    },
  };
}
