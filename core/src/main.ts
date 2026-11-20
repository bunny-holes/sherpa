import { proxyAppleRequest } from "./apple/helper.ts";
import { integer, optionalValue, requireConfirmation, unsigned, value } from "./cli/args.ts";
import { codes, invalidRequest, SherpaError } from "./cli/errors.ts";
import { help } from "./cli/help.ts";
import { boundedStandardInput, utf8 } from "./cli/stdin.ts";
import * as imessage from "./imessage/commands.ts";
import { journaled, JournaledMutationError, MutationJournal } from "./journal/journal.ts";
import * as kakaotalk from "./kakaotalk/commands.ts";
import { log } from "./log.ts";
import { EnvelopeIndex } from "./mail/envelope-index.ts";
import { mailAuthorizationStatus, parseMailMessage, sendMail } from "./mail/outbound.ts";
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

/** Sends through the journal. A send that completed but was not journaled reports the journal error. */
async function journaledSend(capability: string, send: () => Promise<Uint8Array>): Promise<Output> {
  const result = await journaled(MutationJournal.openDefault(), capability, send);
  if (!result.journalFailure) return result.output;
  return sortedJSON({
    status: "completed",
    error: null,
    operation_id: result.operationID,
    journal_error: result.journalFailure,
  });
}

async function dispatch(args: readonly string[]): Promise<Output> {
  const [domain, command] = args;
  switch (`${domain} ${command}`) {
    case "planner request":
    case "mail request":
    case "reminder-kit request":
      return { exitCode: await proxyAppleRequest([domain!, command!]) };
    case "imessage chats":
      return imessage.chats(integer(args, "--limit"));
    case "imessage history":
      return imessage.history({
        chatID: unsigned(args, "--chat-id"),
        start: value(args, "--start"),
        end: value(args, "--end"),
        limit: integer(args, "--limit"),
      });
    case "imessage send": {
      const chatID = unsigned(args, "--chat-id");
      requireConfirmation(args, chatID.toString());
      const text = await boundedStandardInput();
      return journaledSend("imessage.send", () => imessage.send(chatID, text));
    }
    case "kakaotalk setup":
      return kakaotalk.setup(
        args.includes("--user-id-stdin") ? await boundedStandardInput(64) : null,
      );
    case "kakaotalk status":
      return kakaotalk.status();
    case "kakaotalk search":
      return kakaotalk.search(await boundedStandardInput(4096), integer(args, "--limit"));
    case "kakaotalk history":
      return kakaotalk.history(await boundedStandardInput(4096), integer(args, "--limit"));
    case "kakaotalk archive":
      return kakaotalk.archive({
        since: value(args, "--since"),
        timeZone: value(args, "--time-zone"),
        limit: integer(args, "--limit"),
      });
    case "kakaotalk checkpoint":
      requireConfirmation(args, "COMMIT_LOCAL_CHECKPOINT");
      return kakaotalk.commitCheckpoint(await boundedStandardInput(256));
    case "mail authorization-status":
      return mailAuthorizationStatus();
    case "mail list": {
      const maximumBodyBytes = integer(args, "--max-body-bytes");
      if (maximumBodyBytes < 0 || maximumBodyBytes > 1024 * 1024) throw invalidRequest();
      const cursor = optionalValue(args, "--cursor");
      return JSON.stringify(
        new EnvelopeIndex().list({
          from: value(args, "--from"),
          to: value(args, "--to"),
          limit: integer(args, "--limit"),
          ...(cursor ? { cursor } : {}),
        }),
      );
    }
    case "mail read":
      return JSON.stringify(
        new EnvelopeIndex().read(value(args, "--message-id"), integer(args, "--max-body-bytes")),
      );
    case "mail send": {
      requireConfirmation(args, "SEND_MAIL");
      const message = parseMailMessage(utf8(await boundedStandardInput(1_100_000)));
      return journaledSend("mail.send", () => sendMail(message));
    }
    case "operations list":
      return JSON.stringify(MutationJournal.openDefault().recent(integer(args, "--limit")));
    default:
      throw invalidRequest();
  }
}

function writeLine(output: string | Uint8Array): void {
  const bytes = typeof output === "string" ? new TextEncoder().encode(output) : output;
  process.stdout.write(bytes);
  if (bytes.at(-1) !== 0x0a) process.stdout.write("\n");
}

export async function main(args: readonly string[]): Promise<number> {
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
    const output = await dispatch(args);
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
  process.exitCode = await main(process.argv.slice(2));
}
