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
  that field (bunny-holes/sherpa#71). After the build,
  `BUN_BE_BUN=1 dist/sherpa --version` must print the same version, so the
  compiled core carries that runtime. The release notice that runs next proves
  nothing: it warns about newer Bun, core dependency, Claude Code and Codex
  releases from the npm registry and `bun outdated`, and never fails the gate.
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
- **Core static checks**: `vp check` (format, lint with type-aware rules, type
  check) over `core/`.
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
  `sherpa-fake-core`: one channel per relay; refusing a direct connection, code
  that fails the requirement and a seventeenth session; confirmations; and the
  MCP switch.
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
  and runs the installed CLI.

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
