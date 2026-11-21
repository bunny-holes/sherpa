import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { type CoreCommands, systemCommands } from "../commands.ts";
import { log } from "../log.ts";
import { type ResolvedTool, resolveTools } from "../mcp/tools.ts";
import { type DiscoveryBasis, discoveryResultSchema, reconcile } from "../mcp/registry.ts";
import { activeCalls, createSherpaServer } from "../mcp/server.ts";
import { newOperationID, type PlannerPort, plannerRequest } from "../planner/port.ts";
import { SHERPA_VERSION } from "../version.ts";
import { MuxChannelTransport } from "./channel-transport.ts";
import { ControlChannelConfirmations, ControlChannelPlanner } from "./control.ts";
import { AppConnection, EXIT_INTERNAL, type FrameSink, type MuxChannel } from "./mux.ts";

/** How long a new session waits for capability discovery (§10.1). */
export const DISCOVERY_WAIT_MS = 5_000;
/** How long EOF shutdown lets running calls finish before exiting (§7.10 allows 5 s). */
const SHUTDOWN_GRACE_MS = 4_000;

/**
 * The tool list of the process: settled once, by the discovery answer or by
 * the first session that waited 5 s for it, and never changed afterwards.
 */
export class ToolBasis {
  private basis: DiscoveryBasis | null = null;
  private tools: ResolvedTool[] | null = null;
  private readonly waiters: ((basis: DiscoveryBasis) => void)[] = [];
  private readonly abandon = new AbortController();

  constructor(
    private readonly build: (basis: DiscoveryBasis) => ResolvedTool[],
    private readonly waitMs = DISCOVERY_WAIT_MS,
  ) {}

  /** Asks the planner for its capability descriptors (§7.5 step 4). */
  discover(planner: PlannerPort): void {
    const request = plannerRequest(
      "capabilities",
      { schema: "sherpa.planner.capabilities.request.v2" },
      { effect: "read", required_evidence: "none", artifact_directory: null },
      newOperationID(),
    );
    log.info(`[core:registry:discovery] start operation_id=${request.operation_id}`);
    planner
      .request(request, this.abandon.signal)
      .then((reply) => {
        if (reply.kind === "aborted") return;
        if (reply.kind !== "response") return this.settle({ kind: "failed", reason: reply.kind });
        if (reply.response.status !== "succeeded") {
          return this.settle({
            kind: "failed",
            reason: reply.response.error?.code ?? reply.response.status,
          });
        }
        const result = discoveryResultSchema.safeParse(reply.response.result);
        this.settle(
          result.success
            ? { kind: "discovered", descriptors: result.data.capabilities }
            : { kind: "failed", reason: "result_shape" },
        );
      })
      .catch((error: unknown) => {
        log.error(
          `[core:registry:discovery] failure error_type=${error instanceof Error ? error.name : typeof error}`,
        );
        this.settle({ kind: "failed", reason: "internal" });
      });
  }

  fail(reason: string): void {
    this.settle({ kind: "failed", reason });
  }

  /** The tools, after at most `waitMs`; an unanswered discovery then fails for the whole process. */
  async resolved(): Promise<ResolvedTool[]> {
    if (!this.tools) {
      const basis =
        this.basis ??
        (await new Promise<DiscoveryBasis>((resolve) => {
          const timer = setTimeout(
            () => this.settle({ kind: "failed", reason: "discovery_timeout" }),
            this.waitMs,
          );
          this.waiters.push((settled) => {
            clearTimeout(timer);
            resolve(settled);
          });
        }));
      this.tools ??= this.build(basis);
    }
    return this.tools;
  }

  private settle(basis: DiscoveryBasis): void {
    if (this.basis) {
      log.warn(`[core:registry:discovery] late kind=${basis.kind}`);
      return;
    }
    this.basis = basis;
    if (basis.kind === "failed") {
      log.error(`[core:registry:discovery] failure reason=${basis.reason}`);
      this.abandon.abort();
    } else {
      log.info(`[core:registry:discovery] success descriptors=${basis.descriptors.length}`);
    }
    for (const waiter of this.waiters.splice(0)) waiter(basis);
  }
}

export interface ServeOptions {
  input: AsyncIterable<Uint8Array>;
  output: FrameSink;
  commands?: CoreCommands;
  discoveryWaitMs?: number;
}

/** Runs one app connection, one MCP connection per channel, until EOF (0) or a violation (65). */
export async function serveConnection(options: ServeOptions): Promise<number> {
  let connection: AppConnection;
  const planner: PlannerPort = {
    request: (request, signal) =>
      new ControlChannelPlanner(connection.control).request(request, signal),
  };
  const basis = new ToolBasis(
    (settled) =>
      resolveTools(reconcile(settled), {
        planner,
        confirmations: new ControlChannelConfirmations(connection.control),
        commands: options.commands ?? systemCommands,
      }),
    options.discoveryWaitMs,
  );
  connection = new AppConnection({
    version: SHERPA_VERSION,
    input: options.input,
    output: options.output,
    handlers: {
      ready(hello) {
        if (hello.workers.includes("planner")) basis.discover(planner);
        else basis.fail("planner_worker_missing");
      },
      open: (channel: MuxChannel) => {
        const transport = new MuxChannelTransport(channel);
        serveStdio(
          async () =>
            createSherpaServer(await basis.resolved(), {
              version: SHERPA_VERSION,
              channel: channel.id,
              session: transport.signal,
            }),
          {
            transport,
            // Protocol revision 2026-07-28 only (ADR-0011, §10.1): a 2025-era `initialize` or
            // envelope-less request gets -32022 naming 2026-07-28, and the connection stays open.
            legacy: "reject",
            onerror: (error) =>
              log.warn(`[core:mcp:session] error channel=${channel.id} error_type=${error.name}`),
          },
        );
      },
    },
  });
  const code = await connection.run();
  if (activeCalls.size > 0) {
    log.info(`[core:app-serve:shutdown] waiting calls=${activeCalls.size}`);
    await Promise.race([Promise.allSettled(activeCalls), Bun.sleep(SHUTDOWN_GRACE_MS)]);
  }
  return code;
}

/**
 * `sherpa app serve` (§7.1): the long-lived core Sherpa.app starts. It reads
 * only its standard input, writes only frames to standard output and owns
 * the process, so it exits itself once the last frame is flushed.
 */
export async function serveApp(): Promise<number> {
  const exit = (code: number) => {
    process.stdout.write("", () => process.exit(code));
  };
  process.on("uncaughtException", (error) => {
    log.error(`[core:app-serve:internal] failure error_type=${error.name}`);
    process.exit(EXIT_INTERNAL);
  });
  process.on("unhandledRejection", (error) => {
    log.error(
      `[core:app-serve:internal] failure error_type=${error instanceof Error ? error.name : typeof error}`,
    );
    process.exit(EXIT_INTERNAL);
  });
  process.stdout.on("error", (error) => {
    log.error(`[core:app-serve:stdout] failure error_type=${error.name}`);
    process.exit(EXIT_INTERNAL);
  });
  log.info(`[core:app-serve:start] version=${SHERPA_VERSION}`);
  let code: number;
  try {
    code = await serveConnection({ input: Bun.stdin.stream(), output: process.stdout });
  } catch (error) {
    log.error(
      `[core:app-serve:internal] failure error_type=${error instanceof Error ? error.name : typeof error}`,
    );
    code = EXIT_INTERNAL;
  }
  log.info(`[core:app-serve:exit] code=${code}`);
  exit(code);
  return code;
}
