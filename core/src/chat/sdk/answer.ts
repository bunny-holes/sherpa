/**
 * The answer's share of the conversation's limit (app-connection-v1 §7.11 "대화 한도"): what each
 * part of a model's stream adds to the step's messages the conversation keeps, at most, and the
 * middleware that cuts an answer once its turn would pass the limit. The AI SDK keeps one part for
 * each block of text or reasoning, call and file, with the metadata the provider gave it last (ai
 * 7.0.179 stream-text.ts, to-response-messages.ts). The calls' results count where the calls run
 * (src/chat/calls.ts), and a step that finished counts exactly (src/chat/conversation.ts).
 */
import type { LanguageModelMiddleware } from "ai";
import type { TurnRoom } from "../conversation.ts";
import { ChatFailure } from "../errors.ts";

type WrapStream = NonNullable<LanguageModelMiddleware["wrapStream"]>;
type StreamResult = Awaited<ReturnType<Parameters<WrapStream>[0]["doStream"]>>;
/** One part of a model's stream as its provider's package gives it (LanguageModelV4StreamPart). */
export type ModelPart = StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;

type Block = Extract<ModelPart, { type: `${"text" | "reasoning"}-${"start" | "delta" | "end"}` }>;
type FileData = Extract<ModelPart, { type: "file" }>["data"];

/** The two messages of a step, the assistant's and the tools', with their keys and commas. */
const MESSAGES = 64;
/** The keys of a part of the assistant's message besides what it carries, and its comma. */
const PART = 64;
/**
 * The keys of a call's part in the assistant's message and of its result in the tools' message,
 * besides the call's id, name, input and metadata and the result's outcome; and, for a call the
 * AI SDK refuses before it runs, the words of its error: the names of the tools for one the core
 * does not have (ai 7.0.179 no-such-tool-error.ts: 658 bytes for the 35 tools), or a few issues
 * its schema found. A schema that finds many writes more, which only the step's end measures.
 */
const CALL = 2048;

const jsonBytes = (value: unknown) =>
  value === undefined ? 0 : Buffer.byteLength(JSON.stringify(value));
/** A string as JSON writes it, without its quotes. */
const stringBytes = (value: string) => jsonBytes(value) - 2;

/**
 * A call's input as the AI SDK keeps it: the parsed JSON, or `{}` for one that is blank or does
 * not parse, or that is no object (ai 7.0.179 parse-tool-call.ts, to-response-messages.ts).
 */
function inputBytes(input: string): number {
  if (input.trim() === "") return 2;
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    // The SDK refuses the call, and its message keeps `{}` for the input.
    return 2;
  }
  return typeof value === "object" ? jsonBytes(value) : 2;
}

/** A file's data as the AI SDK keeps it, in base64. */
function dataBytes(data: FileData): number {
  if (data.type === "url") return stringBytes(data.url.href);
  return typeof data.data === "string"
    ? stringBytes(data.data)
    : Math.ceil(data.data.byteLength / 3) * 4;
}

/**
 * Counts what one model response adds to the conversation as its parts arrive: at most what the
 * step's messages keep of them, the results of its calls left out.
 */
export class AnswerCount {
  private opened = false;
  /** The most metadata each block of text or reasoning carried so far, by its id. */
  private readonly metadata = new Map<string, number>();
  /** What each call's input added as it streamed, by the call's id. */
  private readonly inputs = new Map<string, number>();

  bytes(part: ModelPart): number {
    const messages = this.opened ? 0 : MESSAGES;
    this.opened = true;
    return messages + this.partBytes(part);
  }

  private partBytes(part: ModelPart): number {
    switch (part.type) {
      case "text-start":
      case "text-delta":
      case "text-end":
        return this.block(`text:${part.id}`, part);
      case "reasoning-start":
      case "reasoning-delta":
      case "reasoning-end":
        return this.block(`reasoning:${part.id}`, part);
      case "tool-input-start":
        this.inputs.set(part.id, 0);
        return 0;
      case "tool-input-delta": {
        // Until the call comes, its input counts as it streams, so a call too large is cut early.
        const bytes = Buffer.byteLength(part.delta);
        this.inputs.set(part.id, (this.inputs.get(part.id) ?? 0) + bytes);
        return bytes;
      }
      case "tool-call": {
        const streamed = this.inputs.get(part.toolCallId) ?? 0;
        this.inputs.delete(part.toolCallId);
        // The id and the name are in the call and in its result, and the name in an error.
        const names = 3 * (stringBytes(part.toolCallId) + stringBytes(part.toolName));
        // An error for input that does not parse or that its schema refuses writes the input again
        // (ai 7.0.179 parse-tool-call.ts, @ai-sdk/provider type-validation-error.ts).
        const again = stringBytes(part.input);
        return (
          CALL +
          names +
          inputBytes(part.input) +
          again +
          jsonBytes(part.providerMetadata) -
          streamed
        );
      }
      case "tool-result":
        // A result the provider ran the tool for: the core sends no such tool, so none is expected.
        return (
          PART +
          2 * (stringBytes(part.toolCallId) + stringBytes(part.toolName)) +
          jsonBytes(part.result) +
          jsonBytes(part.providerMetadata)
        );
      case "file":
      case "reasoning-file":
        return (
          PART +
          stringBytes(part.mediaType) +
          dataBytes(part.data) +
          jsonBytes(part.providerMetadata)
        );
      case "custom":
        return PART + stringBytes(part.kind) + jsonBytes(part.providerMetadata);
      case "tool-approval-request":
        return PART + jsonBytes(part);
      // Neither the call's input when it ends, nor what the SDK keeps outside the messages.
      case "tool-input-end":
      case "source":
      case "stream-start":
      case "response-metadata":
      case "finish":
      case "ping":
      case "raw":
      case "error":
        return 0;
      default:
        // A part this SDK does not name: at most what it carries.
        return jsonBytes(part);
    }
  }

  /**
   * A block's text as its deltas carry it, and its metadata: the SDK keeps the last metadata the
   * block carried, which is at most the largest.
   */
  private block(key: string, part: Block): number {
    const start = part.type === "text-start" || part.type === "reasoning-start";
    if (start) this.metadata.delete(key);
    const metadata = jsonBytes(part.providerMetadata);
    const most = this.metadata.get(key) ?? 0;
    if (metadata > most) this.metadata.set(key, metadata);
    const text = "delta" in part ? stringBytes(part.delta) : 0;
    return (start ? PART : 0) + text + Math.max(0, metadata - most);
  }
}

/**
 * Cuts the answer once its turn would pass the conversation's limit: an `error` part in the
 * model's stream, which ends it. The AI SDK sends no request again for an error in a stream
 * (`streamRetries` unset), runs none of the step's calls and keeps nothing of the step (ai
 * 7.0.179 stream-text.ts), and the error reaches the turn as the ChatFailure it is. Thrown from
 * `doStream`, it would read as an error before the first output.
 */
export function answerLimit(room: TurnRoom): LanguageModelMiddleware {
  return {
    wrapStream: async ({ doStream }) => {
      room.request();
      const result = await doStream();
      const count = new AnswerCount();
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream<ModelPart, ModelPart>({
            transform(part, controller) {
              if (room.answers(count.bytes(part))) {
                controller.enqueue(part);
                return;
              }
              controller.enqueue({ type: "error", error: new ChatFailure("conversation_limit") });
              controller.terminate();
            },
          }),
        ),
      };
    },
  };
}
