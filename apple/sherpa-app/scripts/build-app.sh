#!/usr/bin/env bash
# Development bundle of Sherpa.app (bunny-holes/sherpa#28). Release packaging, the secure
# timestamp and notarization belong to bunny-holes/sherpa#31.
#
#   apple/sherpa-app/scripts/build-app.sh [--debug] [--core <path>] [--identity <sha1|name|->] [--output <dir>]
#
# Layout and signing follow the app connection contract §2: Contents/MacOS/Sherpa
# (dev.xiyo.sherpa, calendars and Apple Events entitlements), sherpa-relay
# (dev.xiyo.sherpa.relay) and sherpa-core (dev.xiyo.sherpa.core, no entitlements), each
# with hardened runtime, signed inside out. The bundle Info.plist is made from the helper's
# Info.plist, the one place that already holds the CLI version (AGENTS.md); no new version
# location is added. The default build is release: a DEBUG build reads the test variables
# of contract §13.2 and is for tests only.
set -euo pipefail

PACKAGE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
REPO_ROOT="$(cd "$PACKAGE/../.." && pwd -P)"
readonly PACKAGE REPO_ROOT
readonly LOG_SCOPE="build:app"

log() { printf '%s [%s:%s] %s\n' "$1" "$LOG_SCOPE" "$2" "$3" >&2; }
fail() { log error "$1" "$2"; exit 1; }

configuration=release
core=""
identity=""
output="$PACKAGE/.build/app"
while [ $# -gt 0 ]; do
  case "$1" in
    --debug) configuration=debug; shift ;;
    --core) core="$2"; shift 2 ;;
    --identity) identity="$2"; shift 2 ;;
    --output) output="$2"; shift 2 ;;
    *) fail usage "reason=unknown_argument" ;;
  esac
done

# Without --core the core is built from this checkout, so the bundle never carries a
# core/dist/sherpa left from an older commit.
if [ -z "$core" ]; then
  (cd "$REPO_ROOT/core" && bun run build >/dev/null 2>&1) || fail build "reason=core_build_failed"
  core="$REPO_ROOT/core/dist/sherpa"
fi
[ -x "$core" ] || fail input "reason=core_missing"

# The app starts the core as `sherpa-core app serve` (contract §7.1). A core without that
# subcommand fails every start with frame violations until the app gives up (2026-11-21: a
# stale core/dist/sherpa from before #44 was bundled), so the core must greet with a Mux 1
# hello of this checkout's version before anything is built.
expected_version="$(plutil -extract CFBundleShortVersionString raw -o - "$REPO_ROOT/apple/eventkit-service/Resources/Info.plist")"
greeting="$("$core" app serve </dev/null 2>/dev/null | head -n 1 || true)"
python3 - "$greeting" "$expected_version" <<'PY' || fail input "reason=core_not_mux remedy=\"build the core from this checkout (bun run build in core/) or pass a matching --core\""
import json, sys
channel, kind, body = (sys.argv[1].split("\t") + ["", "", ""])[:3]
hello = json.loads(body) if channel == "0" and kind == "hello" else {}
sys.exit(0 if hello.get("mux") == 1 and hello.get("version") == sys.argv[2] else 1)
PY

log info start "configuration=$configuration"
swift build --package-path "$PACKAGE" -c "$configuration" --product Sherpa >/dev/null 2>&1 \
  || fail build "reason=app_build_failed"
swift build --package-path "$PACKAGE" -c "$configuration" --product sherpa-relay >/dev/null 2>&1 \
  || fail build "reason=relay_build_failed"
bin="$(swift build --package-path "$PACKAGE" -c "$configuration" --show-bin-path)"

if [ -z "$identity" ]; then
  identity="$(security find-identity -v -p codesigning 2>/dev/null \
    | awk -F'"' '/"Developer ID Application: /{split($1, f, " "); print f[2]; exit}')"
fi
if [ -z "$identity" ]; then
  identity="-"
  log warn sign "no Developer ID identity; the bundle is ad-hoc signed and relays will refuse it"
fi

app="$output/Sherpa.app"
rm -rf "$app"
install -d "$app/Contents/MacOS"
install -m 0755 "$bin/Sherpa" "$app/Contents/MacOS/Sherpa"
install -m 0755 "$bin/sherpa-relay" "$app/Contents/MacOS/sherpa-relay"
install -m 0755 "$core" "$app/Contents/MacOS/sherpa-core"

plist="$app/Contents/Info.plist"
cp "$REPO_ROOT/apple/eventkit-service/Resources/Info.plist" "$plist"
plutil -insert CFBundleExecutable -string Sherpa "$plist"
plutil -insert CFBundlePackageType -string APPL "$plist"
plutil -insert LSUIElement -bool true "$plist"
version="$(plutil -extract CFBundleShortVersionString raw -o - "$plist")"

sign() {
  codesign --force --options runtime --timestamp=none --sign "$identity" "$@" >/dev/null 2>&1
}
sign --identifier dev.xiyo.sherpa.core "$app/Contents/MacOS/sherpa-core" || fail sign "reason=core_signing_failed"
sign --identifier dev.xiyo.sherpa.relay "$app/Contents/MacOS/sherpa-relay" || fail sign "reason=relay_signing_failed"
sign --entitlements "$PACKAGE/Resources/Sherpa.entitlements" "$app" || fail sign "reason=app_signing_failed"
codesign --verify --strict --deep "$app" 2>/dev/null || fail verify "reason=signature_invalid"

# Each executable carries its identifier and hardened runtime; with Developer ID its
# designated requirement also names the team (§4). An ad-hoc requirement is a code hash.
for pair in "Sherpa:dev.xiyo.sherpa" "sherpa-relay:dev.xiyo.sherpa.relay" "sherpa-core:dev.xiyo.sherpa.core"; do
  name="${pair%%:*}"
  details="$(codesign -dv "$app/Contents/MacOS/$name" 2>&1)"
  printf '%s\n' "$details" | grep -qx "Identifier=${pair#*:}" \
    || fail verify "reason=identifier_mismatch file=$name"
  printf '%s\n' "$details" | grep -q 'flags=.*runtime' || fail verify "reason=runtime_missing file=$name"
  if [ "$identity" != "-" ]; then
    requirement="$(codesign -d -r- "$app/Contents/MacOS/$name" 2>&1)"
    printf '%s' "$requirement" | grep -q "identifier \"${pair#*:}\" and anchor apple generic" \
      || fail verify "reason=requirement_not_developer_id file=$name"
    printf '%s' "$requirement" | grep -q 'certificate leaf\[subject.OU\] = FN2KZ2J47B' \
      || fail verify "reason=team_missing file=$name"
  fi
done
[ "$("$app/Contents/MacOS/sherpa-relay" --version)" = "sherpa-relay $version" ] \
  || fail verify "reason=relay_version_mismatch"

signed=developer_id
[ "$identity" = "-" ] && signed=adhoc
log info success "version=$version configuration=$configuration signed=$signed bundle=${app#"$REPO_ROOT/"}"
