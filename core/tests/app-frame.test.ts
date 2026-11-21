import { describe, expect, test } from "vite-plus/test";
import {
  encodeFrame,
  type Frame,
  frameLimits,
  FrameReader,
  FrameViolation,
} from "../src/app/frame.ts";
import { AppConnection, type MuxChannel } from "../src/app/mux.ts";
import { MuxChannelTransport } from "../src/app/channel-transport.ts";
import { plannerRequest } from "../src/planner/port.ts";
import { CollectingSink, PushInput, tick } from "./support/pipes.ts";

// app-connection-v1 §14. The app's hello is the second vector line.
const APP_HELLO = '0\thello\t{"mux":1,"version":"0.9.0","workers":["planner"]}\n';
const encoder = new TextEncoder();

function read(text: string | Uint8Array): Frame[] {
  const frames: Frame[] = [];
  new FrameReader().push(typeof text === "string" ? encoder.encode(text) : text, (frame) =>
    frames.push(frame),
  );
  return frames;
}

function violation(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof FrameViolation) return error.code;
    throw error;
  }
  throw new Error("no violation");
}

function connect() {
  const input = new PushInput();
  const sink = new CollectingSink();
  const channels: MuxChannel[] = [];
  const connection = new AppConnection({
    version: "0.9.0",
    input,
    output: sink,
    handlers: {
      ready: () => {},
      open: (channel) => {
        channels.push(channel);
      },
    },
  });
  return { input, sink, channels, connection, exit: connection.run() };
}

describe("§14 valid frames", () => {
  test("every app frame of the vectors reads as one frame", () => {
    const frames = read(
      [
        APP_HELLO,
        '0\tresponse\t{"id":2,"report":{"error":"sherpa.internal_failure","status":"failed"}}\n',
        "1\topen\n",
        '1\tdata\t{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n',
        '0\tconfirmation\t{"id":3,"decision":"declined"}\n',
        "1\tclose\n",
      ].join(""),
    );
    const text = (body: Uint8Array | null) => (body ? new TextDecoder().decode(body) : null);
    expect(frames.map((frame) => [frame.channel, frame.type, text(frame.body)])).toEqual([
      [0, "hello", '{"mux":1,"version":"0.9.0","workers":["planner"]}'],
      [0, "response", '{"id":2,"report":{"error":"sherpa.internal_failure","status":"failed"}}'],
      [1, "open", null],
      [1, "data", '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'],
      [0, "confirmation", '{"id":3,"decision":"declined"}'],
      [1, "close", null],
    ]);
  });

  test("the core writes its hello first, byte for byte", async () => {
    const { input, sink, exit } = connect();
    input.end();
    expect(await exit).toBe(0);
    expect(sink.lines).toEqual(['0\thello\t{"mux":1,"version":"0.9.0"}']);
  });

  test("the capabilities request is the vector's bytes", async () => {
    const { input, sink, connection } = connect();
    input.push(APP_HELLO);
    await tick();
    const reply = connection.control.request(
      "planner",
      plannerRequest(
        "capabilities",
        { schema: "sherpa.planner.capabilities.request.v2" },
        { effect: "read", required_evidence: "none", artifact_directory: null },
        "op-1",
      ),
    );
    expect(await sink.next((line) => line.startsWith("0\trequest"))).toBe(
      '0\trequest\t{"id":1,"worker":"planner","request":{"kind":"request","protocol_version":"2.0.0","application_contract":"sherpa.planner.v2","request_id":"op-1","operation_id":"op-1","capability":"capabilities","payload":{"schema":"sherpa.planner.capabilities.request.v2"},"deadline_ms":20000,"idempotency_key":"op-1","policy":{"effect":"read","required_evidence":"none","artifact_directory":null}}}',
    );
    input.push(
      '0\tresponse\t{"id":1,"response":{"application_contract":"sherpa.planner.v2","capability":"capabilities","effect":{"kind":"none","state":"not_started"},"error":{"code":"protocol.unsupported_capability","retry":"never"},"kind":"response","operation_id":"op-1","protocol_version":"2.0.0","request_id":"op-1","status":"failed","warnings":[]}}\n',
    );
    expect(await reply).toMatchObject({
      kind: "response",
      response: { status: "failed", error: { code: "protocol.unsupported_capability" } },
    });
    input.end();
  });

  test("the confirm, withdraw, close and fatal bodies are the vector's bytes", async () => {
    const { input, sink, channels, connection } = connect();
    input.push(APP_HELLO);
    input.push("1\topen\n2\topen\n");
    await tick();
    const prompt = {
      tool: "reminder_delete",
      operation_id: "op-2",
      client: { name: "t", version: "0" },
      title: "t",
      lines: [],
    };
    // Ids 1 and 2 went to two requests in the vectors.
    void connection.control.request(
      "planner",
      plannerRequest(
        "event.list",
        {},
        { effect: "read", required_evidence: "none", artifact_directory: null },
        "op-a",
      ),
    );
    void connection.control.request(
      "planner",
      plannerRequest(
        "event.list",
        {},
        { effect: "read", required_evidence: "none", artifact_directory: null },
        "op-b",
      ),
    );
    const cancel = new AbortController();
    const decision = connection.control.confirm(prompt, cancel.signal);
    expect(await sink.next((line) => line.startsWith("0\tconfirm\t"))).toBe(
      '0\tconfirm\t{"id":3,"tool":"reminder_delete","operation_id":"op-2","client":{"name":"t","version":"0"},"title":"t","lines":[],"timeout_ms":30000}',
    );
    cancel.abort();
    expect(await decision).toBe("withdrawn");
    expect(await sink.next((line) => line.startsWith("0\twithdraw"))).toBe('0\twithdraw\t{"id":3}');
    const transport = new MuxChannelTransport(channels[1]!);
    await transport.close();
    expect(sink.lines).toContain('2\tclose\t{"reason":"server_closed"}');
    input.push("1\tDATA\t{}\n");
    await tick();
    expect(sink.lines.at(-1)).toBe('0\tfatal\t{"code":"mux.frame_invalid"}');
  });

  test("encodeFrame refuses a body with LF, an empty body and a body over its limit", () => {
    expect(() => encodeFrame(1, "data", "{\n}")).toThrow();
    expect(() => encodeFrame(1, "data", "")).toThrow();
    expect(() => encodeFrame(0, "withdraw", "x".repeat(frameLimits.other + 1))).toThrow();
    expect(encodeFrame(0, "withdraw", "x".repeat(frameLimits.other)).byteLength).toBe(
      frameLimits.other + "0\twithdraw\t\n".length,
    );
  });
});

describe("§14 violations end the core with fatal and 65", () => {
  const cases: [string, string, string, boolean?][] = [
    ["a leading zero", "01\tdata\t{}\n", "mux.frame_invalid"],
    ["an upper-case type", "1\tDATA\t{}\n", "mux.frame_invalid"],
    ["no tab", "1 data {}\n", "mux.frame_invalid"],
    ["data without a body", "1\topen\n1\tdata\n", "mux.frame_invalid"],
    ["an empty body", "1\topen\n1\tdata\t\n", "mux.frame_invalid"],
    ["open on the control channel", "0\topen\n", "mux.unexpected_frame"],
    ["hello on an MCP channel", '1\thello\t{"mux":1}\n', "mux.unexpected_frame"],
    ["channel 2^53", "9007199254740992\topen\n", "mux.frame_invalid"],
    ["a second open of a live channel", "1\topen\n1\topen\n", "mux.unexpected_frame"],
    ["open before hello", "1\topen\n", "mux.unexpected_frame", true],
    [
      "a line over 8,454,144 bytes",
      `1\tdata\t${"x".repeat(frameLimits.line + 1)}`,
      "mux.frame_too_large",
    ],
    ["data on the control channel", '0\tdata\t{"jsonrpc":"2.0"}\n', "mux.unexpected_frame"],
    ["a second hello", APP_HELLO, "mux.unexpected_frame"],
    ["open of a closed number", "1\topen\n1\tclose\n1\topen\n", "mux.unexpected_frame"],
    ["open with a body", "1\topen\t{}\n", "mux.frame_invalid"],
    ["a close body of another shape", '1\topen\n1\tclose\t{"why":"x"}\n', "mux.frame_invalid"],
    ["a response that is not JSON", "0\tresponse\tnope\n", "mux.frame_invalid"],
    [
      "a confirmation of another shape",
      '0\tconfirmation\t{"id":1,"decision":"maybe"}\n',
      "mux.frame_invalid",
    ],
    ["an unknown type", "1\topen\n1\tping\n", "mux.unexpected_frame"],
  ];
  test.each(cases)("%s", async (_name, frames, code, first) => {
    const { input, sink, exit } = connect();
    if (!first) input.push(APP_HELLO);
    input.push(frames);
    expect(await exit).toBe(65);
    expect(sink.lines.at(-1)).toBe(`0\tfatal\t{"code":"${code}"}`);
  });

  test("an app hello with another mux version is unsupported", async () => {
    const { input, sink, exit } = connect();
    input.push('0\thello\t{"mux":2,"version":"9.0.0","workers":[]}\n');
    expect(await exit).toBe(65);
    expect(sink.lines.at(-1)).toBe('0\tfatal\t{"code":"mux.version_unsupported"}');
  });

  test("an app hello of another shape is invalid", async () => {
    const { input, sink, exit } = connect();
    input.push('0\thello\t{"mux":1,"version":"0.9.0"}\n');
    expect(await exit).toBe(65);
    expect(sink.lines.at(-1)).toBe('0\tfatal\t{"code":"mux.frame_invalid"}');
  });
});

describe("§14 frames that are not violations", () => {
  test("data for a channel that is not open is dropped", async () => {
    const { input, sink, exit } = connect();
    input.push(APP_HELLO);
    input.push('5\tdata\t{"jsonrpc":"2.0","method":"x"}\n5\tclose\n');
    input.end();
    expect(await exit).toBe(0);
    expect(sink.lines).toHaveLength(1);
  });

  test("data that is not JSON gets -32700 on its channel and the connection stays", async () => {
    const { input, sink, channels, exit } = connect();
    input.push(APP_HELLO);
    input.push("1\topen\n");
    await tick();
    const received: unknown[] = [];
    const transport = new MuxChannelTransport(channels[0]!);
    transport.onmessage = (message) => received.push(message);
    input.push('1\tdata\tnot json\n1\tdata\t{"jsonrpc":"2.0","method":"x"}\n');
    expect(await sink.next((line) => line.startsWith("1\tdata"))).toBe(
      '1\tdata\t{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}',
    );
    await tick();
    expect(received).toEqual([{ jsonrpc: "2.0", method: "x" }]);
    input.end();
    expect(await exit).toBe(0);
  });

  test("a response with an unknown id is dropped", async () => {
    const { input, sink, exit } = connect();
    input.push(APP_HELLO);
    input.push('0\tresponse\t{"id":99,"report":{"error":"x","status":"failed"}}\n');
    input.end();
    expect(await exit).toBe(0);
    expect(sink.lines).toHaveLength(1);
  });
});

describe("limits by frame type", () => {
  const types: [string, number][] = [
    ["data", frameLimits.data],
    ["request", frameLimits.request],
    ["response", frameLimits.response],
    ["confirm", frameLimits.confirm],
    ["close", frameLimits.other],
    ["hello", frameLimits.other],
    ["confirmation", frameLimits.other],
  ];
  test.each(types)(
    "a %s body of its limit is read and one byte more is too large",
    (type, limit) => {
      const head = `1\t${type}\t`;
      const [frame] = read(`${head}${"x".repeat(limit)}\n`);
      expect(frame?.body?.byteLength).toBe(limit);
      expect(violation(() => read(`${head}${"x".repeat(limit + 1)}\n`))).toBe(
        "mux.frame_too_large",
      );
    },
  );

  test("a body is stopped at the chunk that passes the limit, before its line ends", () => {
    const reader = new FrameReader();
    const mebibyte = new Uint8Array(1024 * 1024).fill(0x78);
    reader.push(encoder.encode("1\tdata\t"), () => {});
    for (let index = 0; index < 4; index += 1) reader.push(mebibyte, () => {});
    expect(reader.pending).toBe(true);
    expect(violation(() => reader.push(new Uint8Array([0x78]), () => {}))).toBe(
      "mux.frame_too_large",
    );
  });

  test("a frame split across chunks at every byte reads the same", () => {
    const text = '12\tdata\t{"jsonrpc":"2.0"}\n12\tclose\n';
    const frames: Frame[] = [];
    const reader = new FrameReader();
    for (const byte of encoder.encode(text))
      reader.push(new Uint8Array([byte]), (f) => frames.push(f));
    expect(frames.map((frame) => [frame.channel, frame.type])).toEqual([
      [12, "data"],
      [12, "close"],
    ]);
  });

  test("channel and type length are bounded", () => {
    expect(read(`${Number.MAX_SAFE_INTEGER}\topen\n`)[0]?.channel).toBe(Number.MAX_SAFE_INTEGER);
    expect(violation(() => read("12345678901234567\topen\n"))).toBe("mux.frame_invalid");
    expect(read(`1\t${"a".repeat(16)}\n`)[0]?.type).toBe("a".repeat(16));
    expect(violation(() => read(`1\t${"a".repeat(17)}\n`))).toBe("mux.frame_invalid");
    expect(violation(() => read("1\t\n"))).toBe("mux.frame_invalid");
    expect(violation(() => read("\topen\n"))).toBe("mux.frame_invalid");
  });
});
