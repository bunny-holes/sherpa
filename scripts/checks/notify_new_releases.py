"""새 릴리스를 알린다. 게이트를 실패시키지 않는다.

소유자 결정(2026-11-22, AGENTS.md)은 도구와 의존성을 늘 최신 안정판으로
두는 것이다. 그러나 게이트는 같은 커밋에 같은 결과를 내야 하므로 바깥에서
나온 릴리스는 warn 으로만 알린다. 레지스트리에 닿지 못하면 그 사실을 skipped
warn 으로 남기고 끝낸다. 판을 올리는 일은 그 자체의 변경으로 한다.

출처는 공개 npm 레지스트리의 latest 문서와 bun outdated 다. 요청마다 한도를 둔다.

- Bun: 패키지 `bun` 의 latest. Oven 은 `bun upgrade` 가 받는 GitHub 릴리스와
  같은 판을 npm 에도 낸다.
- Claude Code: `@anthropic-ai/claude-code` 의 latest. Homebrew cask
  `claude-code@latest` 가 이 판을 낸다(cask `claude-code` 는 stable 을 따른다).
- Codex: `@openai/codex` 의 latest. GitHub 릴리스 `rust-v<판>` 과 cask
  `codex` 가 같은 판이다.
- core 의 의존성: core/ 에서 `bun outdated`. 모두 정확한 판으로 고정했으므로
  표에 나온 줄이 새 릴리스다.

Claude Code 와 Codex 는 실측에 쓰는 판이라 PATH 에 있으면 그 --version 을 견준다.

사용: notify_new_releases.py <저장소 루트> <선언한 Bun 판>
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

REGISTRY = "https://registry.npmjs.org"
REQUEST_SECONDS = 10
OUTDATED_SECONDS = 60
UNCHECKED = "— new releases are UNCHECKED"
# 이름, 쓰는 판을 읽는 명령(None 이면 게이트가 확인한 Bun 판), npm 패키지.
TOOLS = (
    ("bun", None, "bun"),
    ("claude", ["claude", "--version"], "@anthropic-ai/claude-code"),
    ("codex", ["codex", "--version"], "@openai/codex"),
)
RECOVERABLE = (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError, ValueError, KeyError)


def log(level: str, action: str, message: str) -> None:
    print(f"{level} [check:currency:{action}] {message}", file=sys.stderr)


def release(text: str) -> tuple[int, ...] | None:
    """'2.1.326 (Claude Code)', 'codex-cli 0.171.0' 에서 판 번호를 꺼낸다."""
    match = re.search(r"\d+\.\d+\.\d+", text)
    return tuple(int(part) for part in match.group().split(".")) if match else None


def fetch(path: str) -> bytes:
    # macOS 의 curl 은 시스템 키체인의 인증서와 https_proxy 를 쓴다.
    return subprocess.run(
        ["curl", "-fsS", "--max-time", str(REQUEST_SECONDS), f"{REGISTRY}/{path}"],
        capture_output=True,
        check=True,
        timeout=REQUEST_SECONDS + 5,
    ).stdout


def installed(name: str, command: list[str]) -> str | None:
    if shutil.which(command[0]) is None:
        log("warn", "skipped", f"tool={name} reason=not_installed")
        return None
    try:
        output = subprocess.run(
            command, capture_output=True, text=True, check=True, timeout=REQUEST_SECONDS
        ).stdout
    except RECOVERABLE as error:
        log("warn", "skipped", f"tool={name} reason=version_unreadable error={type(error).__name__}")
        return None
    version = release(output)
    if version is None:
        log("warn", "skipped", f"tool={name} reason=version_unreadable")
        return None
    return ".".join(map(str, version))


def notify_tool(name: str, current: str, package: str) -> int:
    try:
        latest = json.loads(fetch(f"{package}/latest"))["version"]
        latest_release = release(latest)
        if latest_release is None:
            raise ValueError(latest)
    except RECOVERABLE as error:
        failure = type(error).__name__
        log("warn", "skipped", f"tool={name} reason=registry_failed source=npm:{package} error={failure}")
        return 0
    if latest_release > release(current):
        log("warn", "newer", f"tool={name} current={current} latest={latest} source=npm:{package}")
        return 1
    log("info", "current", f"tool={name} version={current} source=npm:{package}")
    return 0


def notify_dependencies(core: Path) -> int:
    try:
        result = subprocess.run(
            ["bun", "outdated"],
            cwd=core,
            capture_output=True,
            text=True,
            timeout=OUTDATED_SECONDS,
            env={**os.environ, "NO_COLOR": "1"},
        )
    except RECOVERABLE as error:
        log("warn", "skipped", f"source=bun_outdated reason={type(error).__name__} {UNCHECKED}")
        return 0
    if result.returncode != 0:
        log("warn", "skipped", f"source=bun_outdated reason=exit_{result.returncode} {UNCHECKED}")
        return 0
    # | Package | Current | Update | Latest | 표의 본문 줄만 읽는다. 머리 줄과 --- 줄은 건너뛴다.
    rows = []
    for line in result.stdout.splitlines():
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) == 4 and cells[0] != "Package" and cells[0].strip("-"):
            rows.append(cells)
    for package, current, _update, latest in rows:
        log(
            "warn",
            "newer",
            f"dependency={package.replace(' ', '')} current={current} latest={latest} source=bun_outdated",
        )
    if not rows:
        log("info", "current", "source=bun_outdated dependencies=core")
    return len(rows)


def main() -> int:
    root, declared_bun = Path(sys.argv[1]), sys.argv[2]
    try:
        fetch("-/ping")
    except RECOVERABLE as error:
        failure = type(error).__name__
        log("warn", "skipped", f"reason=registry_unreachable registry={REGISTRY} error={failure} {UNCHECKED}")
        return 0
    newer = 0
    for name, command, package in TOOLS:
        current = declared_bun if command is None else installed(name, command)
        if current is not None:
            newer += notify_tool(name, current, package)
    newer += notify_dependencies(root / "core")
    log("warn" if newer else "info", "summary", f"newer={newer}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
