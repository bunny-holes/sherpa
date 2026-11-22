// The one module that takes a model: it may import any name of ai but the AI Gateway's and the
// telemetry registry, and the network stays as closed to it as to the rest.
import * as gatewayPackage from "@ai-sdk/gateway"; // expect: eslint(no-restricted-imports)
import { isStepCount, streamText } from "ai";
import { gateway } from "ai"; // expect: eslint(no-restricted-imports)
import { createGateway as create } from "ai"; // expect: eslint(no-restricted-imports)
import { registerTelemetry } from "ai"; // expect: eslint(no-restricted-imports)
import * as ai from "ai"; // expect: eslint(no-restricted-imports)
import * as internal from "ai/internal"; // expect: eslint(no-restricted-imports)
import * as dgram from "node:dgram"; // expect: eslint(no-restricted-imports)

const socket = new WebSocket("wss://api.anthropic.com/"); // expect: eslint(no-restricted-globals)

export {
  gatewayPackage,
  isStepCount,
  streamText,
  gateway,
  create,
  registerTelemetry,
  ai,
  internal,
  dgram,
  socket,
};
