# sherpa HANDOFF — 2026-11-21 17:55 KST

## 목표

Sherpa 를 SwiftUI 메뉴 막대 앱(`Sherpa.app`, 권한 주체)으로 내고, 에이전트에는 앱 안의 TS MCP 서버를
Swift 중계로 연다(소유자 결정 2026-11-21, `docs/adr/0010-menu-bar-app-and-mcp.md`). 공증 + Homebrew cask 로
배포한다. 지금 배포본은 CLI 0.8.5(Bun 코어 + `SherpaHelper.app`)다. 2단계 작업은 GitHub 이슈 묶음 #30 이
추적한다: #26 계약 → #27 코어 MCP · #28 앱·중계(동시) → #29 통합. 3단계는 #31.

## 끝난 것 (커밋·태그·실측 근거)

- 1단계 시험 빌드 전부(버리는 코드): ADR-0010 실측 표, `docs/testing/live-evidence.md` 의 "Menu bar app and MCP
  spike", 기록 커밋 `228eee5`.
- 앱 연결 계약 1판 `docs/contracts/app-connection-v1.md`(#26): 번들 구성, 소켓, 양방향 서명 확인, 앱 머리말,
  중계 종료 코드, 앱·코어 다중화 프레임, 앱 작업 요청, 삭제·보내기 확인, MCP 도구 35개 규칙, 로그, 시험 층과
  시험 벡터. 소유자 결정(2026-11-21)은 계약 §15 에 있다: 삭제·보내기는 앱 창에서 30초 확인,
  `kakaotalk_checkpoint` 는 CLI 와 같은 `confirm` 인자, 팀 ID `FN2KZ2J47B` 커밋, 코어·CLI 는 한 실행 파일
  `sherpa-core`(`dev.xiyo.sherpa.core`), 2단계 동안 CLI 는 헬퍼 경로 유지, 같은 사용자를 믿는 범위로 둔다.
- ADR-0010 정정: "권한 공유 구멍이 닫힌다" 는 맞지 않다. 서명 확인은 중계를 띄운 쪽을 가리지 않아 구멍은
  좁아질 뿐이다(추론, 재현 안 함). 후속은 #39.
- 릴리스 묶음 검사가 `en_US.UTF-8` 셸에서 `unexpected_archive_contents` 로 실패하던 결함을 고쳤다(#37, PR #38,
  `db4f392`). 회귀는 `check-release.sh` 가 패키징을 `LC_ALL=en_US.UTF-8` 로 돌리는 것이다.
- 0.8.5(태그 `v0.8.5`) 가 지금 배포본이다. 공증 자격 증명은 로그인 키체인의 `notarytool` 프로필
  `sherpa-notary` 다(`xcrun notarytool history --keychain-profile sherpa-notary` 로 확인).

## 진행 중

- #26 계약 PR(브랜치 `docs/app-connection-contract`): 마지막 커밋에서 게이트를 돌리고 병합한다.
- 병합 뒤 #27(코어 MCP 서버, `core/`)과 #28(`Sherpa.app`·`sherpa-relay`, `apple/`)을 Orca 워커(Claude)
  둘로 동시에 시작한다. 각자 새 워크트리와 브랜치를 쓰고, 파일 소유는 `core/` 와 `apple/` 로 겹치지 않는다.
  두 워커는 계약만 보고 상대 쪽 없이 자기 쪽을 시험한다.

## 하지 말 것 (실패한 시도, 되돌린 것)

- 코어 테스트를 `vp test` 로 돌리지 않는다. Node 에서 돌아 `bun:sqlite` 를 못 읽는다. `bun run test` 를 쓴다.
- KakaoTalk plist 를 `plutil -convert json` 으로 읽지 않는다. data/date 값 때문에 실패한다.
- Reminders·Calendar 를 AppleScript 나 SQLite 로 읽지 않는다. EventKit `reminder.list` 가 1초 안에 끝난다.
- 전체 디스크 접근은 요청 API 가 없다. 권한 창을 기다리지 말고 설정 화면
  (`x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles`)을 연다.
- macOS 27 의 메뉴 막대 상태 항목 위치를 CGWindowList 나 접근성 트리로 읽으려 하지 않는다. 상태 항목은
  `MenuBarAgent` 가 화면 너비 창 하나로 그리고, 앱 프로세스에는 메뉴 막대가 하나뿐이다(2026-11-21 이 Mac).
- zsh 에서 `log` 는 셸 내장 명령이다. 통합 로그는 `/usr/bin/log` 로 읽는다.
- 한 파일짜리 SwiftUI `@main` 은 `swiftc -parse-as-library` 가 필요하다. 여러 파일이면 최상위 코드는
  `main.swift` 에만 둔다.
- 문서 검사는 저장소 루트를 인자로 받는다: `python3 scripts/checks/verify_docs.py .`.

## 막힌 것 · 오너 결정 대기

- 미리보기 앱에서 메뉴 막대 아이콘이 보이지 않은 원인은 미확인이다(노치 뒤로 밀림 또는 시스템 설정의 메뉴
  막대 허용 꺼짐). #28 이 원인을 정하고 첫 실행에 창을 띄울지 정한다. 소유자 확인이 필요하다.
- 계약 §16 의 미확인 항목(중계가 앱 띄우기, 로그인 항목, 2026-07-28 규격, 두 에이전트의 elicitation,
  코어 `osascript` 의 Apple Events 판정, 89 MB 코어의 정적 서명 확인 시간 등)은 #27·#28·#29 실측으로 닫는다.
- 지금 배포본 헬퍼는 권한 책임을 놓고 다시 떠서 같은 사용자의 다른 프로세스가 `dev.xiyo.sherpa` 권한을 쓸 수
  있다(추론, 재현 안 함). 헬퍼 제거는 3단계 #31, 중계를 띄운 프로그램의 허용은 #39.
- 웹 수집 소스의 대상은 소유자가 정한다(#35).
- 소유자 실기 확인과 kakaocli 상류 이슈 등록(외부 게시) 여부는 #36 에 모았다.
- 미확인: Swift 헬퍼 응답은 null 인 키를 빼고 ObjC 셈은 `null` 로 쓴다. 계약으로 정할 일이다(#34).

## 다음 행동

1. #26 PR 의 마지막 커밋에서 `bash scripts/check-all.sh` exit 0 을 확인하고, PR 본문에 적고 병합한다.
2. #27·#28 Orca 워커를 시작하고, 보고가 오면 검토해 각 PR 의 게이트와 병합을 확인한다.
3. #29 통합 실기 검증(Claude Code·Codex 가 서명 빌드 중계로 도구 호출, 권한 판정, 장시간 메모리).
4. #31 3단계: 공증·스테이플을 `scripts/package.sh` 에, Homebrew cask, formula 이전, 헬퍼 제거와 CLI 의 앱 소켓
   연결, 플러그인 MCP 등록과 스킬 축소, 설치본 실기 검증.
5. 정리 이슈: #32 plist 파서 중복, #33 문서 부채, #34 null 키 계약.

## 저장소·세션 상태 (브랜치, 미커밋, 미푸시, pane)

- `main` 은 `db4f392`(PR #38 병합)다. 원격은 `bunny-holes/sherpa`(공개, `XIYO/sherpa` 가 리다이렉트),
  Formula 는 `XIYO/homebrew-tap`. 로컬 브랜치는 `main` 과 `docs/app-connection-contract` 뿐이다.
- 1단계 시험 프로세스(`SherpaPreview`, `SherpaSpike host`)는 껐다. 시험 빌드 소스는 이전 세션의 임시 폴더에만
  있고 저장소에는 없다. 필요한 사실은 계약과 ADR-0010 에 옮겼다.
- `target/dist` 에는 0.8.5 산출물만 남겼다. 옛 판 묶음은 GitHub 릴리스에 있다.
- 개발 실행: `cd core && bun run build`, `swift build --package-path apple/eventkit-service`, 그리고
  `SHERPA_APPLE_BIN=apple/eventkit-service/.build/debug/sherpa-apple core/dist/sherpa …`.
