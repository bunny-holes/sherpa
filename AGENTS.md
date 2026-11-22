---
uuid: 01a0ed87-17c8-729c-8473-05d2e83ddf73
type: instructions
audience: "이 저장소에서 작업하는 에이전트. 변경·검증·병합 전에 규칙을 확인할 때"
goal: "어디서 상태를 읽고, 사실이 바뀌면 무엇을 함께 고치며, 어떻게 검증하고 병합하는지 따르게 한다"
tone: "명령형 영어. 규칙마다 이유를 한 문장으로 단다"
manner: "규칙만 적고 근거는 ADR·live-evidence·스크립트 주석으로 내린다"
---

# Sherpa repository instructions

- Publish the agent plugin only through `XIYO/plug-hole` as `sherpa@plug-hole`.
  Keep its source and releases here without a repository marketplace.
- This file is the only instruction file of the repository. Do not add
  `CLAUDE.md`, as an import, a symbolic link, or a copy (owner decision,
  2026-10-12): Codex and Claude Code share this checkout, and a second file
  lets the rules drift apart. `scripts/checks/verify_docs.py` rejects one.
- Read `docs/architecture/README.md` and the matching document under
  `docs/contracts/` before changing a worker boundary, canonical reference,
  domain model, or SQLite storage.
- Unfinished work that must pass to another session lives in one root
  `HANDOFF.md`: its goal, the owner's decisions, what is true now, what is not
  yet proven, and the next step. Write it with the toolbox `handoff` skill,
  rewrite its state instead of appending, and re-check it against the current
  Git and Herdr state before acting, because a stale handoff reads as current truth. Do not create `.handoff/` or files
  per topic. Historical probes and old code are not authority.
- When deterministic or owner-operated evidence changes a fact, update the
  matching architecture or contract document, the implementation, the lint
  rule, the relevant tests, and `HANDOFF.md` if it carries that work, in the
  same completed change. Replace disproved guidance and record an unresolved
  fact, marked unverified, in `HANDOFF.md`; do not rely on chat memory.
- Classify every reproduced discovery before continuing dependent work: current
  behavior replaces the matching fact in the architecture, contract, or README
  text, an open uncertainty enters `HANDOFF.md`, and a
  corrected or rejected path moves to the dated `docs/testing/live-evidence.md`
  history. Do not leave a reproduced observation only in chat, a terminal
  transcript, or a code comment, and do not duplicate stale current truth in
  the chronological log.
- The CLI and the plugin carry independent versions. The CLI version lives in
  `core/src/version.ts` (`--version` and the help banner), `core/package.json`,
  the helper's `main.swift` (`sherpa-apple --version` and its help), both
  `Info.plist` files and `MARKETING_VERSION` in `apple/sherpa-app/Version.xcconfig`
  (`Sherpa.app`'s bundle version, which `sherpa-relay --version` prints);
  its tag is `v<version>`, which `scripts/package.sh --publish` requires along
  with the owner's Developer ID Application certificate in the keychain. The
  plugin version lives in both plugin manifests and `plugins/sherpa/CHANGELOG.md`
  and gets no tag. Bump it whenever `plugins/sherpa/` changes, because Claude
  Code compares only that version.
- Keep tools and dependencies on their latest stable release (owner decision,
  2026-11-22): Bun, the core's npm packages, the Swift toolchain of the
  installed Xcode, and the Claude Code and Codex that live evidence runs on.
  Pin exact versions, Bun in `devEngines.packageManager` of
  `core/package.json` and every npm package without a range, and move to a
  newer release in a change of its own, so that a regression traces to one
  upgrade. Bun ignores `devEngines`, so the gate and `scripts/package.sh`
  refuse a `bun` of another version and a compiled core that carries another
  runtime. The gate warns about each newer release it can see but never fails
  on one, because a release published elsewhere must not change a commit's
  result.
  Name in every live-evidence entry the versions it ran on.
- Sherpa supports macOS only, and the repository has no CI (owner decision,
  2026-11-20: Windows support and its hook job were removed). The gate is the
  macOS run of `bash scripts/check-all.sh`, in this order: the Bun version
  check against `core/package.json`, the Swift format check
  (`swift format lint --strict` with the root `.swift-format`), the four Swift
  packages' build and tests, the release builds of `sherpa-relay` and the
  app's test host, which must not read the test variables, the core's
  `vp check`, tests, build and CLI contract probes, the Developer ID signed
  `Sherpa.app` bundle, the plugin, manifest, and document checks, and the
  release smoke install. Before merging
  any pull request, run it after the last change, confirm the whole run exits 0,
  and write that result with the commit it ran on in the pull request body.
  Merge by hand only when that commit is the pull request's head; never use
  `gh pr merge --auto`, because no check guards the merge.
- When pull requests are stacked, retarget the upper one's base to `main`
  before merging the lower one with `--delete-branch`. GitHub closes a pull
  request whose base branch is deleted, and a closed pull request cannot change
  its base.
- Pair every reproduced defect with a deterministic regression or an explicit
  owner-operated live-evidence requirement. If the proof is still unavailable,
  keep that missing proof visible as incomplete work rather than calling the
  path complete.
