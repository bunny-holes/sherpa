#!/usr/bin/env bash
# 플러그인 검사 진입점(macOS). scripts/check-all.sh 가 호출한다.
#
# sherpa 플러그인은 스킬과 두 매니페스트, Sherpa.app 의 MCP 서버를 등록하는 .mcp.json 으로
# 이루어진다. 빌드 산출물이 없으므로 검사는 "배포되는 파일이 서로 모순되지 않는가"에 집중한다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
readonly SCRIPT_DIR PLUGIN_ROOT
readonly EXPECTED_SKILLS="agent-messenger context kakaotalk-local-search planner sherpa"
readonly ENTRY_SKILL="sherpa"

fail() {
  echo "[check:sherpa:failure] $1" >&2
  exit 1
}

echo "[check:sherpa:start] root=${PLUGIN_ROOT##*/}" >&2

command -v python3 >/dev/null 2>&1 || fail "reason=python3_missing"

# 1. 매니페스트 두 벌이 존재하고, name 이 같고, base version 이 같아야 한다.
claude_manifest="$PLUGIN_ROOT/.claude-plugin/plugin.json"
codex_manifest="$PLUGIN_ROOT/.codex-plugin/plugin.json"
[ -f "$claude_manifest" ] || fail "reason=claude_manifest_missing"
[ -f "$codex_manifest" ] || fail "reason=codex_manifest_missing"

python3 - "$claude_manifest" "$codex_manifest" <<'PY' || fail "reason=manifest_mismatch"
import json, re, sys
claude, codex = (json.load(open(p)) for p in sys.argv[1:3])
if claude["name"] != codex["name"] != "sherpa":
    raise SystemExit("name mismatch")
base = lambda v: v.split("+", 1)[0]
if base(claude["version"]) != base(codex["version"]):
    raise SystemExit(f'base version mismatch: {claude["version"]} vs {codex["version"]}')
if not re.fullmatch(r"\d+\.\d+\.\d+", claude["version"]):
    raise SystemExit(f'claude version is not a plain semver: {claude["version"]}')
PY

# 2. MCP 서버 등록. 두 에이전트가 같은 .mcp.json 을 읽는다. Claude Code 는 플러그인 루트의 파일을 기본으로
#    읽고, Codex 는 매니페스트의 mcpServers 가 가리키는 파일을 읽는다. 서버는 sherpa 하나이고 명령은 설치된
#    앱 안의 중계, 인자는 없다(앱 연결 계약 §2). env 의 CODEX_MCP_PROTOCOL_VERSION 은 Codex 가 2026-07-28 로
#    여는 데 필요하고 Codex 가 띄우기 전에 지운다. Claude Code 가 넘겨도 릴리스 중계는 읽지 않는다(ADR-0011).
#    Claude 매니페스트가 mcpServers 를 따로 적으면 같은 이름의 서버가 두 곳에서 와 뒤의 것이 앞의 것을 덮는다.
python3 - "$PLUGIN_ROOT/.mcp.json" "$claude_manifest" "$codex_manifest" <<'PY' || fail "reason=mcp_registration_invalid"
import json, sys
mcp, claude, codex = (json.load(open(p)) for p in sys.argv[1:4])
expected = {
    "mcpServers": {
        "sherpa": {
            "command": "/Applications/Sherpa.app/Contents/MacOS/sherpa-relay",
            "args": [],
            "env": {"CODEX_MCP_PROTOCOL_VERSION": "2026-07-28"},
        }
    }
}
if mcp != expected:
    raise SystemExit(f".mcp.json is not the contract §2 registration: {json.dumps(mcp)}")
if "mcpServers" in claude:
    raise SystemExit("the Claude manifest must not declare mcpServers; Claude Code reads .mcp.json")
if codex.get("mcpServers") != "./.mcp.json":
    raise SystemExit(f'the Codex manifest must point mcpServers at ./.mcp.json, found {codex.get("mcpServers")!r}')
PY

# 3. 스킬 집합이 정확히 일치해야 한다. 진입 스킬(plugin name 과 같은 이름)은 필수다.
actual="$(cd "$PLUGIN_ROOT/skills" && ls -d */ 2>/dev/null | tr -d '/' | sort | tr '\n' ' ')"
expected="$(echo "$EXPECTED_SKILLS" | tr ' ' '\n' | sort | tr '\n' ' ')"
[ "$actual" = "$expected" ] || fail "reason=skill_set_mismatch expected=[$expected] actual=[$actual]"
[ -f "$PLUGIN_ROOT/skills/$ENTRY_SKILL/SKILL.md" ] || fail "reason=entry_skill_missing"

# 4. 각 스킬은 프론트매터 name 이 디렉터리명과 같고, 죽은 계약 필드가 없어야 한다.
for dir in "$PLUGIN_ROOT"/skills/*/; do
  name="$(basename "$dir")"
  skill="$dir/SKILL.md"
  [ -f "$skill" ] || fail "reason=skill_md_missing skill=$name"
  grep -q "^name: $name$" "$skill" || fail "reason=skill_name_mismatch skill=$name"
  ! grep -q '^contract_version:' "$skill" || fail "reason=contract_version_present skill=$name"
done

# 5. 배포물에 이 머신의 절대 경로가 새어 나가면 안 된다.
#    패턴을 문자 클래스로 쓴다 — 리터럴로 적으면 이 스크립트가 자기 자신을 잡는다.
readonly HOME_PATH_PATTERN='/[U]sers/'
if leaked="$(grep -rlE "$HOME_PATH_PATTERN" "$PLUGIN_ROOT" 2>/dev/null)"; then
  fail "reason=absolute_path_leak files=$(echo "$leaked" | tr '\n' ',')"
fi

# 6. 스킬이 부르는 MCP 도구가 Sherpa 서버에 있고, 스킬이 Sherpa CLI 명령을 부르지 않아야 한다.
#    도구 이름은 게이트가 코어의 도구 등록부에서 뽑아 넘긴다. 없으면 이름 검사를 건너뛰되 건너뛴
#    사실을 남긴다 — 조용히 통과하면 검사가 없는 것과 같다. 앞머리와 CLI 검사는 언제나 돈다.
if [ -n "${SHERPA_MCP_TOOLS:-}" ]; then
  [ -s "$SHERPA_MCP_TOOLS" ] || fail "reason=mcp_tool_list_missing_or_empty"
  python3 "$SCRIPT_DIR/checks/verify_tools.py" "$PLUGIN_ROOT" "$SHERPA_MCP_TOOLS" >&2 \
    || fail "reason=skill_names_unknown_tool"
  echo "[check:sherpa:tools] verified against the core tool registry" >&2
else
  python3 "$SCRIPT_DIR/checks/verify_tools.py" "$PLUGIN_ROOT" >&2 || fail "reason=skill_tool_reference_invalid"
  echo "[check:sherpa:tools] skipped reason=no_tool_list — tool existence is UNVERIFIED" >&2
fi

# 7. 스킬이 사용자에게 안내하는 CLI 명령(kakaotalk setup)이 실제로 존재해야 한다.
#    supply 스킬은 대응 명령이 없는 채로 오래 살아남았고, 호출하면 invalidRequest 로
#    죽었다. 바이너리는 게이트가 넘겨주고, 없으면 건너뛰되 건너뛴 사실을 남긴다.
binary="${SHERPA_BINARY:-$(command -v sherpa 2>/dev/null || true)}"
if [ -n "$binary" ] && [ -x "$binary" ]; then
  "$binary" --help > "$PLUGIN_ROOT/.help-snapshot" 2>&1 || true
  python3 "$SCRIPT_DIR/checks/verify_commands.py" "$PLUGIN_ROOT" \
    || { rm -f "$PLUGIN_ROOT/.help-snapshot"; fail "reason=skill_names_unknown_command"; }
  rm -f "$PLUGIN_ROOT/.help-snapshot"
  echo "[check:sherpa:commands] verified against ${binary##*/}" >&2
else
  echo "[check:sherpa:commands] skipped reason=no_binary — command existence is UNVERIFIED" >&2
fi

# 8. 스킬이 참조하는 스크립트가 실제로 있어야 한다.
python3 "$SCRIPT_DIR/checks/verify_references.py" "$PLUGIN_ROOT" \
  || fail "reason=skill_references_missing_script"

# 9. description 은 클라이언트가 그대로 싣는다. 길이와 꺾쇠를 지킨다.
python3 "$SCRIPT_DIR/checks/verify_descriptions.py" "$PLUGIN_ROOT" \
  || fail "reason=skill_description_invalid"

# 10. 생성물이 섞인 채로 배포되면 안 된다 (저장소 규칙: 플러그인 안에 빌드 산출물을 두지 않는다).
for junk in __pycache__ .DS_Store .venv node_modules; do
  found="$(find "$PLUGIN_ROOT" -name "$junk" -print -quit)"
  [ -z "$found" ] || fail "reason=build_artifact_present artifact=$junk path=${found#"$PLUGIN_ROOT/"}"
done

echo "[check:sherpa:success] skills=$(echo "$EXPECTED_SKILLS" | wc -w | tr -d ' ') mcp_server=sherpa" >&2
