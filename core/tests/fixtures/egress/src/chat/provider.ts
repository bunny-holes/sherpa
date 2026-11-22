// A chat module may import the AI SDK, but never its gateway, its MCP client or its
// OpenTelemetry integration, and it reaches the network only through egress.ts.
import * as anthropic from "@ai-sdk/anthropic";
import * as gateway from "@ai-sdk/gateway"; // expect: eslint(no-restricted-imports)
import * as mcp from "@ai-sdk/mcp"; // expect: eslint(no-restricted-imports)
import { streamText } from "ai";
import { serve } from "bun"; // expect: eslint(no-restricted-imports)
import * as net from "node:net"; // expect: eslint(no-restricted-imports)

const openai = await import("@ai-sdk/openai");
const otel = await import("@ai-sdk/otel"); // expect: eslint(no-restricted-imports)
const tracing = await import("@ai-sdk/otel/subpath"); // expect: eslint(no-restricted-imports)
const models = await fetch("https://api.anthropic.com/v1/models"); // expect: eslint(no-restricted-globals)

export { anthropic, gateway, mcp, streamText, serve, net, openai, otel, tracing, models };
