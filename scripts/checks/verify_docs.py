"""문서 구조를 검사한다.

두 가지를 본다.

1. frontmatter 다음에 곧바로 `# 제목`이 와야 한다. 상태 안내를 제목 앞에 붙이는
   실수를 이 세션에서만 두 번 했다. 렌더러는 그런 문서를 제목 없는 문서로 읽는다.
2. `docs/**/*.md`, `README.md`, `AGENTS.md` 는 표준 frontmatter 6개 키
   (`uuid`, `type`, `audience`, `goal`, `tone`, `manner`)를 갖추어야 하고, 옛 키
   (`id`, `title`, `status`, `owner`)를 두지 않는다(`HANDOFF.md` 는 세션 인수인계
   파일이라 예외다).
3. 상대 링크가 실재하는 파일을 가리켜야 한다.
4. `CLAUDE.md` 는 두지 않는다(오너 결정 2026-10-12). 지침 파일은 `AGENTS.md`
   하나다. Codex 와 함께 쓰는 저장소라 파일이 둘이면 규칙이 갈라진다. import 한
   줄이든 심볼릭 링크든 다시 생기면 조용히 남으므로 게이트가 잡는다.
"""

import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
targets = (
    sorted(root.glob("docs/**/*.md"))
    + [root / "README.md", root / "AGENTS.md", root / "HANDOFF.md"]
)

REQUIRED_FRONTMATTER_KEYS = ("uuid", "type", "audience", "goal", "tone", "manner")
LEGACY_FRONTMATTER_KEYS = ("id", "title", "status", "owner")

problems: list[str] = []
for path in targets:
    if not path.is_file():
        continue
    text = path.read_text()
    rel = path.relative_to(root)

    fm_match = re.match(r"^---\n(.*?)\n---\n", text, flags=re.S)
    if rel != pathlib.Path("HANDOFF.md"):
        if not fm_match:
            problems.append(f"{rel}: missing frontmatter")
        else:
            keys = {
                line.split(":", 1)[0].strip()
                for line in fm_match.group(1).splitlines()
                if ":" in line and not line.startswith(" ")
            }
            missing = [k for k in REQUIRED_FRONTMATTER_KEYS if k not in keys]
            legacy = [k for k in LEGACY_FRONTMATTER_KEYS if k in keys]
            if missing:
                problems.append(f"{rel}: missing frontmatter keys {', '.join(missing)}")
            if legacy:
                problems.append(f"{rel}: legacy frontmatter keys {', '.join(legacy)}")

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
