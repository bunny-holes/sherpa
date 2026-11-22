// Every line that ends in "expect:" reaches the network outside src/chat/egress.ts, and names
// the rules that must refuse it (tests/egress-lint.test.ts).
import { Agent } from "_http_agent"; // expect: eslint(no-restricted-imports)
import * as anthropic from "@ai-sdk/anthropic"; // expect: eslint(no-restricted-imports)
import { streamText } from "ai"; // expect: eslint(no-restricted-imports)
import type { ModelMessage } from "ai"; // expect: eslint(no-restricted-imports)
import * as subpath from "ai/subpath"; // expect: eslint(no-restricted-imports)
import * as bun from "bun"; // expect: eslint(no-restricted-imports)
import { serve } from "bun"; // expect: eslint(no-restricted-imports)
import { $ } from "bun";
import { createSocket } from "dgram"; // expect: eslint(no-restricted-imports)
import https from "https"; // expect: eslint(no-restricted-imports)
import { lookup } from "node:dns/promises"; // expect: eslint(no-restricted-imports)
import { request } from "node:http"; // expect: eslint(no-restricted-imports)
import { connect } from "node:http2"; // expect: eslint(no-restricted-imports)
import * as net from "node:net"; // expect: eslint(no-restricted-imports)
import type { Socket } from "node:net"; // expect: eslint(no-restricted-imports)
import { join } from "node:path";
import nodeFetch from "node-fetch"; // expect: eslint(no-restricted-imports)
import * as tls from "tls"; // expect: eslint(no-restricted-imports)
import { fetch as undiciFetch } from "undici"; // expect: eslint(no-restricted-imports)
import { WebSocket as Ws } from "ws"; // expect: eslint(no-restricted-imports)
import { run } from "../chat/sdk/turn.ts"; // expect: eslint(no-restricted-imports)
import dialer = require("node:net"); // expect: eslint(no-restricted-imports) typescript(no-require-imports)
export * from "node:tls"; // expect: eslint(no-restricted-imports)
export { request as relay } from "node:https"; // expect: eslint(no-restricted-imports)

const later = await import("node:net"); // expect: eslint(no-restricted-imports)
const provider = await import("@ai-sdk/openai"); // expect: eslint(no-restricted-imports)
const required = require("node:dgram"); // expect: typescript(no-require-imports)
const metaRequired = import.meta.require("node:tls"); // expect: eslint(no-restricted-properties)

const fetched = await fetch("https://example.com/"); // expect: eslint(no-restricted-globals)
await globalThis.fetch("https://example.com/"); // expect: eslint(no-restricted-properties)
await self.fetch("https://example.com/"); // expect: eslint(no-restricted-properties)
const { fetch: taken } = globalThis; // expect: eslint(no-restricted-properties)
await Bun.fetch("https://example.com/"); // expect: eslint(no-restricted-properties)
const session = new Bun.FetchSession(); // expect: eslint(no-restricted-properties)
const server = Bun.serve({ port: 0, fetch: () => new Response() }); // expect: eslint(no-restricted-properties)
const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } }); // expect: eslint(no-restricted-properties)
const dial = Bun.connect; // expect: eslint(no-restricted-properties)
const { udpSocket } = Bun; // expect: eslint(no-restricted-properties)
const addresses = await Bun.dns.lookup("example.com"); // expect: eslint(no-restricted-properties)
const rows = await Bun.sql`select 1`; // expect: eslint(no-restricted-properties)
const socket = new WebSocket("wss://example.com/"); // expect: eslint(no-restricted-globals)
const Global = globalThis.WebSocket; // expect: eslint(no-restricted-properties)
const events = new EventSource("https://example.com/events"); // expect: eslint(no-restricted-globals)
const shell = $`true`;
const joined = join("a", "b");

export type { Socket, ModelMessage };
export {
  Agent,
  anthropic,
  streamText,
  subpath,
  bun,
  serve,
  createSocket,
  https,
  lookup,
  request,
  connect,
  net,
  nodeFetch,
  tls,
  undiciFetch,
  Ws,
  run,
  dialer,
  later,
  provider,
  required,
  metaRequired,
  fetched,
  taken,
  session,
  server,
  listener,
  dial,
  udpSocket,
  addresses,
  rows,
  socket,
  Global,
  events,
  shell,
  joined,
};
