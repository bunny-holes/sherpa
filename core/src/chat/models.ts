/**
 * `list_models` (app-connection-v1 §7.11, ADR-0012 "비용과 모델 선택"): the provider's own list
 * on the chosen origin, page by page through the turn fetch, with every limit applied while it
 * is read.
 */
import { log } from "../log.ts";
import type { Fetch } from "./egress.ts";
import { ChatFailure, responseFailure, transportFailure } from "./errors.ts";
import { chatLimits } from "./protocol.ts";
import { LISTERS, type Provider } from "./providers.ts";

/** One provider's list: where its paths start and the key its requests carry, if any. */
export interface ModelSource {
  provider: Provider;
  /** The base URL without a trailing slash; the list path is `/models` under it. */
  base: string;
  apiKey: string | undefined;
}

export interface ModelList {
  /** The usable ids, each once, in the provider's order. */
  models: string[];
  /** The list went on past the limit of ids or of pages. */
  truncated: boolean;
  pages: number;
  /** Ids left out because the app could not show or send them back. */
  skipped: number;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

/** An id the app can show and send back: 1–256 bytes of well-formed text, no control character. */
function usable(id: unknown): id is string {
  return (
    typeof id === "string" &&
    id !== "" &&
    id.isWellFormed() &&
    !/\p{Cc}/u.test(id) &&
    Buffer.byteLength(id) <= chatLimits.modelIdBytes
  );
}

/** Runs one step on the wire; what it throws reads as a refusal or a broken connection. */
async function wire<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    throw transportFailure(error);
  }
}

/** Stops a body the core will not read on, so its connection is let go. */
function discard(body: { cancel(): Promise<void> } | null): void {
  body?.cancel().catch((error: unknown) => {
    log.debug(
      `[core:chat:list-models] discard_failure error_type=${error instanceof Error ? error.name : typeof error}`,
    );
  });
}

/** The body as JSON, given up as soon as it passes the limit. */
async function readJSON(response: Response): Promise<unknown> {
  const invalid = () => new ChatFailure("provider_invalid_response", response.status);
  const { body } = response;
  // Bun reads an encoded body out decoded but leaves `content-length` at the encoded length, so
  // only a plain body is weighed by it before it is read (§7.11).
  const declared = response.headers.has("content-encoding")
    ? 0
    : Number(response.headers.get("content-length"));
  if (!body || declared > chatLimits.responseBytes) {
    discard(body);
    throw invalid();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await wire(() => reader.read());
    if (done) break;
    bytes += value.byteLength;
    if (bytes > chatLimits.responseBytes) {
      discard(reader);
      throw invalid();
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(decoder.decode(Buffer.concat(chunks)));
  } catch {
    throw invalid();
  }
}

/**
 * Lists the models of `source` through `send`, the turn fetch of its origin. Throws a
 * `ChatFailure` for a refused request, a broken connection, a status other than 2xx, or a body
 * that passes the limit or has another shape.
 */
export async function listModels(source: ModelSource, send: Fetch): Promise<ModelList> {
  const lister = LISTERS[source.provider];
  const found = new Set<string>();
  let skipped = 0;
  let pages = 0;
  let cursor: string | null = null;
  const list = (truncated: boolean): ModelList => ({
    models: [...found],
    truncated,
    pages,
    skipped,
  });
  do {
    if (pages === chatLimits.pages) return list(true);
    const url = lister.url(source.base, cursor);
    const response = await wire(() => send(url, { headers: lister.headers(source.apiKey) }));
    pages++;
    if (!response.ok) {
      discard(response.body);
      throw responseFailure(response.status);
    }
    const page = lister.page(await readJSON(response));
    if (!page) throw new ChatFailure("provider_invalid_response", response.status);
    for (const model of page.models) {
      if (!model.keep) continue;
      if (!usable(model.id)) {
        skipped++;
        continue;
      }
      if (found.size === chatLimits.models && !found.has(model.id)) return list(true);
      found.add(model.id);
    }
    cursor = page.next;
  } while (cursor !== null);
  return list(false);
}
