---
uuid: 01a0f253-cd8b-73c9-87fb-f7cfed9ab710
type: spec
audience: "Maintainers deciding which test level must prove a Sherpa change before it merges"
goal: "Pick the deterministic or owner-operated proof a change needs and know what each gate covers"
tone: "Normative technical English. States what each level proves and what it cannot"
manner: "One level per bullet; live evidence and the verification matrix stay in their own files"
---

# Sherpa Test Strategy

## Levels

These are the deterministic proofs that exist and run in `bash scripts/check-all.sh`.
Anything not listed here is not proven by the gate.

- **Toolchain pin** (the gate's first step, before any build): the first `bun`
  on `PATH` is the version `devEngines.packageManager` in `core/package.json`
  declares, or the gate stops with `bun_version_mismatch`; Bun itself ignores
  that field (bunny-holes/sherpa#71). `scripts/package.sh` runs the same check
  from `scripts/lib/bun-pin.sh` before it builds, and the gate proves it: with
  a fake `bun` of another version first on `PATH`, `package.sh` must stop with
  the same reason. After each build, `BUN_BE_BUN=1 dist/sherpa --version` must
  print the declared version, so the compiled core carries that runtime; the
  gate asks the core inside `Sherpa.app` the same, and a fake core that
  answers another version must fail with `core_runtime_mismatch`. The release
  notice that runs next proves nothing: it warns about newer Bun, core
  dependency, Claude Code and Codex releases from the npm registry and
  `bun outdated`, and never fails the gate.
- **Core unit tests** (`core/tests`, vitest on the Bun runtime with
  `bun --bun vitest run`). They use synthetic fixtures only:
  - `mail.test.ts` builds a fixture envelope index and proves the keyset cursor
    returns every message exactly once across pages, keeps messages that share
    one received second, reports no further page on an exact final page,
    rejects a cursor issued for another range, rejects invalid ranges before
    opening the store, names the Full Disk Access remedy, bounds `mail read`,
    and rejects header injection and invalid recipients in `mail send`.
  - `journal.test.ts` proves the journal states of a send: completed, failed
    before dispatch, uncertain after dispatch, one terminal transition only,
    an accepted send whose journal finish fails stays `completed` with
    `journal.finish_failed` and a `started` row, and nothing is attempted when
    the journal cannot start.
  - `runner.test.ts` proves the command runner bounds output, reports an
    overflowing mutation as `uncertain`, times out a process group, fails on a
    non-zero exit, and reports a missing executable as unavailable.
  - `imessage*.test.ts` and `kakaotalk*.test.ts` read synthetic Messages and
    KakaoTalk fixture databases, prove the output keys and bounds, the absence
    of native identifiers in KakaoTalk output, the local checkpoint semantics,
    and KakaoTalk key derivation against kakaocli's published test vectors.
    Sends run against a fake `osascript`; no test sends a real message.
  - `chat-egress.test.ts` (ADR-0012) proves without a socket that the global
    `fetch` and `WebSocket` refuse every call and connection and the AI SDK's
    default provider every model, that none of them can be put back, that a
    turn fetch lets out only HTTPS to its origin with `redirect: "error"` and
    the turn's signal, and which base URLs are refused.
  - `chat-sdk-globals.test.ts` (ADR-0012) runs the AI SDK itself on the
    globals the core's entry point leaves, in a process of its own: a model id
    given as a string to `generateText`, `streamText` or `embed` is refused
    before any request, neither the default provider nor the warning log can
    be put back, and the SDK's warnings reach the Sherpa log without their
    details and never reach `process.emitWarning` or `console.warn`.
  - `dependency-network.test.ts` (ADR-0012) reads every JavaScript file of the
    packages the core bundles with Bun's transpiler: no network module the
    lint refuses, no Node module beyond files, paths, the OS, crypto and
    process, no `bun` import, no Bun API, Worker, native binding or module
    named at run time, and no network global in the declared Bun beyond
    `fetch` and `WebSocket`. It reads patterns: code made with `eval` or
    `Function` and names put together at run time stay unseen.
  - `egress-lint.test.ts` (ADR-0012) lints fixtures that break the egress and
    AI SDK rules of `core/vite.config.ts` on purpose and expects each form
    caught and nothing else, so a rule that stops matching fails the gate.
  - `build.test.ts` (contract §7.1) reads the build command in
    `core/package.json`: all four `--no-compile-autoload-*` flags and no flag
    that turns one back on. Bun 1.4.5 reads `tsconfig.json` and
    `package.json` only together with `.env` files, so the built core's
    behaviour cannot show those two flags.
  - `chat-session.test.ts` and `chat-models.test.ts` (contract §7.11) prove
    a chat channel on a fake runtime fetch behind the egress: the message
    shapes and limits, `invalid_message` and what it answers, each provider's
    list request (the key only in its header, no `?key=` for Google), paging
    and Anthropic's active filter, the 1,000-id, 10-request and 4 MiB limits,
    the codes of HTTP statuses, certificates and broken connections, `busy`,
    the 30 s timeout, a close that stops a list, the fifth channel's
    `chat_limit`, and no key in a log line or another frame.
  - `chat-turn.test.ts` (contract §7.11) runs text turns through the AI SDK
    and the four provider packages against hand-written server-sent events
    behind the egress, with model ids the packages know: each provider's
    request (the URL, the key only in its header, Anthropic's version, cached
    instructions and conversation without sampling or thinking settings and
    the model's 128,000
    `max_tokens`, OpenAI's `store: false` and the old `include` only for
    reasoning models, Google's Interactions, OpenAI-compatible's
    `stream_options`) and the tokens of `done`; the `max_tokens` Anthropic's
    package sends a model it does not know (128,000 with `claude-` in the id,
    4,096 without), with its warning and `length`; `delta`s gathered for
    50 ms and cut at 4 KiB between code points; the conversation, which drops
    a step that failed, broke off or was refused and keeps reasoning with its
    signature without sending it to the app; the code of an answer that
    closes early on each provider; the time line before the person's text,
    from an injected clock and time zone read again each turn, one string for
    an OpenAI-compatible server; another chat's `turn`, `busy`, `cancel` and
    a close; the retries (three failures sent three times, ending with the
    last one's code; a 503 then a 200 after the 503's `retry-after-ms`; a
    `cancel` during the wait ending at once with nothing more sent; 401, 403,
    400, 404, a certificate and a redirect one request; a refused connection
    again after 2 s and 4 s; a stream error before output three requests on
    OpenAI and Anthropic, after output one despite `onError`); the
    first-output and between-output limits made short (a request past the
    first-output limit sent once, and the wait after a failure status outside
    it); the 600 s limit on a fake clock, which a request sent again after
    OpenAI reported an error a second before it starts anew, so its answer
    may come after the first request's limit; the 600 s between outputs on a
    fake clock, which each output starts anew; Bun's idle-timeout
    `TimeoutError` before the headers, in the body and after output, each
    sent once and ending with `timeout`; the 2 MiB conversation limit; and no
    key, text or answer in a log line.
    A test fails on any AI SDK warning it does not expect. The providers'
    event shapes live in `tests/support/provider-events.ts`, which
    `chat-tools.test.ts` shares.
  - `chat-tools.test.ts` (contract §7.11 "도구") hands a chat the 35 tools
    built from the planner's descriptors, as `app serve` does: each
    provider's request carries the tool definitions without `$schema` or
    safe-integer bounds and gets the outcome envelope back under the call's
    id; each call goes through the call lifecycle and reaches the app as two
    `tool` events, after the text before it; a step's calls run one at a time
    in the model's order; a failed request sent again after a tool step runs
    no tool again; `step-limit` after the 20th request, and the turn after
    it; the 64 KiB fit (a read `failed`, a change that happened `partial`);
    `chat.invalid_call` for a malformed call and for a tool the core does not
    have (name `null`, `unknown` in the log); call numbers counted from 1 in
    each channel; a change answered after 11 minutes; a declined confirmation,
    one past 30 s, and its `channel` and `client`; a `cancel` while calls run
    (it withdraws the waiting window, cuts planner reads, waits for a change
    already asked for, lets the core's own sends and reads run out, and
    before the response ends runs and keeps nothing); a channel closed during
    a call; calls the AI SDK did not run (the `chat.not_run` envelope, two
    `tool` events, the warn line and the next turn's request after
    OpenAI-compatible and Anthropic `length` and an OpenAI-compatible unknown
    reason; the text before them first; results in call order beside a
    malformed call; call numbers that go on); no request after a step that
    ended for a reason other than `stop` or `tool-calls` (a call cut in the
    middle of its arguments read as malformed, the turn ending with `length`
    after one request and the next turn's request carrying the call and its
    error; a malformed call in an OpenAI-compatible `content_filter` answer or
    an Anthropic refusal ending with `content-filter` and nothing kept, in an
    answer ending for a reason the package does not know with `other`, and
    before a stream error with `error` and nothing kept); a conversation holding a
    call without its result ending `internal` with one error line and no
    request; Anthropic's top-level `cache_control` and tools without a mark;
    and no arguments, results or made-up tool names in a log line. A test
    fails on any AI SDK warning it does not expect.
  - `mcp-tools.test.ts` proves when each call becomes irreversible: a
    planner change reports `committed` in the same tick it sends its request,
    an allowed delete or send right before its request or command, a core
    read right before its command; a signal aborted after that does not stop
    the step, and a call that ended before it reports nothing. The chat's
    `cancel` reads this to choose the calls it withdraws.
  - `tools-call.test.ts` proves the tool call lifecycle
    (`core/src/tools/call.ts`): its start and end lines, the set of active
    calls, a thrown handler as a core failure, an abandoned call left
    unanswered, and the outcome fitted to the caller's limit.
  - `app-control.test.ts` proves the control channel (contract §8, §9): work
    requests and confirmations correlated by id, timeouts and withdrawals,
    bounded prompts, and a `confirm` body of exactly the keys the app reads,
    the channel of the call among them.
- **Core static checks**: `vp check` (format, lint with type-aware rules, type
  check) over `core/`.
- **Core stdio tests** (`core/tests/stdio`, `bun run test:stdio`, right after
  the core build). They start the built `core/dist/sherpa` with a scratch
  `HOME` and drive it through its pipes:
  - `serve.test.ts` drives `sherpa app serve` with a fake app written from the
    app connection contract (§7, §14): Mux 3 hellos and `mcp` channels, three
    concurrent MCP 2026-07-28 sessions, the refusal of 2025-era requests, the
    delete confirmation and the channel it names, a close during a call, and
    frame violations. A Mux 2 app hello and an `open` without a body end the
    core with 65; an `open` of a kind the core does not serve closes only that
    channel with `unsupported_kind`.
  - `egress.test.ts` (ADR-0012, contract §7.1): `lsof`, which must first see
    the test process's own listener and the core's descriptors 0–2, sees no
    internet socket and no listening Unix socket in the core from the hello
    through two MCP sessions and a delete waiting for the person; `--version`
    starts with the global `fetch`, `WebSocket` and AI SDK default provider
    refused too. Started in `/` as the app starts it, the built core holds
    `--use-system-ca` in its `execArgv`, and its default certificate store,
    read by a probe the test passes through Bun's `BUN_OPTIONS`, is Bun's
    bundled authorities together with the macOS system store; the same Bun
    without the flag keeps the bundled ones alone.
    A chat channel's model list for a plain-HTTP loopback origin
    ends with `egress_denied` and no connection while `lsof` sees no socket;
    a turn for one ends with `egress_denied` while the port's listener in the
    test process accepts no connection and `lsof` sees no socket, and loads
    no AI SDK;
    and one for an HTTPS loopback server with a self-signed certificate ends
    with `provider_certificate` before the server's handler sees a request.
    With a certificate authority made per test and passed in
    `NODE_EXTRA_CA_CERTS`, which the app never passes, a model list for a
    loopback server it signed gets its models; while the server holds its
    answer, every internet socket of the core is a connection to that server
    and the key is only in that request's `authorization` header. A 307 to
    another origin and a 302 to the same one from there end with
    `egress_denied`, and the redirect target sees no request. On such a
    server a model list answers without the AI SDK, which the first text turn
    loads once (its debug line); that turn gives the app its first `delta`
    while the server holds the rest, when every internet socket of the core
    is a connection to that server, and ends with `done`; the second carries
    the first answer, the server sees one model list and two turns, and the
    time line carries the time zone the Mac is set to (`/etc/localtime`),
    which the core reads without `TZ`. The built core carries the AI
    Gateway's OIDC code; the turns run with an expired Vercel CLI login in
    the core's `HOME` and a `.vercel/project.json` in its working directory,
    and both files keep their bytes and modification times. As the control,
    the real `@vercel/oidc`, called in a child with a scratch `HOME`, the same
    two files and `fetch` refused by a preload, rewrites that login to `{}`
    without calling `fetch`.
  - `waits.test.ts`: the 30 s confirmation and 5 s discovery waits on the real
    clock.
  - `cli.test.ts`: the built CLI checks every argument before it opens a store,
    and reads no configuration from the directory it runs in, `HOME` or
    `XDG_CONFIG_HOME`: with `.env` files, `bunfig.toml`, `tsconfig.json` and
    `package.json` in that directory and a `.bunfig.toml` in each of the other
    two, each of which writes to standard error once read, `--version` leaves
    standard error empty. A Bun 1.4.5 standalone executable reads the
    `.bunfig.toml` of neither `HOME` nor `XDG_CONFIG_HOME`, even built without
    the flags, so those two cases guard a later Bun.
- **Swift format check** (`swift format lint --strict`, the gate's second step):
  every Swift file Git sees, tracked or untracked and not ignored, is already in
  the form `swift format --in-place` gives it under the root `.swift-format`:
  4-space indentation, 120 columns, unindented `#if` bodies, and the default
  rules except `AlwaysUseLowerCamelCase`, `NoAccessLevelOnExtensionDeclaration`,
  `NoParensAroundConditions`, `ReplaceForEachWithForLoop` and
  `UseLetInEveryBoundCaseVariable`, whose fixes change code beyond its format
  (bunny-holes/sherpa#70). Removing the parentheses that keep a trailing closure
  in a `guard` condition from reading as the statement's body brings back a
  compiler warning. swift-format ships with the Xcode toolchain (6.4.4 in
  Xcode 27.2) and reads the nearest `.swift-format` above each file. The check
  proves layout only, not behavior. A toolchain whose formatter output differs
  fails the gate until the sources are formatted again in a `style:` commit
  listed in `.git-blame-ignore-revs`.
- **Swift helper tests** (`swift test` for `worker-protocol`,
  `foundation-models-service`, `eventkit-service`): Worker Protocol V2 envelope
  and payload validation, EventKit request decoding including
  `reminder.list` with omitted optional keys, recurrence and occurrence logic,
  the journal store's single terminal transition, and the in-process Mail and
  ReminderKit shims answering `capabilities` without a worker.
- **App package tests** (`swift build`, then `swift test`, for `sherpa-app`, the
  fourth package of `SWIFT_PACKAGES` in `scripts/check-all.sh`): Mux frame
  vectors and line bounds, the relay preface and its exit codes, the code
  requirement with the team compiled in, the core restart backoff, the private
  run folder and socket, the four variables the core receives, and process
  tests that run `sherpa-app-testhost` and `sherpa-relay` against
  `sherpa-fake-core`: one `mcp` channel per relay; a Mux 2 core stopped as
  incompatible without a restart; refusing a direct connection, code that fails
  the requirement and a seventeenth session; confirmations, shown with their
  channel's kind and answered `unavailable` without a window when that channel
  is closed or unknown or the body has no usable channel; and the MCP switch,
  which closes the `mcp` channels' confirmation windows one id at a time. No
  test yet shows a chat channel's confirmation while MCP is off, because the
  app opens no chat channel before bunny-holes/sherpa#67.
- **App release-build checks** (`check:app-release`, after the package tests):
  `swift build -c release` builds `sherpa-relay` and `sherpa-app-testhost`.
  The relay's test variables, which move its socket and its code requirement
  (contract §2, §13.2), are in the DEBUG executable and not in the release
  one; a name under 16 bytes fails, because Swift keeps such literals inside
  instructions where `grep` cannot see them. Given those variables, the DEBUG
  relay reaches a fake app at another path, while the release relay ignores
  them, connects to the default socket and ends with 69 or 77. The release
  test host's `--print-configuration` takes none of the four variables that
  move the socket, the core and the two requirements, and reports the bundle
  layout and the production requirements.
- **App bundle** (`check:app-bundle`, after the core build): `xcodebuild`
  builds `apple/sherpa-app/Sherpa.xcodeproj` from scratch and signs it with
  the owner's Developer ID certificate; without the certificate the gate
  stops. A fake core that does not know `app serve`, passed as `SHERPA_CORE`,
  must fail the build with `core_not_mux` and leave no signed executable, and
  one with the right hello whose runtime answers `0.0.1` must fail it with
  `core_runtime_mismatch`, the Embed Core phase's own Bun check, and leave
  none either. The
  Release bundle holds exactly `Sherpa`, `sherpa-core` and `sherpa-relay`; the
  app and the relay hold none of the test variables; the Info.plist carries
  the contract's values and the CLI version; the signature verifies strictly
  and deeply; and each executable has its identifier, the hardened runtime, a
  designated requirement that names the team, and exactly its entitlements.
  The bundled relay reports the CLI version, and the bundled core carries the
  declared Bun.
- **CLI contract probes** in `scripts/check-all.sh`: the `--version` shape the
  Formula test parses, and that an invalid planner request ends in the named
  error `protocol.invalid_envelope` through the core and the helper.
- **Plugin checks** (`plugins/sherpa/scripts/check.sh`): manifests, the
  `.mcp.json` registration (contract §2 "플러그인의 MCP 등록"), skill set, that
  every MCP tool a skill names is in the core's tool registry and that no skill
  calls the CLI, that the one `sherpa …` command a skill asks the person to run
  exists in `sherpa --help`, script references, and descriptions.
- **Document checks**: structure and relative links
  (`scripts/checks/verify_docs.py`), and that every `sherpa …` command in the
  READMEs and `docs/testing/` exists in `sherpa --help`
  (`scripts/checks/verify_doc_commands.py`). That check exists because
  `live-validation.md` still named the Rust-era context sync command in 0.7.1.
- **Release smoke** (`scripts/check-release.sh`): packages the archive with
  exactly `bin/sherpa` and `libexec/SherpaHelper.app`, renders both Formulas,
  installs the local one with Homebrew, checks the installed bundle signature,
  and runs the installed CLI. `package.sh` first runs the core it packages in a
  directory holding the files `cli.test.ts` uses and stops with
  `core_reads_working_directory` if any of them is read.

## Live tests

Live Apple, Mail, Messages, and KakaoTalk checks are owner-operated and opt-in;
the [live validation runbook](live-validation.md) lists them. Record each
observation with its date in [live evidence](live-evidence.md). The
[verification matrix](verification-matrix.md) predates the Bun core and has not
been re-reviewed against it.

## Related

- [System architecture](../architecture/README.md)
- [Hexagonal modularization test plan](hexagonal-modularization.md)
- [Incremental hexagonal modularization RFC](../rfc/0003-hexagonal-modularization.md)
- [Planner requirements](../requirements/planner-authority.md)
- [Worker protocol](../contracts/worker-protocol.md)
- [Context requirements](../requirements/context-intelligence.md)
- [Distribution requirements](../requirements/distribution.md)
- [Unsigned Homebrew distribution](../adr/0005-unsigned-homebrew-distribution.md)
- [Homebrew release runbook](local-homebrew-release.md)
- [Public output contracts](../contracts/public-output-v1.md)
- [Owner-operated live validation](live-validation.md)
- [Requirement verification matrix](verification-matrix.md)
- [Public output v1 contract](../contracts/public-output-v1.md)
