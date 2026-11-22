/**
 * The core's only way to the network (ADR-0012 "네트워크", app-connection-v1 §7.1).
 *
 * `installEgress` runs before any command. It keeps the runtime's `fetch` and leaves
 * `globalThis.fetch` refusing every call for the rest of the process, so a library that falls
 * back to the global (the AI SDK reads it on every request) reaches nothing. A chat turn sends
 * through `Egress.turnFetch`: HTTPS to the one origin the person chose, without userinfo, never
 * following a redirect, and stopped by the turn's signal. Anything else is refused before it
 * leaves, with an `EgressDeniedError` and a `[core:egress:…] refused` line.
 *
 * Replacing the global reaches neither `Bun.fetch`, a separate read-only binding, nor the
 * `fetch` of a Worker's own global scope (Bun 1.4.4 and 1.4.5). The lint rules in
 * `vite.config.ts` keep both, and every other network API, out of the code under `src/`, a
 * worker's body included.
 */
import { SherpaError } from "../cli/errors.ts";
import { log } from "../log.ts";

/** `fetch` as Bun types it, `preconnect` included, so a turn fetch goes wherever a fetch does. */
export type Fetch = typeof fetch;

declare const allowedOriginBrand: unique symbol;

/** The `https:` origin (scheme, host and port) of a base URL that `allowedOrigin` accepted. */
export type AllowedOrigin = string & { readonly [allowedOriginBrand]: true };

/** Why the egress refused: the `reason` of its error and of its log line. */
export type EgressRefusal =
  | "global_fetch"
  | "invalid_url"
  | "not_https"
  | "userinfo"
  | "query"
  | "fragment"
  | "other_origin"
  | "redirect"
  | "preconnect";

/** A request the egress refused before it left, or a redirect it would not follow. */
export class EgressDeniedError extends SherpaError {
  constructor(
    readonly reason: EgressRefusal,
    cause?: unknown,
  ) {
    super("egress_denied");
    this.name = "EgressDeniedError";
    if (cause !== undefined) this.cause = cause;
  }
}

function refuse(action: "fetch" | "base-url", reason: EgressRefusal, cause?: unknown) {
  log.warn(`[core:egress:${action}] refused reason=${reason}`);
  return new EgressDeniedError(reason, cause);
}

/** Why `url` is not plain HTTPS: another scheme, or credentials before the host. */
function httpsRefusal(url: URL): EgressRefusal | null {
  if (url.protocol !== "https:") return "not_https";
  if (url.username !== "" || url.password !== "") return "userinfo";
  return null;
}

/**
 * A query or a fragment after the path, an empty `?` or `#` included, which `search` and
 * `hash` read as "". Runs after `httpsRefusal`, so `href` starts with the origin.
 */
function suffixRefusal(url: URL): EgressRefusal | null {
  const suffix = url.href.slice(url.origin.length + url.pathname.length);
  if (suffix.startsWith("?")) return "query";
  return suffix.startsWith("#") ? "fragment" : null;
}

/**
 * The origin a provider's base URL allows (ADR-0012 "OpenAI 호환의 base URL"). The URL must be
 * `https:` without userinfo, query or fragment; its path stays the provider's. Plain HTTP, a
 * local server included, is refused: the owner chose HTTPS only for every provider
 * (2026-11-22, ADR-0012 "남은 결정" 1).
 */
export function allowedOrigin(baseURL: string): AllowedOrigin {
  const url = URL.parse(baseURL);
  if (!url) throw refuse("base-url", "invalid_url");
  const refusal = httpsRefusal(url) ?? suffixRefusal(url);
  if (refusal) throw refuse("base-url", refusal);
  return url.origin as AllowedOrigin;
}

/**
 * The members of the Fetch standard's `RequestInit` a caller may set; `redirect` and `signal`
 * are the egress's own. Bun's extensions are dropped (bun-types 1.4.5 `BunFetchRequestInit`):
 * `proxy`, `unix`, `session` and `tls` send the request elsewhere or skip the certificate
 * check, `protocol: "http3"` goes over UDP, and `verbose` prints the request, key included.
 */
const FORWARDED = [
  "body",
  "cache",
  "credentials",
  "duplex",
  "headers",
  "integrity",
  "keepalive",
  "method",
  "mode",
  "priority",
  "referrer",
  "referrerPolicy",
] as const;
const STANDARD = new Set<string>([...FORWARDED, "redirect", "signal", "window"]);

function forwardedInit(init: BunFetchRequestInit | undefined): RequestInit {
  const given = (init ?? {}) as Record<string, unknown>;
  const forwarded: Record<string, unknown> = {};
  for (const key of FORWARDED) if (given[key] !== undefined) forwarded[key] = given[key];
  const dropped = Object.keys(given).filter(
    (key) => !STANDARD.has(key) && given[key] !== undefined,
  );
  if (dropped.length > 0) log.warn(`[core:egress:fetch] dropped options=${dropped.join(",")}`);
  return forwarded as RequestInit;
}

/** Bun's answer to a redirect under `redirect: "error"`: a `TypeError` coded `UnexpectedRedirect`. */
function unexpectedRedirect(error: unknown): boolean {
  return error instanceof TypeError && (error as { code?: unknown }).code === "UnexpectedRedirect";
}

/** The error's name, and Bun's code when it is one word; never the message, which names the URL. */
function failureFields(error: unknown): string {
  const type = `error_type=${error instanceof Error ? error.name : typeof error}`;
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^\w+$/.test(code) ? `${type} code=${code}` : type;
}

function turnFetch(real: Fetch, origin: AllowedOrigin, turn: AbortSignal): Fetch {
  const send = async (input: string | URL | Request, init?: BunFetchRequestInit) => {
    const url = URL.parse(
      input instanceof Request ? input.url : input instanceof URL ? input.href : input,
    );
    if (!url) throw refuse("fetch", "invalid_url");
    const refusal = httpsRefusal(url) ?? (url.origin === origin ? null : "other_origin");
    if (refusal) throw refuse("fetch", refusal);
    const request = input instanceof Request ? input : null;
    const callerSignal = init?.signal ?? request?.signal;
    const signal = callerSignal ? AbortSignal.any([callerSignal, turn]) : turn;
    const forwarded = forwardedInit(init);
    const started = Date.now();
    log.info("[core:egress:fetch] start");
    try {
      // The URL just checked, not the caller's object, so nothing changes it on the way.
      const response = await real(request ?? url.href, { ...forwarded, redirect: "error", signal });
      log.info(`[core:egress:fetch] success status=${response.status} ms=${Date.now() - started}`);
      return response;
    } catch (error) {
      const ms = Date.now() - started;
      if (unexpectedRedirect(error)) throw refuse("fetch", "redirect", error);
      if (signal.aborted) log.info(`[core:egress:fetch] abandoned ms=${ms}`);
      else log.error(`[core:egress:fetch] failure ${failureFields(error)} ms=${ms}`);
      throw error;
    }
  };
  return Object.assign(send, {
    preconnect: (): void => {
      throw refuse("fetch", "preconnect");
    },
  });
}

/** What `globalThis.fetch` is after `installEgress`: every call, `preconnect` included, refused. */
function refusingFetch(): Fetch {
  const refused = (): Promise<Response> => Promise.reject(refuse("fetch", "global_fetch"));
  return Object.assign(refused, {
    preconnect: (): void => {
      throw refuse("fetch", "global_fetch");
    },
  });
}

/** What a chat turn sends through (ADR-0012 "코드로 지키기" 2). */
export interface Egress {
  /**
   * The `fetch` one turn hands its provider. A request leaves only when its URL is `https:` on
   * `origin` without userinfo, and always with `redirect: "error"` and `signal`, joined with the
   * caller's own. Anything else is refused before it leaves, and a redirect when it comes back.
   */
  turnFetch(origin: AllowedOrigin, signal: AbortSignal): Fetch;
}

/**
 * Takes the runtime's `fetch` from `scope` and leaves `scope.fetch` refusing every call, for
 * good: the property can be neither assigned nor redefined, so a second call throws. The core's
 * entry point calls it once, before any command runs.
 */
export function installEgress(scope: { fetch: Fetch } = globalThis): Egress {
  const real = scope.fetch;
  Object.defineProperty(scope, "fetch", {
    value: refusingFetch(),
    enumerable: true,
    writable: false,
    configurable: false,
  });
  log.debug("[core:egress:install] success global_fetch=refused");
  return { turnFetch: (origin, signal) => turnFetch(real, origin, signal) };
}
