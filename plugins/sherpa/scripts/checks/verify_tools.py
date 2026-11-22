"""스킬이 Sherpa MCP 도구만 부르는지 확인한다.

스킬은 Sherpa.app 의 MCP 서버 도구를 이름으로 부른다. 서버에 없는 도구를 적으면
에이전트는 그 도구를 찾지 못하고 멈추거나 다른 길을 지어낸다(0.7.x 의 supply 스킬과
같은 결함). 도구 목록은 코어의 도구 등록부(core/src/mcp/registry.ts, core-tools.ts)가
진실이고, 게이트가 그 이름을 한 줄에 하나씩 쓴 파일을 넘긴다.

같이 보는 것:
- 두 에이전트의 도구 이름 앞머리. Claude Code 는 mcp__plugin_<플러그인>_<서버>__,
  Codex 는 mcp__<서버>__ 로 부른다. 플러그인 이름과 .mcp.json 의 서버 키에서 만든다.
- 스킬이 Sherpa CLI 명령을 부르지 않는다. 사용자가 터미널에서 한 번 돌리는
  kakaotalk setup 만 안내할 수 있다(MCP 도구가 아니다, 앱 연결 계약 §10.2).
"""

import json
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
tools_file = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else None

plugin = json.loads((root / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))["name"]
servers = json.loads((root / ".mcp.json").read_text(encoding="utf-8"))["mcpServers"]
if len(servers) != 1:
    raise SystemExit(f".mcp.json must declare exactly one server, found {sorted(servers)}")
(server,) = servers
prefixes = {f"mcp__plugin_{plugin}_{server}__", f"mcp__{server}__"}

TOOL = r"(?:event|reminder|imessage|kakaotalk|mail|operations)_[a-z0-9_]+"
USER_RUN_COMMANDS = {("kakaotalk", "setup")}

known: set[str] | None = None
if tools_file is not None:
    known = {line.strip() for line in tools_file.read_text(encoding="utf-8").splitlines() if line.strip()}
    if not known:
        raise SystemExit("the tool list is empty; refusing to pass silently")

bad: list[str] = []
named = 0
for skill in sorted(root.glob("skills/*/SKILL.md")):
    name = skill.parent.name
    text = skill.read_text(encoding="utf-8")
    for match in re.finditer(r"mcp__[A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*__", text):
        if match.group(0) not in prefixes:
            bad.append(f"{name}: tool prefix {match.group(0)}")
    for tool in set(re.findall(rf"`(?:mcp__[A-Za-z0-9_-]+?__)?({TOOL})`", text)):
        named += 1
        if known is not None and tool not in known:
            bad.append(f"{name}: unknown tool {tool}")
    for match in re.finditer(r"\bsherpa ([a-z][a-z-]*) ([a-z][a-z-]*)", text):
        if (match.group(1), match.group(2)) not in USER_RUN_COMMANDS:
            bad.append(f"{name}: calls the CLI: sherpa {match.group(1)} {match.group(2)}")

if bad:
    raise SystemExit("; ".join(sorted(set(bad))))
print(f"tool_mentions={named} verified={'yes' if known is not None else 'no'}")
