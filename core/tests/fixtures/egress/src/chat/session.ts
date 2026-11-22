// A chat module outside src/chat/sdk/ takes only the AI SDK's types, and only load.ts loads
// src/chat/sdk/.
import { createAnthropic } from "@ai-sdk/anthropic"; // expect: eslint(no-restricted-imports)
import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { ModelMessage } from "ai";
import { type ToolSet } from "ai";
import { streamText } from "ai"; // expect: eslint(no-restricted-imports)
import { serve } from "bun"; // expect: eslint(no-restricted-imports)
import type { Turn } from "./sdk/turn.ts";
import { run } from "./sdk/turn.ts"; // expect: eslint(no-restricted-imports)

const sdk = await import("ai"); // expect: eslint(no-restricted-imports)
const turn = await import("./sdk/turn.ts"); // expect: eslint(no-restricted-imports)
const models = await fetch("https://api.anthropic.com/v1/models"); // expect: eslint(no-restricted-globals)

export type Message = ModelMessage | LanguageModelV4 | ToolSet | Turn;
export { createAnthropic, streamText, serve, run, sdk, turn, models };
