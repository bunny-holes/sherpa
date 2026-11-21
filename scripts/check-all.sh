#!/usr/bin/env bash
# 저장소 게이트. CI 가 없으므로 병합 전 macOS 에서 직접 돌린다(AGENTS.md).
#
# 이 저장소는 brew 로 나가는 CLI(Bun 코어 + Swift Apple 헬퍼)와 plug-hole 에 등록된
# 에이전트 플러그인을 배포한다. 게이트는 둘 다 본다.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly REPO_ROOT
readonly LOG_SCOPE="check:repository"

log() { printf '%s [%s] %s\n' "$1" "$2" "$3" >&2; }
fail() { log error "$LOG_SCOPE:failure" "$1"; exit 1; }

log info "$LOG_SCOPE:start" "root=${REPO_ROOT##*/}"

# 1. Swift 패키지 전부. eventkit-service 만 돌리던 시절, worker-protocol 과
#    foundation-models-service 의 테스트 34 개가 아무도 돌리지 않는 채로 남아 있었다.
#    돌리지 않는 테스트는 없는 테스트다.
#    foundation-models-service 는 CLI 가 부르지 않는다 — 의도적으로 배선하지 않은 채
#    보존한다(승인된 계약 둘의 유일한 구현. docs/roadmap/README.md Phase 2).
#    이 패키지가 platforms: [.macOS(.v26)] 이라 게이트 전체가 macOS 26 이상을 요구한다.
#    sherpa-app 은 Sherpa.app·sherpa-relay 와 그 시험 프로그램이다. 프로세스 시험이 swift build 가 만든
#    DEBUG 실행 파일을 ad-hoc 서명해 띄우므로 build 가 test 보다 먼저다(계약 §13.2).
readonly SWIFT_PACKAGES="worker-protocol foundation-models-service eventkit-service sherpa-app"
for package in $SWIFT_PACKAGES; do
  log info "check:swift:start" "package=$package"
  swift build --package-path "$REPO_ROOT/apple/$package" >/dev/null \
    || fail "reason=swift_build_failed package=$package"
  swift test --package-path "$REPO_ROOT/apple/$package" >/dev/null \
    || fail "reason=swift_test_failed package=$package"
done

log info "check:swift:success" "packages=4"

# 릴리스 빌드는 실행 경로, 소켓 경로, 서명 요건을 바꾸는 시험용 변수를 읽지 않는다(계약 §2, §13.2).
# 같은 사용자의 아무 프로세스나 launchctl setenv 로 그 값을 앱에 넣을 수 있기 때문이다. DEBUG 빌드에
# 있는 이름이 릴리스 빌드에서 사라졌는지 본다. DEBUG 쪽에 이름이 없으면 이 검사는 아무것도 보지 못하므로
# 그것도 실패로 친다.
readonly APP_PACKAGE="$REPO_ROOT/apple/sherpa-app"
log info "check:app-release:start" "package=sherpa-app"
for product in sherpa-relay Sherpa; do
  swift build -c release --package-path "$APP_PACKAGE" --product "$product" >/dev/null \
    || fail "reason=app_release_build_failed product=$product"
done
for entry in "sherpa-relay:SHERPA_APP_SOCKET SHERPA_APP_REQUIREMENT" \
  "Sherpa:SHERPA_APP_SOCKET SHERPA_CORE_BIN SHERPA_RELAY_REQUIREMENT SHERPA_CORE_REQUIREMENT"; do
  product="${entry%%:*}"
  for name in ${entry#*:}; do
    LC_ALL=C grep -q -a -F "$name" "$APP_PACKAGE/.build/debug/$product" \
      || fail "reason=debug_variable_missing product=$product name=$name"
    if LC_ALL=C grep -q -a -F "$name" "$APP_PACKAGE/.build/release/$product"; then
      fail "reason=release_reads_test_variable product=$product name=$name"
    fi
  done
done

# 릴리스 중계에 시험용 변수를 줘도 기본 경로로 간다. 가짜 앱(식별자 dev.xiyo.sherpa 로 ad-hoc 서명한
# 사본)을 다른 경로에 띄우고, 같은 변수를 준 DEBUG 중계가 거기 붙어 0 으로 끝나는 것을 먼저 본 뒤, 릴리스 중계는
# 거기 붙지 않고 기본 경로에서 69(앱 없음) 또는 77(실행 중인 앱이 이 중계를 거부)로 끝나야 한다.
app_probe="$(mktemp -d)"
printf '%s\n' '{"sherpa_app":1,"status":"ready","reason":null,"version":"0.0.0"}' >"$app_probe/preface"
cp "$APP_PACKAGE/.build/debug/sherpa-fake-app" "$app_probe/sherpa-fake-app"
codesign --force --sign - --identifier dev.xiyo.sherpa "$app_probe/sherpa-fake-app" 2>/dev/null   || { rm -rf "$app_probe"; fail "reason=fake_app_sign_failed"; }
"$app_probe/sherpa-fake-app" "$app_probe/app.sock" "$app_probe/preface" echo 2>"$app_probe/fake-app.log" &
fake_app=$!
stop_fake_app() { kill "$fake_app" 2>/dev/null || true; wait "$fake_app" 2>/dev/null || true; rm -rf "$app_probe"; }
for _ in $(seq 50); do
  grep -q 'fake-app: listening' "$app_probe/fake-app.log" && break
  sleep 0.1
done
grep -q 'fake-app: listening' "$app_probe/fake-app.log" || { stop_fake_app; fail "reason=fake_app_not_listening"; }
probe_relay() {
  LOG_LEVEL=debug SHERPA_APP_SOCKET="$app_probe/app.sock" SHERPA_APP_REQUIREMENT='identifier "dev.xiyo.sherpa"' \
    "$1" </dev/null >/dev/null 2>"$app_probe/relay.log"
}
probe_relay "$APP_PACKAGE/.build/debug/sherpa-relay" \
  || { stop_fake_app; fail "reason=debug_relay_ignored_test_variables"; }
[ "$(grep -c 'fake-app: accepted' "$app_probe/fake-app.log")" = 1 ] \
  || { stop_fake_app; fail "reason=debug_relay_not_accepted"; }
release_exit=0
probe_relay "$APP_PACKAGE/.build/release/sherpa-relay" || release_exit=$?
grep -q '\[relay:socket:connect\] socket=default' "$app_probe/relay.log" \
  || { stop_fake_app; fail "reason=release_relay_used_override"; }
[ "$(grep -c 'fake-app: accepted' "$app_probe/fake-app.log")" = 1 ] \
  || { stop_fake_app; fail "reason=release_relay_reached_override"; }
case "$release_exit" in
  69 | 77) ;;
  *) stop_fake_app; fail "reason=release_relay_unexpected_exit exit=$release_exit" ;;
esac
stop_fake_app
log info "check:app-release:success" "release_relay_exit=$release_exit"

# 2. Bun + TypeScript 코어(ADR-0008). 포맷·린트·타입 검사, Bun 런타임 위의 vitest,
#    그리고 배포와 같은 단일 실행 파일 빌드. 테스트를 `vp test` 로 돌리면 Node 에서 돌아
#    bun:sqlite 를 못 읽는다.
readonly CORE="$REPO_ROOT/core"
log info "check:core:start" "root=core"
(cd "$CORE" && bun install --frozen-lockfile >/dev/null) || fail "reason=core_install_failed"
(cd "$CORE" && "$CORE/node_modules/.bin/vp" check >/dev/null) || fail "reason=core_check_failed"
(cd "$CORE" && bun run test >/dev/null) || fail "reason=core_test_failed"
(cd "$CORE" && bun run build >/dev/null) || fail "reason=core_build_failed"

# --version 출력 형식은 계약이다. 스킬의 가드와 Formula 의 test 가 이 모양을 파싱한다.
binary="$CORE/dist/sherpa"
export SHERPA_APPLE_BIN="$REPO_ROOT/apple/eventkit-service/.build/debug/sherpa-apple"
raw="$("$binary" --version)"
printf '%s' "$raw" | grep -Eq '^sherpa [0-9]+\.[0-9]+\.[0-9]+$' \
  || fail "reason=version_format_broken output=$raw"
cli_version="$(printf '%s' "$raw" | awk '{print $2}')"
[ "$("$SHERPA_APPLE_BIN" --version)" = "sherpa-apple $cli_version" ] \
  || fail "reason=helper_version_mismatch cli=$cli_version"

# 실패는 이름 있는 오류 코드로 끝나야 한다. 최상위 catch 가 알 수 없는 실패를 stdout·stderr
# 0 바이트로 끝내던 것을 이 호출로 재현했다. {} 는 봉투 검사에서 거부되므로 EventKit 과
# 기록부에 닿기 전에 끝난다. 코어가 헬퍼에 넘기고 헬퍼의 응답과 종료 코드를 그대로 돌려줘야 한다.
if probe="$(printf '{}' | "$binary" planner request 2>/dev/null)"; then
  fail "reason=invalid_request_accepted"
fi
python3 -c 'import json, sys; assert json.loads(sys.argv[1]) == {"status": "failed", "error": "protocol.invalid_envelope"}' "$probe" \
  || fail "reason=failure_unnamed output=$probe"

# 헬퍼는 권한 책임을 놓고(disclaim) 자신을 한 번 다시 띄워 macOS 권한의 주체가 된다. 그래야
# Calendar 사용 설명이 없는 호스트(Claude 데스크톱)에서도 권한 창이 뜬다(2026-11-20 실측). 다시
# 띄운 자식의 출력과 종료 코드가 그대로 돌아오는지, 실제로 다시 띄웠는지를 본다.
relaunch_log="$(mktemp)"
if relaunch="$(printf '{}' | LOG_LEVEL=debug "$SHERPA_APPLE_BIN" planner request 2>"$relaunch_log")"; then
  rm -f "$relaunch_log"; fail "reason=helper_relaunch_accepted_invalid_request"
fi
grep -q 'relaunched with responsibility disclaimed' "$relaunch_log" \
  || { rm -f "$relaunch_log"; fail "reason=helper_not_relaunched"; }
rm -f "$relaunch_log"
printf '%s' "$relaunch" | grep -q '"protocol.invalid_envelope"' \
  || fail "reason=helper_relaunch_lost_output output=$relaunch"

# 응답이 한도를 넘는 경로를 명령으로 지난다. 8 MiB 짜리 캘린더 없이 닿도록
# SHERPA_APPLE_RESPONSE_LIMIT_BYTES 로 한도만 낮춘다(올릴 수는 없다). 권한이 필요 없는
# capabilities 읽기는 10 KB 쯤이라 1 KiB 한도를 넘는다. 읽기는 효과 없이 failed 이고,
# 종료 코드 0 의 프로토콜 응답이어야 한다. 받아들일 수 없는 값은 무시되어 그대로 성공한다.
capabilities='{"kind":"request","protocol_version":"2.0.0","application_contract":"sherpa.planner.v2","request_id":"gate-1","operation_id":"gate-1","capability":"capabilities","payload":{"schema":"sherpa.planner.capabilities.request.v2"},"deadline_ms":30000,"idempotency_key":"gate-1","policy":{"effect":"read","required_evidence":"none","artifact_directory":null}}'
oversized="$(printf '%s' "$capabilities" | SHERPA_APPLE_RESPONSE_LIMIT_BYTES=1024 "$binary" planner request 2>/dev/null)" \
  || fail "reason=oversized_read_exit_nonzero"
python3 -c '
import json, sys
d = json.loads(sys.argv[1])
assert len(sys.argv[1].encode()) <= 1024
assert d["status"] == "failed" and d.get("result") is None and d["operation_id"] == "gate-1"
assert d["error"] == {"code": "protocol.result_too_large", "retry": "never"}
assert d["effect"] == {"kind": "none", "state": "not_applicable"}
' "$oversized" || fail "reason=oversized_read_misreported output=$oversized"
ignored="$(printf '%s' "$capabilities" | SHERPA_APPLE_RESPONSE_LIMIT_BYTES=1 "$binary" planner request 2>/dev/null)" \
  || fail "reason=rejected_limit_override_failed"
python3 -c 'import json, sys; assert json.loads(sys.argv[1])["status"] == "succeeded"' "$ignored" \
  || fail "reason=rejected_limit_override_applied"
log info "check:core:success" "cli_version=$cli_version"

# 3. 에이전트 플러그인. 방금 빌드한 바이너리를 넘겨 스킬이 부르는 명령이 실제로
#    존재하는지까지 확인시킨다.
SHERPA_BINARY="$binary" bash "$REPO_ROOT/plugins/sherpa/scripts/check.sh" \
  || fail "reason=plugin_check_failed"

# 4. 자체 카탈로그가 다시 생기면 같은 플러그인이 두 목록에 보인다.
for catalog in "$REPO_ROOT/.claude-plugin/marketplace.json" "$REPO_ROOT/.agents/plugins/marketplace.json"; do
  [ ! -e "$catalog" ] || fail "reason=duplicate_marketplace_present file=${catalog#"$REPO_ROOT/"}"
done
log info "check:marketplace:success" "source=plug-hole"

# 5. 스킬이 요구하는 최소 CLI 버전이 이 체크아웃의 CLI 로 만족되는가.
#    같은 저장소에서 나가는 둘이 서로 모순인 채 릴리스되는 것을 막는다.
minimum="$(python3 -c "import json;print(json.load(open('$REPO_ROOT/plugins/sherpa/cli-contract.json'))['minimumVersion'])")"
python3 - "$cli_version" "$minimum" <<'PY' || fail "reason=cli_older_than_contract"
import sys
installed, minimum = (tuple(int(x) for x in v.split(".")) for v in sys.argv[1:3])
if installed < minimum:
    raise SystemExit(f"cli {'.'.join(map(str, installed))} < contract {'.'.join(map(str, minimum))}")
PY
log info "check:contract:success" "cli=$cli_version minimum=$minimum"

# 6. 문서 구조. 제목 앞에 본문이 오면 렌더러가 제목 없는 문서로 읽는다.
python3 "$REPO_ROOT/scripts/checks/verify_docs.py" "$REPO_ROOT" || fail "reason=doc_structure_invalid"
# 사용 문서가 안내하는 명령이 실제로 있는가. 0.7.1 의 live-validation.md 가 없는 명령을 안내했다.
help_snapshot="$(mktemp "${TMPDIR:-/tmp}/sherpa-help.XXXXXX")"
"$binary" --help > "$help_snapshot"
python3 "$REPO_ROOT/scripts/checks/verify_doc_commands.py" "$REPO_ROOT" "$help_snapshot" \
  || { rm -f "$help_snapshot"; fail "reason=doc_names_unknown_command"; }
rm -f "$help_snapshot"
log info "check:docs:success" "structure, links and commands"

# 7. 릴리스 경로. brew 가 없으면 건너뛰되 건너뛴 사실을 남긴다.
#    SHERPA_SKIP_RELEASE=1 로 명시적으로 끌 수 있다 — 반복 실행에서 느리기 때문이다.
if [ "${SHERPA_SKIP_RELEASE:-0}" = "1" ]; then
  log warn "check:release:skipped" "reason=explicitly_disabled — release path is UNVERIFIED"
elif command -v brew >/dev/null 2>&1; then
  bash "$REPO_ROOT/scripts/check-release.sh" || fail "reason=release_check_failed"
else
  log warn "check:release:skipped" "reason=no_brew — release path is UNVERIFIED"
fi

log info "$LOG_SCOPE:success" "cli=$cli_version plugin=1"
