import { SHERPA_VERSION } from "../version.ts";

export const help = `Sherpa ${SHERPA_VERSION} — native macOS assistant CLI

USAGE:
  sherpa app serve
  sherpa planner request
  sherpa imessage chats --limit <count>
  sherpa imessage history --chat-id <id> --start <iso8601> --end <iso8601> --limit <count>
  sherpa imessage send --chat-id <id> --confirm <id>
  sherpa kakaotalk setup [--user-id-stdin]
  sherpa kakaotalk status
  sherpa kakaotalk search --limit <count>
  sherpa kakaotalk history --limit <count>
  sherpa kakaotalk archive --since <yyyy-mm-dd|checkpoint> --time-zone <iana> --limit <count>
  sherpa kakaotalk checkpoint --confirm COMMIT_LOCAL_CHECKPOINT
  sherpa mail authorization-status
  sherpa mail list --from <iso8601> --to <iso8601> --limit <count> --max-body-bytes <count> [--cursor <token>]
  sherpa mail read --message-id <id> --max-body-bytes <count>
  sherpa mail request
  sherpa mail send --confirm SEND_MAIL
  sherpa reminder-kit request
  sherpa operations list --limit <count>

App serve is the MCP core Sherpa.app starts; it speaks only frames on standard
input and output and is not run by hand.
Planner, Mail request, and ReminderKit request accept strict JSON on standard input.
iMessage and Mail send bodies are also read from standard input.
Mail list returns newest first; when limit_reached is true, pass next_cursor to
--cursor with the same --from and --to to read the next page.
iMessage reads the local Messages database directly; no other tool is needed.
KakaoTalk reads the local KakaoTalk database directly and never opens or
controls the KakaoTalk app. Run setup once: it recovers this Mac's KakaoTalk
account number (or reads it from standard input with --user-id-stdin),
verifies the database key and keeps the number in the login keychain. Search reads one UTF-8 query from standard input. History reads one
exact display name from standard input and uses a fixed seven-day window.
Archive reads an explicit local-date range across synchronized rooms. A complete
archive returns a pending local checkpoint token; checkpoint reads that token
from standard input and commits it after analysis. All return bounded,
privacy-filtered local-database projections.
`;
