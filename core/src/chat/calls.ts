/**
 * The tool calls of one chat turn (app-connection-v1 §7.11, ADR-0012 "도구", "중단"). Each runs
 * through the shared lifecycle with the chat's channel, its client and the chat's result limit,
 * and the app hears of it twice in a `tool` message, when it starts and when it ends. A cancel
 * while a step's calls run withdraws the call that has changed nothing, cuts a read and starts no
 * later call; a call that has asked for a change runs to its end, so that the model and the person
 * learn what it did. A call that never ran, one the model formed badly or one the AI SDK did not
 * run, reaches the app as a pair of its own. Each result counts against the conversation's limit,
 * and a call whose result could pass it does not run (§7.11 "대화 한도").
 */
import { log } from "../log.ts";
import { type ModelTool, runToolCall } from "../tools/call.ts";
import {
  effectKindOf,
  type FittedOutcome,
  outcome,
  type Retry,
  type ToolOutcome,
} from "../tools/outcome.ts";
import { SHERPA_VERSION } from "../version.ts";
import type { TurnRoom } from "./conversation.ts";
import type { PendingChange } from "./pending.ts";
import { type ChatEvent, chatLimits, type ToolStatus } from "./protocol.ts";
import type { TurnTools } from "./sdk/turn.ts";

/**
 * Who asks for a confirmation (§9), self-reported as an MCP client's name is: the app tells the
 * chat by the channel a `confirm` names, never by this.
 */
const CLIENT = { name: "sherpa-chat", version: SHERPA_VERSION };

/** A call the person's cancel took back before it changed anything. */
const CANCELLED = "chat.cancelled";
/** A call the model formed badly: a tool the core does not have, or arguments its schema rejects. */
const INVALID = "chat.invalid_call";
/**
 * A call the AI SDK did not run: its step ended for a reason other than `stop` or `tool-calls`,
 * cut at the length limit say (ai 7.0.179 execute-tools-from-stream.ts).
 */
const NOT_RUN = "chat.not_run";
/** A call whose result could pass the conversation's limit: it did not run, nor will in this chat. */
const LIMIT = "chat.conversation_limit";

export interface CallsContext {
  channel: number;
  tools: readonly ModelTool[];
  /** What the conversation's limit leaves the turn; each call's result counts against it. */
  room: TurnRoom;
  /** The channel's next call number, from 1. */
  number(): number;
  /** Writes a `tool` message, after the answer's text that waits. */
  send(event: ChatEvent): void;
  commit(change: PendingChange): Promise<void>;
}

/** The call that runs: whether it only reads, whether it has committed, and what withdraws it. */
interface Running {
  read: boolean;
  committed: boolean;
  withdraw: AbortController;
}

/**
 * What the model reads of a call that changed nothing, under `code`. A tool the core does not have
 * has no capability and no effect.
 */
function unchanged(tool: ModelTool | undefined, code: string, retry: Retry): ToolOutcome {
  return outcome({
    status: "failed",
    capability: tool?.entry.capability ?? "unknown",
    operation_id: null,
    effect: { kind: tool ? effectKindOf(tool.entry.effectClass) : "none", state: "not_started" },
    evidence: null,
    error: { code, retry },
    result: null,
  });
}

/** A call that did not start before the turn ended, or that the person's cancel took back. */
const withdrawn = (tool: ModelTool) => unchanged(tool, CANCELLED, "after_user_action");

/** How the app reads an outcome: a refusal in the confirmation window is `declined`. */
function statusOf(result: ToolOutcome): ToolStatus {
  return result.status === "failed" && result.error?.code === "confirmation.declined"
    ? "declined"
    : result.status;
}

export class TurnCalls implements TurnTools {
  private step = false;
  private stopped = false;
  private running: Running | null = null;

  constructor(private readonly context: CallsContext) {}

  get tools(): readonly ModelTool[] {
    return this.context.tools;
  }

  /** True from a step's first call until the step ends. */
  get inStep(): boolean {
    return this.step;
  }

  get cancelled(): boolean {
    return this.stopped;
  }

  /**
   * The person cancelled while the step's calls run: the call that has not committed, or that
   * only reads, is withdrawn, no later call starts, and the turn takes no later step.
   */
  cancel(): void {
    this.stopped = true;
    const running = this.running;
    if (running && (running.read || !running.committed)) {
      running.withdraw.abort(new DOMException("The person cancelled the turn.", "AbortError"));
    }
  }

  stepEnded(): void {
    this.step = false;
  }

  async run(name: string, input: unknown, signal: AbortSignal): Promise<ToolOutcome> {
    const result = await this.outcomeOf(name, input, signal);
    // What the model reads of the call joins the conversation with its step.
    this.context.room.result(Buffer.byteLength(JSON.stringify(result)));
    return result;
  }

  /** What the model reads of one call. */
  private async outcomeOf(name: string, input: unknown, signal: AbortSignal): Promise<ToolOutcome> {
    this.step = true;
    // The AI SDK runs only the tools it was given (ai 7.0.179 execute-tools-from-stream.ts).
    const tool = this.find(name)!;
    // The turn ended before the call began: nobody reads what it would have said.
    if (signal.aborted) return withdrawn(tool);
    const id = this.context.number();
    this.tell(id, name, "started", null, null);
    if (this.stopped) {
      log.info(`[core:chat:tool-call] withdrawn channel=${this.context.channel} tool=${name}`);
      this.tell(id, name, "withdrawn", CANCELLED, null);
      return withdrawn(tool);
    }
    // Its result, as large as one may be, could pass the conversation's limit: neither this call
    // nor a later one runs, and the turn takes no later step.
    if (!this.context.room.admits()) {
      log.warn(
        `[core:chat:tool-call] refused channel=${this.context.channel} tool=${name} reason=conversation_limit`,
      );
      this.tell(id, name, "failed", LIMIT, null);
      return unchanged(tool, LIMIT, "never");
    }
    const running: Running = {
      read: tool.entry.effectClass === "read",
      committed: false,
      withdraw: new AbortController(),
    };
    this.running = running;
    let fitted: FittedOutcome | null;
    try {
      fitted = await runToolCall(
        tool,
        input,
        {
          signal: AbortSignal.any([signal, running.withdraw.signal]),
          channel: this.context.channel,
          client: CLIENT,
          committed: (operationID) => {
            running.committed = true;
            if (!running.read)
              return this.context.commit({ tool: name, operation_id: operationID });
          },
        },
        { module: "chat", limit: chatLimits.toolResultBytes },
      );
    } finally {
      this.running = null;
    }
    // The channel closed: nothing more goes out, and the outcome reaches nobody.
    if (signal.aborted) return fitted?.outcome ?? withdrawn(tool);
    // No outcome: the cancel withdrew the call before it changed anything.
    if (fitted === null) {
      this.tell(id, name, "withdrawn", CANCELLED, null);
      return withdrawn(tool);
    }
    const result = fitted.outcome;
    this.tell(id, name, statusOf(result), result.error?.code ?? null, result.operation_id);
    return result;
  }

  invalid(name: string): void {
    this.neverRan(name, "invalid", INVALID);
  }

  /**
   * What the model reads of a call the AI SDK did not run: nothing changed, and nobody stopped it,
   * so the model may call it again.
   */
  unrun(name: string): ToolOutcome {
    return unchanged(this.find(name), NOT_RUN, "safe");
  }

  notRun(name: string): void {
    this.neverRan(name, "not_run", NOT_RUN);
  }

  private find(name: string): ModelTool | undefined {
    return this.context.tools.find((item) => item.entry.name === name);
  }

  /**
   * A call that never ran: a warning, and a `tool` pair under one number, which names the tool
   * only when the core has it, since a name the model made up is its output.
   */
  private neverRan(name: string, event: string, code: string): void {
    const known = this.find(name) ? name : null;
    log.warn(
      `[core:chat:tool-call] ${event} channel=${this.context.channel} tool=${known ?? "unknown"}`,
    );
    const id = this.context.number();
    this.tell(id, known, "started", null, null);
    this.tell(id, known, "failed", code, null);
  }

  private tell(
    id: number,
    name: string | null,
    status: ToolStatus,
    code: string | null,
    operationID: string | null,
  ): void {
    this.context.send({ type: "tool", call_id: id, name, status, code, operation_id: operationID });
  }
}
