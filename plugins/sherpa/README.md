---
uuid: 01a0f252-d266-7310-aa81-ee3531585026
type: guide
audience: "Mac users installing the Sherpa agent plugin for Claude Code or Codex"
goal: "Install Sherpa.app and one plugin entry point, connect the agent to the app's MCP server, run a first request, and know what data stays local"
tone: "Plain user-facing English. States requirements before steps"
manner: "Outcome first, then install, prerequisites, first use, verification, troubleshooting, data boundary, limits"
---

# Sherpa

[한국어](README.ko.md)

Sherpa turns planning intent into bounded, evidence-checked work on your own
Mac. Its skills call the MCP server of Sherpa.app, which reads Calendar,
Reminders, Mail, iMessage, and the local KakaoTalk database, proposes changes,
and mutates only after you confirm the exact content. Nothing leaves the
machine except what you explicitly send.

## Install

The plugin bundles the skills and registers one MCP server, `sherpa`, whose
command is `/Applications/Sherpa.app/Contents/MacOS/sherpa-relay`. Install
Sherpa.app first:

1. Put `Sherpa.app` in `/Applications`. The plugin looks nowhere else. Its
   notarized Homebrew cask is not published yet; until it is, build and export
   the app from this repository (`docs/contracts/app-connection-v1.md`, §2
   "번들 빌드") and move it there.
2. Open Sherpa.app and turn on **MCP Server** in its menu bar menu, or the
   switch at the top of the window that **Show Sherpa Status…** opens. It is off
   at the first launch, and while it is off the app turns every agent away.

Then add the plugin. Your GitHub account needs access to the private
`XIYO/plug-hole` repository.

```bash
claude plugin marketplace add https://github.com/XIYO/plug-hole.git
claude plugin install sherpa@plug-hole
```

```bash
codex plugin marketplace add https://github.com/XIYO/plug-hole.git
codex plugin add sherpa@plug-hole
codex features enable mcp_2026_07_28
```

Sherpa.app speaks MCP revision 2026-07-28 only. Claude Code negotiates it by
default. Codex opens that revision only with the feature `mcp_2026_07_28` on;
the plugin's server entry already carries the environment value Codex also
needs (`CODEX_MCP_PROTOCOL_VERSION=2026-07-28`). Codex then warns at session
start that an under-development feature is enabled.

`plug-hole` fetches the plugin from `plugins/sherpa/` in this repository. A
new session loads the skills and starts the server; an open session keeps what
it already loaded. With the plugin installed, you do not need the
`claude mcp add` or `codex mcp add` commands that the Sherpa status window
shows; those register the same relay without the plugin.

## Prerequisites

- macOS 14 or newer, Apple silicon
- Sherpa.app in `/Applications` with its MCP Server switch on
- Calendar and Reminders access for Sherpa.app, from its menu bar menu
- Full Disk Access for Sherpa.app, for Mail, iMessage and local KakaoTalk reads
- `sqlcipher` from Homebrew and `sherpa kakaotalk setup` run once in a
  terminal with Full Disk Access, before the first local KakaoTalk read

## First use

Ask in plain language. The `sherpa` skill routes the request.

```text
오늘 일정과 할 일을 정리해줘.
새 메시지에서 일정 후보를 찾아줘.
```

Five skills carry the work:

| Skill | What it owns |
|---|---|
| `sherpa` | Entry point. Routes intent and runs the evidence loop over the tool outcomes. |
| `planner` | Calendar and Reminders through validated proposals and readback. |
| `context` | Bounded Mail, iMessage, and KakaoTalk reads; commitments and candidates. |
| `kakaotalk-local-search` | Local KakaoTalk text — keyword search, one-room history, dated archive. |
| `agent-messenger` | Server-backed KakaoTalk, Discord, iMessage, Instagram via the upstream CLI. |

The agent sees the tools as `mcp__plugin_sherpa_sherpa__<tool>` in Claude Code
and `mcp__sherpa__<tool>` in Codex, for example `event_list`. Deletes and
sends wait up to 30 seconds while Sherpa.app shows the exact target and asks
you to allow it.

## Verify

In Claude Code, run `/mcp`: `plugin:sherpa:sherpa` must be connected. In
Codex, `codex mcp list` must show `sherpa` as enabled. `claude plugin list`
and `codex plugin list --marketplace plug-hole` show the plugin itself.

## Troubleshooting

| What you see | Cause and fix |
|---|---|
| Claude Code: `plugin:sherpa:sherpa` failed; its MCP log ends with `ENOENT` and `posix_spawn`. Codex: `MCP startup failed: No such file or directory (os error 2)`. | Sherpa.app is not at `/Applications/Sherpa.app`. Move it there; the plugin does not search other places. |
| The server failed and its MCP log names `app_not_running` or `mcp_disabled`. | Open Sherpa.app and turn on MCP Server, then reconnect. |
| The tools stopped in the middle of a session; the MCP log names `app_closed_session`. | MCP Server was turned off, or the app quit. Turn it on again and reconnect the server in `/mcp`, or start a new Codex session. |
| Claude Code starts with no Sherpa tools right after a failure. | Claude Code skips a plugin server that failed in the last 15 minutes. Choose Reconnect for `plugin:sherpa:sherpa` in `/mcp`, or wait. |
| Codex: `-32022: Unsupported protocol version: 2025-06-18`. | The feature is off. Run `codex features enable mcp_2026_07_28` and start a new session. |
| Codex uses a different command than the plugin. | A `[mcp_servers.sherpa]` entry in your own `config.toml` takes precedence over the plugin's server of the same name. Remove it, or keep it with the same command and environment value. |
| Claude Code shows the tools as `mcp__sherpa__<tool>`. | You also added the relay yourself with `claude mcp add` and the same command. Claude Code connects that entry once instead of the plugin's; the skills accept both names. |
| `kakaotalk.setup_required` or `kakaotalk.user_id_not_found`. | Run `sherpa kakaotalk setup` once in a terminal that has Full Disk Access. It is not an MCP tool. |
| `eventkit.access_unavailable`, or a Full Disk Access remedy. | Grant the access to Sherpa.app from its menu bar menu, not to the terminal or the agent app. |

## Data boundary

Reads are bounded by an explicit limit and a checkpoint, and every result
reports its own coverage. Local KakaoTalk reads cover synchronized text only —
never attachments, and never proof that the server holds nothing more. Their
checkpoint stays separate from the Agent Messenger checkpoint and is committed
only after analysis.

Outbound messages and mail are drafted first and sent only after you approve
the exact destination and content, and then once more in the Sherpa.app
window. Calendar and Reminders mutate only past the same confirmation
boundary. Sherpa returns opaque references, never provider identifiers.

## Limitations

- macOS only; Windows and Linux are not supported or tested.
- The plugin reaches Sherpa.app only at `/Applications/Sherpa.app`.
- `sherpa` is not a complete archive of any service.
- The plugin does not install or update Sherpa.app. Update both together:
  a skill that names a tool the app does not serve stops and reports it.

## Development

The plugin lives at `plugins/sherpa/`, the app and relay at
`apple/sherpa-app/`, and the core that serves the tools at `core/`. All ship
from this repository.

```bash
bash scripts/check-all.sh
```
