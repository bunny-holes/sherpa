import { afterAll, afterEach, expect, test, vi } from "vite-plus/test";
import { allowedOrigin, EgressDeniedError, installEgress } from "../../src/chat/egress.ts";
import type { CoreFrame, FakeApp } from "./fake-app.ts";
import { BINARY, cleanHomes, launch, scratchHome } from "./launch.ts";

// ADR-0012 "시험으로 지키기" and app-connection-v1 §7.1 on real sockets: the built core holds no
// internet socket and listens on nothing while it serves MCP, and the `redirect: "error"` the turn
// fetch relies on refuses a redirect before it is followed. The servers here belong to the test
// process; the rule they check is the core's.
const apps: FakeApp[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.stop();
  cleanHomes();
  vi.unstubAllEnvs();
});

/** A listening socket of the test process: lsof must see it, or seeing none in the core proves nothing. */
const control = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("control") });
afterAll(() => control.stop(true));

function lsof(pid: number, ...selection: string[]): string {
  return Bun.spawnSync([
    "/usr/sbin/lsof",
    "-n",
    "-P",
    "-a",
    "-p",
    String(pid),
    ...selection,
  ]).stdout.toString();
}

/** What lsof sees of a process: its standard descriptors, its internet sockets, its Unix listeners. */
function sockets(pid: number) {
  const fields = (output: string, tag: string) =>
    output
      .split("\n")
      .filter((line) => line.startsWith(tag))
      .map((line) => line.slice(1));
  return {
    descriptors: fields(lsof(pid, "-d", "0-2", "-F", "f"), "f").length,
    internet: lsof(pid, "-i"),
    // Bun.spawn's pipes are connected socket pairs, named `->0x…`; a socket with a path listens.
    unixListeners: fields(lsof(pid, "-U", "-F", "n"), "n").filter((name) => !name.startsWith("->")),
  };
}

const QUIET = { descriptors: 3, internet: "", unixListeners: [] };
const INSTALLED =
  "debug [core:egress:install] success global_fetch=refused global_websocket=refused";
const range = { from: "2026-11-21T00:00:00+09:00", to: "2026-11-22T00:00:00+09:00" };
const isConfirm = (frame: CoreFrame) => frame.channel === 0 && frame.type === "confirm";

test("the built core holds no internet socket and listens on nothing while it serves MCP", async () => {
  expect(sockets(process.pid).internet).toContain(`TCP 127.0.0.1:${control.port} (LISTEN)`);
  const app = launch({ LOG_LEVEL: "debug" });
  apps.push(app);
  await app.handshake();
  expect(sockets(app.pid)).toEqual(QUIET);
  await Promise.all([1, 2].map((channel) => app.open(channel)));
  for (const channel of [1, 2]) {
    expect(((await app.rpc(channel, "tools/list", {})).tools as unknown[]).length).toBe(35);
  }
  expect((await app.call(1, "event_list", range)).structuredContent?.status).toBe("succeeded");
  expect(sockets(app.pid)).toEqual(QUIET);
  // A delete waiting for the person: a call in flight on an open session.
  app.confirm = () => null;
  const id = app.send(2, "tools/call", {
    name: "reminder_delete",
    arguments: { native_locator: "r-1" },
  });
  const confirm = await app.next(isConfirm);
  expect(sockets(app.pid)).toEqual(QUIET);
  app.frame(0, "confirmation", { id: (confirm.body as { id: number }).id, decision: "approved" });
  expect((await app.reply(2, id)).result).toMatchObject({
    structuredContent: { status: "succeeded" },
  });
  expect(app.stderr.join("")).toContain(INSTALLED);
});

test("a command other than app serve starts with the global fetch and WebSocket refused too", () => {
  const child = Bun.spawnSync([BINARY, "--version"], {
    env: { HOME: scratchHome(), PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LOG_LEVEL: "debug" },
  });
  expect(child.exitCode).toBe(0);
  expect(child.stderr.toString()).toContain(INSTALLED);
});

test(`Bun ${Bun.version} refuses the redirect a turn fetch forwards, and its target sees no request`, async () => {
  vi.stubEnv("LOG_LEVEL", "error");
  const reached: string[] = [];
  const collect = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      reached.push(new URL(request.url).pathname);
      return new Response("collected");
    },
  });
  const provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      const { pathname } = new URL(request.url);
      reached.push(pathname);
      if (pathname === "/v1/away") {
        return Response.redirect(`http://127.0.0.1:${collect.port}/collect`, 307);
      }
      if (pathname === "/v1/back") {
        return new Response(null, { status: 302, headers: { location: "/v1/final" } });
      }
      return new Response("final");
    },
  });
  try {
    // A trusted local TLS server is out of reach here, so what the turn fetch lets out for
    // https://provider.example goes to the plain local server, its init untouched.
    const local = `http://127.0.0.1:${provider.port}`;
    const runtime = Object.assign(
      (input: string | URL | Request, init?: BunFetchRequestInit) => {
        // The turn fetch hands on the URL it checked, as a string; this test sends no Request.
        if (typeof input !== "string") throw new TypeError("expected the checked URL");
        return fetch(input.replace("https://provider.example", local), init);
      },
      { preconnect: fetch.preconnect },
    );
    const send = installEgress({ fetch: runtime }).turnFetch(
      allowedOrigin("https://provider.example/v1"),
      new AbortController().signal,
    );
    for (const path of ["/v1/away", "/v1/back"]) {
      const error = await send(`https://provider.example${path}`, { redirect: "follow" }).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(EgressDeniedError);
      expect(error).toMatchObject({ reason: "redirect" });
      expect((error as Error).cause).toBeInstanceOf(TypeError);
      expect((error as Error).cause).toMatchObject({ code: "UnexpectedRedirect" });
    }
    expect(reached).toEqual(["/v1/away", "/v1/back"]);
  } finally {
    await Promise.all([collect.stop(true), provider.stop(true)]);
  }
});
