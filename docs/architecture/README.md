---
uuid: 01a0ed5f-2b59-779e-b766-9204357e1d42
type: spec
audience: "Maintainers and agents changing a Sherpa target boundary, journal, or external effect"
goal: "Place a change in the target that owns it and keep dependencies and mutation states correct"
tone: "Normative technical English. States the rule, then what it protects"
manner: "Name each target's role and dependency; defer contract detail to docs/contracts/"
---

# Sherpa System Architecture

## Purpose

Sherpa is a deterministic, local-first personal orchestration system. Humans
and language models may propose intent; only Sherpa itself validates,
authorizes, executes, journals, and verifies external effects.

## Quality goals

1. One public `sherpa` interface can coordinate replaceable capabilities.
2. A broken optional capability does not prevent healthy capabilities from running.
3. Language and framework types never cross the application boundary.
4. Every mutation is previewed, approved when required, journaled, and verified
   to the strongest boundary the provider exposes; weaker acceptance evidence is
   never presented as native read-back or delivery.
5. Untrusted source content is data, never execution authority.
6. Sensitive content is absent from diagnostics, logs, fixtures, and protocol metadata.
7. The repository is self-contained: every local package, skill, protocol, and
   build resource resolves beneath the Sherpa source root.

## System shape

```text
Human / LLM
    |
    v
sherpa — Bun + TypeScript core (one compiled executable, core/)
    |-- cli/ -------------- argv parsing, bounded stdin, reports with remedies
    |-- commands.ts ------- the core commands both the CLI and the MCP tools call
    |-- app/ -------------- `sherpa app serve`: Mux 2 frames, control channel,
    |                       one MCP transport per `mcp` channel (app-connection-v1 §7–§9)
    |-- mcp/ -------------- tool registry, input schemas, outcome envelope,
    |                       confirmation previews (app-connection-v1 §10)
    |-- planner/ ---------- planner port: Worker Protocol V2 request and reply,
    |                       helper-process adapter
    |-- journal/ ---------- journal state of each external mutation (bun:sqlite)
    |-- mail/ ------------- Mail.app envelope index reads with a keyset cursor,
    |                       Mail.app send through osascript
    |-- imessage/ --------- Messages chat.db reads, Messages send through osascript
    |-- kakaotalk/ -------- KakaoTalk SQLCipher reads, key derivation, setup,
    |                       local-text checkpoint
    |-- chat/ ------------- egress, the core's only way to the network (ADR-0012)
    `-- apple/ ------------ hands Worker Protocol V2 requests to the helper
            |
            v
sherpa-apple — Swift helper (apple/eventkit-service), started only by sherpa
    |-- SherpaPlannerApplication ---- approval, idempotency, candidate freshness
    |-- SherpaMutationApplication --- journal state of each planner mutation
    |-- SherpaPlannerContract ------- Worker Protocol V2 schemas
    |-- SherpaEventKitAdapter ------- official Calendar and Reminders
    |-- SherpaReminderKitShim ------- isolated optional private capabilities
    |-- SherpaMailShim -------------- Mail.app aggregate read / send
    `-- SherpaJournalStore ---------- SQLite journal shared with the core
```

The core owns every command, its validation, its journal entry and its output.
What needs Apple frameworks and an executable with an embedded Info.plist —
EventKit, private ReminderKit, and the Mail shim — stays in the Swift helper
(ADR-0008). The core passes `planner request`, `mail request`, and
`reminder-kit request` through unchanged on standard input and output; the
helper validates the Worker Protocol V2 request, journals planner mutations,
and writes the response. Worker Protocol V2 is a contract for callers, not a
long-lived worker process, and it has no V1 runtime fallback.

Before handling a request the helper relaunches itself once with privacy
responsibility disclaimed (`PrivacyResponsibility.swift`), so macOS asks about
Calendar, Reminders, and Automation on behalf of the helper — bundle identifier
`dev.xiyo.sherpa` with its embedded usage descriptions — instead of the app that
hosts the shell. Without it a host lacking the usage description (the Claude
desktop app has none for Calendar) gets `not_determined` and no prompt.

ADR-0010 (adopted 2026-11-21) replaces this shape: `Sherpa.app` becomes the
permission subject and runs the core as one MCP server that agents reach
through `sherpa-relay`. The
[app connection contract](../contracts/app-connection-v1.md) fixes the
boundaries between the relay, the app and the core. The core speaks MCP
revision 2026-07-28 only (ADR-0011, owner decision 2026-11-22): it answers a
2025-era `initialize` with -32022 and reads each call's client from that
request's `_meta` envelope, since the revision has no protocol session. Both sides are
built: the core's `sherpa app serve` (`core/src/app/`, `core/src/mcp/`) and the
app and relay in `apple/sherpa-app`. The Swift package there holds the
connection, server, planner and relay libraries and the test programs;
`apple/sherpa-app/Sherpa.xcodeproj` builds `Sherpa.app` from them, embeds its
`sherpa-relay` target and the core built in `core/`, and exports it with
Developer ID (contract §2 "번들 빌드"). Agents reach the core only while the
app's MCP switch is on. The switch is off at the first launch and lives in the
app's defaults as a same-user consent mark, not a security boundary. While it
is off the app turns every relay away with the preface reason `mcp_disabled`,
and turning it off closes the open sessions. The status window holds the
switch; while it is on, the switch's help button opens the commands that
register the bundled relay with Claude Code and Codex. The app copies them and
never writes an agent's configuration (contract §2 "MCP 켜기와 연결 안내"). The app and relay are not released yet (notarized cask,
bunny-holes/sherpa#31), and the CLI keeps the helper path above until then.

Today no Sherpa process makes a network connection. The core reads only the
pipes the app opened for it (contract §7.1), opens no socket, and has no path
to `fetch`: the turn fetch in `core/src/chat/egress.ts` holds the runtime's
`fetch` but has no caller yet. Every core command starts with
`globalThis.fetch` refusing every call and `globalThis.WebSocket` refusing
every connection, so a bundled package that falls back to either global
reaches nothing. Lint rules keep `fetch` out of every other module and every
socket, HTTP, WebSocket, and name-lookup API out of `core/src`, and a stdio
test checks with `lsof` that the built core holds no internet or listening
socket while it serves MCP. The app listens only on its
Unix socket for relays, and the relay connects only to that socket. [ADR-0012](../adr/0012-in-app-chat.md)
(owner decision 2026-11-22, bunny-holes/sherpa#59) amends ADR-0010 decision 2
for an in-app chat that is not built yet. When it lands, `sherpa app serve` runs
the chat loop in a new `core/src/chat/` module on the Vercel AI SDK v7. The chat
calls the same 35-tool registry as MCP, with the same app-window confirmation
for deletes and sends, and sends each turn, with the tool results it reads, to
the one provider the person chose. Outbound HTTPS to that provider's origin is
then the only connection the core opens; every other outbound connection and
every listening socket stays forbidden. The API key lives in the app's data
protection keychain and reaches the core only inside the turn message on the
pipe. The owner decided on 2026-11-22 that the app stores chat history, within
the exception to the content-archive rule below. Until that work
lands, the current behavior above and contract §7.1 stand.

Sherpa is the only writer of Sherpa-owned databases. Apple remains the source of
truth for Calendar and Reminders; Messages, KakaoTalk, and Mail.app remain the
source of truth for communication content. Sherpa reads their local stores
read-only and never retains message or mail bodies in a long-lived content
archive. It stores a minimal owner-only control/provenance ledger and keeps
selected exact evidence in memory or an encrypted hard-TTL spill for one
workflow. The one exception, once the in-app chat lands, is its history (owner
decision 2026-11-22, [ADR-0012](../adr/0012-in-app-chat.md)): `Sherpa.app` will
keep each conversation, including the mail and message text its tool results
carried, only on this Mac, encrypted with a key in its data protection keychain
and excluded from Time Machine, until the person deletes it or the retention
they chose runs out, at most 90 days after the conversation's last turn. The
core writes no conversation to disk.

No external messaging CLI is involved. iMessage reads `~/Library/Messages/chat.db`
and KakaoTalk reads its SQLCipher database with a key derived in the core from
this Mac's platform UUID and the account number that `sherpa kakaotalk setup`
keeps in the login keychain. Sherpa never launches, activates, or automates the
KakaoTalk app. Sends go to Messages.app and Mail.app through `osascript` with
a fixed script and the content on standard input.

## Dependency rule

Application code owns the ports it needs. Adapters depend inward to implement
those ports. The composition roots choose implementations.

```text
core/src/main.ts (composition root of the CLI)
    -> chat/egress + cli + commands + apple helper proxy; `app serve` -> app/serve
core/src/app/serve.ts (composition root of `sherpa app serve`)
    -> app + mcp + tools + commands; picks the control-channel planner port

app (frame, mux, control, channel transport) -> mcp/confirmation, planner/port, log
mcp (registry, tools, outcome)    -> tools, commands, planner/port, cli/errors, journal,
                                     the send validation of imessage and mail, log
tools (call, outcome)             -> cli/errors, journal, planner/port, log
planner/helper-process            -> planner/port, apple/helper, log
planner/port                      -> no Sherpa module
commands                          -> journal, mail, imessage, kakaotalk, cli/errors
core adapters (mail, imessage, kakaotalk) -> cli/errors, process/runner, log
journal                                   -> cli/errors, log
chat/egress                               -> cli/errors, log

SherpaNative (helper composition root)
    -> SherpaPlannerApplication + SherpaMutationApplication + adapters

SherpaEventKitAdapter        -> SherpaPlannerApplication + SherpaPlannerContract
SherpaJournalStore           -> SherpaMutationApplication
SherpaPlannerApplication     -> SherpaPlannerContract
SherpaMutationApplication    -> no Sherpa target
SherpaPlannerContract        -> SherpaWorkerProtocol only
SherpaMailShim               -> Apple frameworks only
SherpaReminderKitShim        -> Apple frameworks only
```

No application or contract target imports EventKit, ReminderKit, CLI parsing,
terminal I/O, or provider-specific payloads. Those live in the adapter targets.
Private Apple framework code stays behind its own shim and is never a startup
dependency.

The core's `journal/` and the helper's `SherpaMutationApplication` own the
journal state of every external mutation the CLI makes itself: the helper for
`planner request` mutations, the core for `imessage send` and `mail send`. Both
write the same `native_mutations` table. The attempt and each journal write
are separate error boundaries. The terminal status comes from the attempt
alone: `failed` only when the effect never started, `uncertain` once a
mutation command was handed its input and its outcome could not be
established. A journal write that fails never changes that status and is never
retried as another one. The row stays `started`, and the command names the
journal failure in its output. The command runner reports what happened to a
command and never writes the journal.

Context collection commands are compiled, read-only operations inside the same
executable. Every request names one source, an explicit half-open
time range, chat and per-chat limits, and a total message limit. Native command
output, request input, response output, and diagnostic streams are independently
bounded. The application validates the same range and volume invariants again,
assigns run-scoped references, and renders typed completeness and freshness
without persisting source bodies.

Native watchers and notifications are wake-up hints rather than truth. Sherpa
captures a source high-water, applies bounded overlap, records a processed or
skipped page receipt, and only then advances the source checkpoint. A periodic
reconciliation repairs watcher downtime, edits, deletes, and source rotations
where the native source makes those states observable.

Context outbound is a different application use case and policy boundary:

```text
UTF-8 stdin + safe target / exact mail headers
    -> validate and persist immutable expiring draft
    -> render full preview + one-time confirmation code
    -> atomically claim exact draft and confirmation
    -> resolve K001/I001 through a live target directory
    -> revalidate the exact native target
    -> journal a versioned write_with_verification request
    -> native application accepts the send command
    -> persist accepted / failed / partial outcome
```

The public and persistent action contains only a Sherpa thread alias. Provider
conversation names and Messages chat IDs are resolved from a live directory or
short-lived opaque target token at the last responsible moment and exist only
in the adapter request. KakaoTalk uses an exact Agent Messenger account and chat
identifier; iMessage validates the exact numeric chat before sending. Unknown,
expired, changed, or ambiguous targets fail closed.
Confirmation is single-use, so a timeout or process failure after native
invocation becomes `dispatch_uncertain` and is never automatically retried.
Current send adapters can prove only `application_accepted`, not provider
delivery, recipient receipt, or read status.

The explicit Mail permission request follows the same outer boundary:
`sherpa -> ContextMailAuthorizationPort -> SherpaMailShim`. It changes only
macOS automation consent and cannot collect or mutate source records. The other
verified-write route is `context.outbound.dispatch`, and the shim independently
accepts `mail.message.send`. The composition root is the only place that binds
a native adapter; application code sees ports.

Mail.app is the initial aggregate mail adapter. It can read the already
configured enabled accounts and submit through an exact configured sender
without asking Sherpa to acquire each provider credential. It does not expose
those credentials. A later direct-mail adapter is an independent capability:
IMAP supplies reads and mailbox-state mutations, SMTP supplies submission, and
each account requires its own OAuth or app-password setup. The direct adapter
must not be silently substituted for the aggregate adapter and cannot infer
credentials from Mail.app.

Context analysis is a second, separately confirmed boundary. Sherpa first
creates inventory and compact projections, then supplies only selected detail in a
bounded EvidenceBundle. Opaque source locators are replaced with one-based,
invocation-local handles. A specialist has no mutation capability and may ask
for more detail only through a scoped read grant. Sherpa rejects a finding that
cites evidence outside the invocation. Invalid generated entries
are omitted with content-free rule codes; an empty proposal array is a valid
non-hallucinating result.

Sherpa persists only the evidence-set digest, source high-water, analysis profile,
candidate references, and DecisionTrace. Before candidate creation and again
before mutation, it reads current active and completed Reminders plus relevant
Calendar series and occurrences. It records a typed reconciliation result and
re-reads exact evidence and selected Planner items immediately before executing.
A changed or missing fingerprint makes the candidate stale instead of closing a
revision or performing a mutation.


Agent skills are not an application port. They install from the `bunny-holes/plug-hole`
marketplace with each host's own command, and the CLI neither registers nor
inspects them. The plugin registers the app's MCP server: its root `.mcp.json`
names the server `sherpa` with the installed relay
`/Applications/Sherpa.app/Contents/MacOS/sherpa-relay`, which Claude Code reads
by default and Codex through its manifest's `mcpServers`. The skills call that
server's tools and run no CLI command except the one-time
`sherpa kakaotalk setup` they ask the person to run, so the plugin carries no
CLI version guard; the gate checks every tool a skill names against the core's
tool registry (contract §2 "플러그인의 MCP 등록").

## Trust and availability

Capability state and invocation outcome are separate contracts.

```text
CapabilityState = Supported | Unsupported | Unavailable | Incompatible | Disabled | Degraded
InvocationOutcome = Succeeded | Failed | TimedOut | Cancelled | Partial
```

An unavailable or private capability never becomes an empty successful result.
Private Reminder capabilities are opt-in, OS-version-gated, selector-probed,
crash-isolated, and verified independently from EventKit.
Their verification key includes both the active macOS version and the private
helper `implementation_revision`; replacing either invalidates old evidence.
If environment or revision discovery fails, the application does not make a
second probe or trust that provider's capability rows. It emits the complete
expected set as unavailable with the classified adapter error.
For private writes, verified compatibility and the current invocation policy
are also separate axes. A stored OS-scoped round trip can report a capability
as supported, but it never enables writes. Planner doctor reports the current
`private_write_policy` independently, and mutation calls still require the
exact `SHERPA_PRIVATE_WRITES=1` opt-in.

## Planning authority

Context findings first pass live Planner reconciliation. Only a candidate whose
kind, title, destination, schedule/due value, recurrence, evidence, current
completed/incomplete Reminder relation, and relevant Calendar occurrence
relation have been reviewed may become an Event or Reminder mutation.

```text
fresh evidence -> live Planner snapshot -> reconciliation
                  -> PlanningCandidate -> validation -> preview -> approval
                  -> exact evidence and Planner revalidation
                  -> started journal -> mutation
                  -> persist Sherpa reference -> native read-back
                  -> terminal journal state
```

Create operations persist the newly assigned Sherpa reference while the
journal entry is still `started`. If native read-back then fails, cleanup and
recovery can target the created record without retaining a provider-native
locator. The reference cannot be replaced after a terminal journal transition.
The Planning workflow copies that same safe reference and operation ID into a
partial candidate outcome. If the native mutation is verified but candidate
finalization fails, its error retains both values so journal-based recovery is
still possible; a storage failure must not erase knowledge of an Apple-side
effect.

Recurring Event changes require an explicit occurrence span. Destructive and
bulk changes require an exact target preview and explicit confirmation.

## Roadmap

1. **Planner Authority** — Swift Apple helper, EventKit Calendar and
   Reminders, isolated private Reminder capabilities, PlanningCandidate flow.
2. **Context Intelligence** — bounded native fresh reads for iMessage, mail, and
   KakaoTalk; minimal control ledger; progressive evidence; live Planner
   reconciliation; approval-gated text/mail outbound; evidence-bound
   PlanningCandidate proposals. Mail.app is benchmarked header-first and direct
   per-account IMAP is added only when its SLA or coverage gate fails; SMTP is a
   separate capability.

Homebrew is the canonical product installer. A release contains the compiled
core at `bin/sherpa` and the Swift helper bundle at `libexec/SherpaHelper.app`, and nothing
else; a prebuilt archive prevents compilation on the user's Mac. The Formula
declares one runtime dependency, `sqlcipher`, whose library the core loads to
read the KakaoTalk database. Agent skills are not
part of that archive — they install from the `bunny-holes/plug-hole` marketplace,
and the Formula never registers them.

Homebrew's Formula catalog is distinct from the release archive it references.
The catalog is the public `XIYO/homebrew-tap` repository, so users install with
`brew install xiyo/tap/sherpa`, and the Formula's checksum-pinned URL names the
release asset of this repository for that version. For development on one
machine, the same generated Formula may point at a checksum-pinned `file://`
archive in a local tap; that does not change the installer boundary. In either
mode, the release version must be incremented and the generated Formula
published before `brew upgrade` can discover it.

The Apple helper ships as `libexec/SherpaHelper.app`, signed with the owner's
Developer ID Application certificate (ADR-0009). macOS keys privacy grants for
a bare executable to its path, and for a signed bundle to its bundle identifier
and team, so the bundle keeps Calendar and Reminders access across Homebrew
upgrades even though each version installs under a new Cellar path (observed
2026-11-20). Releases are not notarized and use no hardened runtime; the core
stays ad-hoc signed.

## Related

- [Incremental hexagonal modularization RFC](../rfc/0003-hexagonal-modularization.md)
- [Planner requirements](../requirements/planner-authority.md)
- [Context requirements](../requirements/context-intelligence.md)
- [Distribution requirements](../requirements/distribution.md)
- [Fresh-read design](../design/native-fresh-read-context.md)
- [Worker protocol](../contracts/worker-protocol.md)
- [Fresh Context contract](../contracts/fresh-context-v1.md)
- [Context analysis contract](../contracts/context-analysis-v1.md)
- [App connection contract](../contracts/app-connection-v1.md)
- [Test strategy](../testing/README.md)
- [Homebrew release runbook](../testing/local-homebrew-release.md)
- [Roadmap](../roadmap/README.md)
- [Native fresh-read ADR](../adr/0004-native-fresh-read-context.md)
- [Archive migration RFC](../rfc/0001-context-archive-to-fresh-read.md)
- [ADR-0001](../adr/0001-control-plane-and-workers.md)
- [ADR-0002](../adr/0002-conservative-supply-comparison.md)
- [ADR-0003](../adr/0003-context-outbound-and-mail-access.md)
- [Unsigned Homebrew distribution](../adr/0005-unsigned-homebrew-distribution.md)
- [Bun + TypeScript core](../adr/0008-bun-typescript-core.md)
