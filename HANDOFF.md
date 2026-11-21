# sherpa HANDOFF — 2026-11-22 04:03 KST

## 목표

Sherpa 를 SwiftUI 메뉴 막대 앱(`Sherpa.app`, 권한 주체)으로 내고, 에이전트에는 앱 안의 TS MCP 서버를
Swift 중계로 연다(ADR-0010). MCP 는 2026-07-28 규격만 받는다(소유자 결정 2026-11-22, ADR-0011, #51).
공증 + Homebrew cask 로 배포한다. 지금 배포본은 CLI 0.8.5(Bun 코어 + `SherpaHelper.app`)이고, `app serve`·
`Sherpa.app` 은 `v0.8.5` 태그 뒤에 들어와 아직 배포되지 않았다. 2단계 이슈 묶음은 #30, 3단계는 #31.

## 끝난 것 (커밋·태그·실측 근거)

- 앱 연결 계약 1판 `docs/contracts/app-connection-v1.md`(#26). 소유자 결정은 계약 §15.
- 코어 MCP 서버 `sherpa app serve`(#27, PR #44), `Sherpa.app`·`sherpa-relay`(#28, PR #45), 낡은 코어 거부
  (PR #48), Xcode 프로젝트 빌드(#49, PR #50, main `d2f9ad9`).
- #29 통합 실기 일부(2026-11-21, 내보낸 앱 0.8.5, main `d2f9ad9`): 중계로 부른 `reminder_delete` 의 확인 창이
  0.29초 안에 떴고 1초 무장, 거부·허용·30.01초 시간 초과가 계약대로였다. 권한 표시 Allowed. live-evidence
  2026-11-21 "Delete confirmation through the exported app's relay".
- Codex 0.171.0 실측(2026-11-22): 기능 `mcp_2026_07_28` 과 서버 항목 env `CODEX_MCP_PROTOCOL_VERSION=2026-07-28` 을
  켜면 `server/discover`·봉투로 2026-07-28, 끄면 `initialize`(2025-06-18). live-evidence 2026-11-22.
- #51 실기(2026-11-22, 브랜치 `233ee48` 로 내보낸 앱, 공증 전): 기능과 env 를 켠 Codex 는 2026-07-28 로 도구 35개와
  읽기 호출 성공. 기본 설정 Codex 는 `initialize` 하나만 보내 -32022 를 받고 다시 묻지 않으며, 서버 `failed`, 도구
  호출 -32603. Claude Code 2.1.326 은 `server/discover`·`tools/list` 로 2026-07-28 연결(`hasTools` true).
  live-evidence 2026-11-22 "The exported app with the 2026-07-28-only core".
- #51 구현(브랜치 `feat/mcp-2026-07-28`, PR #53): `serveStdio` 의 `legacy: "reject"`, 확인 기록의
  `client` 를 요청 봉투 `io.modelcontextprotocol/clientInfo` 에서 읽기, -32022 응답의 warn 로그, 단위·stdio 회귀
  시험, ADR-0011, ADR-0010·계약 §1·§2·§5·§7·§9·§10·§12–§16·아키텍처·live-evidence 정정. 상태 창 경로 잘림 결함은 #52.

## 진행 중

- PR #53(#51) 병합 대기. 게이트 결과와 그 커밋은 PR 본문에 있다. head 가 바뀌면 다시 돌려 고친다(AGENTS.md).
- 남은 실기(소유자·메인 세션): 내보낸 앱 경로로 Claude Code 가 도구를 부르는지. 모델 호출이 필요해 2026-11-22 에는
  연결과 `tools/list` 까지만 쟀다. 결과는 live-evidence, 계약 §16, ADR-0011.

## 하지 말 것 (실패한 시도, 되돌린 것)

- 에이전트의 협상 규격을 손으로 보낸 `initialize` 로 재지 않는다. 그렇게 잰 "2025-11-25 협상" 이 틀렸다. 클라이언트
  로그나 중계 앞 tee 로 선 위를 본다.
- 확인 기록의 클라이언트를 `server.server.getClientVersion()` 으로 읽지 않는다. 2026-07-28 연결에서 비어 있다.
  핸들러의 `ctx.mcpReq.envelope` 를 쓴다(SDK 2.4.0 d.ts 의 `RequestMetaEnvelope` 는 `{}` 로 나와 키는 zod 로 읽는다).
- 코어 테스트를 `vp test` 로 돌리지 않는다. Node 에서 돌아 `bun:sqlite` 를 못 읽는다. `bun run test` 와
  `bun run test:stdio`(`bun run build` 뒤)를 쓴다.
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
- Xcode 증분 빌드로 번들 서명을 판정하지 않는다. 게이트는 derived data 를 지우고 빌드한다.
- Embed Core 단계에서 번들 안 코어를 직접 `codesign` 하지 않는다. 스크립트 샌드박스가 막는다. `TEMP_DIR` 에서
  서명하고 복사한다.

## 막힌 것 · 오너 결정 대기

- #29 남은 소유자 실기: 메뉴 막대 아이콘이 보이는지(원인 미확인), 메뉴의 Quit, 보내기 확인, Messages Automation
  권한 창, 앱이 띄운 코어의 `osascript` 보내기 권한, 장시간 메모리. 계약 §16 의 미확인도 여기서 닫는다.
- Claude Code 가 기능 플래그나 7일 생략(`MCP_PROTOCOL_NEGOTIATION` 미설정, 서버가 물음에 끝났을 때)으로
  2025-11-25 `initialize` 로 붙으면 거부된다(ADR-0011 위험, 재현 안 함). 처방은 `MCP_PROTOCOL_NEGOTIATION=auto`.
- 계약 §13.3 통합 시험(DEBUG 앱 + 빌드한 코어 + 중계)이 게이트에 없다. 앱의 프로세스 시험은 가짜 코어만 띄운다
  (2026-11-22 확인).
- 앱의 큰 프레임 버퍼가 할당기 캐시에 남아 footprint 가 는다. #46.
- 같은 사용자의 프로세스가 중계로 읽기·만들기·고치기 도구를 부를 수 있다(추론). 중계를 띄운 프로그램 허용은 #39.
- 정할 것: planner 핸들러의 `payload.schema` 확인(#43), 응답 null 키(#34), 웹 수집 소스 대상(#35, 소유자).
- 소유자 실기 확인 모음과 kakaocli 상류 이슈 여부는 #36.

## 다음 행동

1. PR #53 을 병합한다(head 의 게이트 결과 확인 뒤). 이어서 내보낸 앱으로 Claude Code 의 도구 호출을 잰다.
2. 플러그인 MCP 등록(다음 PR, #31 일부): Codex 항목에 `env = { CODEX_MCP_PROTOCOL_VERSION = "2026-07-28" }` 와 기능
   안내를 넣는다. `plugins/sherpa/` 를 바꾸면 플러그인 버전을 올린다.
3. #52 상태 창 중계 경로 잘림을 고치고 실기로 확인한다.
4. #29 남은 실기, #46 할당기 캐시, §13.3 통합 시험을 게이트에 더한다.
5. #31 3단계: 공증·스테이플, Homebrew cask, formula 이전, 헬퍼 제거와 CLI 의 앱 소켓 연결. CLI 버전은 그 릴리스에서
   올린다(`v0.8.5` 뒤 `app serve` 변경은 모두 미배포).

## 저장소·세션 상태 (브랜치, 미커밋, 미푸시, pane)

- 원격은 `bunny-holes/sherpa`(공개), Formula 는 `XIYO/homebrew-tap`. `main` 은 `d2f9ad9`.
- 워크트리 `.claude/worktrees/mcp-modern` 에 브랜치 `feat/mcp-2026-07-28`(#51, PR #53). 병합 뒤 워크트리와 브랜치를
  지운다.
- 개발 실행: `cd core && bun run build`, `swift build --package-path apple/eventkit-service`, 앱 번들은
  `xcodebuild`(계약 §2 "번들 빌드").
