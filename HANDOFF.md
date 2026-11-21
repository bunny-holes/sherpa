# sherpa HANDOFF — 2026-11-21 09:45 KST

## 목표

Bun + TypeScript 코어(`core/`) + Swift Apple 헬퍼(`sherpa-apple`)로 바꾼 0.8.0 은 배포됐다. 남은
소유자 조작 실측과 결함·문서 부채를 닫는다. 근거와 결정은 `docs/adr/0008-bun-typescript-core.md`.

## 끝난 것 (커밋·태그·실측 근거)

- 0.8.0 머지(PR bunny-holes/sherpa#10, 머지 커밋 `6e1b035`): 코어(cli·journal·process·mail·imessage·
  kakaotalk·apple 프록시), Swift 를 `sherpa-apple` 로 축소, `reminder.list` 선택 키 버그 수정과 회귀 테스트,
  문서 명령 검사 `scripts/checks/verify_doc_commands.py`, 스킬·README·아키텍처·배포 스크립트, 플러그인 0.8.0.
- 0.8.5 배포(PR bunny-holes/sherpa#21, 태그 `v0.8.5`, tap `078ef8a`): `SHERPA_APPLE_RESPONSE_LIMIT_BYTES` 로
  초과 응답 경로를 명령으로 시험한다. 게이트는 읽기 초과, `scripts/live/oversized-response.py` 는 적용된
  변경을 본다. 설치본 0.8.5 실기 통과, 0.8.4 → 0.8.5 업그레이드에서 권한이 이어졌다.
- 0.8.4 배포(PR bunny-holes/sherpa#19, 태그 `v0.8.4`, tap `28f7da6`): 변경 적용 뒤 응답이 한도를 넘으면
  결과만 빼고 `partial`/`uncertain` + `protocol.result_too_large` 로 보고한다(planner·Mail·ReminderKit).
  0.8.3 → 0.8.4 업그레이드에서 권한이 이어졌다.
- 0.8.3 배포(PR bunny-holes/sherpa#17, 태그 `v0.8.3`, tap `e2aba79`): 권한 창이 안 뜬 권한 요청을
  `eventkit.authorization_prompt_unavailable` 로 답한다. 0.8.2 → 0.8.3 업그레이드에서 권한이 창 없이 이어졌다.
- 0.8.2 배포(PR bunny-holes/sherpa#15, 태그 `v0.8.2`, tap `47b68ca`): 헬퍼를 Developer ID 로 서명한
  `libexec/SherpaHelper.app` 번들로 낸다(ADR-0009). 설치본 Calendar·Reminders `full_access`, 검증 묶음 `verified`.
- 0.8.1 배포(PR bunny-holes/sherpa#13, 태그 `v0.8.1`, tap `e9a968c`): 헬퍼가 권한 책임을 놓고 다시 떠
  `dev.xiyo.sherpa` 로 권한을 받는다. 이 Mac 의 설치본이 Calendar·Reminders `full_access`, 일회용 검증 묶음 `verified`.
- 릴리스: 태그 `v0.8.0`, `XIYO/sherpa` 릴리스 자산 업로드·되읽기 확인, `XIYO/homebrew-tap` Formula `d055c43`.
  이 Mac 의 `brew upgrade`·`brew test` 통과. 플러그인은 plug-hole 이 기본 브랜치를 따라가므로 머지로 배포됐다.
- 실측(2026-11-20, 이 Mac): `docs/testing/live-evidence.md` 의 같은 날짜 항목. Mail 커서 28페이지 27,964건
  중복 0, Reminders 663건 0.67초, KakaoTalk setup 2.7초 복구·kakaocli 와 결과 동일, iMessage 가 imsg 0.21.1 과
  모든 필드 일치.
- kakaocli 자동 탐지 결함 보고서: 세션 공유 노트 폴더의 `kakaocli-user-id-detection-defect.md`(저장소 밖).

## 진행 중

- 없음. 커밋·PR·릴리스 상태는 아래 "저장소·세션 상태" 를 Git 으로 다시 확인한다.

## 하지 말 것 (실패한 시도, 되돌린 것)

- 코어 테스트를 `vp test` 로 돌리지 않는다. Node 에서 돌아 `bun:sqlite` 를 못 읽는다. `bun run test`
  (`bun --bun vitest run`) 를 쓴다.
- KakaoTalk plist 를 `plutil -convert json` 으로 읽지 않는다. data/date 값 때문에 실패한다.
- Reminders·Calendar 를 AppleScript 나 SQLite 로 읽지 않는다. EventKit `reminder.list` 가 1초 안에 끝난다.

## 막힌 것 · 오너 결정 대기

- kakaocli 상류 이슈 등록(외부 게시)은 소유자 확인이 필요하다.
- 실기 소유자 조작: Mail 한 통 실제 보내기와 Automation 권한 프롬프트 확인(iMessage 보내기는 2026-11-20 확인),
  KakaoTalk 로컬 체크포인트 커밋,
  로그인된 Claude Code·Codex 세션에서 스킬 호출,
  `SR-CX-013` 재검증, Discord 이모지·스티커 명령. 관측하면 `live-evidence.md` 에 날짜로 적고 여기서 지운다.
- 미확인: Swift 헬퍼 응답은 null 인 키(`result`·`error`)를 빼고, ObjC 셈(Mail·ReminderKit)은 `null` 로
  쓴다(2026-11-21 재현). `worker-protocol.md` 의 "exact-key" 가 응답에도 걸리는지 계약이 정하지 않았다.
  코어는 응답을 그대로 넘기므로 지금 깨지는 호출자는 확인되지 않았다.

## 다음 행동

1. plist 파서 중복 정리: `core/src/imessage/bplist.ts` 와 `core/src/kakaotalk/plist.ts`.
2. 문서 부채: `docs/testing/verification-matrix.md` 를 Bun 코어 기준으로 재검토. `docs/` 21개 문서의 옛
   front matter 키(`id`·`title`·`status`·`owner`). `docs/contracts/worker-protocol.md:98` 가
   가리키는 없는 `protocols/worker-v2.schema.json`.
3. 웹 수집 소스(patchright 등)는 코어의 새 어댑터로 붙인다(소유자 방향, ADR-0008). 착수 전 대상 소스를 정한다.

## 저장소·세션 상태 (브랜치, 미커밋, 미푸시, pane)

- `main` 은 `7ac2c11`(0.8.5) 이후다. 원격은 `bunny-holes/sherpa`(`XIYO/sherpa` 가 같은 저장소로 리다이렉트), Formula 는
  `XIYO/homebrew-tap`.
- 개발 실행: `cd core && bun run build`, `swift build --package-path apple/eventkit-service`, 그리고
  `SHERPA_APPLE_BIN=apple/eventkit-service/.build/debug/sherpa-apple core/dist/sherpa …`.
