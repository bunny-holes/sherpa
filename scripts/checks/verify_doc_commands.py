"""사용 문서가 안내하는 sherpa 명령이 CLI 에 실제로 있는지 확인한다.

docs/testing/live-validation.md 가 Rust 시절의 `sherpa context sync` 를 0.7.1 까지
안내했고, 그 문서를 따른 호출이 invalidRequest 로 끝났다(2026-11-20 소유자 실측).
스킬은 플러그인 검사가 보지만 저장소 문서는 아무도 보지 않았다. 지금 쓰는 사용
문서의 코드 블록과 코드 스팬을 --help 가 나열하는 명령 집합과 대조한다. ADR·RFC 는
당시 기록이라 대상이 아니다.

사용: verify_doc_commands.py <repo-root> <help-snapshot>
"""

import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
help_text = pathlib.Path(sys.argv[2]).read_text()

known_top: set[str] = set()
known_pairs: set[tuple[str, str]] = set()
for match in re.finditer(r"^\s+sherpa ([a-z][a-z-]*)(?: ([a-z][a-z-]*))?", help_text, re.M):
    known_top.add(match.group(1))
    if match.group(2):
        known_pairs.add((match.group(1), match.group(2)))
if not known_top:
    raise SystemExit("could not read any command from --help; refusing to pass silently")

documents = [
    root / "README.md",
    root / "plugins/sherpa/README.md",
    root / "plugins/sherpa/README.ko.md",
    *sorted((root / "docs/testing").glob("*.md")),
]
# live-evidence.md 는 날짜별 기록이라 옛 명령을 그대로 인용한다.
documents = [p for p in documents if p.is_file() and p.name != "live-evidence.md"]

command = re.compile(r"(?:^|[\s|(])sherpa ([a-z][a-z-]*)(?: ([a-z][a-z-]*))?")
bad: list[str] = []
for path in documents:
    text = path.read_text()
    code = re.findall(r"```[^\n]*\n(.*?)```", text, re.S) + re.findall(r"`([^`\n]+)`", text)
    for snippet in code:
        for match in command.finditer(snippet):
            top, sub = match.group(1), match.group(2)
            rel = path.relative_to(root)
            if top not in known_top:
                bad.append(f"{rel}: sherpa {top}")
            elif sub and any(t == top for t, _ in known_pairs) and (top, sub) not in known_pairs:
                bad.append(f"{rel}: sherpa {top} {sub}")

if bad:
    raise SystemExit("documents name unknown commands: " + "; ".join(sorted(set(bad))))
