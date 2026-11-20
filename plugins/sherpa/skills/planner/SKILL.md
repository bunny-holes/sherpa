---
name: planner
description: Use Sherpa to inspect and change Apple Calendar and Reminders through proposals, confirmation and readback with natural Korean titles. Trigger for schedules, appointments, deadlines, reminders or checklists and creating, updating, completing or deleting them.
---

# Sherpa Planner

Translate planning intent into the installed Sherpa CLI contract, then reason over its versioned output.

## Workflow

1. If the request is a general planning review, follow the Context skill first. Read fresh Mail, iMessage, and the user-selected KakaoTalk source after their checkpoints. Agent Messenger reads include supported images; local database reads report attachment contents unavailable and use the local-text checkpoint.
2. Before the first Sherpa command in a session, run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/require-cli.sh"` once. Continue only when it prints `"status":"ready"`; otherwise stop and report its JSON. `missing` and `mismatch` carry the command or remedy that fixes the CLI; `unsupported` means this device is not macOS, where the Sherpa CLI cannot run, so say that the plugin is macOS-only and do not suggest an install command. The plugin and the CLI ship separately, so `cli-contract.json` holds the minimum CLI version this skill needs. Do not run `--help` during a normal workflow. Send strict Worker Protocol V2 JSON to `sherpa planner request` on standard input.
3. Read Event sources and their Calendar destinations through `event.source.list` and `reminder.source.list` planner requests before choosing an exact collection.
4. Read current state before updates or deletion. Use only opaque references returned by Sherpa; never pass native identifiers.
5. For language-derived actions, use the proposal and candidate flow. Present the preview and confirmation boundary to the user, then run approval only after explicit confirmation.
6. For direct user instructions, send the matching typed Event or Reminder capability to `sherpa planner request` and verify its native readback.
7. Before every Event create, title or notes update, or communication-derived planning candidate, read `references/korean-event-writing.md` completely and apply it. Pass the draft title and notes as JSON on standard input to `scripts/lint_korean_event_text.py`; rewrite every error and review every warning before mutation. Do not bypass a warning merely because the Event date is in the past.
8. Run `sherpa operations list --limit 100` when a mutation is partial or its final state is unclear.

## Request shape

Every planner call is one Worker Protocol V2 envelope on standard input. Use a
fresh `request_id`, `operation_id`, and `idempotency_key` (letters, digits, `.`,
`-`, `_`) per call and keep the policy matching the effect. A read of current
Reminders and Events looks like this:

```sh
printf '%s' '{"kind":"request","protocol_version":"2.0.0","application_contract":"sherpa.planner.v2","request_id":"req-1","operation_id":"op-1","capability":"reminder.list","payload":{"schema":"sherpa.planner.reminder-list.request.v2","completed":false,"limit":1000},"deadline_ms":30000,"idempotency_key":"idem-1","policy":{"effect":"read","required_evidence":"none","artifact_directory":null}}' | sherpa planner request
printf '%s' '{"kind":"request","protocol_version":"2.0.0","application_contract":"sherpa.planner.v2","request_id":"req-2","operation_id":"op-2","capability":"event.list","payload":{"schema":"sherpa.planner.event-list.request.v2","from":"2026-11-01T00:00:00+09:00","to":"2026-12-01T00:00:00+09:00","limit":500},"deadline_ms":30000,"idempotency_key":"idem-2","policy":{"effect":"read","required_evidence":"none","artifact_directory":null}}' | sherpa planner request
```

`reminder.list` accepts `collection_native_locator`, `limit` (1–10000, default
100) and `completed` (`true`, `false`, or omitted for both); it reads through
EventKit in well under a second. Never read Reminders or Calendar through
AppleScript or their SQLite stores: those paths are slow, unverified, and
bypass the opaque references later mutations need. A payload key the schema
does not list is `protocol.invalid_payload`.

## Authorization

A read or mutation that fails with `eventkit.access_unavailable` needs the
owner's grant. Ask first, then send the matching `event.authorization.request`
or `reminder.authorization.request` (payload schema
`sherpa.planner.event-authorization-request.request.v2` or
`sherpa.planner.reminder-authorization-request.request.v2`, policy effect
`authorization_prompt`, evidence `authorization_readback`, `deadline_ms` at
most 300000) and tell the owner to allow the "Sherpa" prompt. The grant belongs
to Sherpa, not to the terminal or agent app, and survives upgrades. If the
request fails with `eventkit.authorization_prompt_unavailable`, macOS showed no
prompt; report it instead of retrying. `denied` is the owner's answer: stop.

## Korean writing gate

Treat the Calendar date as the time expression and the title as the name of what
happens that day. Use neutral Korean action or schedule phrases. Never generate
a completion report or future-tense sentence as an Event title. Preserve an
official source title exactly only when evidence proves it is a proper name;
set `official_title: true` for the linter and keep that evidence in the active
read session.

The reference owns the detailed title patterns, tense conversions, Korean
naturalness rules, note layout, examples, and final checklist. Do not duplicate
or improvise a competing style rule here.

Always pass timestamps with explicit offsets and preserve the user's time zone. Distinguish events from reminders: fixed attendance or time blocks are events; actionable work and deadlines are reminders. Do not guess a destination, date, recurrence, or destructive scope. Do not treat a process exit as proof of a mutation; require Sherpa's verified result.
