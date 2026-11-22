---
name: planner
description: Use Sherpa to inspect and change Apple Calendar and Reminders through proposals, confirmation and readback with natural Korean titles. Trigger for schedules, appointments, deadlines, reminders or checklists and creating, updating, completing or deleting them.
---

# Sherpa Planner

Translate planning intent into calls of the Sherpa MCP planner tools, then reason over their `sherpa.mcp.tool-outcome.v1` results.

## Tools

The `sherpa` MCP server of Sherpa.app provides these tools; Claude Code prefixes each name with `mcp__plugin_sherpa_sherpa__` and Codex with `mcp__sherpa__` (a server the person registered themselves also uses `mcp__sherpa__`). If they are missing or the server failed, follow the `sherpa` skill's "Sherpa MCP server" section and stop. Never build a Worker Protocol envelope, run the `sherpa` command, or read Calendar or Reminders through AppleScript or their SQLite stores: those paths are slow, unverified, and bypass the references later mutations need.

| Purpose | Tools |
| --- | --- |
| Access | `event_authorization_status`, `reminder_authorization_status` |
| Destinations | `event_source_list`, `reminder_source_list` |
| Read | `event_list`, `event_get`, `reminder_list`, `reminder_get` |
| Dry run | `event_command_validate`, `reminder_command_validate` |
| Create | `event_create`, `event_collection_create`, `reminder_create`, `reminder_collection_create` |
| Change | `event_update`, `reminder_update`, `reminder_complete`, `reminder_reopen` |
| Delete (confirmed in the Sherpa.app window) | `event_delete`, `event_collection_delete`, `reminder_delete`, `reminder_collection_delete` |
| Journal | `operations_list` |

The arguments are the tool's input schema; Sherpa fills in the request envelope, schema name, ids and deadline. A key the schema does not list is rejected, and a value outside its range fails with `protocol.invalid_payload`.

## Workflow

1. If the request is a general planning review, follow the Context skill first. Read fresh Mail, iMessage, and the user-selected KakaoTalk source after their checkpoints. Agent Messenger reads include supported images; local database reads report attachment contents unavailable and use the local-text checkpoint.
2. Read Event sources and their Calendar destinations through `event_source_list` and `reminder_source_list` before choosing an exact collection.
3. Read current state before updates or deletion. Use only the `native_locator` values Sherpa returns; never pass identifiers from another source.
4. For language-derived actions, use the proposal and candidate flow. Present the preview and confirmation boundary to the user, then run the change only after explicit confirmation.
5. For direct user instructions, call the matching typed Event or Reminder tool and verify its native read-back in `evidence` and `result`.
6. Before every Event create, title or notes update, or communication-derived planning candidate, read `references/korean-event-writing.md` completely and apply it. Pass the draft title and notes as JSON on standard input to `scripts/lint_korean_event_text.py`; rewrite every error and review every warning before mutation. Do not bypass a warning merely because the Event date is in the past.
7. Call `operations_list` with `limit` 100 when a mutation is `partial` or `uncertain`, or its final state is unclear. A `partial` or `uncertain` mutation with `protocol.result_too_large` changed (or may have changed) the native state but its result was too large to return: read the state back instead of repeating the mutation.

## Arguments

A read of current Reminders and Events:

- `reminder_list` with `{"completed": false, "limit": 1000}`
- `event_list` with `{"from": "2026-11-01T00:00:00+09:00", "to": "2026-12-01T00:00:00+09:00", "limit": 500}`

`reminder_list` accepts `collection_native_locator`, `limit` (1–10000, default 100) and `completed` (`true`, `false`, or omitted for both); it reads through EventKit in well under a second. `event_list` reads the half-open range [`from`, `to`). Updates take `native_locator` and `changes`: an omitted key stays and `null` clears it. Recurring Event updates and deletes need `span` `this` or `future`; never guess it. Each command inside `event_command_validate` or `reminder_command_validate` keeps its own `schema`, such as `sherpa.planner.event-create.request.v2`.

## Authorization

The Calendar and Reminders grant belongs to Sherpa.app, not to the terminal or agent app, and no tool requests it. A read or mutation that fails with `eventkit.access_unavailable` needs the owner: tell them to open the Sherpa menu bar item and choose Calendar or Reminders, which asks macOS or opens the Privacy & Security pane, then read again after they confirm. `event_authorization_status` and `reminder_authorization_status` report the current state. `denied` is the owner's answer: stop.

## Deletes

Each delete call waits up to 30 seconds while Sherpa.app shows the exact target and asks the person to allow it. Confirm with the user in the conversation first; the app window is a second, separate boundary. `confirmation.declined` means the person refused: stop. On `confirmation.timed_out` or `confirmation.unavailable`, report it and ask before calling again. Destructive and bulk changes require an exact target preview.

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

Always pass timestamps with explicit offsets and preserve the user's time zone. Distinguish events from reminders: fixed attendance or time blocks are events; actionable work and deadlines are reminders. Do not guess a destination, date, recurrence, or destructive scope. Do not treat a returned call as proof of a mutation; require Sherpa's verified result.
