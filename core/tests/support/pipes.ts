import type { FrameSink } from "../../src/app/mux.ts";

const encoder = new TextEncoder();

/** The app's side of the core's standard input: chunks pushed by the test, then EOF. */
export class PushInput implements AsyncIterable<Uint8Array> {
  private readonly queue: (Uint8Array | null)[] = [];
  private wake: (() => void) | null = null;

  push(chunk: string | Uint8Array): void {
    this.queue.push(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
    this.wake?.();
  }

  end(): void {
    this.queue.push(null);
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    for (;;) {
      while (this.queue.length === 0) {
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
      }
      this.wake = null;
      const chunk = this.queue.shift();
      if (!chunk) return;
      yield chunk;
    }
  }
}

/** The core's standard output as complete lines (frames without their LF). */
export class CollectingSink implements FrameSink {
  readonly lines: string[] = [];
  private partial = "";
  private readonly decoder = new TextDecoder();
  private readonly waiters: {
    match: (line: string) => boolean;
    resolve: (line: string) => void;
  }[] = [];

  write(chunk: Uint8Array): boolean {
    this.partial += this.decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = this.partial.indexOf("\n")) >= 0) {
      const line = this.partial.slice(0, end);
      this.partial = this.partial.slice(end + 1);
      this.lines.push(line);
      const index = this.waiters.findIndex((waiter) => waiter.match(line));
      if (index >= 0) this.waiters.splice(index, 1)[0]?.resolve(line);
    }
    return true;
  }

  once(): this {
    return this;
  }

  /** The first line (already written or later) that matches. */
  next(match: (line: string) => boolean, timeoutMs = 2_000): Promise<string> {
    const found = this.lines.find(match);
    if (found !== undefined) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no matching line")), timeoutMs);
      this.waiters.push({
        match,
        resolve: (line) => {
          clearTimeout(timer);
          resolve(line);
        },
      });
    });
  }
}

/** Timers a test fires by hand (`ControlTimers`). */
export class ManualTimers {
  private nextID = 1;
  readonly pending = new Map<number, { callback: () => void; ms: number }>();

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextID++;
    this.pending.set(id, { callback, ms });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  /** Fires every pending timer with the given delay. */
  fire(ms: number): void {
    for (const [id, timer] of this.pending) {
      if (timer.ms !== ms) continue;
      this.pending.delete(id);
      timer.callback();
    }
  }
}

export const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
