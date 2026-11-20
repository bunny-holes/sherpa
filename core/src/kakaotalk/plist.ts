import { codes, SherpaError } from "../cli/errors.ts";
import { runCommand } from "../process/runner.ts";

export type PlistValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | Date
  | Uint8Array
  | PlistValue[]
  | { [key: string]: PlistValue };

const binaryMagic = "bplist00";

/**
 * Reads a property list file without launching the app that owns it. A binary
 * plist is parsed in process; any other format is first converted to binary by
 * `plutil`, because `plutil -convert json` rejects the data and date values that
 * KakaoTalk preferences contain.
 */
export async function readPlistFile(path: string): Promise<PlistValue> {
  const bytes = await Bun.file(path).bytes();
  if (new TextDecoder("latin1").decode(bytes.subarray(0, 8)) === binaryMagic)
    return parseBinaryPlist(bytes);
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

/** Parses an Apple binary property list (`bplist00`). */
export function parseBinaryPlist(data: Uint8Array): PlistValue {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (
    data.byteLength < 40 ||
    new TextDecoder("latin1").decode(data.subarray(0, 8)) !== binaryMagic
  ) {
    throw new SherpaError(codes.failed);
  }
  const trailer = data.byteLength - 32;
  const offsetSize = view.getUint8(trailer + 6);
  const referenceSize = view.getUint8(trailer + 7);
  const objectCount = Number(view.getBigUint64(trailer + 8));
  const topObject = Number(view.getBigUint64(trailer + 16));
  const offsetTable = Number(view.getBigUint64(trailer + 24));
  if (offsetTable + objectCount * offsetSize > trailer || topObject >= objectCount) {
    throw new SherpaError(codes.failed);
  }

  const readUnsigned = (offset: number, size: number): number => {
    if (offset + size > data.byteLength) throw new SherpaError(codes.failed);
    let result = 0;
    for (let index = 0; index < size; index++) result = result * 256 + data[offset + index]!;
    return result;
  };
  const objectOffset = (reference: number): number => {
    if (reference >= objectCount) throw new SherpaError(codes.failed);
    return readUnsigned(offsetTable + reference * offsetSize, offsetSize);
  };

  const parseObject = (reference: number, depth: number): PlistValue => {
    if (depth > 64) throw new SherpaError(codes.failed);
    const offset = objectOffset(reference);
    const marker = data[offset];
    if (marker === undefined) throw new SherpaError(codes.failed);
    const kind = marker >> 4;
    const info = marker & 0x0f;

    const length = (): { count: number; start: number } => {
      if (info !== 0x0f) return { count: info, start: offset + 1 };
      const integerMarker = data[offset + 1];
      if (integerMarker === undefined || integerMarker >> 4 !== 0x1)
        throw new SherpaError(codes.failed);
      const size = 1 << (integerMarker & 0x0f);
      return { count: readUnsigned(offset + 2, size), start: offset + 2 + size };
    };
    const bounded = (start: number, byteCount: number): Uint8Array => {
      if (start + byteCount > data.byteLength) throw new SherpaError(codes.failed);
      return data.subarray(start, start + byteCount);
    };
    const references = (start: number, count: number): number[] =>
      Array.from({ length: count }, (_, index) =>
        readUnsigned(start + index * referenceSize, referenceSize),
      );

    switch (kind) {
      case 0x0:
        if (marker === 0x08) return false;
        if (marker === 0x09) return true;
        return null;
      case 0x1: {
        const size = 1 << info;
        if (offset + 1 + size > data.byteLength) throw new SherpaError(codes.failed);
        if (size <= 4) return readUnsigned(offset + 1, size);
        if (size === 8) {
          const value = view.getBigInt64(offset + 1);
          return value >= BigInt(Number.MIN_SAFE_INTEGER) &&
            value <= BigInt(Number.MAX_SAFE_INTEGER)
            ? Number(value)
            : value;
        }
        if (size === 16) return view.getBigUint64(offset + 9);
        throw new SherpaError(codes.failed);
      }
      case 0x2: {
        if (info !== 2 && info !== 3) throw new SherpaError(codes.failed);
        bounded(offset + 1, 1 << info);
        return info === 2 ? view.getFloat32(offset + 1) : view.getFloat64(offset + 1);
      }
      case 0x3:
        bounded(offset + 1, 8);
        return new Date((view.getFloat64(offset + 1) + 978_307_200) * 1000);
      case 0x4: {
        const { count, start } = length();
        return bounded(start, count).slice();
      }
      case 0x5: {
        const { count, start } = length();
        return new TextDecoder("latin1").decode(bounded(start, count));
      }
      case 0x6: {
        const { count, start } = length();
        const bytes = bounded(start, count * 2);
        let text = "";
        for (let index = 0; index < count; index++) {
          text += String.fromCharCode((bytes[index * 2]! << 8) | bytes[index * 2 + 1]!);
        }
        return text;
      }
      case 0x7: {
        const { count, start } = length();
        return new TextDecoder("utf-8").decode(bounded(start, count));
      }
      case 0x8:
        return readUnsigned(offset + 1, info + 1);
      case 0xa:
      case 0xc: {
        const { count, start } = length();
        bounded(start, count * referenceSize);
        return references(start, count).map((child) => parseObject(child, depth + 1));
      }
      case 0xd: {
        const { count, start } = length();
        bounded(start, count * 2 * referenceSize);
        const keys = references(start, count);
        const values = references(start + count * referenceSize, count);
        const result: { [key: string]: PlistValue } = Object.create(null) as {
          [key: string]: PlistValue;
        };
        keys.forEach((keyReference, index) => {
          const key = parseObject(keyReference, depth + 1);
          if (typeof key !== "string") throw new SherpaError(codes.failed);
          result[key] = parseObject(values[index]!, depth + 1);
        });
        return result;
      }
      default:
        throw new SherpaError(codes.failed);
    }
  };

  return parseObject(topObject, 0);
}

export function isDictionary(value: PlistValue): value is { [key: string]: PlistValue } {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof Uint8Array)
  );
}
