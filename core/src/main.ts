import { proxyAppleRequest } from "./apple/helper.ts";
import { serveApp } from "./app/serve.ts";
import { type Egress, installEgress } from "./chat/egress.ts";
import { integer, optionalValue, requireConfirmation, unsigned, value } from "./cli/args.ts";
import { codes, invalidRequest, SherpaError } from "./cli/errors.ts";
import { help } from "./cli/help.ts";
import { boundedStandardInput, utf8 } from "./cli/stdin.ts";
import { CHECKPOINT_CONFIRMATION, type CoreCommands, systemCommands } from "./commands.ts";
import { JournaledMutationError, type JournaledResult } from "./journal/journal.ts";
import * as kakaotalk from "./kakaotalk/commands.ts";
import { log } from "./log.ts";
import { parseMailMessage } from "./mail/outbound.ts";
import { SHERPA_VERSION } from "./version.ts";

type Output = string | Uint8Array | { exitCode: number };

/** What stdout carries when a command does not end with its normal output. */
interface CommandReport {
  status: string;
  error: string | null;
  operation_id?: string;
  journal_error?: string;
  remedy?: string;
}

function report(error: unknown): CommandReport {
  if (error instanceof JournaledMutationError) {
    return {
      status: error.status,
      error: error.stableCode,
      ...(error.operationID ? { operation_id: error.operationID } : {}),
      ...(error.journalFailure ? { journal_error: error.journalFailure } : {}),
    };
  }
  if (error instanceof SherpaError) {
    return {
      status: "failed",
      error: error.code,
      ...(error.remedy ? { remedy: error.remedy } : {}),
    };
  }
  return { status: "failed", error: codes.internal };
}

function sortedJSON(value: object): string {
  return JSON.stringify(value, Object.keys(value).sort());
}

/** A journaled send's output. A send that completed but was not journaled reports the journal error. */
function sendOutput(result: JournaledResult<Uint8Array>): Output {
  if (!result.journalFailure) return result.output;
  return sortedJSON({
    status: "completed",
    error: null,
    operation_id: result.operationID,
    journal_error: result.journalFailure,
  });
}

async function dispatch(
  args: readonly string[],
  commands: CoreCommands,
  egress: Egress,
): Promise<Output> {
  const [domain, command] = args;
  switch (`${domain} ${command}`) {
    case "planner request":
    case "mail request":
    case "reminder-kit request":
      return { exitCode: await proxyAppleRequest([domain!, command!]) };
    case "app serve":
      if (args.length !== 2) throw invalidRequest();
      return { exitCode: await serveApp(egress) };
    case "imessage chats":
      return commands.imessageChats(integer(args, "--limit"));
    case "imessage history":
      return commands.imessageHistory({
        chatID: unsigned(args, "--chat-id"),
        start: value(args, "--start"),
        end: value(args, "--end"),
        limit: integer(args, "--limit"),
      });
    case "imessage send": {
      const chatID = unsigned(args, "--chat-id");
      requireConfirmation(args, chatID.toString());
      const text = await boundedStandardInput();
      return sendOutput(await commands.imessageSend({ chatID, text }));
    }
    case "kakaotalk setup":
      return kakaotalk.setup(
        args.includes("--user-id-stdin") ? await boundedStandardInput(64) : null,
      );
    case "kakaotalk status":
      return commands.kakaotalkStatus();
    case "kakaotalk search":
      return commands.kakaotalkSearch(await boundedStandardInput(4096), integer(args, "--limit"));
    case "kakaotalk history":
      return commands.kakaotalkHistory(await boundedStandardInput(4096), integer(args, "--limit"));
    case "kakaotalk archive":
      return commands.kakaotalkArchive({
        since: value(args, "--since"),
        timeZone: value(args, "--time-zone"),
        limit: integer(args, "--limit"),
      });
    case "kakaotalk checkpoint":
      // Refused before standard input is read; the command checks the value again for MCP.
      requireConfirmation(args, CHECKPOINT_CONFIRMATION);
      return commands.kakaotalkCheckpoint(CHECKPOINT_CONFIRMATION, await boundedStandardInput(256));
    case "mail authorization-status":
      return commands.mailAuthorizationStatus();
    case "mail list": {
      const maxBodyBytes = integer(args, "--max-body-bytes");
      const cursor = optionalValue(args, "--cursor");
      return commands.mailList({
        from: value(args, "--from"),
        to: value(args, "--to"),
        limit: integer(args, "--limit"),
        maxBodyBytes,
        ...(cursor ? { cursor } : {}),
      });
    }
    case "mail read":
      return commands.mailRead({
        messageID: value(args, "--message-id"),
        maxBodyBytes: integer(args, "--max-body-bytes"),
      });
    case "mail send": {
      requireConfirmation(args, "SEND_MAIL");
      const message = parseMailMessage(utf8(await boundedStandardInput(1_100_000)));
      return sendOutput(await commands.mailSend({ message }));
    }
    case "operations list":
      return commands.operationsList(integer(args, "--limit"));
    default:
      throw invalidRequest();
  }
}

function writeLine(output: string | Uint8Array): void {
  const bytes = typeof output === "string" ? new TextEncoder().encode(output) : output;
  process.stdout.write(bytes);
  if (bytes.at(-1) !== 0x0a) process.stdout.write("\n");
}

export async function main(args: readonly string[], egress: Egress): Promise<number> {
  if (args.length === 1 && (args[0] === "--version" || args[0] === "version")) {
    writeLine(`sherpa ${SHERPA_VERSION}`);
    return 0;
  }
  if (args.length === 0 || (args.length === 1 && (args[0] === "--help" || args[0] === "help"))) {
    process.stdout.write(help);
    return 0;
  }
  try {
    if (args.length < 2) throw invalidRequest();
    const output = await dispatch(args, systemCommands, egress);
    if (typeof output === "object" && "exitCode" in output) return output.exitCode;
    writeLine(output);
    return 0;
  } catch (error) {
    const result = report(error);
    const kind = error instanceof Error ? error.name : typeof error;
    log.error(
      `[cli:sherpa:command-failure] status=${result.status} code=${result.error} error_type=${kind}`,
    );
    writeLine(sortedJSON(result));
    return 1;
  }
}

if (import.meta.main) {
  // Every command runs with the global fetch and WebSocket refusing (ADR-0012 "네트워크"); only
  // `app serve` takes the egress, for its chat channels.
  const egress = installEgress();
  process.exitCode = await main(process.argv.slice(2), egress);
}
