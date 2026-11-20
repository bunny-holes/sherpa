---
uuid: 01a1f73d-c3b4-757e-80aa-1d3037a4cc1c
type: runbook
audience: "Sherpa 를 실제 Mac 에서 소유자 조작으로 검증하는 사람과 에이전트"
goal: "게이트가 닿지 않는 권한·개인 데이터·실제 보내기 경로를 지금 있는 명령만으로 안전하게 확인한다"
tone: "Plain technical English. Every command exists in `sherpa --help`"
manner: "Read checks first, then disposable mutations, then controlled sends; record results in live-evidence.md"
---

# Sherpa Owner-Operated Live Validation

## Safety boundary

Run this only after `bash scripts/check-all.sh` passes. These commands are
absent from the gate because they may request Apple privacy permissions, read
bounded personal content, create disposable Apple records, or send a message.
Print counts, statuses and schema keys while checking; never paste message
bodies, names, addresses, identifiers, or keys into a document, log, or chat.

Every command below appears in `sherpa --help`. A command that is not there —
for example anything under a `context` or `verify` subcommand from the Rust
era — does not exist; do not run it. Use a development build with
`core/dist/sherpa` (after `bun run build` in `core/` and
`swift build --package-path apple/eventkit-service`, with
`SHERPA_APPLE_BIN=apple/eventkit-service/.build/debug/sherpa-apple`) or the
installed `sherpa`.

Developer ID enrollment is not required. An unsigned rebuild may be treated as
a different privacy identity by macOS and require authorization again.

## 1. Calendar and Reminders

Read through `sherpa planner request`. The request shapes are in the planner
skill (`plugins/sherpa/skills/planner/SKILL.md`, "Request shape"). Check, in
order:

1. `event.authorization.status` and `reminder.authorization.status`; request
   access with the matching `*.authorization.request` only when it is not
   `full_access`.
2. `event.source.list` and `reminder.source.list`.
3. `reminder.list` with `{"schema":"sherpa.planner.reminder-list.request.v2","limit":1000}`
   — it must succeed with only the keys it needs and return within a second.
4. `event.list` over one month.

For mutations, create one disposable Reminder list and one disposable Calendar
with `reminder.collection.create` / `event.collection.create`, run create,
update, complete/reopen, and delete against them, read each item back with
`*.get`, and delete the disposable collections. Every mutation must return
native read-back evidence, and `sherpa operations list --limit 20` must show one
terminal row per mutation.

`sherpa-eventkit-live-verify` runs the whole disposable suite in one command
and leaves no residue:

```bash
SHERPA_EVENTKIT_LIVE=1 SHERPA_EVENTKIT_LIVE_CONFIRM=VERIFY_EVENTKIT_DISPOSABLE_CALENDAR_ON_THIS_MAC \
  apple/eventkit-service/.build/debug/sherpa-eventkit-live-verify --worker "$(command -v sherpa)"
```

It starts the worker as `<worker> planner request` and replaces the worker's
environment with only `TZ` for some calls, so a development core that needs
`SHERPA_APPLE_BIN` must be wrapped in a script that sets it.

Grants belong to the helper (`dev.xiyo.sherpa`), not to the terminal or agent
app, and an unsigned rebuild or upgrade asks again. Run the
`*.authorization.request` calls with `deadline_ms` at most 300000; a larger
value is `protocol.invalid_envelope` before any prompt.

## 2. Private Reminder capability

Probe compatibility first with a `capabilities` request to
`sherpa reminder-kit request`. Private writes stay disabled unless the process
has `SHERPA_PRIVATE_WRITES=1` and the request policy asks for the mutation. Run
one private capability at a time against a disposable Reminder, read it back,
and delete the Reminder. Do not infer support for sections, hierarchy, flags, or
attachments from another capability's result.

## 3. Mail

```bash
sherpa mail authorization-status
sherpa mail list --from 2026-11-01T00:00:00+09:00 --to 2026-11-21T00:00:00+09:00 --limit 1000 --max-body-bytes 0
```

Follow `next_cursor` while `limit_reached` is true and confirm the pages add up
to the same count as one call with a large `--limit`, without duplicate
`source_message_id` values. Read one message with `sherpa mail read`.

## 4. iMessage

```bash
sherpa imessage chats --limit 20
sherpa imessage history --chat-id <id> --start 2026-11-01T00:00:00+09:00 --end 2026-11-21T00:00:00+09:00 --limit 200
```

Without Full Disk Access for the host application, both fail with
`imessage.store_unreadable` and a `remedy`; they must not report an empty
result.

## 5. KakaoTalk local database

```bash
sherpa kakaotalk status
sherpa kakaotalk setup
printf '%s' '<keyword>' | sherpa kakaotalk search --limit 20
sherpa kakaotalk archive --since <yyyy-mm-dd> --time-zone Asia/Seoul --limit 50000
```

KakaoTalk must not come to the front or launch at any point; check that the app
stayed as it was. `status` must report every readiness field true after
`setup`. `setup` prints whether it used the keychain, standard input, or
recovery, never the account number.

## 6. Controlled sends

Use only a self/test conversation or mailbox. The body is read from standard
input and the destination must be confirmed exactly:

```bash
printf '%s' 'Sherpa controlled iMessage check' | sherpa imessage send --chat-id <id> --confirm <id>
printf '%s' '{"sender":null,"to":["<self@example.com>"],"cc":[],"bcc":[],"subject":"Sherpa controlled check","body":"body"}' \
  | sherpa mail send --confirm SEND_MAIL
sherpa operations list --limit 5
```

A successful send means only that the application accepted it; confirm delivery
in Messages or Mail. Never retry an `uncertain` result automatically, because
the original command may already have been accepted.

## Related

- [Owner-operated live evidence](live-evidence.md)
- [Test strategy](README.md)
