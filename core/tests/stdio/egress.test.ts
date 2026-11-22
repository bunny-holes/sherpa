import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, expect, test } from "vite-plus/test";
import type { CoreFrame, FakeApp } from "./fake-app.ts";
import { BINARY, cleanHomes, launch, scratchHome } from "./launch.ts";

// ADR-0012 "시험으로 지키기" and app-connection-v1 §7.1, §7.11 on real sockets: the built core holds
// no internet socket and listens on nothing while it serves MCP, a model list for an origin the
// egress refuses never connects, one for an origin whose certificate the core does not trust gets
// no request through, one for an origin whose certificate it trusts holds a connection to that
// origin only, and a redirect from there is refused before it is followed. A turn streams its
// answer from such an origin through the AI SDK, which the built core loads with the AI Gateway and
// its Vercel OIDC code, and leaves the Vercel CLI's files as they were. The built core trusts the
// macOS system store as well as the authorities Bun bundles. The servers here belong to the test
// process; the rule they check is the core's.
const apps: FakeApp[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.stop();
  cleanHomes();
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

/** The values of one field in lsof's field output (`-F`). */
function fields(output: string, tag: string): string[] {
  return output
    .split("\n")
    .filter((line) => line.startsWith(tag))
    .map((line) => line.slice(1));
}

/** What lsof sees of a process: its standard descriptors, its internet sockets, its Unix listeners. */
function sockets(pid: number) {
  return {
    descriptors: fields(lsof(pid, "-d", "0-2", "-F", "f"), "f").length,
    internet: lsof(pid, "-i"),
    // Bun.spawn's pipes are connected socket pairs, named `->0x…`; a socket with a path listens.
    unixListeners: fields(lsof(pid, "-U", "-F", "n"), "n").filter((name) => !name.startsWith("->")),
  };
}

const QUIET = { descriptors: 3, internet: "", unixListeners: [] };
const INSTALLED =
  "debug [core:egress:install] success global_fetch=refused global_websocket=refused ai_sdk_default_provider=refused";
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

/** A key that must reach no frame and no log line. */
const KEY = "sk-sherpa-stdio-marker";
const isChat = (channel: number) => (frame: CoreFrame) =>
  frame.channel === channel && frame.type === "data";

/** A local provider of the test process, and how many requests its handler saw. */
function localProvider(tls?: { cert: string; key: string }) {
  const seen = { requests: 0 };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    ...(tls ? { tls } : {}),
    fetch: () => {
      seen.requests++;
      return Response.json({ data: [{ id: "m-1" }] });
    },
  });
  return { server, seen };
}

/** A certificate for 127.0.0.1 that signs itself, made for this run with the system's openssl. */
async function selfSigned(): Promise<{ cert: string; key: string }> {
  const dir = scratchHome();
  const [cert, key] = [join(dir, "cert.pem"), join(dir, "key.pem")];
  const made = Bun.spawnSync(
    ["/usr/bin/openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1"].concat([
      "-subj",
      "/CN=127.0.0.1",
      "-keyout",
      key,
      "-out",
      cert,
    ]),
    { stdout: "ignore", stderr: "ignore" },
  );
  if (made.exitCode !== 0) throw new Error(`openssl exited with ${made.exitCode}`);
  return { cert: await Bun.file(cert).text(), key: await Bun.file(key).text() };
}

test("a model list for a plain http loopback origin never connects, and the core holds no socket", async () => {
  expect(sockets(process.pid).internet).toContain(`TCP 127.0.0.1:${control.port} (LISTEN)`);
  const local = localProvider();
  try {
    const app = launch({ LOG_LEVEL: "debug" });
    apps.push(app);
    await app.handshake();
    app.frame(1, "open", { kind: "chat" });
    app.frame(1, "data", {
      type: "list_models",
      provider: "openai-compatible",
      base_url: `http://127.0.0.1:${local.server.port}/v1`,
      api_key: KEY,
    });
    expect((await app.next(isChat(1))).body).toEqual({
      type: "error",
      in_reply_to: "list_models",
      code: "egress_denied",
      retryable: false,
      status: null,
    });
    expect(sockets(app.pid)).toEqual(QUIET);
    expect(local.seen.requests).toBe(0);
    app.closeInput();
    expect(await app.exited).toBe(0);
    const stderr = app.stderr.join("");
    expect(stderr).toContain("warn [core:egress:base-url] refused reason=not_https");
    expect(stderr).not.toContain(KEY);
    expect(JSON.stringify(app.log)).not.toContain(KEY);
  } finally {
    await local.server.stop(true);
  }
});

test("a model list for an https loopback origin with a self-signed certificate gets no request through", async () => {
  // The owner's rule is HTTPS with a certificate the core trusts, the loopback not refused by name
  // (ADR-0012 "OpenAI 호환의 base URL", 2026-11-22): the core connects and the TLS check refuses.
  const local = localProvider(await selfSigned());
  try {
    const app = launch({ LOG_LEVEL: "debug" });
    apps.push(app);
    await app.handshake();
    app.frame(1, "open", { kind: "chat" });
    app.frame(1, "data", {
      type: "list_models",
      provider: "openai-compatible",
      base_url: `https://127.0.0.1:${local.server.port}/v1`,
      api_key: KEY,
    });
    expect((await app.next(isChat(1))).body).toEqual({
      type: "error",
      in_reply_to: "list_models",
      code: "provider_certificate",
      retryable: false,
      status: null,
    });
    expect(local.seen.requests).toBe(0);
    app.closeInput();
    expect(await app.exited).toBe(0);
    const stderr = app.stderr.join("");
    expect(stderr).toContain(
      "error [core:egress:fetch] failure error_type=TypeError code=DEPTH_ZERO_SELF_SIGNED_CERT",
    );
    expect(stderr).toContain(
      "warn [core:chat:list-models] failure channel=1 provider=openai-compatible code=provider_certificate status=none",
    );
    expect(stderr).not.toContain(KEY);
  } finally {
    await local.server.stop(true);
  }
});

test("a command other than app serve starts with the global fetch and WebSocket refused too", () => {
  const child = Bun.spawnSync([BINARY, "--version"], {
    env: { HOME: scratchHome(), PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LOG_LEVEL: "debug" },
  });
  expect(child.exitCode).toBe(0);
  expect(child.stderr.toString()).toContain(INSTALLED);
});

/** Writes the certificate stores of the process it runs in to standard error as one JSON line. */
const STORES = `const tls = require("node:tls");
const stores = ["default", "bundled", "system", "extra"].map((store) => [store, tls.getCACertificates(store)]);
console.error(JSON.stringify({ execArgv: process.execArgv, ...Object.fromEntries(stores) }));
`;

test("the built core trusts the macOS system store as well as the authorities Bun bundles", async () => {
  // ADR-0012 위험 9 and §7.1: the app clears the environment NODE_USE_SYSTEM_CA would come in, so
  // the build passes --use-system-ca through --compile-exec-argv. Bun's standalone executables read
  // BUN_OPTIONS, which preloads the probe into the built core, started in / as the app starts it.
  // The same Bun without the flag keeps its bundled store alone; where the system store adds no
  // root to it, only execArgv tells the two apart.
  const dir = scratchHome();
  const probe = join(dir, "stores.js");
  await Bun.write(probe, STORES);
  const env = { HOME: dir, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
  const core = Bun.spawnSync([BINARY, "--version"], {
    cwd: "/",
    env: { ...env, BUN_OPTIONS: `--preload=${probe}` },
  });
  expect(core.exitCode).toBe(0);
  expect(core.stdout.toString()).toMatch(/^sherpa \d+\.\d+\.\d+\n$/);
  const inside = JSON.parse(core.stderr.toString());
  expect(inside.execArgv).toContain("--use-system-ca");
  expect(inside.extra).toEqual([]);
  expect(new Set(inside.default)).toEqual(new Set([...inside.bundled, ...inside.system]));
  const plain = Bun.spawnSync([process.execPath, probe], { cwd: "/", env });
  const outside = JSON.parse(plain.stderr.toString());
  expect(outside.execArgv).not.toContain("--use-system-ca");
  expect(new Set(outside.default)).toEqual(new Set(outside.bundled));
});

/**
 * A certificate authority made for this run and a certificate for 127.0.0.1 it signed, with the
 * system's openssl. The core trusts the authority only when NODE_EXTRA_CA_CERTS names its file at
 * start, and the app passes no such variable (§7.1).
 */
async function trustedCertificate(): Promise<{ ca: string; cert: string; key: string }> {
  const dir = scratchHome();
  const at = (name: string) => join(dir, name);
  await Bun.write(
    at("openssl.cnf"),
    ["[req]", "distinguished_name = dn", "[dn]"]
      .concat(["[authority]", "basicConstraints = critical,CA:TRUE"])
      .concat(["keyUsage = critical,keyCertSign,cRLSign", "[server]"])
      .concat(["subjectAltName = IP:127.0.0.1", "basicConstraints = critical,CA:FALSE"])
      .concat(["keyUsage = critical,digitalSignature,keyEncipherment"])
      .concat(["extendedKeyUsage = serverAuth", ""])
      .join("\n"),
  );
  const openssl = (...args: string[]) => {
    const made = Bun.spawnSync(["/usr/bin/openssl", ...args], { stdout: "ignore", stderr: "pipe" });
    if (made.exitCode !== 0) {
      throw new Error(`openssl ${args[0]} exited with ${made.exitCode}: ${made.stderr.toString()}`);
    }
  };
  const key = ["-newkey", "rsa:2048", "-nodes", "-config", at("openssl.cnf")];
  openssl(
    "req",
    "-x509",
    ...key,
    "-days",
    "1",
    "-subj",
    "/CN=Sherpa stdio test authority",
    "-extensions",
    "authority",
    "-keyout",
    at("ca-key.pem"),
    "-out",
    at("ca.pem"),
  );
  openssl(
    "req",
    ...key,
    "-subj",
    "/CN=127.0.0.1",
    "-keyout",
    at("key.pem"),
    "-out",
    at("server.csr"),
  );
  openssl(
    "x509",
    "-req",
    "-days",
    "1",
    "-set_serial",
    "1",
    "-in",
    at("server.csr"),
    "-CA",
    at("ca.pem"),
    "-CAkey",
    at("ca-key.pem"),
    "-extfile",
    at("openssl.cnf"),
    "-extensions",
    "server",
    "-out",
    at("cert.pem"),
  );
  return {
    ca: at("ca.pem"),
    cert: await Bun.file(at("cert.pem")).text(),
    key: await Bun.file(at("key.pem")).text(),
  };
}

/** Resolves once `done` holds, checking every 10 ms for at most 5 s. */
async function until(done: () => boolean): Promise<void> {
  for (const deadline = Date.now() + 5_000; !done(); await Bun.sleep(10)) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
  }
}

test("a model list for an https loopback origin with a certificate the core trusts reaches that server, the core's one socket", async () => {
  const { ca, ...tls } = await trustedCertificate();
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  const seen: { method: string; path: string; authorization: string | null }[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    tls,
    fetch: async (request) => {
      const { pathname } = new URL(request.url);
      const authorization = request.headers.get("authorization");
      seen.push({ method: request.method, path: pathname, authorization });
      await held;
      return Response.json({ data: [{ id: "m-1" }, { id: "m-2" }] });
    },
  });
  try {
    const app = launch({ LOG_LEVEL: "debug", NODE_EXTRA_CA_CERTS: ca });
    apps.push(app);
    await app.handshake();
    app.frame(1, "open", { kind: "chat" });
    app.frame(1, "data", {
      type: "list_models",
      provider: "openai-compatible",
      base_url: `https://127.0.0.1:${server.port}/v1`,
      api_key: KEY,
    });
    await until(() => seen.length > 0);
    // While the server holds its answer, every internet socket of the core is a connection to it.
    const peers = fields(lsof(app.pid, "-i", "-F", "n"), "n");
    expect(peers.length).toBeGreaterThan(0);
    for (const peer of peers) {
      expect(peer).toMatch(new RegExp(`^127\\.0\\.0\\.1:\\d+->127\\.0\\.0\\.1:${server.port}$`));
    }
    expect(sockets(app.pid).unixListeners).toEqual([]);
    release();
    expect((await app.next(isChat(1))).body).toEqual({
      type: "models",
      models: ["m-1", "m-2"],
      truncated: false,
    });
    expect(seen).toEqual([{ method: "GET", path: "/v1/models", authorization: `Bearer ${KEY}` }]);
    app.closeInput();
    expect(await app.exited).toBe(0);
    const stderr = app.stderr.join("");
    expect(stderr).toContain("info [core:egress:fetch] success status=200");
    expect(stderr).toContain(
      "info [core:chat:list-models] success channel=1 provider=openai-compatible models=2 pages=1 skipped=0 truncated=false",
    );
    expect(stderr).not.toContain(KEY);
    expect(JSON.stringify(app.log)).not.toContain(KEY);
  } finally {
    release();
    await server.stop(true);
  }
});

test("a model list whose trusted origin redirects ends with egress_denied, and the redirect's target sees no request", async () => {
  const { ca, ...tls } = await trustedCertificate();
  const reached: string[] = [];
  const collect = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    tls,
    fetch: (request) => {
      reached.push(`collect ${new URL(request.url).pathname}`);
      return new Response("collected");
    },
  });
  const provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    tls,
    fetch: (request) => {
      const { pathname } = new URL(request.url);
      reached.push(pathname);
      if (pathname === "/away/v1/models") {
        return Response.redirect(`https://127.0.0.1:${collect.port}/v1/models`, 307);
      }
      if (pathname === "/back/v1/models") {
        return new Response(null, { status: 302, headers: { location: "/v1/models" } });
      }
      return Response.json({ data: [{ id: "m-1" }] });
    },
  });
  try {
    const app = launch({ LOG_LEVEL: "debug", NODE_EXTRA_CA_CERTS: ca });
    apps.push(app);
    await app.handshake();
    app.frame(1, "open", { kind: "chat" });
    for (const path of ["/away/v1", "/back/v1"]) {
      app.frame(1, "data", {
        type: "list_models",
        provider: "openai-compatible",
        base_url: `https://127.0.0.1:${provider.port}${path}`,
        api_key: KEY,
      });
      expect((await app.next(isChat(1))).body).toEqual({
        type: "error",
        in_reply_to: "list_models",
        code: "egress_denied",
        retryable: false,
        status: null,
      });
    }
    // A 307 to another origin and a 302 back to the same one: neither is followed.
    expect(reached).toEqual(["/away/v1/models", "/back/v1/models"]);
    app.closeInput();
    expect(await app.exited).toBe(0);
    const stderr = app.stderr.join("");
    expect(stderr.match(/warn \[core:egress:fetch\] refused reason=redirect\n/g)).toHaveLength(2);
    expect(stderr).not.toContain(KEY);
  } finally {
    await Promise.all([collect.stop(true), provider.stop(true)]);
  }
});

/** The files under a directory, by their path in it, each with its text. */
async function tree(dir: string): Promise<Record<string, string>> {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) =>
    entry.isFile(),
  );
  const texts = await Promise.all(
    files.map((entry) => Bun.file(join(entry.parentPath, entry.name)).text()),
  );
  return Object.fromEntries(
    files.map((entry, index) => [
      join(entry.parentPath, entry.name).slice(dir.length + 1),
      texts[index]!,
    ]),
  );
}

test("a turn for an https loopback origin the core trusts streams its answer from that server, the core's one socket, and leaves the Vercel CLI's files as they were", async () => {
  const { ca, ...tls } = await trustedCertificate();
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  const seen: { path: string; authorization: string | null; body: Record<string, unknown> }[] = [];
  const encoder = new TextEncoder();
  const event = (data: unknown) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
  const chunk = (fields: Record<string, unknown>) =>
    event({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m-1", ...fields });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    tls,
    fetch: async (request) => {
      const body = (await request.json()) as Record<string, unknown>;
      seen.push({
        path: new URL(request.url).pathname,
        authorization: request.headers.get("authorization"),
        body,
      });
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const delta = (value: Record<string, unknown>, finish: string | null = null) =>
            chunk({ choices: [{ index: 0, delta: value, finish_reason: finish }] });
          controller.enqueue(delta({ role: "assistant", content: "sherpa-answer-" }));
          await held;
          controller.enqueue(delta({ content: "marker" }));
          controller.enqueue(delta({}, "stop"));
          controller.enqueue(
            chunk({
              choices: [],
              usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 },
            }),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    },
  });
  // The Vercel CLI's login with a token that has expired, and a linked project around the core's
  // working directory: what the AI Gateway's OIDC code reads, and rewrites on such a token.
  const home = scratchHome();
  const data = join(home, "Library/Application Support");
  await Bun.write(
    join(data, "com.vercel.cli/auth.json"),
    JSON.stringify({ token: "vercel-cli-marker", expiresAt: 1 }),
  );
  const project = scratchHome();
  mkdirSync(join(project, ".vercel"));
  await Bun.write(
    join(project, ".vercel/project.json"),
    JSON.stringify({ projectId: "prj_marker", orgId: "team_marker" }),
  );
  const before = { data: await tree(data), project: await tree(project) };
  const TEXT = "stdio-turn-text-marker";
  try {
    const app = launch(
      { HOME: home, LOG_LEVEL: "debug", NODE_EXTRA_CA_CERTS: ca },
      undefined,
      project,
    );
    apps.push(app);
    await app.handshake();
    app.frame(1, "open", { kind: "chat" });
    app.frame(1, "data", {
      type: "turn",
      provider: "openai-compatible",
      base_url: `https://127.0.0.1:${server.port}/v1`,
      api_key: KEY,
      model: "m-1",
      text: TEXT,
    });
    // The first piece of the answer reaches the app while the server holds the rest.
    expect((await app.next(isChat(1))).body).toEqual({ type: "delta", text: "sherpa-answer-" });
    const peers = fields(lsof(app.pid, "-i", "-F", "n"), "n");
    expect(peers.length).toBeGreaterThan(0);
    for (const peer of peers) {
      expect(peer).toMatch(new RegExp(`^127\\.0\\.0\\.1:\\d+->127\\.0\\.0\\.1:${server.port}$`));
    }
    expect(sockets(app.pid).unixListeners).toEqual([]);
    release();
    expect((await app.next(isChat(1))).body).toEqual({ type: "delta", text: "marker" });
    expect((await app.next(isChat(1))).body).toEqual({
      type: "done",
      reason: "stop",
      input_tokens: 11,
      output_tokens: 3,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      path: "/v1/chat/completions",
      authorization: `Bearer ${KEY}`,
      body: { model: "m-1", stream: true },
    });
    // The person's text follows the time on this Mac, in its own time zone.
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const messages = seen[0]!.body.messages as { role: string; content: string }[];
    expect(messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(messages[1]!.content).toMatch(
      new RegExp(
        `^\\[Current time: \\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}[+-]\\d{2}:\\d{2} \\(\\w+day\\), time zone: ${zone}\\]\\n\\n${TEXT}$`,
      ),
    );
    app.closeInput();
    expect(await app.exited).toBe(0);
    expect({ data: await tree(data), project: await tree(project) }).toEqual(before);
    const stderr = app.stderr.join("");
    expect(stderr).toContain("info [core:chat:turn] start channel=1 provider=openai-compatible\n");
    expect(stderr).toContain(
      "info [core:chat:turn] success channel=1 provider=openai-compatible reason=stop steps=1 input_tokens=11 output_tokens=3 ms=",
    );
    // Nothing reached the global fetch, the default provider or the gateway's WebSocket.
    expect(stderr).not.toMatch(/\] refused reason=/);
    expect(stderr).not.toContain("[core:chat:sdk-warning]");
    for (const secret of [KEY, TEXT, "sherpa-answer-", "vercel-cli-marker"]) {
      expect(stderr).not.toContain(secret);
    }
    expect(JSON.stringify(app.log)).not.toContain(KEY);
  } finally {
    release();
    await server.stop(true);
  }
});
