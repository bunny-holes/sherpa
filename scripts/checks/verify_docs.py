"""문서 구조를 검사한다.

두 가지를 본다.

1. frontmatter 다음에 곧바로 `# 제목`이 와야 한다. 상태 안내를 제목 앞에 붙이는
   실수를 이 세션에서만 두 번 했다. 렌더러는 그런 문서를 제목 없는 문서로 읽는다.
2. 상대 링크가 실재하는 파일을 가리켜야 한다.
3. `CLAUDE.md` 는 두지 않는다(오너 결정 2026-10-12). 지침 파일은 `AGENTS.md`
   하나다. Codex 와 함께 쓰는 저장소라 파일이 둘이면 규칙이 갈라진다. import 한
   줄이든 심볼릭 링크든 다시 생기면 조용히 남으므로 게이트가 잡는다.
"""

import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
targets = (
    sorted(root.glob("docs/**/*.md"))
    + [root / "README.md", root / "AGENTS.md", root / "RESUME.md"]
)

problems: list[str] = []
for path in targets:
    if not path.is_file():
        continue
    text = path.read_text()
    rel = path.relative_to(root)

    body = re.sub(r"^---\n.*?\n---\n", "", text, count=1, flags=re.S).lstrip()
    if body and not body.startswith("#"):
        problems.append(f"{rel}: body starts before the title — {body.splitlines()[0][:60]}")

    for match in re.finditer(r"\]\((?!https?://|#)([^)]+)\)", text):
        target = (path.parent / match.group(1).split("#")[0]).resolve()
        if not target.exists():
            problems.append(f"{rel}: dead link {match.group(1)}")

claude_md = root / "CLAUDE.md"
if not (root / "AGENTS.md").is_file():
    problems.append("AGENTS.md: missing — it is the only instruction file")
if claude_md.is_symlink() or claude_md.exists():
    problems.append(
        "CLAUDE.md: present — the owner removed it on 2026-10-12; put rules in AGENTS.md"
    )

if problems:
    raise SystemExit("\n".join(problems))
