/**
 * Memory of the built `sherpa app serve` (app-connection-v1 §13.4): an idle
 * phase with three sessions, then a soak with session churn and a mix of
 * calls, driven by the fake app of the stdio tests. Samples the physical
 * footprint (`footprint`, as Activity Monitor counts it) and the resident
 * size (`ps`). Prints one JSON summary; records nothing by itself.
 *
 *   bun scripts/measure-app-serve.ts [--idle-seconds 120] [--soak-seconds 480]
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { FakeApp } from "../tests/stdio/fake-app.ts";
import { defaultPlanner, v2Response } from "../tests/support/planner.ts";

const { values } = parseArgs({
  options: {
    "idle-seconds": { type: "string", default: "120" },
    "soak-seconds": { type: "string", default: "480" },
    "sample-seconds": { type: "string", default: "10" },
  },
});
const idleMs = Number(values["idle-seconds"]) * 1000;
const soakMs = Number(values["soak-seconds"]) * 1000;
const sampleMs = Number(values["sample-seconds"]) * 1000;

const UNITS: Record<string, number> = { B: 1 / 1024 / 1024, KB: 1 / 1024, MB: 1, GB: 1024 };

async function sample(pid: number): Promise<{ footprintMB: number; rssMB: number }> {
  const [footprint, rss] = await Promise.all([
    Bun.$`footprint ${pid}`.quiet().text(),
    Bun.$`ps -o rss= -p ${pid}`.quiet().text(),
  ]);
  const match = /Footprint: ([\d.]+) (B|KB|MB|GB)/.exec(footprint);
  if (!match) throw new Error("footprint output without a total");
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    footprintMB: round(Number(match[1]) * UNITS[match[2]!]!),
    rssMB: round(Number(rss.trim()) / 1024),
  };
}

function summary(samples: { footprintMB: number; rssMB: number }[]) {
  const footprints = samples.map((item) => item.footprintMB);
  return {
    samples: samples.length,
    footprintMB: { first: footprints[0], last: footprints.at(-1), max: Math.max(...footprints) },
    rssMB: {
      first: samples[0]?.rssMB,
      last: samples.at(-1)?.rssMB,
      max: Math.max(...samples.map((item) => item.rssMB)),
    },
  };
}

const home = mkdtempSync(join(tmpdir(), "sherpa-measure-"));
const app = FakeApp.launch(join(import.meta.dirname, "../dist/sherpa"), {
  HOME: home,
  LOG_LEVEL: "warn",
});
try {
  const hello = await app.handshake();
  let channel = 0;
  const open: number[] = [];
  for (let index = 0; index < 3; index += 1) {
    channel += 1;
    await app.open(channel);
    open.push(channel);
  }
  const idle: { footprintMB: number; rssMB: number }[] = [];
  const idleEnd = Date.now() + idleMs;
  while (Date.now() < idleEnd) {
    idle.push(await sample(app.pid));
    await Bun.sleep(sampleMs);
  }

  const big = { schema: "x", blob: "y".repeat(200_000) };
  app.planner = (request) =>
    request.capability === "event.list" && Math.random() < 0.2
      ? { response: v2Response(request, { result: big }) }
      : defaultPlanner(request);
  app.confirm = () => "approved";
  const range = { from: "2026-11-21T00:00:00+09:00", to: "2026-11-22T00:00:00+09:00" };
  const soak: { footprintMB: number; rssMB: number }[] = [];
  let calls = 0;
  let sessions = open.length;
  let nextSample = Date.now();
  let nextChurn = Date.now() + 10_000;
  const soakEnd = Date.now() + soakMs;
  while (Date.now() < soakEnd) {
    await Promise.all(
      open.map(async (id, index) => {
        switch ((calls + index) % 4) {
          case 0:
            return app.call(id, "event_list", range);
          case 1:
            return app.call(id, "operations_list", { limit: 20 });
          case 2:
            return app.rpc(id, "tools/list", {});
          default:
            return app.call(id, "reminder_delete", { native_locator: "r-1" });
        }
      }),
    );
    calls += open.length;
    if (Date.now() >= nextChurn) {
      app.frame(open.shift()!, "close");
      channel += 1;
      await app.open(channel);
      open.push(channel);
      sessions += 1;
      nextChurn = Date.now() + 10_000;
    }
    if (Date.now() >= nextSample) {
      soak.push(await sample(app.pid));
      nextSample = Date.now() + sampleMs;
    }
    // Drop what the fake app kept so its own memory does not grow.
    app.frames.length = 0;
    app.log.length = 0;
    await Bun.sleep(50);
  }
  soak.push(await sample(app.pid));
  app.closeInput();
  const exit = await app.exited;
  console.log(
    JSON.stringify(
      {
        version: (hello.body as { version: string }).version,
        idleSeconds: idleMs / 1000,
        soakSeconds: soakMs / 1000,
        idle: summary(idle),
        soak: { ...summary(soak), calls, sessions },
        exit,
      },
      null,
      2,
    ),
  );
} finally {
  app.stop();
  rmSync(home, { recursive: true, force: true });
}
