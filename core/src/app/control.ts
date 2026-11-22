import { z } from "zod";
import { log } from "../log.ts";
import {
  type ConfirmationDecision,
  type ConfirmationPort,
  type ConfirmationPrompt,
  boundedPrompt,
} from "../mcp/confirmation.ts";
import {
  commandReportSchema,
  correlates,
  PLANNER_GRACE_MS,
  PLANNER_REQUEST_LIMIT,
  type PlannerPort,
  type PlannerReply,
  type PlannerRequest,
  requestBytes,
  requestTooLarge,
  workerResponseSchema,
} from "../planner/port.ts";
import { FrameViolation } from "./frame.ts";

/** Writes one control frame (`0\t<type>\t<body>`). */
export type ControlWriter = (type: string, body: string) => Promise<void>;

export interface ControlTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemTimers: ControlTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const responseBody = z.union([
  z.strictObject({ id: z.number().int().positive(), response: z.unknown() }),
  z.strictObject({ id: z.number().int().positive(), report: z.unknown() }),
]);
const confirmationBody = z.strictObject({
  id: z.number().int().positive(),
  decision: z.enum(["approved", "declined", "unavailable"]),
});

interface PendingRequest {
  request: PlannerRequest;
  settle(reply: PlannerReply): void;
}

interface PendingConfirmation {
  settle(decision: ConfirmationDecision): void;
}

/**
 * Channel 0 after the handshake (§8, §9): app work requests correlated by id,
 * and confirmation requests with their withdrawal. Requests and confirmations
 * share one id counter that never repeats within the process.
 */
export class ControlChannel {
  private nextID = 1;
  private readonly requests = new Map<number, PendingRequest>();
  private readonly confirmations = new Map<number, PendingConfirmation>();

  constructor(
    private readonly write: ControlWriter,
    private readonly options: { timers?: ControlTimers } = {},
  ) {}

  private get timers(): ControlTimers {
    return this.options.timers ?? systemTimers;
  }

  /** Sends one work request and waits `deadline_ms` + 5 s for its response. */
  request(worker: "planner", request: PlannerRequest, signal?: AbortSignal): Promise<PlannerReply> {
    if (requestBytes(request) > PLANNER_REQUEST_LIMIT) return Promise.resolve(requestTooLarge);
    if (signal?.aborted) return Promise.resolve({ kind: "aborted" });
    const id = this.nextID++;
    const fields = `id=${id} capability=${request.capability} operation_id=${request.operation_id}`;
    return new Promise<PlannerReply>((resolve) => {
      const timer = this.timers.setTimeout(() => {
        log.warn(`[core:control:request] timeout ${fields}`);
        finish({ kind: "timeout" });
      }, request.deadline_ms + PLANNER_GRACE_MS);
      const abort = () => {
        log.info(`[core:control:request] abandoned ${fields}`);
        finish({ kind: "aborted" });
      };
      const finish = (reply: PlannerReply) => {
        if (!this.requests.delete(id)) return;
        this.timers.clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        resolve(reply);
      };
      this.requests.set(id, { request, settle: finish });
      signal?.addEventListener("abort", abort, { once: true });
      log.info(`[core:control:request] start ${fields}`);
      this.write("request", JSON.stringify({ id, worker, request })).catch((error: unknown) => {
        log.error(`[core:control:request] write_failure ${fields} error_type=${errorType(error)}`);
      });
    });
  }

  /** Asks the app to confirm within `timeoutMs`; withdraws on timeout or abort. */
  confirm(
    prompt: ConfirmationPrompt,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<ConfirmationDecision> {
    if (signal.aborted) return Promise.resolve("withdrawn");
    const id = this.nextID++;
    const fields = `id=${id} channel=${prompt.channel} tool=${prompt.tool} operation_id=${prompt.operation_id}`;
    const bounded = boundedPrompt(prompt);
    return new Promise<ConfirmationDecision>((resolve) => {
      const withdraw = (decision: "timed_out" | "withdrawn") => {
        if (!this.confirmations.has(id)) return;
        log.info(`[core:control:confirm] withdraw ${fields} decision=${decision}`);
        this.write("withdraw", JSON.stringify({ id })).catch((error: unknown) => {
          log.error(
            `[core:control:withdraw] write_failure ${fields} error_type=${errorType(error)}`,
          );
        });
        finish(decision);
      };
      const timer = this.timers.setTimeout(() => withdraw("timed_out"), timeoutMs);
      const abort = () => withdraw("withdrawn");
      const finish = (decision: ConfirmationDecision) => {
        if (!this.confirmations.delete(id)) return;
        this.timers.clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        resolve(decision);
      };
      this.confirmations.set(id, { settle: finish });
      signal.addEventListener("abort", abort, { once: true });
      log.info(`[core:control:confirm] start ${fields}`);
      const body = JSON.stringify({
        id,
        tool: bounded.tool,
        operation_id: bounded.operation_id,
        channel: bounded.channel,
        client: bounded.client,
        title: bounded.title,
        lines: bounded.lines,
        timeout_ms: timeoutMs,
      });
      this.write("confirm", body).catch((error: unknown) => {
        log.error(`[core:control:confirm] write_failure ${fields} error_type=${errorType(error)}`);
      });
    });
  }

  /** A `response` frame body. Shape or correlation errors are protocol-boundary failures (§11). */
  onResponse(value: unknown): void {
    const parsed = responseBody.safeParse(value);
    if (!parsed.success) throw new FrameViolation("mux.frame_invalid", "response_body");
    const { id } = parsed.data;
    const pending = this.requests.get(id);
    if (!pending) {
      log.warn(`[core:control:response] late id=${id}`);
      return;
    }
    if ("response" in parsed.data) {
      const response = workerResponseSchema.safeParse(parsed.data.response);
      if (!response.success || !correlates(pending.request, response.data)) {
        throw new FrameViolation("mux.frame_invalid", "response_v2");
      }
      log.info(
        `[core:control:response] success id=${id} capability=${response.data.capability} status=${response.data.status}`,
      );
      pending.settle({ kind: "response", response: response.data });
      return;
    }
    const report = commandReportSchema.safeParse(parsed.data.report);
    if (!report.success) throw new FrameViolation("mux.frame_invalid", "response_report");
    log.warn(`[core:control:response] report id=${id} status=${report.data.status}`);
    pending.settle({ kind: "report", report: report.data });
  }

  /** A `confirmation` frame body. An answer after withdrawal is dropped. */
  onConfirmation(value: unknown): void {
    const parsed = confirmationBody.safeParse(value);
    if (!parsed.success) throw new FrameViolation("mux.frame_invalid", "confirmation_body");
    const { id, decision } = parsed.data;
    const pending = this.confirmations.get(id);
    if (!pending) {
      log.warn(`[core:control:confirmation] late id=${id} decision=${decision}`);
      return;
    }
    log.info(`[core:control:confirmation] success id=${id} decision=${decision}`);
    pending.settle(decision);
  }

  /** Ends every wait at shutdown; nothing is executed afterwards. */
  closeAll(): void {
    for (const pending of this.requests.values()) pending.settle({ kind: "aborted" });
    for (const pending of this.confirmations.values()) pending.settle("withdrawn");
  }
}

/** The planner port of `sherpa app serve`: the control channel (§8). */
export class ControlChannelPlanner implements PlannerPort {
  constructor(private readonly control: ControlChannel) {}

  request(request: PlannerRequest, signal?: AbortSignal): Promise<PlannerReply> {
    return this.control.request("planner", request, signal);
  }
}

/** The confirmation port of `sherpa app serve`: the control channel (§9). */
export class ControlChannelConfirmations implements ConfirmationPort {
  constructor(private readonly control: ControlChannel) {}

  confirm(
    prompt: ConfirmationPrompt,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<ConfirmationDecision> {
    return this.control.confirm(prompt, signal, timeoutMs);
  }
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
