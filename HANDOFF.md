# sherpa HANDOFF — 2026-11-22 10:27 KST

## 목표

Sherpa 를 SwiftUI 메뉴 막대 앱(`Sherpa.app`, 권한 주체)으로 내고, 에이전트에는 앱 안의 TS MCP 서버를 Swift
중계로 연다(ADR-0010). MCP 는 2026-07-28 규격만 받는다(ADR-0011). 앱의 MCP 스위치는 기본 꺼짐이고, 연결 방법은
스위치 옆 "?" 에서 본다(#54). 플러그인은 MCP 서버를 등록한다(#55). 공증 + Homebrew cask 로 배포한다(#31).
지금 배포본은 CLI 0.8.5(Bun 코어 + `SherpaHelper.app`)와 플러그인 0.8.4 이고, `app serve`·`Sherpa.app` 은 아직
배포되지 않았다. 소유자 요청(2026-11-22): 앱을 열면 "AI 연결하기"(API 키로 앱 안 채팅, 여러 모델)와 "MCP
활성화"가 있게 한다. MCP 쪽은 끝났고 채팅은 결정 대기다.

## 끝난 것 (커밋·태그·실측 근거)

- 앱 연결 계약 1판(#26), 코어 MCP 서버(#27, PR #44), 앱·중계(#28, PR #45), 낡은 코어 거부(PR #48), Xcode
  빌드(#49, PR #50).
- #51 MCP 2026-07-28 전용(PR #53, main `8de36c6`): `legacy: "reject"`, 확인 기록의 `client` 를 요청 봉투에서
  읽기, ADR-0011. 실측(2026-11-22): Codex 0.171.0 은 기능 `mcp_2026_07_28` 과 서버 항목 env
  `CODEX_MCP_PROTOCOL_VERSION=2026-07-28` 이 있으면 2026-07-28 로 도구 호출 성공, 기본 설정은 -32022 로 거부.
  Claude Code 2.1.326 은 `server/discover`→`tools/call` 이 2026-07-28 로 성공(`claude -p`, haiku 1회).
- #54·#52 MCP 스위치와 연결 안내(PR #56, main `da3cf97`):
  - 꺼짐이면 중계가 머리말 `unavailable`·`mcp_disabled` 를 받아 75 로 끝나며 remedy 를 남긴다.
  - 끄면 열린 중계를 1초 안에 닫는다. MCP 가 꺼진 채 앱이 뜨면 상태 창이 저절로 열린다.
  - 본 창은 머리·MCP 줄·권한만 둔다. 켜져 있을 때만 "?"(HelpLink) 팝오버에 Claude Code·Codex 등록 명령과
    Copy 가 있다. 경로는 줄바꿈된다(#52).
  - 메인 세션이 내보낸 앱(`e0e2670`, `e6e7c44`, `f950486`)을 스크린샷과 탐침으로 확인했다. live-evidence 2026-11-22.
- #29 일부(2026-11-21): 중계로 부른 `reminder_delete` 확인 창이 계약대로 동작(0.29초 표시, 1초 무장, 거부·허용·
  30.01초 시간 초과).

## 진행 중

- PR #57(#55, 브랜치 `feat/plugin-mcp`, 워크트리 `.claude/worktrees/plugin-mcp`):
  - 플러그인 0.9.0 이 `plugins/sherpa/.mcp.json` 으로 `/Applications/Sherpa.app/Contents/MacOS/sherpa-relay` 를
    등록한다. Codex 항목에는 env 표지가 있다.
  - 스킬 4개를 MCP 도구로 옮기고, CLI 가드와 SessionStart 훅을 지웠다.
  - #56 뒤의 main 위로 rebase 하고 게이트를 다시 돌려야 한다. 배포 순서가 정해지기 전에는 병합하지 않는다(아래).

## 하지 말 것 (실패한 시도, 되돌린 것)

- 에이전트의 협상 규격을 손으로 보낸 `initialize` 로 재지 않는다. 클라이언트 로그나 중계 앞 tee 로 선 위를 본다.
  `codex app-server` 실행은 `~/.codex/logs_2.sqlite` 에 규격 줄을 남기지 않았다.
- 확인 기록의 클라이언트를 `getClientVersion()` 으로 읽지 않는다. 2026-07-28 에서 비어 있다.
- Claude Code 의 실패·고정 캐시를 실제 서버 이름 `sherpa` 로 시험하지 않는다. 플러그인 서버는 실패 뒤 15분
  건너뛴다. 다른 이름으로 잰다.
- plug-hole 의 sherpa 항목은 ref 고정이 없다. `plugins/sherpa/` 변경을 main 에 병합하면 다음 갱신 때 배포된다.
- Orca `get-app-state --window-id` 로 "?" 팝오버를 찍지 않는다(window_not_found). `list-windows` 의 틀로
  `screencapture -R x,y,w,h` 를 쓰고, 다른 앱 화면이 함께 찍히므로 본 뒤 지운다.
- macOS 27 메뉴 막대 상태 항목을 CGWindowList·접근성 트리로 확인하려 하지 않는다. `MenuBarAgent` 가 그린다.
  2026-11-22 에는 셸 `screencapture -R` 로 앱 창 화소가 찍혔다(상태 항목은 재지 않았다).
- 코어 테스트를 `vp test` 로 돌리지 않는다. `bun run test` 와 `bun run test:stdio`(`bun run build` 뒤)를 쓴다.
- KakaoTalk plist 를 `plutil -convert json` 으로, Reminders·Calendar 를 AppleScript·SQLite 로 읽지 않는다.
- 전체 디스크 접근은 요청 API 가 없다. 설정 화면을 연다. Automation 요청은 대상 앱을 띄운 뒤 묻는다.
- 릴리스 빌드의 시험용 변수 이름을 grep 으로만 보지 않는다(15바이트 이하 문자열은 코드에 들어간다).
- zsh 의 `log` 는 내장 명령이다. 통합 로그는 `/usr/bin/log` 로 읽는다.
- Xcode 증분 빌드로 서명을 판정하지 않는다. derived data 를 지우고 빌드한다. Embed Core 단계에서 번들 안 코어를
  직접 `codesign` 하지 않는다(`TEMP_DIR` 에서 서명하고 복사).

## 막힌 것 · 오너 결정 대기

- 플러그인 0.9.0 배포 순서. 0.9.0 은 `/Applications/Sherpa.app` 이 있어야 동작하는데 이 Mac 의
  `/Applications` 에는 앱이 없다. 제안은 main 빌드를 `/Applications` 에 설치한 뒤 #57 병합이고,
  대안은 plug-hole 항목을 지금 main 커밋에 고정해 두고 cask 때 푸는 것이다.
- "AI 연결하기"(앱 안 채팅) 기본값 제안, 소유자 답 대기(ADR-0012 로 쓸 것):
  - 코어 안 채팅 경계 + Vercel AI SDK v7. v1 제공자는 Anthropic, OpenAI, Google, OpenAI 호환.
  - ADR-0010 결정 2("Bun 은 소켓을 열지 않는다")를 고른 제공자로 나가는 HTTPS 만 허용하도록 고친다.
  - API 키는 데이터 보호 키체인에 둔다. 소유자가 App ID `dev.xiyo.sherpa` 의 Developer ID 프로비저닝 프로파일을 만든다.
  - 채팅도 같은 35개 도구를 쓰고, 삭제·보내기는 같은 앱 창 확인을 거친다.
- 미확인:
  - 사용자·플러그인 범위 Claude Code 가 MCP 꺼짐에서 실패한 뒤 `/mcp` Reconnect 로 붙는지.
  - 중계 69(앱 없음) 때의 옛 규격 고정.
  - 메뉴 막대 토글(Orca 가 상태 항목을 못 본다).
  - 복사한 등록 명령을 실제 설정에 넣은 결과(소유자 설정 변경).
- MCP 가 꺼져 있을 때 Codex 에는 "connection closed" 만 보이고 remedy 는 중계 stderr 에만 남는다. 중계가 첫
  요청에 remedy 를 담은 JSON-RPC 오류로 답하는 안은 정하지 않았다.
- 기존: #29 남은 실기(메뉴 막대 아이콘, Quit, 보내기 확인, Messages 권한 창, 장시간 메모리), 계약 §13.3 통합 시험이
  게이트에 없음, #46 할당기 캐시, #39 중계를 띄운 프로그램 허용, #43·#34·#35, #36.
- 저장소에 Swift 포매터·린터가 없다. swift-format 과 `.swift-format`, check-all 의 `swift format lint --strict` 를
  제안받았다.

## 다음 행동

1. #57 을 main 위로 rebase 하고 게이트를 다시 돌린다(작업자 세션 `plugin-mcp`).
2. 소유자가 배포 순서를 정하면 그대로 한 뒤 #57 을 병합한다. plug-hole 설명("Sherpa CLI로 …")을 MCP 기준으로
   고치고, 플러그인 갱신과 `codex features enable mcp_2026_07_28` 뒤 두 에이전트를 실제 설정으로 확인한다.
3. 채팅 결정을 받으면 ADR-0012 를 쓴다.
4. #29 남은 실기, #46, §13.3 통합 시험, swift-format 도입.
5. #31: 공증·스테이플, cask, formula 이전, 헬퍼 제거와 CLI 의 앱 소켓 연결. CLI 버전은 그 릴리스에서 올린다.

## 저장소·세션 상태 (브랜치, 미커밋, 미푸시, pane)

- 원격 `bunny-holes/sherpa`(공개), Formula `XIYO/homebrew-tap`, 마켓플레이스 `XIYO/plug-hole`(비공개, sherpa 항목은
  `git-subdir` `plugins/sherpa`, ref 없음).
- `main` 은 `da3cf97` 과 그 뒤 이 파일을 고친 문서 PR.
- 워크트리 `.claude/worktrees/plugin-mcp`(브랜치 `feat/plugin-mcp`, PR #57).
- 떠 있는 앱은 main 빌드 `apple/sherpa-app/.build/export/Sherpa.app`, MCP 꺼짐.
- 개발 실행: `cd core && bun run build`, 앱 번들은 `xcodebuild`(계약 §2 "번들 빌드").
