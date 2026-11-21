/**
 * Per-call human confirmation of delete and send tools (app-connection-v1 §9).
 * The app asks in its own window; the core's clock is the authority.
 */
export type ConfirmationDecision =
  /** The person allowed it in the app window. */
  | "approved"
  | "declined"
  /** The app could not show its window. */
  | "unavailable"
  /** No answer within the timeout; the request was withdrawn. */
  | "timed_out"
  /** The call was cancelled or its connection ended; the request was withdrawn. */
  | "withdrawn";

export interface ConfirmationLine {
  label: string;
  value: string;
}

export interface ConfirmationPrompt {
  tool: string;
  operation_id: string;
  client: { name: string; version: string };
  title: string;
  lines: ConfirmationLine[];
}

export interface ConfirmationPort {
  /** Asks the app and waits at most `timeoutMs`, the part of the §9 budget the preview left. */
  confirm(
    prompt: ConfirmationPrompt,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<ConfirmationDecision>;
}

/**
 * The §9 budget of one delete or send: the preview read and the wait for the
 * person together. With the 20 s work deadline and the 5 s grace it stays
 * inside Codex's 60 s tool timeout.
 */
export const CONFIRMATION_TIMEOUT_MS = 30_000;
/** `deadline_ms` of the planner read that builds a delete's preview (§9). */
export const PREVIEW_DEADLINE_MS = 5_000;

const TITLE_MAX = 100;
const LINES_MAX = 12;
const LABEL_MAX = 40;
const VALUE_MAX = 2_000;
const CLIENT_MAX = 128;
/** The `confirm` frame body limit (§7.4) less room for the wrapper. */
const PROMPT_BYTES_MAX = 60 * 1024;

/** Cuts `value` to `maximum` code points, marking the cut with an ellipsis. */
export function clip(value: string, maximum: number): string {
  const points = Array.from(value);
  return points.length <= maximum ? value : `${points.slice(0, maximum - 1).join("")}…`;
}

/**
 * Applies the §9 bounds: title 100, 12 lines, label 40, value 2,000 code points.
 * Long multi-byte values are cut further until the prompt fits the frame.
 */
export function boundedPrompt(prompt: ConfirmationPrompt): ConfirmationPrompt {
  const bounded: ConfirmationPrompt = {
    tool: prompt.tool,
    operation_id: prompt.operation_id,
    client: {
      name: clip(prompt.client.name, CLIENT_MAX),
      version: clip(prompt.client.version, CLIENT_MAX),
    },
    title: clip(prompt.title, TITLE_MAX),
    lines: prompt.lines
      .slice(0, LINES_MAX)
      .map((line) => ({ label: clip(line.label, LABEL_MAX), value: clip(line.value, VALUE_MAX) })),
  };
  while (Buffer.byteLength(JSON.stringify(bounded)) > PROMPT_BYTES_MAX) {
    const longest = bounded.lines.reduce((a, b) => (b.value.length > a.value.length ? b : a));
    longest.value = clip(
      longest.value,
      Math.max(1, Math.floor(Array.from(longest.value).length / 2)),
    );
  }
  return bounded;
}
