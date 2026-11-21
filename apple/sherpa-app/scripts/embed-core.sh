#!/bin/sh
# The "Embed Core" build phase of the Sherpa target in Sherpa.xcodeproj. It puts the Bun core at
# Contents/MacOS/sherpa-core and signs it as dev.xiyo.sherpa.core with hardened runtime and no
# entitlements, with the identity Xcode resolved for the app (app connection contract §2). It
# only checks and embeds: Xcode's script PATH has no bun, so the core is built before xcodebuild
# (`bun run build` in core/). SHERPA_CORE, a build setting of the target, names the core.
#
# The app starts the core as `sherpa-core app serve` (§7.1). A core without that subcommand fails
# every start with frame violations until the app gives up (2026-11-21: a core/dist/sherpa from
# before #44 was bundled), so its first line must be the Mux 1 hello of the app's version
# (MARKETING_VERSION, the CLI version).
set -eu

fail() { echo "error: [build:app:embed-core] $1" >&2; exit 1; }
[ -x "$SHERPA_CORE" ] || fail "reason=core_missing remedy=\"build the core (bun run build in core/)\""
greeting="$("$SHERPA_CORE" app serve </dev/null 2>/dev/null | head -n 1 || true)"
tab="$(printf '\t')"
hello="${greeting#0${tab}hello${tab}}"
mux="$(printf '%s' "$hello" | plutil -extract mux raw -o - - 2>/dev/null || true)"
version="$(printf '%s' "$hello" | plutil -extract version raw -o - - 2>/dev/null || true)"
if [ "$hello" = "$greeting" ] || [ "$mux" != 1 ] || [ "$version" != "$MARKETING_VERSION" ]; then
  fail "reason=core_not_mux version=${version:-none} expected=$MARKETING_VERSION remedy=\"build the core from this checkout (bun run build in core/) or set SHERPA_CORE to a matching core\""
fi

# codesign writes a temporary file beside its target, and the script sandbox lets this phase write
# only its declared output and TEMP_DIR, so the copy is signed in TEMP_DIR and then embedded.
signed="$TEMP_DIR/sherpa-core"
cp -f "$SHERPA_CORE" "$signed"
if [ "$CODE_SIGNING_ALLOWED" = YES ]; then
  codesign --force --sign "$EXPANDED_CODE_SIGN_IDENTITY" --identifier dev.xiyo.sherpa.core \
    --options runtime --timestamp=none "$signed"
fi
cp -f "$signed" "$TARGET_BUILD_DIR/$EXECUTABLE_FOLDER_PATH/sherpa-core"
echo "[build:app:embed-core] status=embedded version=$version"
