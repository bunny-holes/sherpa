# sherpa HANDOFF — 2026-11-22 11:40 KST

## 목표

Sherpa 를 SwiftUI 메뉴 막대 앱(`Sherpa.app`, 권한 주체)으로 내고, 에이전트에는 앱 안의 TS MCP 서버를 Swift
중계로 연다(ADR-0010). MCP 는 2026-07-28 규격만 받는다(ADR-0011). 앱의 MCP 스위치는 기본 꺼짐이고, 연결 방법은
스위치 옆 "?" 에서 본다(#54). 플러그인 0.9.0 은 MCP 서버를 등록하고 `plug-hole` 로 배포됐다(#55). 다음은 공증 +
Homebrew cask 배포(#31)와 앱 안 채팅 "AI 연결하기"의 구현이다(#59, 설계는 ADR-0012). CLI 배포본은 아직 0.8.5(Bun 코어 +
`SherpaHelper.app`)이고, `Sherpa.app` 은 공증 배포 전이라 이 저장소에서 빌드해 `/Applications` 에 둔다.

## 끝난 것 (커밋·태그·실측 근거)

- 앱 연결 계약 1판(#26), 코어 MCP 서버(#27, PR #44), 앱·중계(#28, PR #45), 낡은 코어 거부(PR #48), Xcode
  빌드(#49, PR #50).
- #51 MCP 2026-07-28 전용(PR #53): `legacy: "reject"`, 확인 기록의 `client` 를 요청 봉투에서 읽기, ADR-0011.
- #54·#52 MCP 스위치와 연결 안내(PR #56). 꺼짐이면 중계가 `unavailable`·`mcp_disabled` 로 75 를 내고, 끄면
  열린 중계를 닫는다. 켜져 있을 때만 "?" 팝오버에 등록 명령이 있다.
- #55 플러그인 0.9.0(PR #57, main `075aa28`). `.mcp.json` 이 `/Applications/Sherpa.app/Contents/MacOS/sherpa-relay`
  를 서버 `sherpa` 로 등록하고, 스킬은 MCP 도구를 쓴다. CLI 가드와 SessionStart 훅은 없다.
- 배포 실측(2026-11-22, live-evidence "Plugin 0.9.0 from `plug-hole`"):
  - main `b01470c` 빌드를 `/Applications/Sherpa.app` 에 설치했고, Calendar·Reminders 권한은 `full_access` 그대로다.
  - plug-hole sherpa 설명을 MCP 기준으로 고쳤다(bunny-holes/plug-hole PR #11, `f6583d5`).
  - Claude Code: `claude plugin install sherpa@plug-hole`(user)에서 `plugin:sherpa:sherpa` 가 2026-07-28 로
    이었고, haiku 로 도구를 한 번 불러 `succeeded` 를 받았다.
  - Codex: `codex features enable mcp_2026_07_28` 와 `codex plugin add sherpa@plug-hole` 뒤, `-c` 없이 35개
    도구로 이어 호출이 `succeeded` 였다.
- 배포 실측과 HANDOFF 를 실은 문서 PR #60(main `de49b16`). #55 닫힘.
- #59 앱 안 채팅 설계(PR #61, main `6f415ae`): ADR-0012 를 더했고, ADR-0010 결정 2 정정 메모와 아키텍처 문단을 달았다.
  - 채팅 루프는 코어 안 `core/src/chat/` 에서 돈다. 채팅 하나에 Mux 채널 하나를 쓰고, mux 는 2 로 올린다.
  - 도구는 레지스트리의 `handle` 을 직접 부른다. `@ai-sdk/mcp` 자기 루프와 AI SDK `toolApproval` 은 쓰지 않는다.
  - 나가는 연결은 지킨 `fetch` 하나다(https, 같은 출처, `redirect: "error"`).
  - 키는 앱만 data protection keychain 에 두고, 차례마다 `turn` 메시지에 실어 코어로 넘긴다.
  - 구현 전이라 지금의 코어는 네트워크를 열지 않는다(코드 검색으로 확인).
- #29 일부(2026-11-21): 중계로 부른 `reminder_delete` 확인 창이 계약대로 동작했다.

## 진행 중

- 없음. 앱 안 채팅 구현은 아래 소유자 결정 뒤 ADR-0012 "구현 단계" 1~6 을 이슈로 나눠 시작한다.

## 하지 말 것 (실패한 시도, 되돌린 것)

- 에이전트의 협상 규격을 손으로 보낸 `initialize` 로 재지 않는다. 클라이언트 로그나 중계 앞 tee 로 선 위를 본다.
- 확인 기록의 클라이언트를 `getClientVersion()` 으로 읽지 않는다. 2026-07-28 에서 비어 있다.
- Claude Code 의 실패·고정 캐시를 실제 서버 이름 `sherpa` 로 시험하지 않는다. 플러그인 서버는 실패 뒤 15분
  건너뛴다. 다른 이름으로 잰다.
- plug-hole 의 sherpa 항목은 ref 고정이 없다. `plugins/sherpa/` 변경을 main 에 병합하면 다음 갱신 때 배포된다.
- 작업자가 게이트나 커밋을 끝냈는지 보지 않고 그 워크트리를 지우지 않는다. #56 때 push 전 커밋이 사라질 뻔했다.
- plug-hole 게이트를 이 Mac 의 기본 Bun(1.4.4)으로 돌리지 않는다. 고정 판은 1.4.2 이다. 1.4.4 로 올리면 줄
  커버리지가 94.55% 로 떨어진다(bunny-holes/plug-hole#12). 1.4.2 바이너리를 임시 폴더에 받아 PATH 앞에 둔다.
- Orca `get-app-state --window-id` 로 "?" 팝오버를 찍지 않는다(window_not_found). `list-windows` 의 틀로
  `screencapture -R x,y,w,h` 를 쓰고, 다른 앱 화면이 함께 찍히므로 본 뒤 지운다.
- macOS 27 메뉴 막대 상태 항목을 CGWindowList·접근성 트리로 확인하려 하지 않는다. `MenuBarAgent` 가 그린다.
- 코어 테스트를 `vp test` 로 돌리지 않는다. `bun run test` 와 `bun run test:stdio`(`bun run build` 뒤)를 쓴다.
- KakaoTalk plist 를 `plutil -convert json` 으로, Reminders·Calendar 를 AppleScript·SQLite 로 읽지 않는다.
- 전체 디스크 접근은 요청 API 가 없다. 설정 화면을 연다. Automation 요청은 대상 앱을 띄운 뒤 묻는다.
- zsh 의 `log` 는 내장 명령이다. 통합 로그는 `/usr/bin/log` 로 읽는다.
- Xcode 증분 빌드로 서명을 판정하지 않는다. derived data 를 지우고 빌드한다. Embed Core 단계에서 번들 안 코어를
  직접 `codesign` 하지 않는다(`TEMP_DIR` 에서 서명하고 복사).

## 막힌 것 · 오너 결정 대기

- 앱 안 채팅(ADR-0012) 소유자 결정 대기:
  - OpenAI 호환 제공자에 로컬 서버(`http://localhost` 등)를 허용할지. 권고는 허용하지 않고 https 만 받는 것이다.
  - 대화 기록을 디스크에 저장할지. 권고는 저장하지 않는 것이다.
  - 답을 받으면 ADR-0012 "남은 결정" 에 정정으로 단다.
- 소유자 할 일: Apple Developer 에서 명시 App ID `dev.xiyo.sherpa` 를 등록하고 Developer ID provisioning profile 을
  만든다. ADR-0012 구현 단계 3(앱 키 저장소)이 이것을 기다린다.
- ADR-0012 "아직 확인 전":
  - Google Interactions 경로, Anthropic `anthropic-version: 2026-10-21` 수락.
  - 프로필 없을 때 -34018, 코어·중계가 앱의 키체인 항목을 못 읽는지.
  - hardened runtime·Bun 1.4.5 의 크기와 RSS, 도구 정의 토큰 수, 프록시와 사설 루트 인증서.
  - 프로필을 넣은 빌드의 공증과 권한 이어짐, 채팅 입력 중 확인 창의 키 입력.
  - 구현 단계와 유료 실기에서 닫는다.
- 미확인:
  - 사용자·플러그인 범위 Claude Code 가 MCP 꺼짐에서 실패한 뒤 옛 규격 고정이 남는지, `/mcp` Reconnect 로 붙는지.
  - 중계 69(앱 없음) 때의 옛 규격 고정.
  - 메뉴 막대 토글(Orca 가 상태 항목을 못 본다).
- MCP 가 꺼져 있을 때 Codex 에는 "connection closed" 만 보이고 remedy 는 중계 stderr 에만 남는다. 중계가 첫
  요청에 remedy 를 담은 JSON-RPC 오류로 답하는 안은 정하지 않았다.
- 기존: #29 남은 실기(메뉴 막대 아이콘, Quit, 보내기 확인, Messages 권한 창, 장시간 메모리), 계약 §13.3 통합 시험이
  게이트에 없음, #46 할당기 캐시, #39 중계를 띄운 프로그램 허용, #43·#34·#35, #36.
- 저장소에 Swift 포매터·린터가 없다. swift-format 과 `.swift-format`, check-all 의 `swift format lint --strict` 를
  제안받았다.

## 다음 행동

1. 소유자에게 ADR-0012 의 두 결정과 App ID 프로필을 받는다. 결정은 ADR-0012 정정으로 싣는다.
2. ADR-0012 "구현 단계" 1~6 을 이슈로 나눈다. 순서는 계약 다음 판 → 코어 나가는 길 경계와 정적 검사 → 앱 키
   저장소(프로필 필요) → 코어 채팅 → 앱 화면 → 통합 실기다.
3. #29 남은 실기, #46, §13.3 통합 시험, swift-format 도입.
4. #31: 공증·스테이플, cask, formula 이전, 헬퍼 제거와 CLI 의 앱 소켓 연결. CLI 버전은 그 릴리스에서 올린다.

## 저장소·세션 상태 (브랜치, 미커밋, 미푸시, pane)

- 원격 `bunny-holes/sherpa`(공개), Formula `XIYO/homebrew-tap`, 마켓플레이스 `XIYO/plug-hole`(원격 `bunny-holes/plug-hole`, 비공개,
  sherpa 항목은 `git-subdir` `plugins/sherpa`, ref 없음).
- `main` 은 `6f415ae`(#61 병합)와 그 뒤 이 파일을 고친 문서 PR.
- 작업자 워크트리는 없다.
- 떠 있는 앱은 `/Applications/Sherpa.app`(main `b01470c` 빌드, Developer ID, 공증 전), MCP 켜짐.
- 이 Mac 의 Claude Code·Codex 프로필에는 `sherpa@plug-hole` 0.9.0 이 깔려 있고, Codex 는 기능 `mcp_2026_07_28` 이 켜져 있다.
- 개발 실행: `cd core && bun run build`, 앱 번들은 `xcodebuild`(계약 §2 "번들 빌드").
