/**
 * Recovers the plain body of a message whose `text` column is empty from its
 * `attributedBody` blob, an NSAttributedString in NeXTSTEP typedstream form.
 * The first NSString after the header is the body; this mirrors imsg 0.21.1.
 */
const STREAMTYPED = "streamtyped";
const TYPEDSTREAM = "typedstream";

export function parseAttributedBody(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) return "";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    try {
      return new TextDecoder("utf-16le", { fatal: true, ignoreBOM: true }).decode(
        bytes.subarray(2),
      );
    } catch {
      return "";
    }
  }
  if (bytes[0] !== 4 || bytes[1] !== 11) {
    return new TextDecoder("utf-8", { ignoreBOM: true })
      .decode(bytes)
      .replace(/^[\p{Cc}\p{Cf}]+/u, "");
  }
  if (bytes.byteLength < 13) return "";
  const signature = String.fromCharCode(...bytes.subarray(2, 13));
  const littleEndian = signature === STREAMTYPED;
  if (!littleEndian && signature !== TYPEDSTREAM) return "";

  for (let index = 13; index + 1 < bytes.byteLength; index += 1) {
    if (bytes[index] === 0x01 && bytes[index + 1] === 0x2b) {
      return decodeString(bytes, index + 2, littleEndian) ?? "";
    }
  }
  return "";
}

function decodeString(bytes: Uint8Array, index: number, littleEndian: boolean): string | null {
  if (index >= bytes.byteLength) return null;
  const head = bytes[index]!;
  let bodyStart = index + 1;
  let length = 0;
  if (head === 0x81 || head === 0x82) {
    const width = head === 0x81 ? 2 : 4;
    if (width > bytes.byteLength - bodyStart) return null;
    for (let offset = 0; offset < width; offset += 1) {
      const shift = (littleEndian ? offset : width - 1 - offset) * 8;
      length += bytes[bodyStart + offset]! * 2 ** shift;
    }
    bodyStart += width;
  } else {
    if (head >= 0x80 && head <= 0x91) return null;
    length = head;
  }
  if (length > bytes.byteLength - bodyStart) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes.subarray(bodyStart, bodyStart + length),
    );
  } catch {
    return null;
  }
}
