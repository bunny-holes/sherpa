/**
 * Minimal reader for Apple binary property lists (`bplist00`), the format of
 * chat.db `attachment.user_info`, `message.payload_data` and keyed archives.
 * It returns plain values: strings, numbers (bigint beyond 2^53), booleans,
 * null, `Uint8Array` for data, `PlistDate`, `PlistUID`, arrays and string-keyed
 * objects. Malformed input throws; callers treat that as "no value".
 */
export class PlistUID {
  constructor(readonly value: number) {}
}

export class PlistDate {
  /** Seconds since 2001-01-01T00:00:00Z. */
  constructor(readonly referenceSeconds: number) {}
}

export type PlistValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | Uint8Array
  | PlistDate
  | PlistUID
  | PlistValue[]
  | { [key: string]: PlistValue };

const MAGIC = "bplist00";
const MAX_DEPTH = 64;

export function isBinaryPlist(data: Uint8Array): boolean {
  if (data.byteLength < MAGIC.length + 32) return false;
  for (let index = 0; index < MAGIC.length; index += 1) {
    if (data[index] !== MAGIC.charCodeAt(index)) return false;
  }
  return true;
}

export function parseBinaryPlist(data: Uint8Array): PlistValue {
  if (!isBinaryPlist(data)) throw new Error("not a binary plist");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const trailer = data.byteLength - 32;
  const offsetSize = data[trailer + 6]!;
  const refSize = data[trailer + 7]!;
  const objectCount = Number(view.getBigUint64(trailer + 8));
  const topObject = Number(view.getBigUint64(trailer + 16));
  const tableOffset = Number(view.getBigUint64(trailer + 24));
  if (offsetSize < 1 || offsetSize > 8 || refSize < 1 || refSize > 8)
    throw new Error("bad trailer");
  if (tableOffset + objectCount * offsetSize > trailer || topObject >= objectCount) {
    throw new Error("bad offset table");
  }

  const unsigned = (at: number, width: number): number => {
    if (at + width > data.byteLength) throw new Error("truncated");
    let value = 0;
    for (let index = 0; index < width; index += 1) value = value * 256 + data[at + index]!;
    return value;
  };
  const objectOffset = (ref: number): number => {
    if (ref >= objectCount) throw new Error("bad reference");
    return unsigned(tableOffset + ref * offsetSize, offsetSize);
  };

  const active = new Set<number>();

  /** Reads a length that may follow a marker nibble of 0xF as an integer object. */
  const length = (at: number, nibble: number): [count: number, start: number] => {
    if (nibble !== 0x0f) return [nibble, at + 1];
    const marker = data[at + 1]!;
    if (marker >> 4 !== 0x1) throw new Error("bad length");
    const width = 1 << (marker & 0x0f);
    return [unsigned(at + 2, width), at + 2 + width];
  };

  const read = (ref: number, depth: number): PlistValue => {
    if (depth > MAX_DEPTH || active.has(ref)) throw new Error("cyclic plist");
    active.add(ref);
    try {
      return readAt(objectOffset(ref), depth);
    } finally {
      active.delete(ref);
    }
  };

  const readAt = (at: number, depth: number): PlistValue => {
    if (at >= trailer) throw new Error("bad object offset");
    const marker = data[at]!;
    const high = marker >> 4;
    const low = marker & 0x0f;
    switch (high) {
      case 0x0:
        if (marker === 0x00) return null;
        if (marker === 0x08) return false;
        if (marker === 0x09) return true;
        throw new Error("unsupported singleton");
      case 0x1: {
        const width = 1 << low;
        if (at + 1 + width > data.byteLength) throw new Error("truncated");
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
        throw new Error("bad integer width");
      }
      case 0x2:
        if (low === 2) return view.getFloat32(at + 1);
        if (low === 3) return view.getFloat64(at + 1);
        throw new Error("bad real width");
      case 0x3:
        if (marker !== 0x33) throw new Error("bad date");
        return new PlistDate(view.getFloat64(at + 1));
      case 0x4: {
        const [count, start] = length(at, low);
        if (start + count > data.byteLength) throw new Error("truncated");
        return data.slice(start, start + count);
      }
      case 0x5: {
        const [count, start] = length(at, low);
        if (start + count > data.byteLength) throw new Error("truncated");
        return new TextDecoder("latin1").decode(data.subarray(start, start + count));
      }
      case 0x6: {
        const [count, start] = length(at, low);
        if (start + count * 2 > data.byteLength) throw new Error("truncated");
        let text = "";
        for (let index = 0; index < count; index += 1) {
          text += String.fromCharCode(view.getUint16(start + index * 2));
        }
        return text;
      }
      case 0x7: {
        const [count, start] = length(at, low);
        if (start + count > data.byteLength) throw new Error("truncated");
        return new TextDecoder("utf-8").decode(data.subarray(start, start + count));
      }
      case 0x8:
        return new PlistUID(unsigned(at + 1, low + 1));
      case 0xa:
      case 0xc: {
        const [count, start] = length(at, low);
        const values: PlistValue[] = [];
        for (let index = 0; index < count; index += 1) {
          values.push(read(unsigned(start + index * refSize, refSize), depth + 1));
        }
        return values;
      }
      case 0xd: {
        const [count, start] = length(at, low);
        const result: { [key: string]: PlistValue } = {};
        for (let index = 0; index < count; index += 1) {
          const key = read(unsigned(start + index * refSize, refSize), depth + 1);
          const value = read(unsigned(start + (count + index) * refSize, refSize), depth + 1);
          if (typeof key === "string") result[key] = value;
        }
        return result;
      }
      default:
        throw new Error("unsupported object type");
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
    !(value instanceof Uint8Array) &&
    !(value instanceof PlistDate) &&
    !(value instanceof PlistUID)
  );
}
