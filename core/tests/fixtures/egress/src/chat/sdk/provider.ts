// A module under src/chat/sdk/ builds providers from their packages and takes from ai only its
// types and the names it is given; it never takes the AI Gateway, the AI SDK MCP client or
// OpenTelemetry, and it reaches the network only through egress.ts.
import * as anthropic from "@ai-sdk/anthropic";
import * as gateway from "@ai-sdk/gateway"; // expect: eslint(no-restricted-imports)
import * as mcp from "@ai-sdk/mcp"; // expect: eslint(no-restricted-imports)
import {
  fingerprintTools,
  jsonSchema,
  modelMessageSchema,
  pruneMessages,
  tool,
  type LanguageModel,
} from "ai";
import type { ModelMessage } from "ai";
import { streamText } from "ai"; // expect: eslint(no-restricted-imports)
import { generateText as generate } from "ai"; // expect: eslint(no-restricted-imports)
import { gateway as aiGateway } from "ai"; // expect: eslint(no-restricted-imports)
import * as ai from "ai"; // expect: eslint(no-restricted-imports)
import { MockLanguageModelV4 } from "ai/test"; // expect: eslint(no-restricted-imports)
import { serve } from "bun"; // expect: eslint(no-restricted-imports)
import * as net from "node:net"; // expect: eslint(no-restricted-imports)
export { embed } from "ai"; // expect: eslint(no-restricted-imports)

const openai = await import("@ai-sdk/openai");
const otel = await import("@ai-sdk/otel"); // expect: eslint(no-restricted-imports)
const tracing = await import("@ai-sdk/otel/subpath"); // expect: eslint(no-restricted-imports)
// A rule that picks names does not read import() (oxlint 1.94.0); the default provider that
// egress.ts installs refuses a model id given as a string at run time.
const later = await import("ai");
const models = await fetch("https://api.anthropic.com/v1/models"); // expect: eslint(no-restricted-globals)

export type Message = ModelMessage | LanguageModel;
export {
  anthropic,
  gateway,
  mcp,
  fingerprintTools,
  jsonSchema,
  modelMessageSchema,
  pruneMessages,
  tool,
  streamText,
  generate,
  aiGateway,
  ai,
  MockLanguageModelV4,
  serve,
  net,
  openai,
  otel,
  tracing,
  later,
  models,
};
