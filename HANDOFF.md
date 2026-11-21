# sherpa HANDOFF — 2026-11-21 23:30 KST

## 목표

Sherpa 를 SwiftUI 메뉴 막대 앱(`Sherpa.app`, 권한 주체)으로 내고, 에이전트에는 앱 안의 TS MCP 서버를
Swift 중계로 연다(소유자 결정 2026-11-21, `docs/adr/0010-menu-bar-app-and-mcp.md`). 공증 + Homebrew cask 로
배포한다. 지금 배포본은 CLI 0.8.5(Bun 코어 + `SherpaHelper.app`)다. 2단계는 이슈 묶음 #30, 3단계는 #31.

## 끝난 것 (커밋·태그·실측 근거)

- 앱 연결 계약 1판 `docs/contracts/app-connection-v1.md`(#26, PR #40·#41). 소유자 결정은 계약 §15.
- 코어 MCP 서버 `sherpa app serve`(#27, PR #44, `7590a49`): Mux 1, 도구 35개, 앱 창 확인, 결과 감싸개.
  유휴 footprint 21–24 MB, 8분 부하 26→31 MB(최대 49 MB).
- `Sherpa.app`·`sherpa-relay`(#28, PR #45, `2ba14b1`, 패키지 `apple/sherpa-app`): 소켓·양방향 서명 확인,
  코어를 멈춘 채 띄워 실행 중 코드를 확인한 뒤 재개(9–15 ms), 첫 실행 창, 권한 상태·요청. Developer ID
  번들에서 번들 중계로 initialize(2025-11-25)·tools/list 35개 성공.
- 리뷰로 고친 결함: 같은 JSON-RPC id 가 연결 종료 철회를 피하던 것(-32600, 계약 §10.1), 코어 서명 확인과
  실행 사이 바꿔치기, 세션마다 새던 연결·버퍼, 서술자 스키마 이름(PR #42), 릴리스 묶음 검사의 로캘 정렬(#38).
- 계약 정정: 1판은 같은 사용자를 믿는 범위로 둔다(ADR-0010 정정, 후속 #39).
- 낡은 `core/dist/sherpa` 가 번들에 들어가던 결함(PR #48): 번들 빌드가 코어의 Mux 1 인사와 버전을 확인한다.
  이 확인은 #49 에서 Xcode 프로젝트의 Embed Core 단계로 옮겼다(게이트 회귀).

## 진행 중

- #49 `Sherpa.app` 을 `apple/sherpa-app/Sherpa.xcodeproj` 로 빌드(브랜치 `build/xcode-app`, 병합 전).
  `build-app.sh` 는 지웠다. 아카이브 → Developer ID 내보내기, 세 실행 파일의 식별자·팀·runtime·타임스탬프,
  게이트의 Xcode Release·Debug 빌드와 낡은 코어 거부는 확인했다(live-evidence 2026-11-21 "Sherpa.app built by
  an Xcode project"). 미확인: 내보낸 앱을 띄워 번들 중계로 `initialize`(2025-11-25)·`tools/list` 35개.
- #29 통합 실기(소유자 손)는 #49 의 내보낸 앱으로 한다. 명령은 계약 §2 "번들 빌드"(`bun run build` 뒤
  `xcodebuild archive`·`-exportArchive`, 결과 `apple/sherpa-app/.build/export/Sherpa.app`, 미공증).

## 하지 말 것 (실패한 시도, 되돌린 것)

- 코어 테스트를 `vp test` 로 돌리지 않는다. Node 에서 돌아 `bun:sqlite` 를 못 읽는다. `bun run test` 를 쓴다.
- KakaoTalk plist 를 `plutil -convert json` 으로 읽지 않는다. data/date 값 때문에 실패한다.
- Reminders·Calendar 를 AppleScript 나 SQLite 로 읽지 않는다. EventKit `reminder.list` 가 1초 안에 끝난다.
- 전체 디스크 접근은 요청 API 가 없다. 권한 창을 기다리지 말고 설정 화면을 연다.
- macOS 27 의 메뉴 막대 상태 항목을 CGWindowList·접근성 트리·셸 `screencapture` 로 확인하려 하지 않는다.
  상태 항목은 `MenuBarAgent` 가 그리고, 이 Mac 의 셸에는 화면 녹화 권한이 없어 캡처가 검다.
- Automation 요청은 대상 앱이 떠 있지 않으면 `procNotFound` 로 권한 창이 뜨지 않는다. 앱은 대상을 활성화하지
  않고 띄운 뒤 묻는다.
- 릴리스 빌드에 시험용 변수 이름이 없는지 grep 으로만 보지 않는다. Swift 는 15바이트 이하 문자열을 코드에
  넣는다. 시험용 변수 이름은 16바이트 이상이다.
- zsh 에서 `log` 는 셸 내장 명령이다. 통합 로그는 `/usr/bin/log` 로 읽는다.
- 문서 검사는 저장소 루트를 인자로 받는다: `python3 scripts/checks/verify_docs.py .`.
- Xcode 증분 빌드로 번들 서명을 판정하지 않는다. 서명 설정만 바뀐 중계가 번들에 다시 복사되지 않았다. 게이트는
  derived data 를 지우고 빌드한다.
- Embed Core 단계에서 번들 안 코어를 직접 `codesign` 하지 않는다. 스크립트 샌드박스가 codesign 의 임시 파일을
  막아 "Write permissions error" 가 난다. `TEMP_DIR` 에서 서명하고 복사한다.

## 막힌 것 · 오너 결정 대기

- #29 소유자 실기: 메뉴 막대 아이콘이 보이는지(원인 미확인), Messages Automation 권한 창, 메뉴의 Quit,
  실제 코어로 띄운 맨 앞 확인 창(허용·거부·30초, 버튼 1초 막힘), Claude Code·Codex 설정으로 도구 호출,
  앱이 띄운 코어의 `osascript` 보내기 권한, 장시간 메모리. 계약 §16 의 미확인도 여기서 닫는다.
- 앱의 큰 프레임 버퍼가 할당기 캐시(`Malloc Large (empty)`)에 남아 footprint 가 는다(8 MB 세션 30개 128 MB,
  `MallocLargeCache=0` 이면 3 MB). #46.
- 같은 사용자의 프로세스가 중계로 읽기·만들기·고치기 도구를 부를 수 있다(추론). 중계를 띄운 프로그램 허용은 #39.
- 헬퍼 번들 제거와 CLI 의 앱 소켓 연결, 공증·cask·플러그인 MCP 등록은 3단계 #31.
- 정할 것: planner 핸들러의 `payload.schema` 확인(#43), 응답 null 키(#34), 웹 수집 소스 대상(#35, 소유자).
- 소유자 실기 확인 모음과 kakaocli 상류 이슈 여부는 #36.

## 다음 행동

1. #49: PR 을 열고 게이트 결과를 본문에 적어 병합한다. 내보낸 앱으로 번들 중계 `initialize`·`tools/list` 를
   확인한다.
2. #29 소유자 실기를 한 번에 받는다. 결과를 `live-evidence.md`, 계약 §16, ADR-0010 에 반영한다.
3. #46 할당기 캐시: 상한을 재고 `mmap` 버퍼나 번들 `LSEnvironment` 를 실측해 고친다.
4. #31 3단계: 공증·스테이플, Homebrew cask, formula 이전, 헬퍼 제거와 CLI 의 앱 소켓 연결, 플러그인 MCP 등록.
5. 정리 이슈: #32 plist 파서 중복, #33 문서 부채, #34·#43 계약 결정, #39 중계 실행자 허용.

## 저장소·세션 상태 (브랜치, 미커밋, 미푸시, pane)

- `main` 이 원격과 같다(이 파일을 담은 PR 병합 뒤). 원격은 `bunny-holes/sherpa`(공개), Formula 는
  `XIYO/homebrew-tap`. #49 작업은 워크트리 `.claude/worktrees/xcode-app`, 브랜치 `build/xcode-app` 이다.
- 2단계 Orca 워커 둘(core-mcp, app-relay)은 끝나 터미널을 닫았고 워크트리와 브랜치를 지웠다.
- 개발 실행: `cd core && bun run build`, `swift build --package-path apple/eventkit-service`, 앱 번들은
  `xcodebuild`(계약 §2 "번들 빌드").
