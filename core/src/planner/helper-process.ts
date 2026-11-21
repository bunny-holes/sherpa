import { resolveAppleHelper } from "../apple/helper.ts";
import { log } from "../log.ts";
import {
  commandReportSchema,
  correlates,
  PLANNER_GRACE_MS,
  PLANNER_REQUEST_LIMIT,
  PLANNER_RESPONSE_LIMIT,
  type PlannerPort,
  type PlannerReply,
  type PlannerRequest,
  requestBytes,
  requestTooLarge,
  workerResponseSchema,
} from "./port.ts";

/**
 * The planner port over the Swift helper: one `sherpa-apple planner request`
 * process per request, as the CLI has always used it. A response that is not
 * the V2 response or the command report the helper writes is a
 * protocol-boundary failure and throws.
 */
export class HelperProcessPlanner implements PlannerPort {
  constructor(private readonly helper: string = resolveAppleHelper()) {}

  async request(request: PlannerRequest, signal?: AbortSignal): Promise<PlannerReply> {
    if (requestBytes(request) > PLANNER_REQUEST_LIMIT) return requestTooLarge;
    const fields = `capability=${request.capability} operation_id=${request.operation_id}`;
    log.info(`[core:planner-helper:request] start ${fields}`);
    const child = Bun.spawn([this.helper, "planner", "request"], {
      stdin: new TextEncoder().encode(JSON.stringify(request)),
      stdout: "pipe",
      stderr: "inherit",
      env: process.env,
    });
    let timedOut = false;
    const stop = () => child.kill("SIGKILL");
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, request.deadline_ms + PLANNER_GRACE_MS);
    const abort = () => stop();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const output = await bounded(child.stdout, PLANNER_RESPONSE_LIMIT + 1024, stop);
      const exitCode = await child.exited;
      if (signal?.aborted) return { kind: "aborted" };
      if (timedOut) {
        log.warn(`[core:planner-helper:request] timeout ${fields}`);
        return { kind: "timeout" };
      }
      if (output === null) throw new Error("helper output above the response limit");
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(output));
      if (exitCode === 0) {
        const response = workerResponseSchema.parse(value);
        if (!correlates(request, response)) throw new Error("helper response does not correlate");
        log.info(`[core:planner-helper:request] success ${fields} status=${response.status}`);
        return { kind: "response", response };
      }
      const report = commandReportSchema.parse(value);
      log.warn(`[core:planner-helper:request] report ${fields} exit=${exitCode}`);
      return { kind: "report", report };
    } catch (error) {
      log.error(
        `[core:planner-helper:request] failure ${fields} error_type=${error instanceof Error ? error.name : typeof error}`,
      );
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
}

async function bounded(
  stream: ReadableStream<Uint8Array>,
  limit: number,
  onOverflow: () => void,
): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.byteLength;
    if (total > limit) {
      onOverflow();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
