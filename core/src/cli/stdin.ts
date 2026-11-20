import { invalidRequest } from "./errors.ts";

/** Reads all of standard input, rejecting empty input and input above `maximum` bytes. */
export async function boundedStandardInput(maximum = 64 * 1024): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of Bun.stdin.stream()) {
    total += chunk.byteLength;
    if (total > maximum) throw invalidRequest();
    chunks.push(chunk);
  }
  if (total === 0) throw invalidRequest();
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

/** Strict UTF-8 decoding: malformed input is an invalid request, never replaced text. */
export function utf8(data: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw invalidRequest();
  }
}
