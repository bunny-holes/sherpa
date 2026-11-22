// The egress module may hold and call fetch; the rest of the network stays closed to it too.
import { streamText } from "ai";
import * as net from "node:net"; // expect: eslint(no-restricted-imports)

type Fetch = typeof fetch;
const real: Fetch = globalThis.fetch;
const models = await fetch("https://api.anthropic.com/v1/models");
const again = await self.fetch("https://api.anthropic.com/v1/models");
const bound = await Bun.fetch("https://api.anthropic.com/v1/models"); // expect: eslint(no-restricted-properties)
const socket = new WebSocket("wss://api.anthropic.com/"); // expect: eslint(no-restricted-globals)
const loaded = require("node:tls"); // expect: typescript(no-require-imports)

export type { Fetch };
export { streamText, net, real, models, again, bound, socket, loaded };
