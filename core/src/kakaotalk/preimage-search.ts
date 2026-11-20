import { availableParallelism } from "node:os";
import { codes, SherpaError } from "../cli/errors.ts";
import { log } from "../log.ts";

/**
 * Parallel SHA-512 pre-image search over increasing positive integers. KakaoTalk
 * keeps only SHA-512(decimal user id) in its preferences, so the id is recovered
 * by hashing candidates until one matches. Workers run on every core and take
 * fixed-size ranges from a shared cursor; the search stops at the first match or
 * when the time budget runs out. Logs carry rate and progress only.
 */

export interface PreimageSearchOptions {
  budgetMs: number;
  workers?: number;
  /** First candidate (inclusive). */
  start?: number;
  /** Candidates per work item. */
  chunk?: number;
  progressIntervalMs?: number;
}

export interface PreimageSearchResult {
  userId: string | null;
  candidates: number;
  elapsedMs: number;
  workers: number;
  candidatesPerSecond: number;
  exhaustedBudget: boolean;
}

type WorkerReply = { type: "done"; start: number; end: number; found: string | null };

/**
 * Worker body. It runs from a Blob URL so a compiled single-file binary needs no
 * extra entry point, which is why it must not reference anything outside itself.
 */
function preimageWorker(): void {
  const scope = globalThis as unknown as {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage(message: unknown): void;
  };
  let targets: Uint8Array[] = [];
  const digest = new Uint8Array(64);
  const digits = new Uint8Array(24);
  scope.onmessage = (event: MessageEvent) => {
    const message = event.data as
      | { type: "targets"; targets: Uint8Array[] }
      | { type: "range"; start: number; end: number };
    if (message.type === "targets") {
      targets = message.targets;
      return;
    }
    const startText = String(message.start);
    let length = startText.length;
    for (let index = 0; index < length; index++) digits[index] = startText.charCodeAt(index);
    let view = digits.subarray(0, length);
    let found: string | null = null;
    const count = message.end - message.start;
    for (let step = 0; step < count; step++) {
      Bun.SHA512.hash(view, digest);
      for (const target of targets) {
        if (
          digest[0] !== target[0] ||
          digest[1] !== target[1] ||
          digest[2] !== target[2] ||
          digest[3] !== target[3]
        ) {
          continue;
        }
        let equal = true;
        for (let index = 4; index < 64; index++) {
          if (digest[index] !== target[index]) {
            equal = false;
            break;
          }
        }
        if (equal) found = String(message.start + step);
      }
      if (found !== null) break;
      let position = length - 1;
      while (position >= 0 && digits[position] === 0x39) {
        digits[position] = 0x30;
        position--;
      }
      if (position < 0) {
        digits.copyWithin(1, 0, length);
        digits[0] = 0x31;
        length++;
        view = digits.subarray(0, length);
      } else {
        digits[position]!++;
      }
    }
    scope.postMessage({ type: "done", start: message.start, end: message.end, found });
  };
}

let workerURL: string | null = null;
function preimageWorkerURL(): string {
  workerURL ??= URL.createObjectURL(
    new Blob([`(${preimageWorker.toString()})();`], { type: "application/javascript" }),
  );
  return workerURL;
}

export async function searchPreimage(
  targetHashes: readonly string[],
  options: PreimageSearchOptions,
): Promise<PreimageSearchResult> {
  const targets = targetHashes.map((hash) => {
    if (!/^[0-9a-f]{128}$/.test(hash)) throw new SherpaError(codes.invalidRequest);
    return Uint8Array.from(Buffer.from(hash, "hex"));
  });
  if (targets.length === 0) throw new SherpaError(codes.invalidRequest);
  const workerCount = Math.max(1, options.workers ?? availableParallelism());
  const chunk = options.chunk ?? 1_000_000;
  const progressInterval = options.progressIntervalMs ?? 10_000;
  const startedAt = performance.now();
  let cursor = Math.max(1, options.start ?? 1);
  let searched = 0;
  let lastProgress = startedAt;

  log.info(
    `[adapter:kakaotalk:setup-search-start] workers=${workerCount} budget_s=${Math.round(options.budgetMs / 1000)}`,
  );

  const workers: Worker[] = [];
  const result = await new Promise<{ userId: string | null; exhaustedBudget: boolean }>(
    (resolve, reject) => {
      let settled = false;
      let active = 0;
      const finish = (value: { userId: string | null; exhaustedBudget: boolean }) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const dispatch = (worker: Worker) => {
        const now = performance.now();
        if (now - startedAt >= options.budgetMs || cursor >= Number.MAX_SAFE_INTEGER - chunk) {
          active--;
          if (active === 0) finish({ userId: null, exhaustedBudget: true });
          return;
        }
        const start = cursor;
        cursor += chunk;
        worker.postMessage({ type: "range", start, end: start + chunk });
      };
      for (let index = 0; index < workerCount; index++) {
        const worker = new Worker(preimageWorkerURL());
        workers.push(worker);
        worker.onmessage = (event: MessageEvent<WorkerReply>) => {
          if (settled) return;
          const reply = event.data;
          searched += reply.end - reply.start;
          if (reply.found !== null) {
            finish({ userId: reply.found, exhaustedBudget: false });
            return;
          }
          const now = performance.now();
          if (now - lastProgress >= progressInterval) {
            lastProgress = now;
            const seconds = (now - startedAt) / 1000;
            log.info(
              `[adapter:kakaotalk:setup-search-progress] elapsed_s=${Math.round(seconds)} candidates_per_second=${Math.round(searched / seconds)}`,
            );
          }
          dispatch(worker);
        };
        worker.onerror = (event) => {
          if (settled) return;
          settled = true;
          log.error(`[adapter:kakaotalk:setup-search-failure] error_type=${event.type}`);
          reject(new SherpaError(codes.failed));
        };
        worker.postMessage({ type: "targets", targets });
        active++;
        dispatch(worker);
      }
    },
  ).finally(() => {
    for (const worker of workers) worker.terminate();
  });

  const elapsedMs = performance.now() - startedAt;
  const candidatesPerSecond = Math.round(searched / Math.max(elapsedMs / 1000, 0.001));
  log.info(
    `[adapter:kakaotalk:setup-search-end] found=${result.userId !== null} elapsed_s=${Math.round(elapsedMs / 1000)} candidates_per_second=${candidatesPerSecond}`,
  );
  return {
    userId: result.userId,
    candidates: searched,
    elapsedMs: Math.round(elapsedMs),
    workers: workerCount,
    candidatesPerSecond,
    exhaustedBudget: result.exhaustedBudget,
  };
}
