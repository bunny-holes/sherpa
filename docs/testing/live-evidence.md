---
uuid: 01a0ed5f-8dd1-705a-9f48-d51eac1c0851
type: note
audience: "Maintainers checking what was actually observed on a device before trusting a Sherpa claim"
goal: "Find the dated observation behind a current fact, and what that observation did not cover"
tone: "Dated, factual English. Separates what ran from what was inferred or left unobserved"
manner: "Newest entry first; each entry names its device, build, commands, and exact results"
---

# Sherpa Owner-Operated Live Evidence

## 2026-11-22 — The MCP switch in the exported app built from `e0e2670` (bunny-holes/sherpa#54)

This Mac, run by the main session on `Sherpa.app` exported from the
bunny-holes/sherpa#54 branch at `e0e2670`; that session keeps the
screenshots. Recorded from its report, which gave no Codex version or command
line.

- At the first launch the status window opened by itself, with MCP off.
- While MCP was off, the relay ended with exit 75 and its remedy line, and
  Codex showed the server as `failed`.
- Turned on with the window's switch, Codex connected, listed 35 tools, and a
  tool call `succeeded`.
- The relay path in the window was shown whole.
- The owner then asked that the connection guide not fill the window: "mcp를
  활성화 하면 연결 방법은 ?를 통해서 직접 보게해라. 화면을 설명으로
  덮어버리지마라". The window now holds the header, the MCP row and the
  permissions, and the guide opens from the MCP row's help button while MCP is
  on (app-connection-v1 §2). That layout is not measured yet.
- Not in the report: the menu's switch, turning MCP off under a connected
  agent, Claude Code while MCP is off, a copied command, and an install path
  longer than `/Applications/Sherpa.app` (app-connection-v1 §13.4).

## 2026-11-22 — Agent registration commands written into empty configuration homes (bunny-holes/sherpa#54)

This Mac, run by the worktree session of bunny-holes/sherpa#54 to fix the
commands the status window shows (app-connection-v1 §2 "MCP 켜기와 연결 안내").
Each agent wrote into an empty temporary folder, so `~/.claude` and
`~/.codex` did not change. No relay started and no model was called. The
relay path in both commands held a space and was single-quoted by the shell,
as the app quotes it.

- Claude Code 2.1.326: `claude mcp add --help` gives
  `claude mcp add [options] <name> <commandOrUrl> [args...]` with
  `-s, --scope <scope>` (`local`, `user` or `project`). With
  `CLAUDE_CONFIG_DIR` set to the empty folder,
  `claude mcp add --scope user sherpa -- '<path>/sherpa-relay'` printed
  `Added stdio MCP server sherpa with command: <path>/sherpa-relay  to user
  config`. That folder's `.claude.json` then held
  `"mcpServers": {"sherpa": {"type": "stdio", "command": "<path>/sherpa-relay",
  "args": [], "env": {}}}`.
- Codex 0.171.0: `codex mcp add --help` gives
  `codex mcp add [OPTIONS] <NAME> (--url <URL> | -- <COMMAND>...)` with
  `--env <KEY=VALUE>`. With `CODEX_HOME` set to the empty folder,
  `codex features enable mcp_2026_07_28` printed that it enabled the feature
  in `config.toml`, with a warning that under-development features are
  enabled.
  `codex mcp add --env CODEX_MCP_PROTOCOL_VERSION=2026-07-28 sherpa -- '<path>/sherpa-relay'`
  printed `Added global MCP server 'sherpa'.` The folder's `config.toml`
  then held `[mcp_servers.sherpa]` with that `command`,
  `[mcp_servers.sherpa.env]` with `CODEX_MCP_PROTOCOL_VERSION = "2026-07-28"`,
  and `[features]` with `mcp_2026_07_28 = true`.
- A program that reads `UserDefaults.standard` read `mcpEnabled` as false
  without arguments and true when started with `-mcpEnabled YES` (the
  argument domain). The app's MCP switch is a consent mark, not a security
  boundary (app-connection-v1 §2).
- Not measured: the app's MCP switch, its status window and menu, whether a
  copied command connects, and the relay path under a long install path
  (bunny-holes/sherpa#52). They are the owner-operated checks of
  app-connection-v1 §13.4.

## 2026-11-22 — Claude Code calls a tool through the exported app built from `main` (bunny-holes/sherpa#51)

This Mac, run by the main session. `main` at `8de36c6` was built from
scratch and exported: `Sherpa.app` 0.8.5, Developer ID,
`codesign --verify --deep --strict` passed, not notarized. A `tee` in front
of the bundled `sherpa-relay` recorded the wire; only methods and versions
were kept.

- Claude Code 2.1.326, `claude -p` with `--model haiku` (`claude-haiku-5-5`),
  `--strict-mcp-config --mcp-config` and
  `--allowedTools mcp__sherpa__reminder_authorization_status`:
  - The requests were `server/discover`, `tools/list` and `tools/call`, all
    three with the 2026-07-28 envelope and `clientInfo.name` `claude-code`.
    The first answer gave `supportedVersions: ["2026-07-28"]`.
  - The tool result's `status` was `succeeded`. The run took 3 turns and
    about 0.006 USD.
- Codex 0.171.0 `codex app-server` on the same build:
  - With the feature `mcp_2026_07_28` and `CODEX_MCP_PROTOCOL_VERSION=2026-07-28`
    in the server entry's env, it connected, listed 35 tools, and the call
    succeeded.
  - In its default configuration it was refused, and a tool call returned
    `-32603` `failed to get client`.
- This closes "a tool call from Claude Code through the exported app", left
  open in the entry below, in ADR-0011 and in app-connection-v1 §16.

## 2026-11-22 — The exported app with the 2026-07-28-only core serves both agents' 2026-07-28 opening and refuses Codex's default `initialize` (bunny-holes/sherpa#51)

This Mac, run by the main session. Branch `feat/mcp-2026-07-28` at `233ee48`
was archived and exported with the contract §2 bundle build commands:
`Sherpa.app` 0.8.5, Developer ID, `codesign --verify --deep --strict`
passed, not notarized. It ran in place of the `main` build. A `tee` in front
of the bundled `sherpa-relay` recorded the wire; only methods, versions and
errors were kept.

- Codex 0.171.0 `codex app-server`, with `-c` overrides only:
  - Feature `mcp_2026_07_28` on and `CODEX_MCP_PROTOCOL_VERSION=2026-07-28` in
    the server entry's env: `server/discover`, `tools/list` and `tools/call`
    all carried the 2026-07-28 envelope with `clientInfo.name`
    `codex-mcp-client`. The answers gave `supportedVersions: ["2026-07-28"]`
    and 35 tools. `mcpServer/tool/call` of `reminder_authorization_status`
    returned status `succeeded`.
  - Default configuration (feature off): the only request on the wire was
    `initialize` with `protocolVersion` `2025-06-18`. The core answered
    `-32022` `Unsupported protocol version: 2025-06-18` with
    `data: {"supported":["2026-07-28"],"requested":"2025-06-18"}`. Codex did
    not ask again with a newer revision. It left the server at
    `runtimeStatus` `failed` with `toolsError` `MCP startup failed:
    handshaking with MCP server failed: JSON-RPC error: -32022: Unsupported
    protocol version: 2025-06-18(...)`, and a tool call returned `-32603`
    `failed to get client: MCP startup failed: ...`.
- Claude Code 2.1.326, interactive, started in a pty with
  `--strict-mcp-config --mcp-config`. No prompt was sent, so no model was
  called.
  - The first request was `server/discover` (id `server-discover-probe-1`)
    with the 2026-07-28 envelope and `clientInfo.name` `claude-code`. The
    answer gave `supportedVersions: ["2026-07-28"]`. `tools/list` followed
    with the 2026-07-28 envelope.
  - Claude Code's MCP log: `Successfully connected (transport: stdio) in
    49ms`, server `sherpa` 0.8.5, `hasTools` true.
- Not measured: a tool call from Claude Code, which needs a model call, and
  the `clientCapabilities` either agent declared (not recorded).

## 2026-11-22 — Codex 0.171.0 reaches the exported app on MCP 2026-07-28 only with its feature and env (bunny-holes/sherpa#51)

This Mac, run by the main session. The exported `Sherpa.app` 0.8.5 was
running; its core still had the SDK default `legacy: 'serve'`. Codex 0.171.0 ran `codex app-server` with `-c` overrides,
so no configuration file changed. A `tee` in front of the bundled
`sherpa-relay` recorded the messages on the wire.

- With the feature `mcp_2026_07_28` on and `CODEX_MCP_PROTOCOL_VERSION=2026-07-28`
  in the server entry's env:
  - The first request was `server/discover`. Its `_meta` carried
    `io.modelcontextprotocol/protocolVersion` `2026-07-28`, `clientInfo` and
    `clientCapabilities`. `tools/list` and `tools/call` carried the same
    envelope.
  - The server answered `supportedVersions: ["2026-07-28"]` with
    `io.modelcontextprotocol/serverInfo` in the result's `_meta`.
    `tools/list` listed 35 tools and `reminder_authorization_status` succeeded.
  - The relay Codex started reached the app on the default socket.
- With either of them missing, Codex opened with `initialize` (protocol
  `2025-06-18`), then `notifications/initialized`, `tools/list` and
  `tools/call`. That core still served the 2025 era, so the calls succeeded.
- Claude Code 2.1.326 negotiated `2026-07-28` with a test server through
  `sherpa-relay` (client log `negotiatedProtocolVersion`). The exported app's
  path with Claude Code was measured later the same day (entry above).
- Corrected path: **"Claude Code and Codex negotiated 2025-11-25" was the server
  answering a hand-sent `initialize`.** The 2026-11-21 spike entry, ADR-0010
  and app-connection-v1 §10.1 recorded that protocol for both agents. Neither
  agent's negotiation was read then. The relay checks below that print
  `initialize` answering `2025-11-25` sent that request by hand too.
- The owner then decided that the core accepts 2026-07-28 only (ADR-0011). The
  core now runs `serveStdio` with `legacy: "reject"`. Its unit and stdio tests
  show the refusals:
  - an `initialize` for `2025-11-25` or `2025-06-18` gets `-32022` with
    `data: {"supported":["2026-07-28"],"requested":"<version>"}`;
  - an envelope-less request gets `-32022` without `requested`;
  - the same channel then opens with `server/discover`.
  Codex in its default configuration was run against such a core later the
  same day (entry above).

## 2026-11-21 — Delete confirmation through the exported app's relay (bunny-holes/sherpa#29)

This Mac, run by the main session. The exported `Sherpa.app` 0.8.5 built from
`main` `d2f9ad9` ran from `open`. `reminder_delete` was called through the
bundled `sherpa-relay` on a disposable reminder.

- The confirmation window came up within 0.29 s of the call, in front, with
  the right contents. Its buttons accepted a press after about 1 s
  (`armingDelay` in `apple/sherpa-app/App/ConfirmationWindows.swift`).
- Decline gave `confirmation.declined` with effect `not_started`.
- Allow gave a succeeded outcome with evidence `native_absence_readback`
  `matched`.
- Pressing nothing gave `confirmation.timed_out` after 30.01 s.
- The status window listed every permission as Allowed. Its "Agent
  configuration" cut the relay path with "…", so the path could not be read in
  full. That defect is bunny-holes/sherpa#52.
- Not measured: whether the menu bar icon shows, the menu's Quit, a call by
  Claude Code through the exported app, and memory over a long run.

## 2026-11-21 — Sherpa.app built by an Xcode project (bunny-holes/sherpa#49)

This Mac (macOS 27.3, Xcode 27.2 27B52), branch `build/xcode-app`.
`apple/sherpa-app/Sherpa.xcodeproj` now builds the bundle, and
`apple/sherpa-app/scripts/build-app.sh` is deleted. Signing used the owner's
Developer ID Application certificate (team `FN2KZ2J47B`).

- Clean builds with `-derivedDataPath apple/sherpa-app/.build/xcode` took 12 s
  (Debug) and 15 s (Release), with the three local packages. `xcodebuild archive`
  took 15 s. `-exportArchive` with `ExportOptions.plist` (method
  `developer-id`, manual signing) took 12–13 s.
- The exported bundle had these contents:
  - `Contents/MacOS/Sherpa` (1,197,280 bytes), `sherpa-core` (89,678,048) and
    `sherpa-relay` (266,704).
  - An empty `Contents/Resources`. The asset catalog has only an empty AppIcon
    slot.
  - An Info.plist with Xcode's standard keys (`CFBundleInfoDictionaryVersion`,
    `CFBundleSupportedPlatforms`, `DTXcode` 2720, `DTSDKName` macosx27.2,
    `BuildMachineOSBuild`). It also had `CFBundleShortVersionString` and
    `CFBundleVersion` 0.8.5, `LSUIElement` true and the three usage
    descriptions.
- `codesign -dvv` showed the following for each of the three executables:
  - its identifier (`dev.xiyo.sherpa`, `dev.xiyo.sherpa.relay`,
    `dev.xiyo.sherpa.core`);
  - `flags=0x10000(runtime)`, `TeamIdentifier=FN2KZ2J47B` and a `Timestamp=` line;
  - the designated requirement `anchor apple generic and identifier "<id>" and
    (... certificate leaf[subject.OU] = FN2KZ2J47B)`.

  Only the app had entitlements (calendars and Apple Events). The relay and the
  core had an empty entitlements dictionary.
- Checks on the whole exported bundle:
  - `codesign --verify --strict --deep` reported "valid on disk" and "satisfies
    its Designated Requirement".
  - `sherpa-relay --version` printed `sherpa-relay 0.8.5`.
  - `spctl -a -vv` printed `rejected` and `source=Unnotarized Developer ID`
    (exit 3). Notarization is bunny-holes/sherpa#31.
  - None of the five test variable names was in the exported `Sherpa` or
    `sherpa-relay`.
- The export signed every executable again with
  `--preserve-metadata=identifier,flags,runtime,...` and a secure timestamp. The
  core therefore kept `dev.xiyo.sherpa.core` and gained a timestamp, although the
  build phase signs it with `--timestamp=none`. Plain builds carry no timestamp.
- A stand-in core that prints an error envelope was given as `SHERPA_CORE`. The
  Debug build failed at the Embed Core phase with
  `reason=core_not_mux version=none expected=0.8.5`:
  - On warm derived data it failed in 4.6 s. The bundle's `Contents/MacOS`
    stayed empty, there was no `_CodeSignature`, and the log had no
    `CodeSign` step.
  - On fresh derived data it failed in 9.5 s. The independent `sherpa-relay`
    target still finished after the failure and signed its own product outside
    the bundle.
- Corrected path: **the generated Info.plist dropped the helper plist's version.**
  The target used `GENERATE_INFOPLIST_FILE` with the helper's `Info.plist` as
  `INFOPLIST_FILE`. While `MARKETING_VERSION` was unset, the built plist had no
  `CFBundleShortVersionString` or `CFBundleVersion`. The bundled relay then
  ended with `reason=version_unavailable` (exit 70). The version now comes from
  `MARKETING_VERSION` in `apple/sherpa-app/Version.xcconfig`, a new version
  location listed in `AGENTS.md`. The usage descriptions still come from the
  helper's plist.
- Corrected path: **codesign could not sign inside the sandboxed script phase.**
  User script sandboxing was on, and the core ran inside it. `codesign` on the
  bundle path still failed with "Write permissions error". The generated sandbox
  profile lets the phase write only its declared output and `TEMP_DIR`. The
  phase now signs a copy in `TEMP_DIR` and then copies it into the bundle.
  Sandboxing stays on.
- Corrected path: **plain Release builds carried debugging entitlements.** The app
  and the relay got `com.apple.security.get-task-allow`. With no entitlements
  file, the relay also got `com.apple.application-identifier` = `FN2KZ2J47B.`
  from the SDK's `Entitlements.plist`. Two settings removed both:
  `CODE_SIGN_INJECT_BASE_ENTITLEMENTS = NO` in Release and
  `ENTITLEMENTS_REQUIRED = NO` on the relay. With them, the plain Release build,
  the archive and the export had only the app's two entitlements.
- Corrected path: **an incremental build left a stale relay in the bundle.** Only
  the relay's signing settings had changed. The relay product was signed again,
  but the app's Code Sign On Copy step did not run again, so the bundle kept the
  old signature. The gate now deletes its derived data and builds from scratch.
- Settings the build needs, each checked by changing it back:
  - Without `OTHER_CODE_SIGN_FLAGS = --identifier dev.xiyo.sherpa.relay`, the
    relay was signed `Identifier=sherpa-relay`. With it, Code Sign On Copy kept
    `dev.xiyo.sherpa.relay`.
  - With `ENABLE_DEBUG_DYLIB = YES`, the Debug bundle also held
    `Sherpa.debug.dylib` and `__preview.dylib`. `SHERPA_TEST_CORE_BIN` was then
    in the dylib, not in `Contents/MacOS/Sherpa`, so the app target sets it to
    `NO`.
- The app exported from `e2730af` ran. The earlier dev bundle was stopped with
  SIGTERM, and the exported app was opened with `open`. It started
  `sherpa-core app serve` and listened on the default socket. Through the bundled
  `sherpa-relay`, `initialize` answered protocol `2025-11-25` and server
  `sherpa` 0.8.5. `tools/list` listed 35 tools, and the relay exited 0 at the
  end of its input.

## 2026-11-21 — The app bundle carried a core from before the MCP server (bunny-holes/sherpa#28)

This Mac. The Developer ID dev bundle was built on `main` after bunny-holes/sherpa#44
and bunny-holes/sherpa#45 with `apple/sherpa-app/scripts/build-app.sh`.

- Corrected path: **the script copied whatever `core/dist/sherpa` held.** That file
  was a build from before bunny-holes/sherpa#44, with no `app serve` subcommand.
  The menu app started it, each start ended in `invalidRequest` and then
  `mux.frame_invalid`, and the app stopped after five exits. Rebuilding the core
  (`bun run build` in `core/`) and the bundle fixed it. Through the bundle's
  relay, `initialize` then answered `2025-11-25`, `tools/list` listed 35 tools,
  and the relay exited 0.
- The script now builds the core from the checkout unless `--core` is given.
  Before any Swift build it also requires the core's first line under
  `app serve` to be the Mux 1 hello with the helper `Info.plist` version. A
  stand-in core that prints an error envelope fails with `reason=core_not_mux`
  in about 0.4 s. `scripts/check-all.sh` runs that stand-in as a regression.

## 2026-11-21 — PR #45 review fixes: the core runs only after its running code passes, closed sessions keep nothing (bunny-holes/sherpa#28)

This Mac (Mac16,8, Apple M4 Pro, macOS 27.3 26C5035r). The fixes for the review of
bunny-holes/sherpa#45 on `feat/menu-bar-app`. The checks used a scratch program
that starts a child with `POSIX_SPAWN_START_SUSPENDED`, the DEBUG test host with
ad-hoc signed copies of the relay and the fake core, and the Developer ID dev
bundle's core (`Sherpa.app/Contents/MacOS/sherpa-core`, 89,677,632 bytes,
hardened runtime).

- A child started with `POSIX_SPAWN_START_SUSPENDED` was stopped before resume
  (`proc_pidinfo` status 4, `SSTOP`). `SecCodeCopyGuestWithAttributes` with
  `kSecGuestAttributePid`, then `SecCodeCheckValidity`, gave these results for
  the stopped child:
  - An unsigned shell script at the core's path gave -67050
    (`errSecCSReqFailed`). Its running code is `/bin/sh`.
  - The fake core signed as another identifier gave -67050.
  - The fake core signed `dev.xiyo.sherpa.core`, under the test requirement, gave 0
    in 3–4 ms. After SIGCONT it ran, wrote its hello and exited 0.
  - A copy signed as another identifier was started stopped. A correctly signed
    copy was then renamed over its path, and the check gave -67034
    (`errSecCSStaticCodeChanged`: the code on disk does not match what is
    running).
  - The dev bundle's core passed the production core requirement in 9–15 ms over
    five runs. The relay's requirement rejected it with -67050. The static check of
    the same core had taken 290–550 ms (entry below).
  - SIGKILL to a stopped child ended it without a resume. `waitpid` reaped it
    within 10–13 ms, and the script's marker file was never created.
- Corrected path: **the core was checked by path, then started from the same path.**
  The reviewer swapped a signed fake core and an unsigned file under the DEBUG test
  host. In 3 of 16 starts the unsigned file ran with the app's rights. The app now
  starts the core stopped, checks the running code, and resumes it only on success.
  Otherwise it kills and reaps the core and does not start it again. The static
  pre-check is gone. The process test
  "neverLetsACoreRunWhoseRunningCodeFailsTheRequirement" puts an unsigned script
  and a fake core of another identifier in the core's place. It requires the
  rejection, no marker file and no fake-core start record. With the check bypassed,
  the same test failed with six issues.
- Corrected path: **closed sessions kept their connection and what they were sent.**
  The reviewer found three causes:
  - The outbox's `ended` closure held the connection, and the connection held the
    outbox. `leaks` reported a ROOT CYCLE. After 20 sessions, 20 RelayConnection
    and 21 Outbox objects were alive.
  - Written chunks stayed in the queue until 64 more were written.
  - The queue was not cleared when the writer stopped. With five sessions that
    each received 8 MB, the footprint went from 3.8 to 49 MB.

  The outbox now drops a chunk as soon as the writer takes it. It clears its queue
  and its closures when the writer stops. Three unit tests failed against the old
  outbox and pass now:
  - a written 8 MiB chunk is released while the outbox stays open;
  - nothing is held after `finish`;
  - 20 closed sessions free their connection and outbox.
- After the fix, the DEBUG test host and fake core ran 20 `echo` sessions. Five more
  sessions each received 8,000,132 bytes (`flood` with 2 × 4,000,000).
  - `leaks` found 0 leaks and no ROOT CYCLE.
  - `heap` showed no RelayConnection. It showed one Outbox (the core's input) and
    one CoreProcess.
  - Live malloc memory was 287 KB.
- The footprint still grew with each large session: 2.8 MB at the start, 46 MB
  after 5 of them and 128 MB after 30. The growth was vmmap's
  `Malloc Large (empty)`: 208 freed regions, 80 MB resident and 35 MB
  compressed after 30 sessions. With `MallocLargeCache=0` in the host's
  environment the footprint stayed flat: 2.8 MB, then 3.1 MB after 10 such
  sessions. `malloc_zone_pressure_relief(nil, 0)` after each write of 1 MiB or
  more did not help (73 MB after 10), so it was not kept. Freed pages can still
  hold sent bytes. The allocator's cache is deferred to bunny-holes/sherpa#46.
- Corrected path: **shutdown's last status could be an old one.** `shutdown()`
  waited until the core was cleared, then published. The exit handler wrote
  `stopped` only later. With a 50 ms delay in that gap, the reviewer saw
  "shutsDownOnSIGTERM" end on `core=ready`. `stopped` is now set in the same
  step that clears the core. The test runs with a 50 ms gap
  (`--exit-handling-delay 0.05`). With the old order the test failed on that
  line; it passes now.
- Corrected path: **the gate could not see a 15-byte name.** The reviewer moved
  `SHERPA_CORE_BIN` (15 bytes) out of `#if DEBUG`. grep then found 0 matches in
  the release build, because Swift stores a string literal of 15 bytes or fewer
  inside the instructions. The variable is now `SHERPA_TEST_CORE_BIN`, and the
  gate rejects a test variable name under 16 bytes. The gate also runs
  `sherpa-app-testhost --print-configuration` with every test variable set. The
  DEBUG build printed the injected values. The release build printed the default
  socket (`socket_override=false`), `.build/release/sherpa-core` and the two
  production requirements.
- Corrected path: **the 64 KiB work request limit counted re-encoded bytes.**
  `JSONEncoder` writes `/` as `\/`, so a request with 40,000 slashes was about
  40 KB as sent and over 64 KiB once encoded again. The app now keeps the
  request's bytes as the core sent them. The unit test requires the same bytes at
  the planner.
- Not observed yet, for the owner's integrated live check in
  bunny-holes/sherpa#29: the Allow and Decline buttons of each new confirmation
  panel stay off for about 1 s, including when a second request replaces the
  first. No deterministic test covers this AppKit path.

## 2026-11-21 — Sherpa.app socket server and relay (bunny-holes/sherpa#28, Developer ID dev bundle)

Builds of the `apple/sherpa-app` package on this Mac. Most checks ran the server
inside the DEBUG test host, which is the same server library without the menu.
The menu app itself ran as the Developer ID dev bundle from
`apple/sherpa-app/scripts/build-app.sh`: `dev.xiyo.sherpa`, team `FN2KZ2J47B`,
hardened runtime, listening on the default socket.

- Signed with the owner's Developer ID and hardened runtime, three programs passed
  the production requirements (`anchor apple generic`, leaf OU `FN2KZ2J47B`,
  identifier). They were the release `sherpa-relay` (`dev.xiyo.sherpa.relay`),
  the test host as `dev.xiyo.sherpa` and the fake core as `dev.xiyo.sherpa.core`.
  On the default socket `~/Library/Application Support/Sherpa/run/app.sock`, the
  relay accepted the host and the host accepted the relay. The core's static
  check passed in 5 ms, `echo` answered on channel 1, and the relay exited 0. The
  same release relay, given `SHERPA_APP_SOCKET` for another path, logged
  `socket=default`.
- The static check of the Developer ID signed 89 MB core (`core/dist/sherpa`,
  hardened runtime) took 290–550 ms over repeated runs. It used
  `kSecCSCheckAllArchitectures | kSecCSStrictValidate`.
- With the core of main after bunny-holes/sherpa#44, the menu app started
  `sherpa-core app serve` as its child. Through the bundle's own relay, MCP
  `initialize` answered protocol `2025-11-25` and server `sherpa` 0.8.5.
  `tools/list` listed 35 tools, the planner tools included, and the relay exited
  0 at the end of its input.
- SIGTERM to the menu app ended it in 0.12 s. The core exited, the socket file
  was removed, and `app.lock` stayed.
- A linker-signed release relay accepted the menu app and was refused with
  `peer_signature`, exit 77. That is the gate's release relay check whenever the
  app runs; with no app it exits 69.
- The first-run status window, launched by `open` from a shell, was on the
  current Space (`kCGWindowIsOnscreen` true).
- The core's environment held HOME, LOG_LEVEL, PATH and TMPDIR, plus
  `__CF_USER_TEXT_ENCODING`. That last variable appears even under `env -i`: the
  child's own CoreFoundation sets it.
- `spctl` assessed the dev bundle as `Unnotarized Developer ID`; notarization is
  bunny-holes/sherpa#31. Signing needed no keychain prompt.
- Corrected on the way:
  - **Core ignored SIGTERM.** posix_spawn reset only SIGPIPE in the core, so the
    core inherited the SIGTERM that the app ignores for its own signal source.
    After a frame violation the core ignored SIGTERM, and SIGKILL ended it 5 s
    later. The host now resets every signal. The fake core records which signals
    it inherited as ignored, and the process tests require none and a SIGTERM end.
  - **Stale status.** Status changes reached the observer from concurrent queues,
    so a stale `ready` could follow `stopped`. They now pass through one serial
    queue.
  - **Core on main could not serve.** Before bunny-holes/sherpa#44 the core had no
    `app serve`. Started by the host, it wrote a line that is not a frame. The
    host logged `mux.frame_invalid` and restarted it after 0 s and 1 s. The menu
    app showed `core_failed`, and its relay got that preface and exited 75.
  - **Menu app never quit on SIGTERM.** The first menu app build never ended after
    SIGTERM. It sat in `-[NSApplication _shouldTerminate]` after the server had
    already removed the socket. The SIGTERM source runs on the main queue, so the
    `.terminateLater` wait loop could not run the completion that
    `DispatchQueue.main` held. The completion is now a run loop block. No
    deterministic test covers this AppKit path; the 0.12 s run above is its check.
  - **Window on another Space.** When the coordinator launched the first build,
    its first-run window was on another Space (offscreen). The window now moves to
    the active Space and may join a full-screen Space.
  - **Flaky first hook run.** The pre-push hook's first run of commit `c3610f0`
    failed in the sherpa-app tests. The gate then discarded test output, so the
    failing test is unknown. The next hook run passed, and so did 12 later runs,
    three of them with every core busy. The gate now prints failing tests. Two
    races in the test helpers were fixed. A child's exit could be seen before its
    last stderr line. `Process.waitUntilExit` on a Swift concurrency thread waited
    forever for a child that had already ended.
- Measured for the Messages request: `AEDeterminePermissionToAutomateTarget` asked
  without a prompt returned `errAEEventWouldRequireUserConsent` for a running
  Messages and Mail. AppleEvents.h says a target that is not running gives
  `procNotFound` and no prompt, so the request now starts the target without
  activating it, then asks.
- Not observed yet. The first four wait for the owner's integrated live check in
  bunny-holes/sherpa#29:
  - the menu bar icon;
  - the Messages Automation prompt from the Request button;
  - quitting from the menu;
  - the front-most confirmation panel with the real core;
  - a Calendar, Reminders or Mail prompt, since all of them were already allowed
    for this identifier;
  - the Full Disk Access pane.

## 2026-11-21 — Confirmation under a reused request id, a cut connection and the 30 s budget (core 0.8.5 branch build)

This Mac (Mac16,8, Apple M4 Pro, macOS 27.3 26C5035r). The coordinator's
review of bunny-holes/sherpa#44 on `feat/core-mcp-server`, then the branch's tests
(`bun run test`, and `bun run test:stdio` against the local `bun run build`
with a scratch `HOME`).

- Reproduced: two `tools/call` of `reminder_delete` under JSON-RPC id 5 on
  one connection, then the connection cut. `@modelcontextprotocol/server`
  2.4.0 keeps one abort controller per request id
  (`_requestHandlerAbortControllers.set(request.id, …)`), so the close aborted
  only the newer call: `withdraw` went out for one window and approving the
  other ran the delete with no connection left. With the session signal taken
  out of the server, the regression test "closing a session ends every waiting
  call, even two the SDK holds under one request id" read `[false, true]` for
  the two calls' signals.
- Corrected path: every call also listens to its connection's signal
  (`AbortSignal.any`), and the channel transport answers a request whose id is
  still in flight with -32600 "Request id already in use" before the SDK sees
  it. With that refusal taken out, the in-process test of it found no answer
  within 2 s. Both tests pass with the fix.
- Corrected path: the 30 s wait began after the preview read, which could take
  20 s + 5 s itself. The clock now starts before the read, the read has
  `deadline_ms` 5000, and `timeout_ms` is what is left. In the stdio tests an
  approved delete's `timeout_ms` was above 25,000 and at most 30,000, an
  unanswered window was withdrawn 29–31 s after the call, and an approval sent
  after the withdrawal ran nothing.
- Corrected path: `imessage_send` showed only the chat number. It now reads the
  chat's display name and participant handles from chat.db (a fixture in the
  scratch `HOME`); an unknown chat or an unreadable store ends the call without
  a `confirm` frame. `[adapter:imessage:history|send]` logged `chat_id`; a
  `LOG_LEVEL=debug` run now shows no chat id, name, handle or text.
- Corrected path: `mail list` and `mail read` looked up the Mail store in the
  `EnvelopeIndex` constructor, before their argument checks, and
  `operations list --limit 0` created the journal before rejecting the limit.
  The built CLI on a scratch `HOME` now answers `invalidRequest` without a Mail
  store or journal being touched, and `mail.store_unreadable` only for a valid
  request. `mail_list` ignored `max_body_bytes`; summaries are now cut to it on
  a whole UTF-8 character.
- Not covered: the real `Sherpa.app` and relay (#28), and real agents.

## 2026-11-21 — `sherpa app serve` memory and planner schema names (core 0.8.5 branch build)

This Mac (Mac16,8, Apple M4 Pro, macOS 27.3 26C5035r). A local `bun run build`
of `feat/core-mcp-server` (bunny-holes/sherpa#27), not signed with Developer ID
and without hardened runtime, driven through its pipes by the fake app of the
stdio tests with a scratch `HOME` and `LOG_LEVEL=warn`. Physical footprint
from `footprint`, resident size from `ps`, one sample every 10 s.

- Idle, `bun scripts/measure-app-serve.ts --idle-seconds 120` (three sessions,
  12 samples): footprint 24 MB falling to 21 MB, resident 41.8–42.1 MB.
- Soak, the same run's `--soak-seconds 480`: 26,082 calls over three sessions
  in turn — `event_list` through the control channel (about one in five with a
  200 KB result), `operations_list` on the scratch journal, `tools/list`, and
  `reminder_delete` with an approved confirmation (preview read, then the
  delete) — while one session was closed and a new one opened every 10 s, 50
  sessions in all. Footprint 26 MB at the start, 31 MB at the end, at most
  49 MB; resident size grew from 48.9 MB to 156.9 MB. EOF ended the process
  with 0.
- A 4-minute rerun (13,341 calls, 26 sessions) ended at footprint 37 MB, peak
  57 MB. `footprint` put 30 MB dirty and 59 MB reclaimable in the JS heap
  region (App-Specific Tag 1), so the resident growth was mostly freed heap
  pages macOS may reclaim rather than footprint. These runs do not show a leak;
  longer runs were not made.
- The ADR-0010 spike's multiplexer stayed at 13.6 MB over 941 calls; this core
  idles at 21–24 MB. The difference was not traced.
- Not covered: a core started by a signed `Sherpa.app`, real agents, and
  Calendar or Reminders access (app-connection-v1 §13.4).

Corrected path: the planner schema test of the core gate sends the
`event_command_validate` example to the built `sherpa-apple planner request`
with the descriptor's `request_schema`. Before bunny-holes/sherpa#42 the
descriptor named `sherpa.planner.event.command.validate.request.v2`, which got
`protocol.invalid_payload`, while `sherpa.planner.event-command-validate.request.v2`
succeeded with `command_count` 2. Descriptors now spell the capability with
hyphens, and the test passes against the rebuilt helper.

## 2026-11-21 — Menu bar app and MCP spike (throwaway build, ADR-0010)

Throwaway Swift and Bun programs in the session scratch area, signed with the
owner's Developer ID; nothing shipped. Results that ADR-0010 rests on:

- A bundle with identifier `dev.xiyo.sherpa` but a different name and
  executable read Calendar and Reminders as `full_access` (663 Reminders, 26
  Events in 60 days), with and without hardened runtime, with no prompt.
- Under hardened runtime a new identifier (`dev.xiyo.sherpa.spike`) asking for
  Calendar without `com.apple.security.personal-information.calendars` was
  refused at once (granted false in 0.0 s; tccd logged the missing
  entitlement); with it, tccd logged `AUTHREQ_PROMPTING` for
  `kTCCServiceCalendar`. Reminders prompted with no entitlement at all. The
  prompts were left unanswered.
- The compiled Bun core and a TS MCP SDK probe ran under hardened runtime with
  no entitlements. Without `allow-jit` the probe's footprint after 50 calls
  was 16.5 MB instead of 22.7 MB; `imessage chats --limit 500` took 0.03 s
  either way.
- Started by the app through Launch Services, a Bun child reading `chat.db`
  failed with `imessage.store_unreadable`; the same command from the agent
  shell succeeded. The child is judged by the app's Full Disk Access, which the
  app did not have. macOS offers no prompt for Full Disk Access: the attempt
  added `dev.xiyo.sherpa` to the list switched off (`auth_value` 0). After the
  owner switched it on (`auth_value` 2), the same app-started child read one
  chat and exited 0.
- Notarization: the app (calendars entitlement), the Bun MCP multiplexer with
  no entitlements and the Swift relay, each signed with hardened runtime and a
  secure timestamp, were zipped (41 MB) and submitted with
  `notarytool --keychain-profile sherpa-notary`. Accepted in 36 s with no
  issues; the ticket lists all three executables. After stapling, a copy
  carrying a quarantine attribute was assessed by `spctl` as
  `Notarized Developer ID`, and the notarized relay completed an MCP
  `initialize` and `tools/list` against the running spike host. Saving the
  profile first failed with HTTP 403 ("A required agreement is missing or has
  expired") until the owner accepted the Apple Developer Program License
  Agreement issued 2026-10-30.
- An app-owned Unix socket with audit-token signature checks in both
  directions multiplexed three concurrent relay sessions onto one Bun process
  running TS SDK v2 `serveStdio` with a custom transport. A direct unsigned
  connection and an ad-hoc signed relay were refused; a relay facing a fake
  server exited 77; with no app it exited 69. Claude Code 2.1.326 and Codex
  0.170.0 both called tools through the relay. (The protocol 2025-11-25 first
  written here was the answer to a hand-sent `initialize`, not either agent's
  negotiation; see 2026-11-22.)
- Memory (physical footprint): MCP probe idle 20.5 MB in Bun, 2.6 MB in Rust
  rmcp 3.11.0; the multiplexed Bun server stayed at 13.6 MB and the Swift host
  at 5.2 MB over 8 minutes, 941 calls and 48 sessions. A first 20-minute run
  grew the host by about 78 MB because its reader thread had no autorelease
  pool; the Bun process stayed at 15 MB. A minimal SwiftUI `MenuBarExtra` app
  idles at 17 MB.

## 2026-11-21 — Oversized response after an applied change, through the command (CLI 0.8.5 build)

The 0.8.4 entry below rested on deterministic tests alone. A Developer ID
signed package of this change (`scripts/package.sh`, run from its extracted
`bin/sherpa`) ran `scripts/live/oversized-response.py` twice on this Mac with no
permission prompt. Both runs: the disposable list was created; `reminder.create`
with `SHERPA_APPLE_RESPONSE_LIMIT_BYTES=1024` exited 0 with a 393-byte
`partial` response, effect `native_mutation`/`applied`, evidence
`native_readback`/`matched`, error `protocol.result_too_large`/`never`, and no
result; `sherpa operations list` held one row for that operation with status
`partial` and the same code; `reminder.list` found the Reminder; the list was
deleted. `scripts/check-all.sh` now checks the read case through the core
command (`failed`, effect `none`/`not_applicable`, exit 0) and that an
unacceptable override is ignored.

After the release (PR bunny-holes/sherpa#21, merge `7ac2c11`, tag `v0.8.5`, tap
`078ef8a`), `brew upgrade xiyo/tap/sherpa` installed 0.8.5, `brew test` passed,
and the same script against `/opt/homebrew/bin/sherpa` passed with the same
results and no permission prompt across the 0.8.4 → 0.8.5 upgrade.

Observed on the way: Swift-encoded responses omit keys whose value is null
(`result`, `error`), while the Objective-C shims write `null`. Recorded as open
in `HANDOFF.md`.

## 2026-11-20 — Oversized helper responses after an applied change (CLI 0.8.4)

Before 0.8.4, `sherpa-apple planner request` journaled a mutation `completed`
and then encoded its response under an 8 MiB limit; an oversized response
became the command report `{"status":"failed"}` with exit 1, which reads as a
change that did not happen. The Mail (32 MiB) and private Reminders (1 MiB)
shims answered `failed` with effect `not_started` the same way. Found by code
reading; no oversized response was produced live.

0.8.4 (PR bunny-holes/sherpa#19, merge `3ee4b7a`, tag `v0.8.4`, tap `28f7da6`)
keeps the effect and evidence, drops only the result, and answers `partial`
(or `uncertain`) with `protocol.result_too_large` and `retry: never`; reads
still fail. Proof at release was deterministic only (`ProtocolTests.swift`,
`JournalStoreTests.swift`); the 2026-11-21 entry above adds the command run. `brew upgrade xiyo/tap/sherpa` installed 0.8.4,
`brew test` passed, the bundle's signature verified, and both
`*.authorization.status` reads stayed `full_access` with no prompt across the
0.8.3 → 0.8.4 upgrade.

## 2026-11-20 — Grants carried across a Homebrew upgrade (CLI 0.8.2 → 0.8.3)

Before the upgrade the installed 0.8.2 bundle read Calendar and Reminders
`full_access`. `brew upgrade xiyo/tap/sherpa` installed 0.8.3 under
`Cellar/sherpa/0.8.3` (tag `v0.8.3`, tap `e2aba79`); the installed bundle's
Developer ID signature verified, and without any authorization request both
statuses read `full_access` and no prompt appeared. The disposable suite
against `/opt/homebrew/bin/sherpa` returned `verified` in 4 s. This is the
first observed upgrade across which ADR-0009's grants held.

0.8.3 also stops `*.authorization.request` from answering `succeeded` when the
status stays `not_determined`; it now fails with
`eventkit.authorization_prompt_unavailable` (deterministic test only; the
no-prompt condition was not reproduced live on 0.8.3).

## 2026-11-20 — Privacy grants that survive a rebuild: Developer ID and an app bundle (CLI 0.8.2)

After 0.8.1 the owner still answered a new Calendar and Reminders prompt for
every helper build. Measured on this Mac from the Claude host, statuses only:

- Ad-hoc helper rebuilt at the same path: both grants back to `not_determined`.
- Signed with the owner's Developer ID Application certificate (designated
  requirement `identifier "dev.xiyo.sherpa" and anchor apple generic … subject.OU`,
  no code hash), granted once, then replaced at the same path by a different
  binary (release instead of debug, different size and code hash): both
  `full_access`, no prompt.
- The same signed binary at a different path: `not_determined`. A symlink to the
  granted path followed the target's grant, so a stable symlink cannot pin the
  path. Homebrew installs each version under `Cellar/sherpa/<version>/`.
- Wrapped as `Sherpa Helper.app` and signed, granted Calendar once, then copied to
  another directory with a different binary inside: `full_access`, no prompt.
  The bundle that `scripts/package.sh` then produced (a new build at a third path)
  also read Calendar `full_access` without a prompt; Reminders, not yet granted
  to the bundle identity, read `not_determined`.

CLI 0.8.2 ships the helper as the Developer ID signed `libexec/SherpaHelper.app`
(ADR-0009); the owner said they hold an Apple developer membership. Released the
same day (tag `v0.8.2`, archive sha256 `4f5afb49…b2b4f7`, tap `47b68ca`):
after `brew upgrade` the installed bundle's signature still verified with the
Developer ID chain, Calendar read `full_access` with no prompt (granted earlier
to the test bundle), Reminders asked once and reached `full_access`, and the
disposable suite against `/opt/homebrew/bin/sherpa` returned `verified` in 4 s. Earlier in
the day a zsh loop sent malformed envelopes (`protocol.invalid_envelope`, no
prompt); that was the operator's script, not Sherpa.

## 2026-11-20 — Calendar authorization under an agent host; disposable EventKit suite and a real iMessage send (CLI 0.8.0 → 0.8.1)

Run on this Mac from a shell started by the Claude desktop app. Only statuses,
counts, and timings were printed.

- Calendar: the installed 0.8.0 helper reported `event.authorization.status`
  `not_determined` while Reminders was `full_access`.
  `event.authorization.request` returned at once with no prompt, still
  `not_determined`, yet the response said `succeeded` with evidence
  `authorization_readback: matched`. Run from Terminal.app the same request
  showed the prompt and became `full_access`, but the Claude-hosted call stayed
  `not_determined`: macOS keys the grant to the responsible app, and neither the
  Claude desktop app nor the embedded Claude Code app has a Calendar usage
  description. CLI 0.8.1's helper relaunches itself with responsibility
  disclaimed; the debug build then prompted from the Claude host as
  `dev.xiyo.sherpa` and reached `full_access` for both Calendar and Reminders.
  Rebuilding the helper reset both to `not_determined` (new code hash).
- Two `*.authorization.request` calls sent with `deadline_ms: 600000` failed as
  `protocol.invalid_envelope` before any prompt; the envelope allows 1–300000.
- `sherpa-eventkit-live-verify` started its worker without arguments, so it
  could not drive `sherpa` or `sherpa-apple`; it now runs `<worker> planner
  request`. Through the core it then failed at `recurring_create` with
  `protocol.invalid_payload`: `EventCommandValidator` parsed dates only without
  fractional seconds, while the adapter writes and reads both forms and the
  verifier sends what the adapter writes. After that fix it failed at
  `timed_update_readback` (`alarm_count` expected 0, actual -1) because the
  verifier expected `[]` where the adapter reports an empty collection as null.
  With both fixed the suite returned `verified` in 6 s: 31 calls, all
  succeeded, and the journal showed 20 `completed` Calendar and Reminder
  mutations with no residue.
- iMessage: installed 0.8.0 `imessage send` to the owner's own 1:1 chat
  (owner-approved destination) returned `application_accepted` at once, the
  journal row was `completed`, and `chat.db` showed the message from me, sent,
  delivered, with no error and matching text. No Automation prompt appeared;
  Messages control was already allowed for the host.

Released the same day as CLI 0.8.1 (tag `v0.8.1`, archive sha256
`375b9e35…454aa9`, tap `e9a968c`). After `brew upgrade` the installed helper was
a new identity again; from the Claude host it prompted for Calendar and
Reminders and reached `full_access` for both. The disposable suite against
`/opt/homebrew/bin/sherpa` returned `verified` in 4 s, and a one-month
`event.list` returned 15 events in 0.09 s. Over the day the owner answered
prompts for four identities (Terminal.app, two debug builds, the Homebrew
build); each later upgrade asks once more for Calendar and for Reminders.

## 2026-11-20 — Windows support removed (owner decision)

The owner dropped Windows. The repository's only CI job (`windows-hook`, which
ran `plugins/sherpa/scripts/check-windows.ps1` on `windows-latest`) and that
script were deleted, and `verify_session_start.py` lost its Git Bash selection
and CRLF Python cases. The open Windows items in ADR-0007 `## 미검증` and the
"Windows hook silence" owner check in `HANDOFF.md` are closed as out of scope,
not as observed. The hook's silence and the guard's `unsupported` answer on
other operating systems remain and are still checked on macOS with a fake
`uname`. Plugin 0.8.1.

## 2026-11-20 — CLI 0.7.1 field failures and the 0.8.0 Bun core (macOS 27.0.1, M4 Pro, KakaoTalk Mac 26.10.0)

The owner used installed CLI 0.7.1 for a real investigation and bypassed it with
`kakaocli`, `imsg`, `sqlite3`, and AppleScript. Each failure was reproduced or
explained on this Mac, and a development build of 0.8.0 (`core/dist/sherpa` with
`sherpa-apple` from `apple/eventkit-service`) was run against the same data.
Only counts, statuses, and timings were printed.

- `sherpa context sync` → `{"error":"invalidRequest"}` on 0.7.1 and 0.8.0. The
  command never existed in the Swift CLI; `live-validation.md` still named it
  from the Rust era, and the `context` skill named no Mail or iMessage command.
  The runbook was rewritten and `scripts/checks/verify_doc_commands.py` fails
  the old text (`docs/testing/live-validation.md: sherpa context`).
- Mail: 0.7.1 `mail list --limit 1000|5000|50000` over 2020-01-01..2026-11-21
  returned 1000, 5000, and 27,964 messages (0.25 s, 0.87 s, 4.94 s). There was no
  1000-row cap, only no signal that a page was full. 0.8.0 pages with
  `--cursor`: 28 pages of 1000, 27,964 messages, 0 duplicate identifiers, 86 ms
  in total.
- Reminders: 0.7.1 `reminder.list` through EventKit returned 663 / 56 / 607
  reminders (all / incomplete / completed) in 0.43 / 0.08 / 0.35 s. The
  120-second timeout was the AppleScript `whose` query, not Sherpa. The same
  request with only `schema` and `limit` failed with `protocol.invalid_payload`
  because the helper required every optional key; 0.8.0 returns 663 reminders
  in 0.67 s through the core and helper.
- KakaoTalk: `kakaocli` 0.6.0 cannot find the account number on this KakaoTalk
  version (all four detection strategies fail; its brute force stops after 10 s
  at about 30 million candidates) and then opens the encrypted database without
  a key, which surfaces as "file is not a database". 0.8.0 `kakaotalk setup`
  recovered the number with 14 workers at about 88 million candidates per
  second in 2.7 s, verified that the derived key opens the database, and stored
  it in the login keychain. `kakaotalk status` reported `ready: true`. Compared
  with `kakaocli` given the same database and key: three searches of 100 rows
  each, 1,904 messages over three days, and 284 room names were identical.
- iMessage: 0.8.0 reads `chat.db` directly with `PATH=/usr/bin:/bin` and no
  `imsg`. Compared with `imsg` 0.21.1: 1000 chats, 18,505 messages across 999
  chats, and four ranges of the largest chat (up to 10,000 messages each)
  matched on every field.

Homebrew 7.0.15 refused the release smoke's fresh tap ("Refusing to load
formula … from untrusted tap"), so `brew audit` failed regardless of this
change. `scripts/check-release.sh` now trusts its temporary tap inside a
temporary `XDG_CONFIG_HOME`, leaving the owner's `~/.homebrew/trust.json`
untouched, and the smoke installs and `brew test`s 0.8.0, including a planner
request from the installed core through the installed helper.

Released the same day: tag `v0.8.0` on merge commit `6e1b035`, archive
`sherpa-0.8.0-aarch64-apple-darwin.tar.gz` (sha256 `a5539a03…8fb896`) uploaded
to `XIYO/sherpa` and read back by `scripts/package.sh --publish`, and the
formula pushed to `XIYO/homebrew-tap` (`d055c43`). `brew upgrade
xiyo/tap/sherpa` installed 0.8.0 on this Mac and `brew test` passed. The
installed `sherpa` and `libexec/sherpa-apple` both report 0.8.0; incomplete
`reminder.list` returned 56 reminders in 0.09 s, a 20-day `mail list` returned
479 messages with `limit_reached: false`, `imessage chats --limit 20` returned
20 chats, and `kakaotalk status` reported `ready: true`.

Not observed: a real iMessage or Mail send through 0.8.0, the Automation
permission prompt for the core's `osascript`, committing a KakaoTalk local
checkpoint against the real store (one staged pending row was left), the
Homebrew-installed 0.8.0 on a second Mac, and that KakaoTalk stays untouched
on screen during reads (no code path launches or activates it; the core reads
only its `Info.plist` file).

## 2026-10-12 — `CLAUDE.md` removed by owner decision; the 2026-09-21 import is retired

The owner decided on this date that the repository keeps one instruction file,
`AGENTS.md`, because Codex and Claude Code share the checkout. `CLAUDE.md` was
deleted, the rule in `AGENTS.md` now forbids it, and
`scripts/checks/verify_docs.py` fails when a `CLAUDE.md` exists in any form
instead of when it is missing. This replaces the `@AGENTS.md` import adopted in
the 2026-09-21 entry below; that entry stays as the record of what was measured
then.

No new measurement was taken for this change. Whether a Claude Code session
loads `AGENTS.md` without the import is unobserved here, and the conditions the
2026-09-21 entry lists under which it does not (a `CLAUDE.md` in a directory
above the checkout, a session that cannot fetch feature flags) were not
re-tested. The owner accepted that risk.

The check was run against scratch copies of the repository: no `CLAUDE.md`
exited 0; a `CLAUDE.md` holding `@AGENTS.md`, a symbolic link to `AGENTS.md`,
and a dangling symbolic link each exited 1 with the `CLAUDE.md: present` reason.

## 2026-10-05 — Plugin 0.7.8 startup behavior (Codex 0.160.0 and Claude Code 2.1.289)

On macOS, a fresh ephemeral Codex session loaded the installed plugin 0.7.8. A
temporary `sherpa` executable on PATH answered `sherpa 0.0.1`. The session used
the owner's configured hook trust bypass and no model tools. Its answer reported
the startup warning and the installed version 0.0.1. This directly proves that
Codex ran the plugin's SessionStart hook and delivered its context to the model.
The real Homebrew CLI remained 0.7.1 and was not changed by the test.
The probe invoked `codex exec --ephemeral --json --skip-git-repo-check
--dangerously-bypass-hook-trust -C <scratch>` with the fake CLI first on PATH.

On Windows, a logged-in headless Claude Code session loaded the enabled
`sherpa@plug-hole` plugin 0.7.8 alongside `svelte-arch` 7.27.2. The latter's
SessionStart hook reported a fixture version difference. Sherpa showed no
warning, as its CLI is macOS-only. The debug log named the installed Sherpa
version but did not name `session-start.sh`, so this observation does not by
itself prove Sherpa's silent hook executed. The Windows hook CI did run the
Sherpa script with ready, missing, mismatch, and unsupported fixtures and passed.
The host probe used `claude -p` with `--output-format json --max-turns 1
--debug hooks` from a disposable project.

## 2026-09-29 — Journaled send outcomes and the silent top-level failure (CLI 0.7.0 → 0.7.1)

Run here, on this Mac (macOS 26.5.1, Swift 6.3.3), against a debug build of
`d973d74`. No message, mail, Calendar, or Reminder record was read or written;
every send below is a fixture `imsg` run by the real command runner, and every
journal is an in-memory fake.

**The silent failure, reproduced.** `printf '{}' | sherpa planner request`
exited 1 with 0 bytes on stdout and 0 bytes on stderr. The envelope check threw
`WorkerProtocolError.invalidEnvelope`, and the top-level `catch` printed only a
`NativeCommandError`; every other error ended the process without output. On
0.7.1 the same call prints `{"error":"protocol.invalid_envelope","status":"failed"}`
and exits 1. A decode error in `mail send` input, which fails before any send,
prints `sherpa.internal_failure`. The gate now runs the `{}` call itself.

**The send outcomes, pinned before the fix.** The 0.7.0 `journaled` control
flow was ported unchanged into `SherpaMutationApplication`, and five tests were
run against it:

- rejected before the sender launched → `failed`: passed. This was already
  correct and is now pinned.
- sender launched, then its output exceeded the bound → expected `uncertain`,
  journaled `failed`. The runner threw `outputTooLarge` after the child ran,
  and only `uncertain` was mapped to `uncertain`.
- sender accepted, completion write refused → expected `completed` with a named
  journal failure. Instead the same `catch` wrote `failed`, which the fake
  accepted, and the command threw.
- sender failed after launch, failure write refused → the error did not say the
  journal missed it.
- journal start refused → the raw store error escaped instead of a named one.

A runner test (`effect: .mutation`, output over the limit) threw
`outputTooLarge`. After the fix all six pass, and so do the other 79 tests in
`eventkit-service`.

**Not observed.** A real iMessage or Mail send through 0.7.1, a real SQLite
write failure after a send, and an installed 0.7.1 binary. The journal failure
paths are proven only against the fake journal.

## 2026-09-21 — Codex update, pinning, and session load (codex-cli 0.155.1, macOS)

Run here, on this Mac, with three throwaway `CODEX_HOME` directories and local
probe marketplaces. It closes what the `sherpa@xiyo` catalog entry below left
open for Codex: update, `ref`/`sha` pinning, and session load. Everything in
this entry is codex-cli 0.155.1 on macOS; the Windows 11 device runs 0.154.0
and was not used.

**There is no `codex plugin update`.** `codex plugin --help` lists exactly four
subcommands: `add`, `list`, `marketplace`, `remove`. The two update paths are
`codex plugin marketplace upgrade [NAME]` and re-running
`codex plugin add <plugin>@<marketplace>`.

**`codex plugin add` never compares versions; it re-checks-out the source every
time.** Two independent proofs.

1. *Inode and a planted file.* A marker was written into the install cache
   (`PROBE-MARKER.txt`), then `codex plugin add` was re-run for the same
   plugin at the same version. The cache directory's inode changed from
   `1789998717` to `1789998735` and the marker was gone. The file count was 28
   before and after, so a count alone would have shown nothing.
2. *Same version string, two commits.* The probe marketplace pointed at two
   commits of this repository that both carry the plugin version
   `0.7.0+codex.20260827020000` — `0dc0efc4` (no hooks) and `1b6408c0`
   (SessionStart hook present). Flipping only `sha` between them and re-running
   `add` moved the cache between 22 and 28 files, and between "no `hooks/`
   directory" and `hooks/hooks.json` plus `hooks/session-start.sh`. The version
   string never changed. Under Claude Code's rule the second install would have
   been a no-op.

**Codex deletes the old version directory.** After an upgrade the marketplace
holds exactly one cache directory. Claude Code, by contrast, leaves the old one
in place when a `ref` pin is removed and the plugin is updated (the
`ref: v0.7.0` row of the catalog entry below).

**Codex honours `ref` and `sha`; it does not silently drop them.** Five local
probe marketplaces, one variant each.

| Probe source fields | Installed |
| --- | --- |
| `ref: v0.7.0` | 0.7.0 |
| `sha: ce628821c4b3b51fb87c3f3a1c31d3ffae64e7ac` (the 0.7.1 commit) | 0.7.1 |
| `ref: main` + the same `sha` | 0.7.1 — **`sha` wins** |
| `sha: deadbeef…` (does not exist) | **exit 1**, see below |
| `zzzbogus: …` (unknown field) | installs, no message — the unknown field is dropped |

The nonexistent `sha` is the decisive one. It does not fall back to the tip:

```text
Error: git checkout deadbeef… failed with status exit status: 128
fatal: upload-pack: not our ref
```

So the only thing Codex discards in silence is a field it does not know. That
is the same trap the `github` source sprang with `path` (the subdirectory probe
entry below), still living in the schema layer.

**Runbook value.** The human-readable output of `codex plugin marketplace
upgrade` answers `Upgraded marketplace … to the latest configured revision.`
even when nothing changed. Only `--json` tells the truth, with
`upgradedRoots: []`.

**Session load is half closed.** `codex debug prompt-input [PROMPT]` ("Render
the model-visible prompt input list as JSON") exits 0 without a login. Its
`<skills_instructions>` block carries all five `sherpa:*` skills —
`agent-messenger`, `context`, `kakaotalk-local-search`, `planner`, `sherpa` —
each with the install cache path as its skill root. What remains is whether the
model actually invokes one, and `codex exec` stops at 401 Unauthorized. That is
the same root as the open Claude Code item.

**Whether Codex registers this plugin's SessionStart hook is not known.**
`.codex-plugin/plugin.json` declares `skills` only and has no hooks key; the
cached `hooks/hooks.json` describes itself as a "Claude Code adapter" and its
command uses `${CLAUDE_PLUGIN_ROOT}`. The codex binary does contain the string
`hooks/hooks.json`, but `RUST_LOG=debug` produced no hook log line. Neither
"registers" nor "does not register" is supported.

**User configuration untouched.** All three `CODEX_HOME` directories were
temporary and were removed, as were the probe marketplaces. `~/.codex/plugins`
has zero files written — checked before and after.

## 2026-09-21 — Two marketplaces share one skill namespace; re-reading the hook line

No new install was performed for this. It is a documentation reading plus a
re-reading of evidence already in this file.

**Confirmed: Claude Code names a skill after the plugin alone.** The name is
`sherpa:planner`; the marketplace is not part of it. Three sources agree.
`code.claude.com/docs/en/discover-plugins` (read on this date) states "Plugin
skills are namespaced by the plugin name". `plugins-reference` states that "the
agent `agent-creator` for the plugin with name `plugin-dev` will appear as
`plugin-dev:agent-creator`". The name-construction site in the claude 2.1.278
bundle does the same. So installing both `sherpa@sherpa` and `sherpa@xiyo`
produces five same-named skills and one same-named hook with **no way to
address one rather than the other**.

**Re-read, not re-run: the coexistence entry below already recorded who won.**
The `sherpa@xiyo` catalog entry of this same date logs
`Skipping duplicate hook registration for plugin "sherpa" from sherpa@sherpa`.
That message names the registration being *displaced*, so in that measurement
`sherpa@xiyo` had already registered and `sherpa@sherpa` was the one skipped —
**`sherpa@xiyo` won.** The same entry's other observation points the same way: a
bare `claude plugin details sherpa` resolved to `sherpa@xiyo`. The original
entry is left exactly as it was written; what is new here is knowing what that
line meant.

**Inferred, not reproduced.** Reading the obfuscated bundle suggests the winner
is decided by key order in `settings.json`'s `enabledPlugins`, with skill-list
assembly being first-wins. Version plays no part, so an older copy can win. And
`~/.claude-secondary` stores `enabledPlugins` alphabetically while `~/.claude` stores
it in install order, which would mean the winner can flip whenever the settings
file is rewritten. None of this was reproduced, and it cannot be reproduced on
this Mac right now: all four Claude profiles hold `sherpa@sherpa` 0.7.2 and
nothing else, `sherpa@xiyo` is installed in none of them (only the marketplace
is registered, in all four; `~/.claude`'s `xiyo` has `autoUpdate: true`), and
the only cache directory is `0.7.2`.

**A related mtime question is answered.** `CURRENT.md` used to say that the
`installed_plugins.json` files were rewritten at 08:04–08:07Z by an unknown
actor. The sherpa entries do carry those timestamps, but the files themselves
were rewritten later the same day by another plugin update: that
entry's `lastUpdated` is 11:59:50.793Z in one file and
12:00:04.606Z in the other. Files were read only; nothing under `~/.claude*`
was written.

## 2026-09-21 — `agent-messenger` 2.38.0 carries the Discord emoji and sticker commands

Deterministic package evidence, not an owner-operated live run. It answers the
question the `CURRENT.md` "next candidates" list left open: whether upstream
`agent-messenger/agent-messenger#337` (Discord custom emoji and stickers) had
actually shipped to npm. It had, in `agent-messenger@2.38.0`. This is why
plugin 0.7.4 writes those commands into `skills/agent-messenger/SKILL.md`.

No automated gate protects those command names. `verify_commands.py` only
matches calls that begin with `sherpa `, and step 6 of
`plugins/sherpa/scripts/check.sh` explicitly excludes `agent-messenger` from
the guard-reference rule because the skill drives an upstream CLI. The
existence check for these lines is this entry and nothing else, so the four
checks are written here in a form that can be repeated.

1. **Timing.** The pull request's `mergedAt` is 2026-09-21T08:04:51Z; npm
   published 2.38.0 at 2026-09-21T08:13:17.825Z, eight minutes later.
2. **Lineage.** `npm view agent-messenger@2.38.0 gitHead` is
   `505738a15d47a9e1d76f16302288bc347d427d84`. GitHub's compare of the merge
   commit `46268c9e142179566b49c2c4af50787ed9854926` against that `gitHead`
   reports ahead 1, behind 0 — the published tree descends from the merge
   rather than predating it.
3. **Tarball.** The 2.38.0 package contains
   `src/platforms/discord/commands/emoji.ts`, `sticker.ts`,
   `expression-format.ts`, and `expression-names.ts`, and
   `src/platforms/discord/cli.ts` registers them with `addCommand(emojiCommand)`
   and `addCommand(stickerCommand)`.
4. **Execution.**
   `bunx --yes --package agent-messenger@2.38.0 agent-messenger discord emoji --help`
   and the `sticker` equivalent exit 0 and print the signatures the skill now
   documents.

Checks 1 to 3 and the pinned help runs were performed in another session.
Repeated here against the unpinned form the skill actually uses:
`npm view agent-messenger version` answers `2.38.0`, and
`bunx --yes --package agent-messenger agent-messenger discord <server|emoji|sticker> --help`
plus `discord sticker create --help` each exit 0. Those runs are what fixed two
details of the wording: `server info` takes the server id as an argument
(`info [options] <server-id>`), and `--tags <emoji>` is the only required
option among the six commands.

Still unverified. `emoji list` and `sticker list` have not been run against a
real Discord guild, and nothing has been uploaded or deleted. By this
repository's standard there is no owner-operated live evidence for these
commands at all. The local pre-request name and byte-sniffing validation, the
`server info` slot fields, the `MANAGE_GUILD_EXPRESSIONS` requirement, and the
VERIFIED/PARTNERED restriction on Lottie stickers are read from the upstream
help text and sources — no observed response carries them.

## 2026-09-21 — Installed plugin 0.7.3 on a real Windows device

Reported by the Windows session, the session that operates a Windows 11
device. Nothing in this entry was run here.

- **Update path.** `claude plugin update sherpa@xiyo --scope user` answered
  "updated from 0.7.2 to 0.7.3 for scope user".
- **Hook.** `bash "$CLAUDE_PLUGIN_ROOT/hooks/session-start.sh"`, the same
  invocation `hooks.json` declares, run against the installed 0.7.3 cache: exit
  0, no stdout, no stderr. With no output there is no `additionalContext`.
- **Guard.** `bash "$CLAUDE_PLUGIN_ROOT/scripts/require-cli.sh"` exited 1. The
  platform value is that device's real `uname -s`, with no fake in place, and
  `brew` appears in neither stream (checked with grep).

  ```text
  stdout  {"status":"unsupported","reason":"macos_only","platform":"MINGW64_NT-10.0-26200","remedy":"none on this device: the Sherpa CLI runs only on macOS, so use these skills on a Mac"}
  stderr  warn [plugin:sherpa:require-cli:failure] platform=MINGW64_NT-10.0-26200; the Sherpa CLI runs only on macOS
  ```

Limit stated by that session: it could not open a new logged-in Claude Code
session. What is confirmed ends at the hook's empty output under the declared
invocation. That a real session on that device shows nothing, and how the model
words the `unsupported` answer when it calls a skill there, were not observed.
This replaces the "every session reads the install sentence" state of the 0.7.2
entry below for the hook's output, not for a session screen.

## 2026-09-21 — Actions billing block; hosted jobs removed; first green `main` since 0.7.2

Observed here with `gh`. From the merge of PR #8 on, GitHub did not start the
hosted jobs: "The job was not started because recent account payments have
failed or your spending limit needs to be increased."

| Run | Commit | Jobs |
| --- | --- | --- |
| 35575597752 (`main` push) | plugin 0.7.2 | `Repository gate` failure, `Windows hook gate` failure; neither started, a re-run ended the same way |
| 35589839153 (`main` push) | plugin 0.7.3 | `Repository gate` (`macos-latest`) failure, `Windows hook gate` (`windows-latest`) failure, neither started; `Windows hook gate (self-hosted)` success on the self-hosted Windows runner |
| 35605438357 (PR #11) | hosted jobs removed | `Windows hook gate` success on the self-hosted Windows runner |
| 35605553318 (`main` push) | PR #11 squash | `Windows hook gate` success on the self-hosted Windows runner; run conclusion success |

Neither red `main` run was a code failure. The 0.7.2 merge commit has the same
tree as the last commit of PR #8, which passed both hosted checks before the
block began. Whether the CI iterations of the 0.7.2 work pushed the account over
a limit is not known.

Owner decision, relayed by the Windows session quoting the owner: no
GitHub Actions payment; connect everything to self-hosted runners. PR #11
removed the two hosted jobs from `verify.yml`. A job that is always red hides a
real failure, and the jobs can be restored from git history if billing is
resolved. The remaining runner is a self-hosted Windows runner (labels
`self-hosted`, `Windows`, `X64`), online at the time of these runs. PR #10
(plugin 0.7.3) was merged by the Windows session on the owner's instruction, as
that session reported.

Consequence: the macOS gate (`scripts/check-all.sh`) no longer runs in CI. No
macOS self-hosted runner was attached: the owner gave no such instruction for
this repository, `check-release.sh` unlinks and relinks the real `sherpa`
Homebrew formula on the machine it runs on, and a laptop runner sleeps with its
lid closed, leaving jobs queued. `AGENTS.md` now requires a local full-gate
exit 0, recorded in the pull request body, before a merge. On this Mac the gate
exited 0 after the last change of PR #11 and again after the last change of
PR #9.

Installed copies on this Mac, read from files only and not modified:
`~/.claude` and `~/.claude-secondary` both list `sherpa@sherpa` 0.7.2, each with a
single `0.7.2` cache directory; both `installed_plugins.json` files were updated
on 2026-09-21 between 08:04Z and 08:07Z. In `~/.claude-secondary`, all 10
`installPath` values and all 5 `installLocation` values now lie under
`~/.claude-secondary/`, unlike the state recorded in the `~/.claude-secondary` entry
below (11 and 15, all under `~/.claude/`). This session did not make that change
and does not know who did; `claude plugin marketplace update` was not re-run in
that profile.

## 2026-09-21 — Plugin 0.7.3 on a real Windows device; the check picked a WSL `bash.exe`

Windows session report (a Windows 11 device), not run here. That session
ran `verify_session_start.py` from branch `feat/plugin-0.7.3-non-macos-silence`
at `9d77b03`.

As committed, every case failed with `hook exited 126` and output `''`. The
cause was the check, not the hook. `find_bash()` returned a WSL launcher:

```text
DEBUG rc=126  stderr=b'/bin/bash: /bin/bash: cannot execute binary file\n'
BASH = %USERPROFILE%\AppData\Local\Microsoft\WindowsApps\bash.exe
```

That device has two `bash.exe` on PATH: `C:\WINDOWS\system32\bash.exe`, which
the `SystemRoot` exclusion skipped, and `…\Microsoft\WindowsApps\bash.exe`, a
Store app-execution alias that the exclusion did not cover. Git Bash
(`C:\Program Files\Git\bin\bash.exe`) is not on PATH at all. The `git`-relative
fallback knew the right answer but ran only after the PATH scan had already
returned the wrong one.

With BASH forced to Git Bash the check exited 0 with no failures, so the 0.7.3
logic passes on real Windows. The `cygpath -u` re-prepend that keeps the fake
`uname` ahead of Git for Windows' `usr/bin/uname` works there, and so do fake
scripts without an exec bit. This closes the "fake `uname` may be shadowed" item
that PR #10 left unverified. With the real `uname`, the hook printed nothing and
exited 0.

Corrected here: `find_bash()` no longer lists bad directories. It collects the
PATH candidates and the `git`-relative paths, runs `bash -c 'echo $OSTYPE'` on
each with a timeout when on Windows, and takes the first that answers `msys` or
`cygwin`; if none does, it fails with every candidate and its rejection reason.
The selection function is exercised with fake candidates (exit 126, `linux-gnu`,
no answer, missing file, `msys`) inside the same check, so the macOS gate covers
it. Against the previous pick-the-first-file logic that self-check failed on
this Mac with `bash selection: picked '…/exits-126', expected the one whose
OSTYPE is msys`. A self-hosted job on that device was added to `verify.yml`
next to the hosted `windows-latest` job.

Run on the device by that self-hosted job (workflow run 35579700068, job
`Windows hook gate (self-hosted, <device>)`, 37 s, success; pwsh 7.6.6, git
2.55.0.windows.3, checkout `i/lf w/crlf`). `Get-Command bash` listed only the two
WSL launchers. The check logged:

```text
[check:sherpa:bash] chosen=C:\Program Files\Git\bin\bash.exe rejected=2
[check:sherpa:bash] rejected C:\WINDOWS\system32\bash.exe: OSTYPE is 'linux-gnu', not one of ('msys', 'cygwin')
[check:sherpa:bash] rejected %USERPROFILE%\AppData\Local\Microsoft\WindowsApps\bash.exe: OSTYPE is 'linux-gnu', not one of ('msys', 'cygwin')
[check:sherpa:hook] verified with %USERPROFILE%\AppData\Local\Microsoft\WindowsApps\python3.exe
```

Both WSL launchers ran and answered, so an "is it executable" probe alone would
have accepted them; the OSTYPE is what separates them from Git Bash. Git Bash was
reached through the `git`-relative path. The two hosted jobs of the same run did
not start: "The job was not started because recent account payments have failed
or your spending limit needs to be increased."

After that run the runner was renamed and relabelled: it now carries only the
automatic labels `self-hosted`, `Windows`, `X64`; the custom device label is
gone. The job now asks for `[self-hosted, Windows]` and its display name no
longer names a device. The record above replaces the device, runner, and user
names that run used with generic placeholders.

## 2026-09-21 — Plugin 0.7.2 on a real Windows device

Reported by the Windows session, the session that operates a Windows 11
device. Nothing in this entry was run here. It closes the two Windows questions
left open after the 0.7.2 merge.

- **Update path.** `claude plugin marketplace update xiyo` succeeded. The listing
  then read `sherpa@xiyo / Version: 0.7.1 / Scope: user`.
  `claude plugin update sherpa@xiyo --scope user` answered "updated from 0.7.1 to
  0.7.2 for scope user". The cache holds both 0.7.1 and 0.7.2 and the listing
  reads 0.7.2. No uninstall was needed.
- **Hook, four states.** Every run exited 0 and no payload carried a CR byte.

  | State | How it was reached | `additionalContext` |
  | --- | --- | --- |
  | `missing` | the device's real state, no fake | "Sherpa CLI가 설치되어 있지 않습니다. … 설치: brew install xiyo/package-hole/sherpa" |
  | `ready` | fake `sherpa` 0.7.0 | no output |
  | too old | fake `sherpa` 0.6.9 | "…계약과 어긋납니다(설치됨 0.6.9). 조치: brew install xiyo/package-hole/sherpa" |
  | too new | fake `sherpa` 9.0.0 | "…(설치됨 9.0.0). 조치: update this plugin (its skills expect an older CLI)" |

- **Python on that device.** `python3` is
  `%USERPROFILE%\AppData\Local\Microsoft\WindowsApps\python3.exe`, an App
  Execution Alias that leads to Python Manager. It is a real interpreter, not the
  Store stub, and it ran with exit 0. `python` is
  `…\Programs\Python\Python314\python`. The hook therefore used `python3` on
  this device, and **the `python3` → `python` fallback still has no real-device
  run**; it remains exercised only by the simulated `renamed` case. CRLF was the
  single cause of the 0.7.2 defect.
- **Every session on that device now reads the install sentence.**
  `~/.claude/settings.json` there enables `sherpa@xiyo: true` globally, the CLI
  is macOS-only, so the state is always `missing` and each session is told to run
  `brew install …`, a command that device cannot run. Whether the hook should
  speak on a non-macOS device is an owner decision.
- **plug-hole hit the same Actions billing block.** The jobs for its main push
  were not started; its local gate and pre-push hook passed.

## 2026-09-21 — SessionStart hook read every state as a failure on Windows (plugin 0.7.2)

Reported by another session operating a Windows 11 / pwsh 7 device, then
reconfirmed here from the code and on a GitHub `windows-latest` runner. The
guard `require-cli.sh` was correct (`{"status":"missing",...}`, exit 1). The hook
extracted the guard's fields with `python3 -c '... print(...)'` and read them
with bash `read`. Python's stdout is in text mode on Windows, so `print()` writes
`\r\n`; bash `read` strips only `\n`. `ready\r`, `missing\r`, and `mismatch\r`
match no `case` pattern, so every state fell to the catch-all branch and every
session read "Sherpa CLI 확인에 실패했습니다(…\r)", including one whose CLI
satisfied the contract. `emit()` appended `\r` to the payload for the same
reason. The reporting session confirmed that `sys.stdout.reconfigure(newline="\n")`
in both Python calls restores the `ready` branch and silence.

Two reasons it went unnoticed, both corrected. `check-windows.ps1` checked only
the manifests on the premise that nothing runs on Windows; that holds for the
CLI but not for the hook, which `hooks.json` registers unconditionally, and
nothing called the script anyway. And `verify_session_start.py` asked only
whether the install command was contained in the context, which the catch-all
branch also satisfies because it interpolates the remedy.

Reproduced before the fix on this Mac (Python 3.14.7) with the new regression
case, which gives the hook a `python3` whose `sitecustomize.py` reconfigures
stdout to `\r\n`. `plain` passed; `crlf` failed in all four states, for example
`crlf/ready: hook spoke while the CLI satisfies the contract: …(\\r)…}}\r\n` and
`crlf/missing: fell through to the catch-all branch: 'Sherpa CLI 확인에
실패했습니다(brew install xiyo/package-hole/sherpa\r). …'`. The `renamed` case
(a `python3` that exists but does not run, plus a working `python`) failed with
empty output: the old hook said nothing at all when `python3` did not run.

Reproduced on real Windows. A probe branch carrying the new check and the
unfixed hook ran on `windows-latest` (workflow run 35574980007, since cancelled;
the branch is deleted): the unsimulated `plain` case failed in all four states
with the same sentences and the same `\r`. The fix branch passed on the same
runner image (run 35574887239).

Facts recorded by that runner (image win25-vs2026 20260907.229, pwsh 7.6.5, git
2.55.0.windows.5):

| Question | Observed |
| --- | --- |
| Is there a `python3`? | Yes. `C:\hostedtoolcache\windows\Python\3.12.10\x64\python3.exe`, then `…\WindowsApps\python3.exe`. `python.exe` exists in the same two places. The check ran with the hostedtoolcache `python3.exe`. |
| Which `bash`? | `C:\Program Files\Git\bin\bash.exe`, then `C:\Windows\system32\bash.exe`, then `C:\Program Files\Git\usr\bin\bash.exe`. The check skips the System32 entry. |
| Line endings of the checkout | `core.autocrlf=true` from the system gitconfig; `session-start.sh`, `require-cli.sh`, `hooks.json`, and `cli-contract.json` are all `i/lf w/crlf`. Git Bash ran the hook and the guard to completion from those CRLF files and the check passed, so CRLF script files are not a cause of this defect. |
| Extensionless fake `sherpa` on PATH | Git Bash resolves and runs a `#!/bin/sh` script without an extension; the four states were reachable. |

Audited here at the same time: the hook is the only place in the plugin where
bash reads another tool's output and branches on it. `require-cli.sh` does not
call Python; it reads the contract file with `sed` and builds JSON with bash
`printf`. The three Python scripts under the skills are read by the agent, not
by bash, and `check.sh` is a macOS/Linux gate only.

Not verified: a real Windows device that has no `python3`. The `python3` →
`python` fallback is exercised only by the simulated `renamed` case. `pwsh` is
not installed on this Mac, so `check-windows.ps1` was executed only on the
runner. A real Claude Code session on Windows picking up 0.7.2 through
`plugin update` is left to the Windows session after the merge.

Reported by the Windows session in the same exchange (Windows 11 Pro 26200,
codex-cli 0.154.0, pwsh 7), not run here:

- `codex plugin marketplace upgrade` exited 0, then `codex plugin add sherpa@xiyo`
  exited 0. The cache
  `%USERPROFILE%\.codex\plugins\cache\xiyo\sherpa\0.7.1+codex.20260921101159`
  holds 28 files, the same file list as the Claude Code cache for 0.7.1. The
  listing reads `sherpa@xiyo → https://github.com/XIYO/sherpa.git`, path
  `plugins/sherpa`. **Windows Codex resolves `git-subdir`.** The plugin was then
  removed with `codex plugin remove sherpa@xiyo`, because it is macOS-only and
  of no use on that device.
- Before `upgrade`, sherpa was absent from the listing. That is not a Codex or
  documentation defect: the command had not been run on that device. Both
  plug-hole READMEs already put `codex plugin marketplace upgrade xiyo` first in
  their `## 업데이트` section and explain why the background refresh fails
  silently for a private repository.
- `git ls-remote https://github.com/XIYO/sherpa.git` exited 0. The device has
  access, so this does not show how an account without access fails.

## 2026-09-21 — Claude Code did not load `AGENTS.md` here; `CLAUDE.md` import

The repository's only agent instruction file was `AGENTS.md`, and a Claude Code
session opened in this checkout did not have it in context. The official memory
documentation (code.claude.com/docs/en/memory, read on this date) says Claude
Code v2.1.277 or later reads `AGENTS.md` directly, but only when no
`CLAUDE.md`, `.claude/CLAUDE.md`, or `CLAUDE.local.md` exists in the working
directory or any directory above it, and not at all in sessions that cannot
fetch feature flags (third-party providers, telemetry disabled, the first
session after an install or upgrade, `disableAllHooks`). For those cases it
recommends a `CLAUDE.md` next to `AGENTS.md` containing the `@AGENTS.md` import,
and the import rather than a symbolic link when anyone clones on Windows.

Measured with claude 2.1.278, `claude -p` run from the repository root with
`CLAUDE_CONFIG_DIR` pointed at a new scratch directory that held only a
`settings.json` registering an `InstructionsLoaded` command hook that appended
its payload to a scratch file. There was no login, so the run ends with exit 1
at the API call; the hook fires before that. No user configuration directory was
written.

| State | `InstructionsLoaded` payloads |
| --- | --- |
| Before (`AGENTS.md` only) | `~/.claude/CLAUDE.md`, `memory_type: Project`, `load_reason: session_start` |
| After (`CLAUDE.md` = `@AGENTS.md`) | the same, plus `<repo>/CLAUDE.md` (`Project`, `session_start`) and `<repo>/AGENTS.md` (`Project`, `load_reason: include`, `parent_file_path: <repo>/CLAUDE.md`) |

With `CLAUDE_CONFIG_DIR` set to anything other than `~/.claude`, the file
`~/.claude/CLAUDE.md` is loaded as a project instruction file, because it is a
`.claude/CLAUDE.md` in a directory above the checkout. By the documented rule
that alone stops direct `AGENTS.md` reading for every such profile on this Mac.
The documentation states that `InstructionsLoaded` does not fire for an
`AGENTS.md` read directly, so the "before" row cannot by itself prove that
`AGENTS.md` was skipped; the cold feature-flag cache of a login-free first
session is a second documented reason it would be. The "after" row is direct
evidence that the import loads it. What the model receives in a logged-in
session was not observed.

`scripts/checks/verify_docs.py` now fails when `CLAUDE.md` is missing, is a
symbolic link, or is anything other than the single line `@AGENTS.md`; each case
was run against a scratch copy and exited 1, and the correct form exited 0.

## 2026-09-21 — `sherpa@xiyo` catalog entry: install, coexistence, update, session load

`XIYO/plug-hole` PR #5 (merge commit; macOS and Windows CI both passed, and the
post-merge main CI run succeeded) added `sherpa` to both of its manifests,
`.claude-plugin/marketplace.json` for Claude and
`.agents/plugins/marketplace.json` for Codex, with the source object
`{"source":"git-subdir","url":"https://github.com/XIYO/sherpa.git","path":"plugins/sherpa"}`.
The plug-hole checker used to admit only in-repository products (entry equals
published equals a `plugins/` directory, source `./plugins/<name>`). It now
admits an external product only when `catalog-policy.json` declares it under
`external` (`{"sherpa":{"url":...,"path":...}}`): the name must be published and
cannot be primary, `url` must be a full `https://….git`, `path` must be
relative, the source object in both catalogs must equal the declaration down to
its keys, `ref` and `sha` pins are rejected, and the `github` source is
rejected. Four checker tests cover this. `XIYO/plug-hole` and `XIYO/sherpa` are
both PRIVATE.

Every Claude command below ran with claude 2.1.278 and `CLAUDE_CONFIG_DIR`
pointed at a new empty scratch directory. `~/.claude`, `~/.claude-secondary`, the
two further Claude profile directories, `~/.codex`, and the global git
configuration were identical before and after every check in this entry.

- **Install.** `claude plugin install sherpa@xiyo` exited 0. The cache
  `cache/xiyo/sherpa/0.7.1/` holds only the contents of `plugins/sherpa/`, 28
  files, no `.git`. `claude plugin details` reports `sherpa 0.7.1`, Skills (5),
  Hooks (1) SessionStart.
- **Coexistence.** With `sherpa@sherpa` and `sherpa@xiyo` installed into the
  same configuration, both list as 0.7.1 enabled and no conflict message
  appears. The debug log reads `Total plugin skills loaded: 10 (0 duplicate…
  skipped)`, yet the session init event names only the five `sherpa:*` skills.
  The hook registers once:
  `Skipping duplicate hook registration for plugin "sherpa" from sherpa@sherpa`.
  A bare `claude plugin details sherpa` resolves to `sherpa@xiyo`. Which of the
  two same-named skills actually runs was not verified.
- **Update and pinning.** `claude plugin update sherpa@xiyo` answered "already
  at the latest version (0.7.1)". A temporary probe marketplace showed that
  `ref: v0.7.0` and a `sha` pin both pass validate and install. After the pin
  was removed and the plugin updated, the `ref` install moved 0.7.0 → 0.7.1 and
  left the old cache directory in place; the `sha` install answered "already at
  the latest" and its recorded commit did not change. **Update compares the
  version number only and never looks at the commit**, so the rule that the
  version number is the only cache-invalidation signal holds for `git-subdir`
  as well.
- **Session load.** Without a login,
  `claude -p … --output-format stream-json --verbose --debug-file` emitted an
  init event that carries the cache path and the five `sherpa:*` skills, and the
  SessionStart hook exited 0. The run ended with "Not logged in", so a model
  actually invoking one of these skills was not verified.
- **Remote, after the merge.** In another new empty configuration,
  `claude plugin marketplace add XIYO/plug-hole` exited 0 with the shorthand as
  given; the resulting remote is HTTPS, and whether SSH was attempted first was
  not observed. `claude plugin install sherpa@xiyo` then exited 0 with 0.7.1,
  Skills (5), Hooks (1).
- **Codex.** codex-cli 0.155.1 with an empty `CODEX_HOME`:
  `codex plugin add sherpa@codex-probe` exited 0, version
  `0.7.1+codex.20260921101159`, and the cache holds the `plugins/sherpa` tree
  with five skills. Only the install was checked. Codex update, pinning, and
  session load were not verified.

Nothing was run on Windows. plug-hole's `CURRENT.md` (ruling 18) and the PR
body carry a handoff to the Windows session, which is the same
`XIYO/plug-hole` repository operated on the Windows device rather than a
separate repository. It asks how `sherpa` appears after a marketplace update,
how the SessionStart hook (bash and python3) and `require-cli.sh` end on
install, and whether Windows Codex resolves `git-subdir`. plug-hole's Windows
gate iterates only its `plugins/` directory, so it runs nothing for sherpa, and
nothing anywhere calls sherpa's `check-windows.ps1`.

Inferred, not run: plug-hole is held back from going public until it is
finished. Once it is public, an account without access to `XIYO/sherpa` should
fail to install this entry. No account without access was used to try it.

## 2026-09-21 — `~/.claude-secondary` sherpa update and a registry that points at `~/.claude`

`CLAUDE_CONFIG_DIR=~/.claude-secondary claude plugin update sherpa@sherpa` exited 0
and moved the install 0.7.0 → 0.7.1. Its install guidance is now
`brew install xiyo/package-hole/sherpa`, and `claude plugin list` reports no
error. The 0.7.0 cache directory remains beside the new one.

The update exposed a structural problem in that profile. All 11 `installPath`
values in `~/.claude-secondary/plugins/installed_plugins.json` and all 15
`installLocation` values in `known_marketplaces.json` pointed into
`~/.claude/plugins/...`. The sherpa that profile had been reading was therefore
the 0.7.0 cache under `~/.claude`. `claude plugin marketplace update sherpa`
exits 1 before git runs, with
`corrupted installLocation … expected a path inside ~/.claude-secondary/plugins/marketplaces … remove and re-add`.
All 15 entries are in the same state, so every marketplace update fails in that
profile. The profile's own sherpa marketplace clone is still at 2026-08-27.

Inferred, not proven: the plugin update succeeded because the CLI followed the
stale `installLocation` and read the current clone under `~/.claude`. The basis
is that the newly recorded `gitCommitSha` equals that clone's HEAD.

The registry was not re-registered. That reaches beyond sherpa and can drop
installed plugins, so it is left as an owner decision.

## 2026-09-21 — Marketplace subdirectory source probe

ADR-0007 left open which marketplace field makes an entry resolve a plugin that
lives in another repository's subdirectory (`XIYO/sherpa`, `plugins/sherpa/`).
`claude plugin validate --strict` could not decide it, so the question was
settled by real installs with claude 2.1.278. Every `claude plugin` command ran
with `CLAUDE_CONFIG_DIR` pointed at a new empty scratch directory. SHA-256
digests of `installed_plugins.json`, `known_marketplaces.json`, and
`settings.json`, plus the cache and marketplace directory listings, under
`~/.claude`, `~/.claude-secondary`, and the two further Claude profile directories
were identical before and after. No global git configuration was changed and
no credential value was printed.

A local directory marketplace `sherpa-probe` declared four entries against the
same repository:

| Variant | `source` object |
| --- | --- |
| A | `{"source":"git-subdir","url":"XIYO/sherpa","path":"plugins/sherpa"}` |
| A2 | `{"source":"git-subdir","url":"https://github.com/XIYO/sherpa.git","path":"plugins/sherpa"}` |
| B | `{"source":"github","repo":"XIYO/sherpa","path":"plugins/sherpa"}` |
| C | `{"source":"github","repo":"XIYO/sherpa","subdirectory":"plugins/sherpa"}` |

`claude plugin validate --strict` exited 0 for the combined manifest and for
each variant validated alone. Validation again distinguished nothing.

The first `claude plugin install <name>@sherpa-probe` of A, B, and C exited 1
with `git@github.com: Permission denied (publickey)`. The `owner/repo`
shorthand is cloned over SSH, for both `github` and `git-subdir`, and this Mac
has no GitHub SSH identity; its GitHub access is HTTPS through the
`gh auth git-credential` helper. A2 installed with exit 0 and no workaround,
so the full HTTPS URL uses the system credential helper and reaches the private
repository. To observe A, B, and C past the clone, the installs were repeated
with a process-scoped rewrite only
(`GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=url.https://github.com/.insteadOf`,
`GIT_CONFIG_VALUE_0=git@github.com:`). All three then exited 0 with
`Successfully installed plugin`.

Install success did not mean the subdirectory was resolved. The cache showed:

| Variant | Cache directory | Cache root | `claude plugin details` |
| --- | --- | --- | --- |
| A, A2 | `<name>/0.7.1` | `.claude-plugin/plugin.json`, `skills/` (5), `hooks/`, `scripts/`, `cli-contract.json`; 28 files, no `.git` | `sherpa 0.7.1`, Skills (5), Hooks (1) SessionStart |
| B, C | `<name>/571c8352d7e7` | whole repository root (`apple/`, `docs/`, `plugins/`, `runtime/`, `CURRENT.md`, ...); `.claude-plugin/` holds only `marketplace.json`; 138 files | entry name only, Skills (0), Hooks (0), always-on ~0 tok |

`git-subdir` with `path` is the only form that resolves the subdirectory: the
cache root is the plugin root and the version comes from `plugin.json`. The
`github` source silently ignores both `path` and `subdirectory`, copies the
repository root, finds no plugin manifest there, falls back to the 12-character
commit prefix as the version, and registers an enabled plugin with zero
components. It reports no error at validate, install, or list time, which is
the failure this probe existed to catch.

All four probe plugins were uninstalled and the marketplace was removed;
`claude plugin list` and `claude plugin marketplace list` in the scratch
configuration ended empty. `XIYO/plug-hole` was not modified. Not covered:
`ref`/`sha` pinning on `git-subdir`, `claude plugin update` behaviour for a
`git-subdir` entry, and a session actually loading the skills from such an
install.

## 2026-08-10 — iCloud Calendar residue discovery gap

An owner screenshot and iCloud.com inspection showed many server-side Calendars
whose titles begin with `Sherpa disposable Calendar verification` or
`Sherpa EventKit disposable`. The same Mac's Calendar UI and
`event.source.list` exposed only seven Calendars and none of the disposable
titles. This disproves the earlier claim that an immediate local EventKit
absence read-back proves remote cleanup.

Source discovery now calls EventKit's public `refreshSourcesIfNecessary()`
before reading Calendar or Reminder collections. Deterministic spies prove
that refresh precedes both reads, and the Swift package's 68 tests pass. An
owner-operated release query still returned seven Calendars and zero Sherpa
residue after that refresh. Therefore EventKit remains a device-local view and
cannot be the sole authority for iCloud cleanup verification. Direct iCloud
Calendar reconciliation remains incomplete and requires an authenticated
server boundary; no server-side deletion was attempted.

## 2026-08-05 — Rust-owned disposable destination v4

The owner-approved release CLI created its own disposable Calendar and
Reminder list from explicit safe source references, exercised the public item
workflows inside those destinations, and removed both the items and their
destinations. Both commands returned
`eventkit.live_synthetic_crud.v4` with `supported` state.

The Calendar path journaled five verified mutations: Calendar create, Event
create, future-series update, future-series delete, and Calendar delete. Its
exact item read-backs, both bounded occurrence-residue windows, destination
delete read-back, and an independent source-list residue count all passed.

The first Reminder attempt deliberately preserved a real failure rather than
being retried as if it were transient. Reminder-list create and cleanup were
verified, while Reminder create became `partial` with `protocol_failure` before
Rust could record an affected safe item reference. The cause was an exact
cross-language contract mismatch: Swift returned the actual worker
envelopes as `reminders` and `reminder`, while the Rust decoder required
`tasks` and `task` under `deny_unknown_fields`. Rust now maps only the actual
Swift envelope names, and a regression test accepts list, get, and verified
mutation responses while rejecting the obsolete names.

After rebuilding the release CLI, the Reminder v4 path journaled seven
verified mutations: list create, Reminder create, update, complete, reopen,
delete, and list delete. Exact item deletion read-back, destination deletion
read-back, and an independent source-list residue count all passed. The two
post-run destination residue counts were zero. All twelve final v4 journal
rows contained only safe `cal1_`, `ev1_`, `rl1_`, or `rm1_` references; no
native locator, destination title, or item content is recorded here.

Parallel source discovery also reproduced a canonical-store first-open race:
simultaneous CLI processes could read a stale schema version and replay an
already-completed migration, while concurrent fresh-database WAL transitions
could return `BUSY` immediately. Schema discovery and migration now share one
immediate transaction, WAL retries are finite and limited to `BUSY`/`LOCKED`,
and file creation accepts only the independently revalidated `AlreadyExists`
race. Twelve barrier-synchronized storage opens passed deterministically, and
32 release CLI processes then opened one fresh `SHERPA_HOME` with zero
failures.

## 2026-08-05 — Swift EventKit disposable acceptance expansion

The owner-authorized release worker and Swift live verifier returned:

```json
{"status":"verified","suite":"eventkit-disposable-calendar-and-reminder"}
```

The run created two exact disposable Calendars and two exact disposable
Reminder lists, exercised the completed public EventKit Calendar and Reminder
acceptance set, deleted both destinations by their opaque native references,
and independently confirmed their absence from source listings. It did not
select or mutate owner data by title.

The expanded Calendar run reproduced a second future-split defect: a same-time
recurrence-rule update left both the old and replacement occurrence on the
split day. The worker repair now applies to a future split with or without a
time move, but removes an old occurrence only after exact old/new identifiers
and exact starts prove two distinct branches. The corrected release run proved
old history, changed target/later occurrences, future deletion, and no
split-day duplicate. The same run covered single-occurrence title/time/all-day
changes with both neighbors, bounded deterministic reads, one/multi-day
all-day moves, and timed/all-day/daily-recurrence behavior across Los Angeles
spring DST in an explicitly zoned worker process.

The Reminder date expansion exposed that EventKit treats a component set
without hour, minute, and second as all-day. Sherpa's minute-precision payload
had passed hour and minute while leaving second absent, so a fresh due-time
Reminder lost its time. The worker now supplies second `0` when the caller
omits it. The release run then passed separate due-date-only, due-date-time,
start-only, and start-plus-due create/read stages, timed update, explicit
due/start clear, completion/reopen exact filtered membership, and recurring
completion with exact cleanup of the completed and next incomplete
occurrences.

The deterministic Swift gate passed 56 tests and the release suite remained
green after every Event and Reminder data operation gained a full-access
preflight. The owner confirmed that authorization-unavailable validation is
complete for Calendar and Reminders; the verifier does not reset or revoke TCC.
A safe count-only source audit found two read-only Calendars. Calendar
read-only rejection has a deterministic guard and an optional exact-reference
live mode, but the owner decided that a mutation-rejection live run was not an
acceptance requirement; no candidate reference or title was printed or
auto-selected. Read-only destinations are not part of the Reminder acceptance
scope, so the verifier no longer requires a Reminder-list fixture.

At the 2026-08-05 acceptance run, organizer and attendee values were read-only
Event snapshot metadata. No attendee mutation, invitation creation or sending,
or RSVP capability was implemented or claimed. The later product proposal is
tracked separately in
[RFC-0004](../rfc/0004-calendar-invitation-boundary.md).

## 2026-08-01 — Public EventKit v3

The owner explicitly approved Calendar and Reminders access and the two exact
CRUD confirmation phrases. The identity-free local binaries reported full
access for Calendar, Reminders, and the isolated private Reminder helper.

The first live attempt exposed Foundation's `UTC` to `GMT` canonicalization and
a verifier cleanup gap. Both native partial records were recovered. The shared
domain now recognizes only the reviewed UTC-link family, partial create errors
retain their safe Sherpa reference, and recurring Calendar cleanup uses the
future-series span with two occurrence-window residue checks.

The corrected verifier returned `eventkit.live_synthetic_crud.v3`:

| Capability | Create | Update | Additional mutations | Cleanup | Result |
| --- | --- | --- | --- | --- | --- |
| `calendar.crud` | `mut-0aff20nwd8w3f` | `mut-8fh3xdx957nkp` | — | `mut-08cgq7ha6g66q` | supported |
| `reminder.crud` | `mut-4hy9gbxbynfc7` | `mut-chxaptqytfk7v` | complete `mut-0dxprb34s7bwt`; reopen `mut-eb9nj5y8w8yjb` | `mut-cnxp30nwq6fgd` | supported |

An independent post-run query found zero titles with either synthetic verifier
prefix in both selected destinations. The journal contains the full safe
mutation history; this document intentionally omits destination names, native
identifiers, and item content.

After hardening create recovery so the assigned Sherpa reference is persisted
on the still-`started` journal row before read-back, the full release gate and
both owner-approved round trips were run again:

| Capability | Create | Update | Additional mutations | Cleanup | Result |
| --- | --- | --- | --- | --- | --- |
| `calendar.crud` | `mut-6tsd4456zr74y` | `mut-e5rew2g426071` | — | `mut-7yj9xye8pznjk` | supported |
| `reminder.crud` | `mut-6kq9pje0jsqtn` | `mut-7v5hrjdp4vreb` | complete `mut-e29581ghqjv5m`; reopen `mut-dy4pdfavvg1yv` | `mut-1hdy85hy4f0dv` | supported |

All eight new journal rows were independently read back as `verified`. Both
create rows already contained their safe Sherpa target references, and every
later row for that record retained the same reference. A separate bounded
post-run query again found zero Calendar and zero Reminder titles with the
synthetic verifier prefixes.

Private Reminder selectors were available, but all six advanced capabilities
remained disabled at that checkpoint pending their independent owner-approved
write/read-back checks.

## 2026-08-01 — Read-only readiness observations

The rebuilt release binary reported the isolated private Reminder helper at
the current macOS/helper revision with full Reminders access. Selector probes
completed, but tags, sections, hierarchy, flagged state, URL attachments, and
image attachments correctly remained `disabled` with
`private.requires_live_verification`. The disposable tags preview printed its
exact destination and `VERIFY_REMINDER_TAGS_ON_THIS_MAC`, then exited without a
write because no private confirmation had been supplied.

`context doctor` reported the iMessage and KakaoTalk readers ready with source
access still unknown, Mail degraded because its target application was not
running, and the on-device Foundation Models adapter ready. No communication
content was collected. The Supply doctor at that historical checkpoint reported
three markets before any matching live adapters existed; that claim has since
been disproved and is not current evidence. Doctor v2 now advertises only the
Naver capture vertical slice. No marketplace page or persisted browser profile
was opened by the historical readiness check.

These are readiness observations only. They do not replace the owner-operated
private mutations, bounded personal-source collection/model invocation, or
per-market research required by the verification matrix.

Without contacting a communication source, an empty `context status` opened
the real local Context archive. A path-redacted filesystem inspection found a
regular owner-owned database with mode `0600` beneath a non-symlink,
owner-owned directory with mode `0700`. No SQLite journal, WAL, or SHM sidecar
was present after the read-only empty status query. The public status contract
returned an empty array and exposed no content or filesystem path.

The private helper was subsequently advanced to `reminder-private-v2` after
removing an unsafe side effect: `section.assign` now resolves only an existing
section and returns `private.section_not_found` before constructing a save when
the name is absent. The release gate bans the private section-creation selector.
The rebuilt helper compiled and passed the full regression gate, its live probe
reported the v2 environment, and all six capabilities remained disabled as
required. A fresh v2 tags preview again exited without mutation and printed the
same exact owner confirmation phrase.

## 2026-08-01 — Private Reminder tags

The owner then supplied the exact `VERIFY_REMINDER_TAGS_ON_THIS_MAC`
confirmation for the selected disposable Reminder list. The isolated
`reminder-private-v2` helper completed a synthetic create, private tag replace,
private tag read-back, public EventKit read-back, and cleanup round trip on
`Version 26.5.1 (Build 25F80)`.

| Capability | Public create | Private mutation | Public cleanup | Evidence | Result |
| --- | --- | --- | --- | --- | --- |
| `reminder.tags` | `mut-2zbz7ttaz1der` | `mut-bs9qhcsm2sej1` | `mut-9ra2xg66f5z5m` | `private.live_synthetic_round_trip.v1` | supported |

All three journal rows were independently read back as `verified` and retained
the same safe Sherpa target reference. An independent bounded query found zero
remaining synthetic verification reminders. The capability registry now marks
only `reminder.tags` as `supported` for this exact OS/helper environment;
sections, hierarchy, flagged state, URL attachments, and image attachments
remain `disabled` with `private.requires_live_verification`. Destination names,
native identifiers, and item content are intentionally omitted.

## 2026-08-01 — All private Reminder capabilities on v8

The owner granted standing authorization for Sherpa's local live validation,
sensitive-source reads, and synthetic create/read-back/cleanup operations. This
removed repeated conversational approval prompts without weakening the CLI's
explicit write environment and exact-reference confirmation gates.

Testing the remaining private surfaces exposed four real compatibility defects
that deterministic selector-presence tests could not prove:

- the forwarded `flagged` getter returns an integer scalar and crashed when read
  as an Objective-C object;
- private subtask proxies did not provide a reliable title and their completion
  getter was another scalar boundary, so content read-back moved to EventKit;
- image `fileSize`, `width`, and `height` are unsigned scalars and crashed when
  read as objects;
- operation-scoped staging names allowed duplicate image attachments after a
  crash retry, so staging became SHA-512 content-addressed.

The isolated helper contained both native crashes: the Rust CLI and public
EventKit remained available, and the affected journals retained `partial`
status (`mut-eg3sjgdx08fd2`, `mut-1smt15k89x3a1`, and
`mut-8tk7qrpb7yka2`). An empty section list was also corrected from
`Unavailable` to `Absent` only after the full list-section query succeeded with
zero rows. Every incompatible helper change advanced the implementation
revision, preventing stale evidence reuse. The final helper is
`reminder-private-v8` on `Version 26.5.1 (Build 25F80)`.

The final v8 evidence is:

| Capability | Verified mutation evidence |
| --- | --- |
| `reminder.tags` | create `mut-7m7tkmweg262v`; replace `mut-8zgk0q7bfv81a`; cleanup `mut-6120546sfqz7r` |
| `reminder.sections` | create `mut-8ghvq5jzz1xj1`; assign `mut-c13ecxksgszt5`; cleanup `mut-d29cra0ked555` |
| `reminder.flagged` | `mut-2xrzfswk3edsw` |
| `reminder.attachments.url` | `mut-6veqywczgd5h8` |
| `reminder.hierarchy` | `mut-ady5pxkec1nsv` |
| `reminder.attachments.image` | `mut-fxq21vzbw6apb` |

The shared synthetic parent was created by `mut-ehfe7fskr5pnc` and removed by
`mut-avkk52a7jbty3`. All twelve final rows above were independently read back
as `verified`. Replaying the same content-addressed image on the synthetic
parent left the image count unchanged. Parent and subtask references both
returned not found after cleanup, and bounded title queries found zero parent,
subtask, section-verifier, and tags-verifier residues.

The final capability registry reports all six private capabilities as
`supported` for the exact v8 environment. No support is inferred for a future
macOS build or helper revision. Section names, destination names, native
identifiers, and user item content are intentionally omitted.

The complete deterministic `cargo xtask check` passed after the v8 rebuild. A final
post-gate capability query still reported all six as supported, and fresh
bounded residue queries again returned zero for every synthetic title.

## 2026-08-01 — KakaoTalk Context to verified Calendar Event

A bounded one-day KakaoTalk collection archived three messages from two threads.
The source worker remained read-only, the Context archive retained the exact
revisions, and analysis coverage ended with zero pending revisions. No message
was sent and no attachment binary was opened.

Live on-device analysis exposed several boundary defects before a trustworthy
candidate was accepted:

- Rust emits fractional RFC 3339 reference times, so the Swift parser was made
  tolerant of both whole and fractional seconds;
- message timestamps were incorrectly attractive as planning clocks, so timed
  Events now require both clocks in selected message content;
- date-only occurrences and timed Events were split into separate generated
  shapes, with DST-safe local-calendar conversion for all-day ranges;
- copying opaque references or source quotes was unreliable, so the model view
  now uses compact one-based invocation-local handles and restores the exact
  immutable pair only after bounded validation;
- a model-normalized date is no longer authoritative: the mapper resolves a
  unique explicit date from selected content and rejects absent or ambiguous
  temporal evidence;
- one malformed generated proposal no longer discards valid siblings; it is
  omitted with a content-free `analysis.omitted.<rule>` warning.

One inspected date-only occurrence was approved and created through the normal
PlanningCandidate gate. The first mutation (`mut-6m5kgqavgm0cy`) was recorded as
partial because this EventKit store read the inclusive local end back as
`23:59:59`. The adapter now canonicalizes only that exact all-day representation
to the next local midnight. A no-content-change follow-up
(`mut-37stga6p2308v`) completed verified native read-back, and a bounded Event
detail query confirmed the intended half-open one-day range.

After the ordinal-handle and deterministic-date changes, a fresh analysis of
the same immutable revisions returned one correctly grounded all-day Event
candidate for that existing occurrence. Unsupported all-day and timed siblings
were omitted with `all_day_start_evidence` and `event_start_evidence`. The
candidate was deliberately not approved, so no duplicate was created. Earlier
false-positive candidates expired without mutation.

iMessage and Mail remain pending their separate macOS TCC grants; this evidence
does not infer readiness for those sources.

## 2026-08-01 — Archive-free KakaoTalk fresh read

The unsigned release CLI and Context worker ran the new `context read` path
against a bounded KakaoTalk range without opening `ContextStore`. A compact
request emitted three run-scoped records from two run-scoped threads. It exposed
only `E...`, `T...`, and `P...` aliases; no native message, thread, or author
identifier and no message body appeared in compact output.

The request reached a configured native limit. The v1 coverage contract reported
`partial_limit`, `matched=3/lower_bound`, and `remaining=?/unknown`; it did not
claim completeness. A second one-record inventory request returned an empty
public item array with the same conservative limit state.

The Context SQLite modification time and byte size were captured immediately
before and after the second native read and were identical. No Calendar,
Reminder, message, or mail mutation was attempted. This proves the first
archive-free live read boundary only; checkpoint, overlap, specialist routing,
and Planner reconciliation remain separate migration gates.

## Related

- [Owner-operated live validation](live-validation.md)
- [Requirement verification matrix](verification-matrix.md)
- [Test strategy](README.md)
- [Native fresh-read ADR](../adr/0004-native-fresh-read-context.md)
- [Archive migration RFC](../rfc/0001-context-archive-to-fresh-read.md)
