import { expect, test } from "vite-plus/test";
import { AppConnection, type MuxChannel } from "../src/app/mux.ts";
import { CollectingSink, PushInput, tick } from "./support/pipes.ts";

const APP_HELLO = '0\thello\t{"mux":1,"version":"0.9.0","workers":["planner"]}\n';

function connect() {
  const input = new PushInput();
  const sink = new CollectingSink();
  const channels: MuxChannel[] = [];
  const events: string[] = [];
  const hellos: unknown[] = [];
  const connection = new AppConnection({
    version: "0.9.0",
    input,
    output: sink,
    handlers: {
      ready: (hello) => hellos.push(hello),
      open: (channel) => {
        channels.push(channel);
        channel.onmessage = (body) =>
          events.push(`${channel.id}:data:${new TextDecoder().decode(body)}`);
        channel.onclose = () => events.push(`${channel.id}:closed`);
      },
    },
  });
  return { input, sink, channels, events, hellos, connection, exit: connection.run() };
}

test("the handshake hands the app hello to the composition", async () => {
  const { input, hellos, exit } = connect();
  input.push(APP_HELLO);
  input.end();
  expect(await exit).toBe(0);
  expect(hellos).toEqual([{ mux: 1, version: "0.9.0", workers: ["planner"] }]);
});

test("open, data and close reach their channel in order, and each channel stays separate", async () => {
  const { input, events, connection, exit } = connect();
  input.push(APP_HELLO);
  input.push("1\topen\n3\topen\n");
  input.push('3\tdata\t{"n":1}\n1\tdata\t{"n":2}\n3\tclose\t{"reason":"client_gone"}\n');
  await tick();
  expect(events).toEqual(['3:data:{"n":1}', '1:data:{"n":2}', "3:closed"]);
  expect(connection.sessionCount).toBe(1);
  input.end();
  expect(await exit).toBe(0);
  expect(events.at(-1)).toBe("1:closed");
});

test("data that crosses the app's close is dropped without a frame", async () => {
  const { input, sink, events, exit } = connect();
  input.push(APP_HELLO);
  input.push('1\topen\n1\tclose\n1\tdata\t{"late":true}\n1\tclose\n');
  input.end();
  expect(await exit).toBe(0);
  expect(events).toEqual(["1:closed"]);
  expect(sink.lines).toHaveLength(1);
});

test("a channel the core closed writes close once and drops later sends", async () => {
  const { input, sink, channels, events, exit } = connect();
  input.push(APP_HELLO);
  input.push("1\topen\n");
  await tick();
  const channel = channels[0]!;
  await channel.send('{"a":1}');
  await channel.close("server_closed");
  await channel.close("server_closed");
  await channel.send('{"a":2}');
  input.push('1\tdata\t{"crossed":true}\n');
  input.end();
  expect(await exit).toBe(0);
  expect(sink.lines.slice(1)).toEqual(['1\tdata\t{"a":1}', '1\tclose\t{"reason":"server_closed"}']);
  // The core closed it, so the session is not told again.
  expect(events).toEqual([]);
});

test("a violation ends every open session before fatal", async () => {
  const { input, sink, events, exit } = connect();
  input.push(APP_HELLO);
  input.push("1\topen\n2\topen\n2\topen\n");
  expect(await exit).toBe(65);
  expect(events).toEqual(["1:closed", "2:closed"]);
  expect(sink.lines.at(-1)).toBe('0\tfatal\t{"code":"mux.unexpected_frame"}');
});

test("EOF inside a frame drops the partial frame and exits 0", async () => {
  const { input, events, exit } = connect();
  input.push(APP_HELLO);
  input.push('1\topen\n1\tdata\t{"cut');
  input.end();
  expect(await exit).toBe(0);
  expect(events).toEqual(["1:closed"]);
});
