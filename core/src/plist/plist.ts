import { codes, SherpaError } from "../cli/errors.ts";
import { runCommand } from "../process/runner.ts";

/** Object reference inside an `NSKeyedArchiver` binary property list. */
export class PlistUID {
  constructor(readonly value: number) {}
}

export type PlistValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | Date
  | Uint8Array
  | PlistUID
  | PlistValue[]
  | { [key: string]: PlistValue };

const MAGIC = "bplist00";
const MAX_DEPTH = 64;
const APPLE_EPOCH_OFFSET_SECONDS = 978_307_200;

export function isBinaryPlist(data: Uint8Array): boolean {
  if (data.byteLength < MAGIC.length + 32) return false;
  for (let index = 0; index < MAGIC.length; index += 1) {
    if (data[index] !== MAGIC.charCodeAt(index)) return false;
  }
  return true;
}

/**
 * Reads a property list file without launching the app that owns it. A binary
 * plist is parsed in process; any other format is first converted to binary by
 * `plutil`, because `plutil -convert json` rejects the data and date values that
 * KakaoTalk preferences contain.
 */
export async function readPlistFile(path: string): Promise<PlistValue> {
  const bytes = await Bun.file(path).bytes();
  if (isBinaryPlist(bytes)) return parseBinaryPlist(bytes);
  const converted = await runCommand(
    "/usr/bin/plutil",
    ["-convert", "binary1", "-o", "-", "--", path],
    {
      timeoutMs: 10_000,
      outputLimit: 16 * 1024 * 1024,
    },
  );
  return parseBinaryPlist(converted.stdout);
}

/**
 * Parses an Apple binary property list (`bplist00`). Used by both iMessage
 * `chat.db` blobs (including `NSKeyedArchiver` archives with `PlistUID`) and
 * KakaoTalk preference files. Malformed or cyclic input throws `SherpaError`.
 */
export function parseBinaryPlist(data: Uint8Array): PlistValue {
  if (!isBinaryPlist(data)) throw new SherpaError(codes.failed);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const trailer = data.byteLength - 32;
  const offsetSize = data[trailer + 6]!;
  const refSize = data[trailer + 7]!;
  const objectCount = Number(view.getBigUint64(trailer + 8));
  const topObject = Number(view.getBigUint64(trailer + 16));
  const tableOffset = Number(view.getBigUint64(trailer + 24));
  if (offsetSize < 1 || offsetSize > 8 || refSize < 1 || refSize > 8) {
    throw new SherpaError(codes.failed);
  }
  if (tableOffset + objectCount * offsetSize > trailer || topObject >= objectCount) {
    throw new SherpaError(codes.failed);
  }

  const unsigned = (at: number, width: number): number => {
    if (at + width > data.byteLength) throw new SherpaError(codes.failed);
    let value = 0;
    for (let index = 0; index < width; index += 1) value = value * 256 + data[at + index]!;
    return value;
  };
  const objectOffset = (ref: number): number => {
    if (ref >= objectCount) throw new SherpaError(codes.failed);
    return unsigned(tableOffset + ref * offsetSize, offsetSize);
  };
  const bounded = (start: number, byteCount: number): Uint8Array => {
    if (start + byteCount > data.byteLength) throw new SherpaError(codes.failed);
    return data.subarray(start, start + byteCount);
  };

  /** Reads a length that may follow a marker nibble of 0xF as an integer object. */
  const length = (at: number, nibble: number): [count: number, start: number] => {
    if (nibble !== 0x0f) return [nibble, at + 1];
    const marker = data[at + 1];
    if (marker === undefined || marker >> 4 !== 0x1) throw new SherpaError(codes.failed);
    const width = 1 << (marker & 0x0f);
    return [unsigned(at + 2, width), at + 2 + width];
  };

  const active = new Set<number>();

  const read = (ref: number, depth: number): PlistValue => {
    if (depth > MAX_DEPTH || active.has(ref)) throw new SherpaError(codes.failed);
    active.add(ref);
    try {
      return readAt(objectOffset(ref), depth);
    } finally {
      active.delete(ref);
    }
  };

  const readAt = (at: number, depth: number): PlistValue => {
    if (at >= trailer) throw new SherpaError(codes.failed);
    const marker = data[at]!;
    const high = marker >> 4;
    const low = marker & 0x0f;
    switch (high) {
      case 0x0:
        if (marker === 0x00) return null;
        if (marker === 0x08) return false;
        if (marker === 0x09) return true;
        throw new SherpaError(codes.failed);
      case 0x1: {
        const width = 1 << low;
        if (at + 1 + width > data.byteLength) throw new SherpaError(codes.failed);
        if (width === 1) return data[at + 1]!;
        if (width === 2) return view.getUint16(at + 1);
        if (width === 4) return view.getUint32(at + 1);
        if (width === 8) {
          const value = view.getBigInt64(at + 1);
          return value >= BigInt(Number.MIN_SAFE_INTEGER) &&
            value <= BigInt(Number.MAX_SAFE_INTEGER)
            ? Number(value)
            : value;
        }
        if (width === 16) {
          const value = view.getBigUint64(at + 9);
          return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
        }
        throw new SherpaError(codes.failed);
      }
      case 0x2: {
        if (low !== 2 && low !== 3) throw new SherpaError(codes.failed);
        bounded(at + 1, 1 << low);
        return low === 2 ? view.getFloat32(at + 1) : view.getFloat64(at + 1);
      }
      case 0x3: {
        if (marker !== 0x33) throw new SherpaError(codes.failed);
        bounded(at + 1, 8);
        return new Date((view.getFloat64(at + 1) + APPLE_EPOCH_OFFSET_SECONDS) * 1000);
      }
      case 0x4: {
        const [count, start] = length(at, low);
        return new Uint8Array(bounded(start, count));
      }
      case 0x5: {
        const [count, start] = length(at, low);
        return new TextDecoder("latin1").decode(bounded(start, count));
      }
      case 0x6: {
        const [count, start] = length(at, low);
        bounded(start, count * 2);
        let text = "";
        for (let index = 0; index < count; index += 1) {
          text += String.fromCharCode(view.getUint16(start + index * 2));
        }
        return text;
      }
      case 0x7: {
        const [count, start] = length(at, low);
        return new TextDecoder("utf-8").decode(bounded(start, count));
      }
      case 0x8:
        return new PlistUID(unsigned(at + 1, low + 1));
      case 0xa:
      case 0xc: {
        const [count, start] = length(at, low);
        bounded(start, count * refSize);
        const values: PlistValue[] = [];
        for (let index = 0; index < count; index += 1) {
          values.push(read(unsigned(start + index * refSize, refSize), depth + 1));
        }
        return values;
      }
      case 0xd: {
        const [count, start] = length(at, low);
        bounded(start, count * 2 * refSize);
        const result: { [key: string]: PlistValue } = {};
        for (let index = 0; index < count; index += 1) {
          const key = read(unsigned(start + index * refSize, refSize), depth + 1);
          const value = read(unsigned(start + (count + index) * refSize, refSize), depth + 1);
          if (typeof key === "string") {
            Object.defineProperty(result, key, {
              value,
              enumerable: true,
              writable: true,
              configurable: true,
            });
          }
        }
        return result;
      }
      default:
        throw new SherpaError(codes.failed);
    }
  };

  return read(topObject, 0);
}

/** Parses a binary plist, returning undefined instead of throwing. */
export function tryParseBinaryPlist(data: Uint8Array): PlistValue | undefined {
  try {
    return parseBinaryPlist(data);
  } catch {
    return undefined;
  }
}

export function isPlistDictionary(value: unknown): value is { [key: string]: PlistValue } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof Uint8Array) &&
    !(value instanceof PlistUID)
  );
}
