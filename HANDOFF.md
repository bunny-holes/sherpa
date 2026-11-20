# sherpa HANDOFF — 2026-11-20 15:30 KST

## 목표

Bun + TypeScript 코어(`core/`) + Swift Apple 헬퍼(`sherpa-apple`)로 바꾼 0.8.0 은 배포됐다. 남은
소유자 조작 실측과 결함·문서 부채를 닫는다. 근거와 결정은 `docs/adr/0008-bun-typescript-core.md`.

## 끝난 것 (커밋·태그·실측 근거)

- 0.8.0 머지(PR bunny-holes/sherpa#10, 머지 커밋 `6e1b035`): 코어(cli·journal·process·mail·imessage·
  kakaotalk·apple 프록시), Swift 를 `sherpa-apple` 로 축소, `reminder.list` 선택 키 버그 수정과 회귀 테스트,
  문서 명령 검사 `scripts/checks/verify_doc_commands.py`, 스킬·README·아키텍처·배포 스크립트, 플러그인 0.8.0.
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

## 다음 행동

1. `*.authorization.request` 가 권한이 그대로 `not_determined` 여도 `succeeded`·증거 `matched` 로 답한다
   (`EventKitWorker.swift` 의 두 authorization request 분기, 2026-11-20 재현). 상태가 바뀌지 않았으면 이름 있는
   실패로 답하게 하고 결정적 시험을 세운다. 미수정.
2. 다음 판(0.8.3 이상)으로 `brew upgrade` 한 뒤 Calendar·Reminders 가 권한 창 없이 `full_access` 인지
   확인한다. 0.8.2 설치본은 두 권한 모두 받았다. 판을 넘는 실측은 아직 없다(ADR-0009).
3. 헬퍼의 8 MiB 응답 문제: `apple/eventkit-service/Sources/SherpaNative/main.swift` 의 `plannerRequest` 가
   변경을 기록한 뒤 `encoded(maximumBytes: 8 MiB)` 로 인코딩해, 넘으면 `failed` 로 보고된다(코드로 확인,
   재현 안 함). 초과 응답 시험을 먼저 세운다.
4. plist 파서 중복 정리: `core/src/imessage/bplist.ts` 와 `core/src/kakaotalk/plist.ts`.
5. 문서 부채: `docs/testing/verification-matrix.md` 를 Bun 코어 기준으로 재검토. `docs/` 21개 문서의 옛
   front matter 키(`id`·`title`·`status`·`owner`). `docs/contracts/worker-protocol.md:85` 가
   가리키는 없는 `protocols/worker-v2.schema.json`.
6. 웹 수집 소스(patchright 등)는 코어의 새 어댑터로 붙인다(소유자 방향, ADR-0008). 착수 전 대상 소스를 정한다.

## 저장소·세션 상태 (브랜치, 미커밋, 미푸시, pane)

- `main` 은 `6e1b035` 이후다. 원격은 `bunny-holes/sherpa`(`XIYO/sherpa` 가 같은 저장소로 리다이렉트), Formula 는
  `XIYO/homebrew-tap`.
- 개발 실행: `cd core && bun run build`, `swift build --package-path apple/eventkit-service`, 그리고
  `SHERPA_APPLE_BIN=apple/eventkit-service/.build/debug/sherpa-apple core/dist/sherpa …`.
