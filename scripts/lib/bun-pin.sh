# shellcheck shell=bash
# Bun 판 고정(bunny-holes/sherpa#71). 게이트(scripts/check-all.sh), 릴리스 패키징(scripts/package.sh), Xcode 의 Embed Core
# 단계(apple/sherpa-app/scripts/embed-core.sh)가 source 한다.
#
# 코어는 core/package.json 의 devEngines.packageManager 가 적은 Bun 하나로 설치·시험·빌드하고, bun build --compile 은
# 그 런타임을 실행 파일에 넣는다. Bun 은 이 필드를 읽지 않으므로(docs/testing/live-evidence.md 2026-11-22) PATH 의 첫
# bun 과 컴파일한 코어가 품은 런타임을 여기서 직접 본다.
#
# 함수는 로그를 쓰지 않는다. 실패하면 BUN_PIN_FAILURE 에 reason=… 을 남기고 1 을 돌려준다. 부른 쪽이 자기 로그 범위로
# 그 값을 적고 멈추므로 실패 이름은 부르는 스크립트마다 같다.

# 홈 아래 경로는 ~ 로 줄여 적는다. 게이트 출력은 PR 본문에 옮겨진다.
bun_pin_shown_path() { case "$1" in "$HOME"/*) printf '~/%s' "${1#"$HOME"/}" ;; *) printf '%s' "$1" ;; esac; }

# core/package.json 이 선언한 판을 읽는다. 인자: 저장소 루트. 성공하면 BUN_PIN_VERSION 에 그 판을 둔다. PATH 의 bun 은
# 보지 않으므로, PATH 에 bun 이 없는 Xcode 의 스크립트 단계도 부를 수 있다.
bun_pin_declared() {
  BUN_PIN_VERSION="" BUN_PIN_FAILURE=""
  if ! BUN_PIN_VERSION="$(python3 -c '
import json, re, sys
manager = json.load(open(sys.argv[1])).get("devEngines", {}).get("packageManager")
version = manager.get("version") if isinstance(manager, dict) and manager.get("name") == "bun" else None
if not isinstance(version, str) or not re.fullmatch(r"[0-9]+[.][0-9]+[.][0-9]+", version):
    sys.exit(1)
print(version)
' "$1/core/package.json")"; then
    BUN_PIN_FAILURE="reason=bun_version_undeclared file=core/package.json"
    return 1
  fi
}

# PATH 의 첫 bun 이 선언한 판인지 본다. 인자: 저장소 루트. 성공하면 BUN_PIN_VERSION 에 선언한 판을, BUN_PIN_PATH 에
# 그 bun 의 경로(~ 로 줄인 것)를 둔다.
bun_pin_require() {
  local path actual
  BUN_PIN_PATH=""
  bun_pin_declared "$1" || return 1
  if ! path="$(command -v bun)"; then
    BUN_PIN_FAILURE="reason=bun_missing expected=$BUN_PIN_VERSION"
    return 1
  fi
  BUN_PIN_PATH="$(bun_pin_shown_path "$path")"
  if ! actual="$(bun --version)"; then
    BUN_PIN_FAILURE="reason=bun_version_unreadable path=$BUN_PIN_PATH"
    return 1
  fi
  if [ "$actual" != "$BUN_PIN_VERSION" ]; then
    BUN_PIN_FAILURE="reason=bun_version_mismatch expected=$BUN_PIN_VERSION actual=$actual path=$BUN_PIN_PATH"
    return 1
  fi
}

# 컴파일한 코어가 품은 Bun 런타임이 선언한 판인지 본다. bun_pin_require 나 bun_pin_declared 가 성공한 뒤에 부른다.
# 인자: 실행 파일, 실패에 적을 이름. BUN_BE_BUN=1 이면 컴파일한 실행 파일이 자기 진입점 대신 bun CLI 로 돈다(Bun
# 문서 "Act as the Bun CLI").
bun_pin_verify_runtime() {
  local binary="$1" label="$2" runtime
  BUN_PIN_FAILURE=""
  if ! runtime="$(BUN_BE_BUN=1 "$binary" --version)"; then
    BUN_PIN_FAILURE="reason=core_runtime_unreadable file=$label"
    return 1
  fi
  if [ "$runtime" != "$BUN_PIN_VERSION" ]; then
    BUN_PIN_FAILURE="reason=core_runtime_mismatch expected=$BUN_PIN_VERSION actual=$runtime file=$label"
    return 1
  fi
}
