import { invalidRequest } from "../cli/errors.ts";
import { runCommand } from "../process/runner.ts";

export interface MailMessage {
  sender: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
}

function validMailbox(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value) > 320 ||
    /\s/.test(value)
  ) {
    return false;
  }
  const parts = value.split("@");
  return parts.length === 2 && parts[0]!.length > 0 && parts[1]!.includes(".");
}

function addressList(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every(validMailbox)) throw invalidRequest();
  return value;
}

/** Parses and validates the `mail send` standard input exactly as 0.7 did. */
export function parseMailMessage(json: string): MailMessage {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw invalidRequest();
  }
  return validateMailMessage(raw);
}

/** Validates one `mail send` payload; the CLI and the `mail_send` tool share it. */
export function validateMailMessage(value: unknown): MailMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidRequest();
  const raw = value as Record<string, unknown>;
  const to = addressList(raw.to);
  const cc = addressList(raw.cc);
  const bcc = addressList(raw.bcc);
  const { subject, body } = raw;
  const sender = raw.sender ?? null;
  if (
    typeof subject !== "string" ||
    typeof body !== "string" ||
    to.length === 0 ||
    to.length + cc.length + bcc.length > 100 ||
    subject.includes("\0") ||
    body.includes("\0") ||
    /[\r\n]/.test(subject) ||
    Buffer.byteLength(subject) > 8 * 1024 ||
    Buffer.byteLength(body) > 1024 * 1024 ||
    (sender !== null && !validMailbox(sender))
  ) {
    throw invalidRequest();
  }
  return { sender, to, cc, bcc, subject, body };
}

const authorizationScript = `
ObjC.import('Foundation');
const Mail = Application('Mail');
Mail.name();
JSON.stringify({authorized:true});
`;

const sendScript = `
ObjC.import('Foundation');
function input() {
  const data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  const value = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
  if (!value) throw new Error('invalid utf8');
  return JSON.parse(ObjC.unwrap(value));
}
function recipient(Mail, kind, address) {
  if (kind === 'to') return Mail.ToRecipient({address: address});
  if (kind === 'cc') return Mail.CcRecipient({address: address});
  return Mail.BccRecipient({address: address});
}
const payload = input();
const Mail = Application('Mail');
const message = Mail.OutgoingMessage({subject: payload.subject, content: payload.body, visible: false});
Mail.outgoingMessages.push(message);
payload.to.forEach(x => message.toRecipients.push(recipient(Mail, 'to', x)));
payload.cc.forEach(x => message.ccRecipients.push(recipient(Mail, 'cc', x)));
payload.bcc.forEach(x => message.bccRecipients.push(recipient(Mail, 'bcc', x)));
if (payload.sender) message.sender = payload.sender;
message.send();
JSON.stringify({accepted:true});
`;

const OSASCRIPT = "/usr/bin/osascript";

/** Asks Mail.app for its name, which surfaces the Automation consent state. */
export async function mailAuthorizationStatus(): Promise<Uint8Array> {
  return (await runCommand(OSASCRIPT, ["-l", "JavaScript", "-e", authorizationScript])).stdout;
}

/** Hands one message to Mail.app. Success proves only application acceptance. */
export async function sendMail(message: MailMessage): Promise<Uint8Array> {
  const { stdout } = await runCommand(OSASCRIPT, ["-l", "JavaScript", "-e", sendScript], {
    stdin: new TextEncoder().encode(JSON.stringify(message)),
    timeoutMs: 120_000,
    outputLimit: 1024 * 1024,
    effect: "mutation",
  });
  return stdout;
}
