"""SessionStart 훅이 CLI 어긋남을 세션 시작 때 알리는지 확인한다.

스킬의 `require-cli.sh` 가드는 스킬을 부를 때까지 아무것도 알려주지 않는다.
그래서 사용자는 일을 시키고 나서야 CLI 가 없거나 낡았다는 것을 안다.
훅은 같은 가드를 세션 첫머리에 한 번 돌려 그 시점을 앞당긴다.

훅에 걸린 제약은 둘이다 — 정상일 때는 아무 말도 하지 않아야 하고(매 세션마다
같은 문장을 읽게 만들지 않는다), 어떤 경우에도 세션을 실패시키지 않아야 한다.
그래서 종료 코드는 항상 0이다.

가짜 `sherpa` 를 PATH 에 두고 네 가지 상태를 모두 태운다.

이 검사는 macOS 게이트에서만 돈다(Windows 지원은 2026-11-20 소유자 결정으로 걷어냈다).
python 은 이름이 아니라 이 검사를 돌리는 인터프리터로 고정한다.

훅은 Python 없이 동작해야 한다. PATH 에 Python 이 없거나 잘못된 이름만 있어도 같은
상태를 내는지 확인한다.

플랫폼도 흉내 낸다. 가드는 `uname -s` 로 macOS 인지 보므로 가짜 `uname` 을 PATH 에 둔다.
네 상태는 `Darwin` 으로 고정하고, 다른 OS 에서는 훅이 침묵하고 가드가 `unsupported` 를
답하는지를 따로 본다. 플러그인 마켓플레이스는 OS 를 가리지 않으므로 다른 OS 의 Claude Code
가 훅을 돌려도 세션마다 쓸 수 없는 안내를 읽히지 않게 한다.
"""

import json
import os
import pathlib
import shutil
import stat
import subprocess
import sys
import tempfile

root = pathlib.Path(sys.argv[1])
hook = root / "hooks" / "session-start.sh"
guard = root / "scripts" / "require-cli.sh"
contract = json.loads((root / "cli-contract.json").read_text(encoding="utf-8"))
command = contract["command"]
minimum = contract["minimumVersion"]
install = contract["install"]

# 훅의 분기마다 하나뿐인 문장 조각. 설치 명령이 들어 있는지만 물으면 "확인에 실패"
# 분기도 remedy 를 끼워 넣으므로 통과한다 — 어느 분기의 문장인지를 묻는다.
SENTENCE_MISSING = "설치되어 있지 않습니다"
SENTENCE_MISMATCH = "계약과 어긋납니다"
SENTENCE_FALLBACK = "확인에 실패"

failures: list[str] = []

if not hook.is_file():
    raise SystemExit(f"hook is missing: {hook}")

hooks_json = root / "hooks" / "hooks.json"
if not hooks_json.is_file():
    raise SystemExit(f"hook manifest is missing: {hooks_json}")

manifest = json.loads(hooks_json.read_text(encoding="utf-8"))
events = manifest.get("hooks", {})
if "SessionStart" not in events:
    failures.append("hooks.json declares no SessionStart hook")


def write_script(path: pathlib.Path, body: str) -> None:
    path.write_bytes(body.encode("utf-8"))
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


def path_without_cli() -> list[str]:
    """진짜 sherpa 가 있는 디렉터리만 뺀 PATH. 섞이면 "CLI 없음" 상태를 만들 수 없다."""
    kept = []
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        if not entry:
            continue
        directory = pathlib.Path(entry)
        if any((directory / name).exists() for name in (command, f"{command}.exe")):
            continue
        kept.append(entry)
    return kept


BASH = shutil.which("bash") or "/bin/bash"
BASE_PATH = path_without_cli()
PYTHON = pathlib.Path(sys.executable).as_posix()


def install_python(bin_dir: pathlib.Path, python: str) -> None:
    """훅이 부를 python 을 bin_dir 에 둔다.

    plain    python3 이 이 검사를 돌리는 인터프리터다.
    renamed  python3 은 이름만 있고 실행되지 않으며 python 만 동작한다.
    absent   python3 도 python 도 실행되지 않는다.
    """
    broken = '#!/bin/sh\necho "Python was not found" >&2\nexit 49\n'
    working = f'#!/bin/sh\nexec "{PYTHON}" "$@"\n'
    write_script(bin_dir / "python3", broken if python in ("renamed", "absent") else working)
    if python in ("renamed", "absent"):
        write_script(bin_dir / "python", broken if python == "absent" else working)


def run(
    fake_version: str | None,
    python: str = "plain",
    platform: str | None = "Darwin",
    script: pathlib.Path = hook,
) -> subprocess.CompletedProcess[bytes]:
    """훅(또는 script 로 준 가드)을 돌린다. fake_version 이 None 이면 PATH 에 sherpa 가 없는 상태다.

    platform 은 가짜 `uname` 이 답할 커널 이름이다. None 이면 `uname` 이 실패한다.
    출력은 바이트로 받는다. text 모드로 받으면 `\\r\\n` 이 `\\n` 으로 바뀌어 보려던 것이 사라진다.
    """
    with tempfile.TemporaryDirectory() as tmp:
        bin_dir = pathlib.Path(tmp)
        if fake_version is not None:
            write_script(bin_dir / command, f'#!/bin/sh\necho "{command} {fake_version}"\n')
        write_script(bin_dir / "uname", f'#!/bin/sh\necho "{platform}"\n' if platform else "#!/bin/sh\nexit 1\n")
        install_python(bin_dir, python)
        env = {**os.environ, "PATH": os.pathsep.join([str(bin_dir), *BASE_PATH])}
        return subprocess.run([BASH, str(script)], capture_output=True, env=env, check=False)


def context_of(result: subprocess.CompletedProcess[bytes]) -> str:
    if not result.stdout.strip():
        return ""
    payload = json.loads(result.stdout.decode("utf-8"))
    return payload["hookSpecificOutput"]["additionalContext"]


def expect_sentence(label: str, result: subprocess.CompletedProcess[bytes], sentence: str) -> str:
    """결과가 그 분기의 문장인지, 그리고 어디에도 `\\r` 이 없는지 본다."""
    try:
        context = context_of(result)
    except (ValueError, KeyError) as error:
        failures.append(f"{label}: hook output is not a SessionStart payload ({error}): {result.stdout!r}")
        return ""
    if sentence not in context:
        failures.append(f"{label}: expected the sentence {sentence!r}, got {context!r}")
    if sentence != SENTENCE_FALLBACK and SENTENCE_FALLBACK in context:
        failures.append(f"{label}: fell through to the catch-all branch: {context!r}")
    if "\r" in context:
        failures.append(f"{label}: context carries a carriage return: {context!r}")
    if b"\r" in result.stdout:
        failures.append(f"{label}: payload carries a carriage return: {result.stdout!r}")
    return context


major, minor, patch = (int(part) for part in minimum.split("."))
older = f"{major}.{minor}.{patch - 1}" if patch else f"{major}.{minor - 1}.0"


def exercise(python: str) -> None:
    # 1. 최소 버전을 만족하면 침묵한다.
    ready = run(minimum, python)
    if ready.stdout.strip():
        failures.append(f"{python}/ready: hook spoke while the CLI satisfies the contract: {ready.stdout!r}")

    # 2. CLI 가 아예 없으면 "없다"는 문장으로 설치 방법을 알린다.
    missing = run(None, python)
    if install not in expect_sentence(f"{python}/missing", missing, SENTENCE_MISSING):
        failures.append(f"{python}/missing: missing CLI did not surface the install command")

    # 3. 낡은 CLI 에는 "어긋난다"는 문장으로 설치된 버전과 설치(업그레이드) 명령을 낸다.
    too_old = run(older, python)
    old_context = expect_sentence(f"{python}/too_old", too_old, SENTENCE_MISMATCH)
    if install not in old_context:
        failures.append(f"{python}/too_old: old CLI did not surface the upgrade command")
    if older not in old_context:
        failures.append(f"{python}/too_old: old CLI was not told its installed version {older}")

    # 4. MAJOR 가 앞선 CLI 에는 brew 를 권하면 안 된다 — 고쳐야 할 쪽은 플러그인이다.
    too_new = run(f"{major + 1}.0.0", python)
    new_context = expect_sentence(f"{python}/too_new", too_new, SENTENCE_MISMATCH)
    if install in new_context:
        failures.append(f"{python}/too_new: newer CLI was told to reinstall the CLI: {new_context!r}")
    if "plugin" not in new_context.lower():
        failures.append(f"{python}/too_new: newer CLI was not told to update the plugin: {new_context!r}")

    # 5. 어떤 상태에서도 세션을 실패시키지 않는다.
    for label, result in (
        ("ready", ready),
        ("missing", missing),
        ("too_old", too_old),
        ("too_new", too_new),
    ):
        if result.returncode != 0:
            failures.append(f"{python}/{label}: hook exited {result.returncode}; it must never fail a session")


exercise("plain")

# 6. python3 이라는 이름이 실행되지 않고 python 만 있어도 같다.
exercise("renamed")

# 7. Python 이 아예 없어도 네 상태를 모두 판정한다.
exercise("absent")

# 8. 비 macOS 에서는 CLI 가 있을 수 없다. 훅은 침묵하고 — 실행할 수 없는 brew 명령을 매 세션
#    읽히지 않는다 — 가드는 스킬을 부를 때 "macOS 전용"이라고 답한다. 가짜 sherpa 가 있든 없든 같다.
for platform in ("MINGW64_NT-10.0-26200", "Linux"):
    for fake_version in (None, minimum):
        label = f"{platform}/{'ready' if fake_version else 'missing'}"

        silent = run(fake_version, platform=platform)
        if silent.stdout.strip():
            failures.append(f"{label}: hook spoke on a platform the CLI does not run on: {silent.stdout!r}")
        if silent.returncode != 0:
            failures.append(f"{label}: hook exited {silent.returncode}; it must never fail a session")

        refused = run(fake_version, platform=platform, script=guard)
        if refused.returncode == 0:
            failures.append(f"{label}: guard exited 0 on a platform the CLI does not run on")
        if b"\r" in refused.stdout:
            failures.append(f"{label}: guard output carries a carriage return: {refused.stdout!r}")
        try:
            answer = json.loads(refused.stdout.decode("utf-8"))
        except ValueError as error:
            failures.append(f"{label}: guard output is not JSON ({error}): {refused.stdout!r}")
            continue
        if answer.get("status") != "unsupported":
            failures.append(f"{label}: guard status is {answer.get('status')!r}, expected 'unsupported'")
        if answer.get("reason") != "macos_only":
            failures.append(f"{label}: guard reason is {answer.get('reason')!r}, expected 'macos_only'")
        if answer.get("platform") != platform:
            failures.append(f"{label}: guard did not report the platform it saw: {answer!r}")
        if "macos" not in str(answer.get("remedy", "")).lower():
            failures.append(f"{label}: guard remedy does not say the CLI is macOS-only: {answer!r}")
        if b"brew" in refused.stdout.lower():
            failures.append(f"{label}: guard suggested brew where it cannot run: {refused.stdout!r}")

# 9. 플랫폼을 읽지 못하면 침묵하지 않는다. 조용한 실패가 0.7.2 에서 고친 결함이었다.
unknown = run(None, platform=None)
expect_sentence("no-uname/missing", unknown, SENTENCE_FALLBACK)
if unknown.returncode != 0:
    failures.append(f"no-uname/missing: hook exited {unknown.returncode}; it must never fail a session")

if failures:
    raise SystemExit("\n".join(failures))
