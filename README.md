---
uuid: 01a0ed5e-d548-7186-8258-6b67286a11f2
type: guide
audience: "Developers and agents who build, run, or release the Sherpa CLI from this repository"
goal: "Build and gate the CLI, call its commands, read their outcomes, and install the agent skills"
tone: "Plain technical English. States verified behavior and names what is unobserved"
manner: "Commands first, then the contract each one keeps; long evidence stays in docs/"
---

# Sherpa

Sherpa is a macOS CLI. Its core is written in Bun + TypeScript (`core/`) and
compiles to one executable. It reads Mail.app's envelope index, the Messages
database, and the KakaoTalk database directly and journals every send. A small
Swift helper, `sherpa-apple` (`apple/eventkit-service`), handles what needs
Apple frameworks: EventKit Calendar and Reminders, the optional private
ReminderKit adapter, and the Mail shim. The core starts it; nobody else does.
No external messaging CLI (`imsg`, `kakaocli`) is used. See
[ADR-0008](docs/adr/0008-bun-typescript-core.md).

## Build and test

One gate covers everything — the core's format, lint, type check and tests,
all three Swift packages, the `--version` format the plugin's guard parses, the
agent plugin, the documents, and the Homebrew release smoke:

```bash
bash scripts/check-all.sh
```

The core uses the Vite+ toolchain with Bun as its package manager and runtime:

```bash
cd core
bun install
vp check          # format, lint, type check
bun run test      # vitest on the Bun runtime (bun --bun vitest run)
bun run build     # dist/sherpa
```

Tests run on the Bun runtime because the core uses `bun:sqlite`; plain
`vp test` runs on Node and cannot load it.

The gate requires a macOS 26 or newer host. `apple/foundation-models-service`
declares `platforms: [.macOS(.v26)]` and imports `FoundationModels`; the other
two packages declare `.macOS(.v14)`. That one package therefore sets the floor
for the whole gate. What an older host actually does — a build failure, or
something subtler — has not been observed, because no such machine was
available; the floor is read off the declared platform, not off a failed run.
`SHERPA_SKIP_RELEASE=1` skips only the Homebrew release smoke, not that package.

Enable the pre-push check once per clone:

```sh
git config core.hooksPath .githooks
```

The hook runs the full gate, including the release smoke, against each pushed commit
in a clean worktree under `.claude/worktrees/`.

`bash scripts/package.sh` builds both executables, produces the release archive
(`bin/sherpa`, the Developer ID signed `libexec/SherpaHelper.app`) and renders the Homebrew Formula from the
version the built core reports. Users install the released CLI with
`brew install xiyo/tap/sherpa`, which also installs `sqlcipher`; the [release
runbook](docs/testing/local-homebrew-release.md) publishes a version there and
installs a development build locally.

## Commands

`sherpa --help` lists every command. Mail, iMessage, and KakaoTalk reads need
Full Disk Access for the application that runs `sherpa` (the terminal or the
agent host). A failure prints one JSON line with a named `error` code and exits
1; when the fix is a step the user can take — a permission, an install, a
setup command — the line also carries a `remedy`.

Planner and native framework requests use bounded Worker Protocol V2 JSON on
standard input and go to the Swift helper unchanged:

```bash
sherpa planner request
sherpa mail request
sherpa reminder-kit request
```

iMessage reads the local Messages database. Sends read the message body from
standard input, require an exact destination confirmation, and go to
Messages.app:

```bash
sherpa imessage chats --limit 20
sherpa imessage history --chat-id 42 --start 2026-08-01T00:00:00+09:00 --end 2026-08-07T00:00:00+09:00 --limit 200
printf '%s' 'message' | sherpa imessage send --chat-id 42 --confirm 42
```

KakaoTalk reads the Mac's locally synchronized database directly and never
opens or controls the KakaoTalk app. Run setup once per Mac and account: it
recovers the account number from KakaoTalk's preferences (or reads it from
standard input with `--user-id-stdin`), verifies that the derived key opens
the database, and keeps the number in the login keychain. `status` reports
what is ready with booleans only.

```bash
sherpa kakaotalk setup
sherpa kakaotalk status
printf '%s' '배송' | sherpa kakaotalk search --limit 20
printf '%s' 'exact room display name' | sherpa kakaotalk history --limit 1000
sherpa kakaotalk archive --since 2026-07-01 --time-zone Asia/Seoul --limit 50000
printf '%s' '<checkpoint token>' | sherpa kakaotalk checkpoint --confirm COMMIT_LOCAL_CHECKPOINT
```

The local adapter supports keyword search, one exact room's fixed seven-day
window, and an explicit all-room date range. Results always report partial
coverage and omit KakaoTalk-native identifiers. A complete local archive returns
a pending local-text checkpoint; commit it only after analysis. It remains
separate from Agent Messenger and does not include attachment contents.

Mail reads Mail.app's envelope index, newest first. When a page is full,
`limit_reached` is true and `next_cursor` continues the same range:

```bash
sherpa mail authorization-status
sherpa mail list \
  --from 2026-08-01T00:00:00+09:00 \
  --to 2026-08-02T00:00:00+09:00 \
  --limit 1000 --max-body-bytes 16384
sherpa mail list --from … --to … --limit 1000 --max-body-bytes 16384 --cursor '<next_cursor>'
sherpa mail read \
  --message-id '<source_message_id>' --max-body-bytes 1048576
printf '%s' '{"sender":"me@example.com","to":["you@example.com"],"cc":[],"bcc":[],"subject":"subject","body":"body"}' \
  | sherpa mail send --confirm SEND_MAIL
```

`mail list` covers every account in the half-open interval `from <= received
< to`. Each item carries Mail's stored summary as `body`; `mail read` returns
the full body of exactly one identifier from `mail list`. A cursor is valid only
with the `--from` and `--to` it was issued for.

Mutation outcomes are recorded in one SQLite journal without message bodies or
native locators. The core journals `imessage send` and `mail send`; the helper
journals `planner request` mutations:

```bash
sherpa operations list --limit 100
```

A send is journaled `failed` only when it never reached the sender. Once the
sender has been handed the message, any failure is `uncertain`: check the
conversation before sending again. A journaled send that fails carries its
`operation_id`. A send that completed but could not be journaled exits 0 with
`"status":"completed"` and `"journal_error":"journal.finish_failed"`, and its
journal row stays `started`. A `planner request` whose journal write fails
still prints its response and logs `[apple:sherpa-apple:journal-failure]` on
standard error.

## Agent skills

The agent skills live in `plugins/sherpa/` and are listed by the `plug-hole`
marketplace. They are not bundled into the CLI archive — installing the CLI
does not install them, and vice versa:

Your GitHub account needs access to the private `XIYO/plug-hole` repository.

```bash
claude plugin marketplace add https://github.com/XIYO/plug-hole.git
claude plugin install sherpa@plug-hole
```

```bash
codex plugin marketplace add https://github.com/XIYO/plug-hole.git
codex plugin add sherpa@plug-hole
```

Both halves come from this repository, but they reach a machine by different
routes, so their versions can drift. `plugins/sherpa/cli-contract.json` records
the minimum CLI version the skills need, and every skill that calls the CLI runs
`scripts/require-cli.sh` before its first command — an outdated CLI stops the
workflow with a clear message instead of failing partway through.

Private ReminderKit is an optional, unsupported Apple implementation detail.
It is linked behind the `reminder-kit request` adapter and remains disabled for
writes unless its explicit environment and request gates are both satisfied.
