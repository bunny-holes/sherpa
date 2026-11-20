import { codes, SherpaError } from "../cli/errors.ts";
import { runCommand, type RunOptions } from "../process/runner.ts";

/**
 * Sends one text to an existing Messages chat through Messages.app automation.
 * The chat guid and the text travel on standard input, never in argv, so other
 * processes cannot read them from the process table. The script reports
 * whether it failed before dispatch (nothing sent) or after it started
 * (outcome unknown); Messages gives no delivery proof, so success is only
 * "the application accepted the send".
 */
export const OSASCRIPT = "/usr/bin/osascript";

export const SEND_SCRIPT = `ObjC.import("Foundation");
function run() {
  var phase = "not_started";
  try {
    var data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
    var input = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding));
    if (typeof input !== "string") throw new Error("input");
    var split = input.indexOf("\\n");
    if (split < 1) throw new Error("input");
    var guid = input.slice(0, split);
    var text = input.slice(split + 1);
    var messages = Application("Messages");
    var chat = messages.chats.byId(guid);
    chat.id();
    phase = "may_have_completed";
    messages.send(text, { to: chat });
    return "SHERPA_RESULT\\tok\\t0";
  } catch (error) {
    var number = error && typeof error.errorNumber === "number" ? error.errorNumber : 0;
    return "SHERPA_RESULT\\t" + phase + "\\t" + String(number);
  }
}`;

export type Runner = (
  executable: string,
  args: readonly string[],
  options: RunOptions,
) => Promise<{ stdout: Uint8Array }>;

export interface SendResult {
  status: "application_accepted";
}

export async function sendToChat(
  guid: string,
  text: string,
  options: { executable?: string; run?: Runner; timeoutMs?: number } = {},
): Promise<SendResult> {
  const run = options.run ?? runCommand;
  const stdin = new TextEncoder().encode(`${guid}\n${text}`);
  const { stdout } = await run(
    options.executable ?? OSASCRIPT,
    ["-l", "JavaScript", "-e", SEND_SCRIPT],
    {
      stdin,
      timeoutMs: options.timeoutMs ?? 60_000,
      outputLimit: 64 * 1024,
      effect: "mutation",
    },
  );
  const fields = new TextDecoder().decode(stdout).trim().split("\t");
  if (fields.length === 3 && fields[0] === "SHERPA_RESULT") {
    if (fields[1] === "ok") return { status: "application_accepted" };
    if (fields[1] === "not_started") {
      throw new SherpaError("imessage.send_not_started", {
        remedy:
          "allow the app that runs sherpa to control Messages (System Settings > Privacy & Security > Automation) and keep Messages signed in",
      });
    }
  }
  // Dispatch started, or the script's answer is unreadable: the message may have gone out.
  throw new SherpaError(codes.uncertain, { mayHaveApplied: true });
}
