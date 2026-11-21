import { afterEach, expect, test } from "vite-plus/test";
import type { FakeApp } from "./fake-app.ts";
import { cleanHomes, launch } from "./launch.ts";
import { defaultPlanner } from "../support/planner.ts";

// The 30 s confirmation and 5 s discovery waits of app-connection-v1 §9 and §10.1, on the real clock.
const apps: FakeApp[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.stop();
  cleanHomes();
});

test(
  "an unanswered confirmation is withdrawn after 30 s, the call fails and a later approval runs nothing",
  { timeout: 60_000 },
  async () => {
    const app = launch();
    apps.push(app);
    app.confirm = () => null;
    await app.handshake();
    await app.open(1);
    const started = Date.now();
    const id = app.send(1, "tools/call", {
      name: "event_collection_delete",
      arguments: { collection_native_locator: "c-1" },
    });
    const confirm = await app.next((frame) => frame.channel === 0 && frame.type === "confirm");
    const withdraw = await app.next(
      (frame) => frame.channel === 0 && frame.type === "withdraw",
      40_000,
    );
    const confirmID = (confirm.body as { id: number }).id;
    expect(withdraw.body).toEqual({ id: confirmID });
    // The 30 s count from before the preview read (§9).
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(29_000);
    expect(elapsed).toBeLessThan(31_000);
    app.frame(0, "confirmation", { id: confirmID, decision: "approved" });
    const reply = await app.reply(1, id);
    expect(reply.result).toMatchObject({
      isError: true,
      structuredContent: {
        status: "failed",
        error: { code: "confirmation.timed_out", retry: "after_user_action" },
      },
    });
    await Bun.sleep(1_000);
    expect(app.requested()).toEqual(["capabilities", "event.source.list"]);
  },
);

test(
  "an unanswered discovery leaves the core tools after 5 s and a late answer is dropped",
  { timeout: 30_000 },
  async () => {
    const app = launch();
    apps.push(app);
    app.planner = () => null;
    await app.handshake();
    const discovery = await app.next((frame) => frame.channel === 0 && frame.type === "request");
    const started = Date.now();
    await app.open(1);
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(4_500);
    const tools = (await app.rpc(1, "tools/list", {})).tools as { name: string }[];
    expect(tools).toHaveLength(13);
    expect(tools.map((tool) => tool.name)).not.toContain("event_list");
    const body = discovery.body as { id: number; request: Record<string, unknown> };
    app.frame(0, "response", { id: body.id, ...(defaultPlanner(body.request) as object) });
    await app.open(2);
    expect(((await app.rpc(2, "tools/list", {})).tools as unknown[]).length).toBe(13);
  },
);

test("an app without the planner worker gets the core tools at once", async () => {
  const app = launch();
  apps.push(app);
  await app.handshake([]);
  await app.open(1);
  expect(((await app.rpc(1, "tools/list", {})).tools as unknown[]).length).toBe(13);
  expect(app.requested()).toEqual([]);
});
