/**
 * Mux 3 frames between Sherpa.app and `sherpa app serve` (app-connection-v1 §7.2–§7.4):
 *
 *   frame   = channel HTAB type [HTAB body] LF
 *   channel = "0" / (%x31-39 *15DIGIT)   ; decimal, no leading zero, at most 2^53-1
 *   type    = 1*16(%x61-7A / "-")
 *   body    = 1*(%x00-09 / %x0B-FF)      ; one UTF-8 JSON value without LF
 */
/**
 * The `mux` of both hellos (§7.5). Mux 2 added the channel kind of `open` (§7.3) and Mux 3 the
 * channel of a `confirm`'s call (§9); an earlier `mux` is refused.
 */
export const MUX_VERSION = 3;

const KiB = 1024;
const MiB = 1024 * KiB;

/** Body limits by frame type and the limit of one whole line (§7.4). */
export const frameLimits = {
  data: 4 * MiB,
  request: 64 * KiB + KiB,
  response: 8 * MiB + KiB,
  confirm: 64 * KiB,
  other: 4 * KiB,
  line: 8 * MiB + 64 * KiB,
} as const;

export function bodyLimit(type: string): number {
  switch (type) {
    case "data":
      return frameLimits.data;
    case "request":
      return frameLimits.request;
    case "response":
      return frameLimits.response;
    case "confirm":
      return frameLimits.confirm;
    default:
      return frameLimits.other;
  }
}

export interface Frame {
  channel: number;
  type: string;
  body: Uint8Array | null;
}

/** Stable codes of the core's `fatal` frame (§10.7). */
export type ViolationCode =
  | "mux.frame_invalid"
  | "mux.frame_too_large"
  | "mux.unexpected_frame"
  | "mux.version_unsupported";

/** A protocol violation: the core writes `fatal` with `code` and exits 65. */
export class FrameViolation extends Error {
  constructor(
    readonly code: ViolationCode,
    /** A fixed word for the log; never frame content. */
    readonly reason: string,
  ) {
    super(`${code}: ${reason}`);
    this.name = "FrameViolation";
  }
}

const TAB = 0x09;
const LF = 0x0a;
const ZERO = 0x30;
const NINE = 0x39;
const HYPHEN = 0x2d;
const LOWER_A = 0x61;
const LOWER_Z = 0x7a;
const MAX_CHANNEL_DIGITS = 16;
const MAX_TYPE_LENGTH = 16;

/**
 * Splits a byte stream into frames and enforces the limits while reading: once
 * the head names the type, a body that passes its limit stops the reader
 * before more of it is kept.
 */
export class FrameReader {
  private phase: "channel" | "type" | "body" = "channel";
  private channelText = "";
  private typeText = "";
  private body: Uint8Array[] = [];
  private bodyLength = 0;
  private limit = 0;
  private lineLength = 0;

  /** True while a frame has started and not yet ended. */
  get pending(): boolean {
    return this.lineLength > 0;
  }

  /** Reads `chunk` and calls `onFrame` for every complete frame; throws the first violation. */
  push(chunk: Uint8Array, onFrame: (frame: Frame) => void): void {
    let position = 0;
    while (position < chunk.length) {
      if (this.phase === "body") {
        const end = chunk.indexOf(LF, position);
        const stop = end < 0 ? chunk.length : end;
        const length = stop - position;
        if (this.bodyLength + length > this.limit) {
          throw new FrameViolation("mux.frame_too_large", "body_limit");
        }
        this.count(length + (end < 0 ? 0 : 1));
        if (length > 0) this.body.push(chunk.slice(position, stop));
        this.bodyLength += length;
        position = stop;
        if (end < 0) continue;
        position += 1;
        if (this.bodyLength === 0) throw new FrameViolation("mux.frame_invalid", "empty_body");
        onFrame(this.finish(Buffer.concat(this.body, this.bodyLength)));
        continue;
      }
      const byte = chunk[position]!;
      position += 1;
      this.count(1);
      if (this.phase === "channel") this.readChannel(byte);
      else if (this.readType(byte)) onFrame(this.finish(null));
    }
  }

  private count(bytes: number): void {
    this.lineLength += bytes;
    if (this.lineLength > frameLimits.line) {
      throw new FrameViolation("mux.frame_too_large", "line_limit");
    }
  }

  private readChannel(byte: number): void {
    if (byte === TAB) {
      if (!/^(0|[1-9][0-9]*)$/.test(this.channelText)) {
        throw new FrameViolation("mux.frame_invalid", "channel");
      }
      if (Number(this.channelText) > Number.MAX_SAFE_INTEGER) {
        throw new FrameViolation("mux.frame_invalid", "channel_range");
      }
      this.phase = "type";
      return;
    }
    if (byte < ZERO || byte > NINE || this.channelText.length === MAX_CHANNEL_DIGITS) {
      throw new FrameViolation("mux.frame_invalid", "channel");
    }
    this.channelText += String.fromCharCode(byte);
  }

  /** Returns true when the frame ended without a body. */
  private readType(byte: number): boolean {
    if (byte === TAB || byte === LF) {
      if (this.typeText.length === 0) throw new FrameViolation("mux.frame_invalid", "type");
      if (byte === LF) return true;
      this.phase = "body";
      this.limit = bodyLimit(this.typeText);
      return false;
    }
    const valid = (byte >= LOWER_A && byte <= LOWER_Z) || byte === HYPHEN;
    if (!valid || this.typeText.length === MAX_TYPE_LENGTH) {
      throw new FrameViolation("mux.frame_invalid", "type");
    }
    this.typeText += String.fromCharCode(byte);
    return false;
  }

  private finish(body: Uint8Array | null): Frame {
    const frame = { channel: Number(this.channelText), type: this.typeText, body };
    this.phase = "channel";
    this.channelText = "";
    this.typeText = "";
    this.body = [];
    this.bodyLength = 0;
    this.lineLength = 0;
    return frame;
  }
}

const encoder = new TextEncoder();

/** One frame as the bytes of a single write. Bodies come from `JSON.stringify`, which never emits LF. */
export function encodeFrame(channel: number, type: string, body?: string): Uint8Array {
  if (body === undefined) return encoder.encode(`${channel}\t${type}\n`);
  const bytes = encoder.encode(`${channel}\t${type}\t${body}\n`);
  const head = `${channel}\t${type}\t`.length;
  if (body.length === 0 || body.includes("\n") || bytes.length - head - 1 > bodyLimit(type)) {
    throw new Error(`frame body rejected type=${type}`);
  }
  return bytes;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

/** A control body: strict UTF-8 JSON, or a frame violation. */
export function controlBody(body: Uint8Array | null): unknown {
  if (body === null) throw new FrameViolation("mux.frame_invalid", "missing_body");
  try {
    return JSON.parse(decoder.decode(body));
  } catch {
    throw new FrameViolation("mux.frame_invalid", "body_json");
  }
}
