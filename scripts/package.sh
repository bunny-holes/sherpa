#!/usr/bin/env bash
# 릴리스 아카이브와 Homebrew Formula 를 만든다.
#
# 아카이브에는 실행 파일 둘만 담는다: Bun 으로 컴파일한 코어 bin/sherpa 와 Swift Apple
# 헬퍼 libexec/sherpa-apple(ADR-0008). 에이전트 스킬은 plugin marketplace 로 따로 나간다.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly REPO_ROOT
readonly CORE_PATH="$REPO_ROOT/core"
readonly HELPER_PACKAGE="$REPO_ROOT/apple/eventkit-service"
# 기본은 릴리스 산출물 자리. 검사용 실행은 SHERPA_DIST 로 임시 위치를 준다 —
# 빌드가 비결정적이라 여기서 아카이브를 다시 만들면 해시가 달라지고, tap 의
# Formula 가 가리키던 해시와 어긋나 재설치가 깨진다.
readonly DIST="${SHERPA_DIST:-$REPO_ROOT/target/dist}"
readonly STAGING="$DIST/pkg"
readonly TARGET_TRIPLE="aarch64-apple-darwin"
readonly LOG_SCOPE="release:package"

log() { printf '%s [%s:%s] %s\n' "$1" "$LOG_SCOPE" "$2" "$3" >&2; }
fail() { log error "$1" "$2"; exit 1; }

log info start "building the core and the Apple helper"
(cd "$CORE_PATH" && bun install --frozen-lockfile >/dev/null && bun run build >/dev/null) \
  || fail failure "reason=core_build_failed"
swift build --package-path "$HELPER_PACKAGE" -c release --product sherpa-apple >/dev/null \
  || fail failure "reason=helper_build_failed"

readonly BINARY="$CORE_PATH/dist/sherpa"
readonly HELPER="$HELPER_PACKAGE/.build/release/sherpa-apple"
[ -x "$BINARY" ] || fail failure "reason=binary_missing path=${BINARY#"$REPO_ROOT/"}"
[ -x "$HELPER" ] || fail failure "reason=helper_missing path=${HELPER#"$REPO_ROOT/"}"

# 버전의 단일 진실 원천은 빌드된 코어다. 가드(require-cli.sh)와 Formula 가 같은
# 문자열에 기대므로 형식부터 검증하고, 헬퍼가 같은 판인지 대조한다.
raw_version="$("$BINARY" --version)"
version="$(printf '%s' "$raw_version" | sed -n 's/^sherpa \([0-9]\{1,\}\.[0-9]\{1,\}\.[0-9]\{1,\}\)$/\1/p')"
[ -n "$version" ] || fail failure "reason=version_format_unexpected output=$raw_version"
helper_version="$("$HELPER" --version)"
[ "$helper_version" = "sherpa-apple $version" ] \
  || fail failure "reason=helper_version_mismatch core=$version helper=$helper_version"
log info version "version=$version"

rm -rf "$STAGING"
mkdir -p "$STAGING"

install -d "$STAGING/bin" "$STAGING/libexec"
install -m 0755 "$BINARY" "$STAGING/bin/sherpa"
install -m 0755 "$HELPER" "$STAGING/libexec/sherpa-apple"

staged="$(cd "$STAGING" && find . -type f | sort | tr '\n' ' ')"
[ "$staged" = "./bin/sherpa ./libexec/sherpa-apple " ] \
  || fail failure "reason=unexpected_archive_contents staged=$staged"
# Apple silicon 은 서명 없는 실행 파일을 죽인다. 둘 다 ad-hoc 서명이 유효해야 한다.
for executable in "$STAGING/bin/sherpa" "$STAGING/libexec/sherpa-apple"; do
  codesign --verify "$executable" 2>/dev/null \
    || fail failure "reason=signature_invalid file=${executable#"$STAGING/"}"
done

readonly ARCHIVE="$DIST/sherpa-$version-$TARGET_TRIPLE.tar.gz"
rm -f "$ARCHIVE"
tar -czf "$ARCHIVE" -C "$STAGING" .
checksum="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"

# Formula 는 같은 틀로 두 벌 렌더한다. 둘은 url 한 줄만 다르다.
#
# - Formula/sherpa.rb: 배포본. url 이 공개 저장소의 릴리스 자산을 가리킨다. 공개 tap
#   XIYO/homebrew-tap 의 Formula/sherpa.rb 로 통째로 옮기면 `brew install xiyo/tap/sherpa` 가
#   이 판을 받는다. 자산은 --publish 가 올리므로 --publish 가 성공한 실행의 것만 옮긴다 —
#   Swift 빌드가 비결정적이라 다른 실행의 아카이브는 해시가 다르다.
# - local-tap/Formula/sherpa.rb: 개발본. url 이 방금 만든 file:// 아카이브라 게시 전에도
#   설치된다. 릴리스 스모크(check-release.sh)와 로컬 개발 tap 이 쓴다.
readonly RELEASE_REPOSITORY="XIYO/sherpa"
readonly ARCHIVE_NAME="${ARCHIVE##*/}"
readonly TAG="v$version"
readonly RELEASE_URL="https://github.com/$RELEASE_REPOSITORY/releases/download/$TAG/$ARCHIVE_NAME"

if [ "${1:-}" = "--publish" ]; then
  command -v gh >/dev/null 2>&1 || fail failure "reason=gh_missing"
  gh release view "$TAG" --repo "$RELEASE_REPOSITORY" >/dev/null 2>&1 \
    || fail failure "reason=release_tag_missing tag=$TAG"
  gh release upload "$TAG" "$ARCHIVE" --repo "$RELEASE_REPOSITORY" --clobber >/dev/null 2>&1 \
    || fail failure "reason=asset_upload_failed tag=$TAG"
  # 배포본 Formula 의 sha256 은 이 자산의 것이어야 한다. 올린 것을 다시 받아 대조한다.
  readback="$(mktemp -d "${TMPDIR:-/tmp}/sherpa-readback.XXXXXX")"
  gh release download "$TAG" --repo "$RELEASE_REPOSITORY" --pattern "$ARCHIVE_NAME" --dir "$readback" >/dev/null 2>&1 \
    || { rm -rf "$readback"; fail failure "reason=asset_readback_failed tag=$TAG"; }
  uploaded="$(shasum -a 256 "$readback/$ARCHIVE_NAME" | awk '{print $1}')"
  rm -rf "$readback"
  [ "$uploaded" = "$checksum" ] || fail failure "reason=asset_checksum_mismatch tag=$TAG"
  log info publish "asset verified at $TAG; copy Formula/sherpa.rb into XIYO/homebrew-tap"
fi

# Formula 에 `version` 줄을 넣지 않는다. Homebrew 는 url 의 아카이브 이름
# (sherpa-<version>-aarch64-apple-darwin.tar.gz)에서 판을 읽고, 같은 값을 명시하면
# `brew audit` 이 "redundant with version scanned from URL" 로 거부한다(0.7.1 tap 에서 실측).
# 두 url 모두 같은 아카이브 이름을 가리키므로 두 판 다 같은 판을 읽는다.
render_formula() {
  local url="$1" destination="$2"
  mkdir -p "${destination%/*}"
  cat > "$destination" <<FORMULA
class Sherpa < Formula
  desc "Local-first planning and context orchestrator for macOS"
  homepage "https://github.com/$RELEASE_REPOSITORY"
  url "$url"
  sha256 "$checksum"
  license "MIT"

  depends_on arch: :arm64
  depends_on macos: :sonoma
  depends_on "sqlcipher"

  def install
    bin.install "bin/sherpa"
    libexec.install "libexec/sherpa-apple"
  end

  def caveats
    <<~EOS
      Sherpa is installed without Developer ID or notarization.
      macOS may ask for Calendar, Reminders, or automation permission when used.
      Mail, iMessage, and KakaoTalk reads need Full Disk Access for the app that
      runs sherpa. Run "sherpa kakaotalk setup" once before reading KakaoTalk.

      Agent skills are not bundled with this CLI. Install them separately:
      Your GitHub account needs access to the private XIYO/plug-hole repository.
        claude plugin marketplace add https://github.com/XIYO/plug-hole.git
        claude plugin install sherpa@plug-hole
    EOS
  end

  test do
    # 스킬의 버전 가드가 이 출력 형식에 기댄다. version 은 Homebrew 가 url 에서 읽은 값이다.
    assert_equal "sherpa #{version}", shell_output("#{bin}/sherpa --version").strip
    assert_match "sherpa kakaotalk archive", shell_output("#{bin}/sherpa --help")
    assert_equal "sherpa-apple #{version}", shell_output("#{libexec}/sherpa-apple --version").strip
    # 코어가 설치 위치의 헬퍼를 찾아 이름 있는 오류로 끝나는지 본다.
    assert_match "protocol.invalid_envelope", pipe_output("#{bin}/sherpa planner request", "{}", 1)
  end
end
FORMULA
}

render_formula "$RELEASE_URL" "$DIST/Formula/sherpa.rb"
render_formula "file://$ARCHIVE" "$DIST/local-tap/Formula/sherpa.rb"

log info success "version=$version archive=${ARCHIVE#"$REPO_ROOT/"} sha256=$checksum"
printf '%s\n' "$checksum"
