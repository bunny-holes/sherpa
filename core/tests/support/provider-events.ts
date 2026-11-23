/**
 * What each provider's server streams, as its package 4.x reads it, for the chat tests: a text
 * answer, one after the model's reasoning with what the provider takes back, an answer that calls
 * tools, and a failure the AI SDK sends again. Every response counts 11 tokens in and 3 out.
 */
import type { ServerEvent } from "./chat.ts";

/**
 * A call the model makes: the id its provider gives it, the tool and the arguments, which a string
 * gives as written (a call cut in the middle of them).
 */
export interface ModelCall {
  id: string;
  name: string;
  input: Record<string, unknown> | string;
}

const argumentsOf = (call: ModelCall) =>
  typeof call.input === "string" ? call.input : JSON.stringify(call.input);

export const anthropic = (texts: string[], stop = "end_turn"): ServerEvent[] => [
  {
    event: "message_start",
    data: {
      type: "message_start",
      message: {
        id: "msg_1",
        model: "claude-sonnet-5-5",
        role: "assistant",
        usage: { input_tokens: 11 },
      },
    },
  },
  {
    event: "content_block_start",
    data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  },
  ...texts.map((text) => ({
    event: "content_block_delta",
    data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
  })),
  { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
  {
    event: "message_delta",
    data: { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 3 } },
  },
  { event: "message_stop", data: { type: "message_stop" } },
];
const created = { id: "resp_1", created_at: 1, model: "gpt-5.1" };
export const openai = (texts: string[]): ServerEvent[] => [
  { data: { type: "response.created", response: created } },
  { data: { type: "response.in_progress", response: created } },
  {
    data: {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "message", id: "msg_1" },
    },
  },
  ...texts.map((delta) => ({
    data: {
      type: "response.output_text.delta",
      item_id: "msg_1",
      output_index: 0,
      content_index: 0,
      delta,
      logprobs: [],
    },
  })),
  {
    data: {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "message",
        id: "msg_1",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: texts.join(""), annotations: [] }],
      },
    },
  },
  {
    data: {
      type: "response.completed",
      response: {
        ...created,
        usage: {
          input_tokens: 11,
          output_tokens: 3,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      },
    },
  },
];
export const google = (texts: string[]): ServerEvent[] => [
  { data: { event_type: "interaction.created", interaction: { status: "in_progress" } } },
  { data: { event_type: "step.start", index: 0, step: { type: "model_output", content: [] } } },
  ...texts.map((text) => ({
    data: { event_type: "step.delta", index: 0, delta: { type: "text", text } },
  })),
  { data: { event_type: "step.stop", index: 0 } },
  {
    data: {
      event_type: "interaction.completed",
      interaction: {
        status: "completed",
        usage: { total_input_tokens: 11, total_output_tokens: 3 },
      },
    },
  },
];
export const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
  data: {
    id: "c1",
    object: "chat.completion.chunk",
    created: 1,
    model: "m-1",
    choices: [{ index: 0, delta, finish_reason: finish }],
  },
});
export const chat = (texts: string[], finish = "stop"): ServerEvent[] => [
  ...texts.map((content, index) =>
    chunk(index === 0 ? { role: "assistant", content } : { content }),
  ),
  chunk({}, finish),
  {
    data: {
      id: "c1",
      object: "chat.completion.chunk",
      created: 1,
      model: "m-1",
      choices: [],
      usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 },
    },
  },
  { data: "[DONE]" },
];

/** Moves the events of output block `from` to `to`, under the key a provider numbers them by. */
const moved = (events: ServerEvent[], key: string, from: number, to: number) =>
  events.map((event) => {
    const data = event.data as Record<string, unknown>;
    return data[key] === from ? { ...event, data: { ...data, [key]: to } } : event;
  });

/** An Anthropic answer after a thinking block, whose signature the next request gives back. */
export const anthropicThinking = (texts: string[], signature = "sig-1"): ServerEvent[] => {
  const answer = moved(anthropic(texts), "index", 0, 1);
  return [
    answer[0]!,
    {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" },
      },
    },
    {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Let me see" },
      },
    },
    {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature },
      },
    },
    { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
    ...answer.slice(1),
  ];
};

/** An OpenAI Responses answer after a reasoning item, whose encrypted content comes back. */
export const openaiReasoning = (texts: string[], encrypted = "enc-1"): ServerEvent[] => {
  const answer = moved(openai(texts), "output_index", 0, 1);
  return [
    ...answer.slice(0, 2),
    {
      data: {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "reasoning", id: "rs_1", encrypted_content: null },
      },
    },
    {
      data: {
        type: "response.output_item.done",
        output_index: 0,
        item: { type: "reasoning", id: "rs_1", encrypted_content: encrypted, summary: [] },
      },
    },
    ...answer.slice(2),
  ];
};

/** A Google Interactions answer after a thought, whose signature the next request gives back. */
export const googleThought = (texts: string[], signature = "sig-g"): ServerEvent[] => {
  const answer = moved(google(texts), "index", 0, 1);
  return [
    answer[0]!,
    { data: { event_type: "step.start", index: 0, step: { type: "thought", signature } } },
    { data: { event_type: "step.stop", index: 0 } },
    ...answer.slice(1),
  ];
};

/** An OpenAI-compatible answer after the model's reasoning, which the next request gives back. */
export const chatReasoning = (texts: string[], reasoning = "Let me see"): ServerEvent[] => [
  chunk({ role: "assistant", reasoning_content: reasoning }),
  ...texts.map((content) => chunk({ content })),
  ...chat([]),
];

/** An Anthropic answer that calls tools, after the text before them if there is any. */
export const anthropicCalls = (
  calls: ModelCall[],
  texts: string[] = [],
  stop = "tool_use",
): ServerEvent[] => {
  const text = anthropic(texts).slice(1, -2);
  const first = texts.length > 0 ? 1 : 0;
  return [
    anthropic([]).at(0)!,
    ...(texts.length > 0 ? text : []),
    ...calls.flatMap((call, offset): ServerEvent[] => {
      const index = first + offset;
      return [
        {
          event: "content_block_start",
          data: {
            type: "content_block_start",
            index,
            content_block: { type: "tool_use", id: call.id, name: call.name, input: {} },
          },
        },
        {
          event: "content_block_delta",
          data: {
            type: "content_block_delta",
            index,
            delta: { type: "input_json_delta", partial_json: argumentsOf(call) },
          },
        },
        { event: "content_block_stop", data: { type: "content_block_stop", index } },
      ];
    }),
    ...anthropic([], stop).slice(-2),
  ];
};

/** An OpenAI Responses answer that calls tools. */
export const openaiCalls = (calls: ModelCall[]): ServerEvent[] => [
  ...openai([]).slice(0, 2),
  ...calls.flatMap((call, index): ServerEvent[] => {
    const item = { type: "function_call", id: `fc_${index}`, call_id: call.id, name: call.name };
    const input = argumentsOf(call);
    return [
      {
        data: {
          type: "response.output_item.added",
          output_index: index,
          item: { ...item, arguments: "" },
        },
      },
      {
        data: {
          type: "response.function_call_arguments.delta",
          item_id: item.id,
          output_index: index,
          delta: input,
        },
      },
      {
        data: {
          type: "response.output_item.done",
          output_index: index,
          item: { ...item, arguments: input, status: "completed" },
        },
      },
    ];
  }),
  openai([]).at(-1)!,
];

/** A Google Interactions answer that calls tools: it ends needing their results. */
export const googleCalls = (calls: ModelCall[]): ServerEvent[] => [
  google([]).at(0)!,
  ...calls.flatMap((call, index): ServerEvent[] => [
    {
      data: {
        event_type: "step.start",
        index,
        step: { type: "function_call", id: call.id, name: call.name },
      },
    },
    {
      data: {
        event_type: "step.delta",
        index,
        delta: { type: "arguments_delta", arguments: argumentsOf(call) },
      },
    },
    { data: { event_type: "step.stop", index } },
  ]),
  {
    data: {
      event_type: "interaction.completed",
      interaction: {
        status: "requires_action",
        usage: { total_input_tokens: 11, total_output_tokens: 3 },
      },
    },
  },
];

/** An OpenAI-compatible answer that calls tools, after the text before them if there is any. */
export const chatCalls = (
  calls: ModelCall[],
  texts: string[] = [],
  finish = "tool_calls",
): ServerEvent[] => {
  const tool_calls = calls.map((call, index) => ({
    index,
    id: call.id,
    type: "function",
    function: { name: call.name, arguments: argumentsOf(call) },
  }));
  return [
    ...chat(texts).slice(0, texts.length),
    chunk(texts.length > 0 ? { tool_calls } : { role: "assistant", tool_calls }),
    ...chat([], finish),
  ];
};

/** A failure answer the AI SDK sends again after `ms`, at once unless the test says otherwise. */
export const failure = (status: number, ms = 0) =>
  Response.json(
    { error: { message: "try later" } },
    { status, headers: { "retry-after-ms": String(ms) } },
  );
