---
name: context
description: Use Sherpa to read bounded KakaoTalk, iMessage or Mail context from checkpoints, find commitments and planning candidates, check coverage, and send only confirmed replies. Trigger for reviewing recent messages or mail or extracting plans from them.
---

# Sherpa Context

Sherpa owns source checkpoints, bounded reads, disposition summaries, and outbound confirmation. Use Agent Messenger for server-backed KakaoTalk reads, media, and explicitly approved sends. When the user chooses the Mac database as the read source, use the `kakaotalk-local-search` archive and its separate local-text checkpoint. Neither local source is a completeness or send authority.

## Tools

The `sherpa` MCP server of Sherpa.app reads Mail and iMessage; Claude Code prefixes each tool name with `mcp__plugin_sherpa_sherpa__` and Codex with `mcp__sherpa__` (a server the person registered themselves also uses `mcp__sherpa__`). If the tools are missing or the server failed, follow the `sherpa` skill's "Sherpa MCP server" section and stop. Pass user text only as tool arguments.

| Tool | Arguments |
| --- | --- |
| `mail_authorization_status` | none |
| `mail_list` | `from`, `to`, `limit`, `max_body_bytes`, `cursor` (optional) |
| `mail_read` | `message_id`, `max_body_bytes` |
| `imessage_chats` | `limit` |
| `imessage_history` | `chat_id`, `start`, `end`, `limit` |
| `mail_send` | `sender` (optional), `to`, `cc`, `bcc`, `subject`, `body` |
| `imessage_send` | `chat_id`, `text` |

For example, `mail_list` with `{"from": "2026-11-01T00:00:00+09:00", "to": "2026-11-21T00:00:00+09:00", "limit": 1000, "max_body_bytes": 16384}`, then `mail_read` with `{"message_id": "<source_message_id>", "max_body_bytes": 1048576}` only for a message whose stored summary is not enough. `imessage_chats` and `imessage_history` return their rows in `result.items`.

`mail_list` is newest first. While `limit_reached` is true, call it again with the same `from` and `to` and `cursor` set to `next_cursor`; never split the range by hand and never stop at the first page when absence matters. For the local KakaoTalk database use the `kakaotalk-local-search` tools.

A failure carries `error.code` and, when the user can fix it, `error.remedy`. Full Disk Access belongs to Sherpa.app, the app that runs the reads; the Sherpa menu opens its Privacy & Security pane. Report the remedy as written; do not fall back to `sqlite3`, AppleScript, `imsg`, `kakaocli`, or the `sherpa` command.

## Workflow

1. Diagnose the requested source before reading when access is uncertain.
   For historical KakaoTalk keyword lookup, diagnose and search through the
   `kakaotalk-local-search` skill instead of enumerating every Agent Messenger
   room.
2. For server-backed KakaoTalk, list every room with Agent Messenger and maintain one checkpoint per account and room: `account_id`, `chat_id`, `last_log_id`, and `last_message_at`. If the requested room has no checkpoint, read only the prior seven days. Report the exact read-floor date and say that earlier conversation was not read. For a user-selected local read, follow the `kakaotalk-local-search` archive workflow and advance only its local-text checkpoint after analysis.
3. Read KakaoTalk incrementally with `message list <chat_id> --from <last_log_id> --count <limit>`. Bound every page and reject records at or before the stored log ID after decoding.
4. For Agent Messenger pages, pipe the exact JSON page through `scripts/store_kakaotalk_images.py --account-id <account_id> --chat-id <chat_id>` and analyze every returned image before advancing its checkpoint. For local archive pages, mark image and attachment contents unavailable; the local checkpoint covers text only.
5. Store the scenario summary and image analysis before advancing any checkpoint. A failed download, image analysis, or context analysis leaves the prior checkpoint unchanged.
6. Keep conversation memory as a scenario summary, not a task-state mirror. Calendar owns schedules and Reminders owns tasks. Suppress resolved items and known noise; surface changed evidence again.
7. Inspect completeness and coverage before claiming that no message or commitment exists. A successful local KakaoTalk search proves only that the synchronized Mac database was queried; it does not prove that every server message or attachment was available.
8. Draft first. Call `mail_send` or `imessage_send` only after the user explicitly approves the exact destination and content. Each send then waits up to 30 seconds while Sherpa.app shows it and asks the person again. `confirmation.declined` means the person refused: stop. `uncertain` means the message may have left: never resend it; check the conversation and `operations_list` first.

Use JSON for control decisions. Never expose native source identifiers, retained evidence paths, cookies, account data, raw logs, or credentials. If evidence is incomplete, stale, changed, or expired, reread it instead of reconstructing it.

KakaoTalk images are retained under `~/Library/Application Support/Sherpa/context-media/kakaotalk/` in opaque account, room, and message folders. The script validates HTTPS, blocks private-network targets, caps each image at 25 MiB, verifies image bytes, uses owner-only permissions, and stores no source URL. Do not delete retained media unless the user asks to remove the related context or defines a retention limit.
