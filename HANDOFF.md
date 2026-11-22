# sherpa HANDOFF — 2026-11-22 21:12 KST

## 목표

Sherpa 를 SwiftUI 메뉴 막대 앱(`Sherpa.app`, 권한 주체)으로 내고, 에이전트에는 앱 안의 TS MCP 서버를 Swift
중계로 연다(ADR-0010). MCP 는 2026-07-28 규격만 받는다(ADR-0011). 앱 첫 화면은 두 타일이다. "AI 연결하기" 는 앱 안
채팅이고(ADR-0012), "MCP 활성화하기" 는 스위치이며 연결 방법은 "?" 뒤에 둔다. 지금은 ADR-0012 구현 단계 4(#66, 코어
채팅 경계)를 하고 있다. 그 뒤로 단계 3·5·6(#65·#67·#68)과 공증·Homebrew cask 배포(#31)가 남았다. CLI 배포본은
0.8.6 이다. `Sherpa.app` 은 공증 전이라 이 저장소에서 빌드해 `/Applications` 에 둔다.

## 끝난 것 (커밋·태그·실측 근거)

- 바탕: 앱 연결 계약(#26)부터 Xcode 빌드(#49)까지 PR #44·#45·#48·#50. MCP 2026-07-28 전용(#51, PR #53). MCP 스위치와
  "?" 안내(#54·#52, PR #56). 플러그인 0.9.0 배포와 실측(#55, PR #57·#60). ADR-0012 설계(#59, PR #61).
- 2026-11-22 병합. 모두 PR head 에서 `bash scripts/check-all.sh` exit 0 을 확인하고 손으로 병합했다.
  - #73 swift-format(서식 커밋 `e3ed524` 는 `.git-blame-ignore-revs`), #75 Claude Code 2.1.326 실측과 플러그인 0.9.1,
    #77 Bun 고정(`devEngines`, `scripts/lib/bun-pin.sh`, 새 판은 경고만), #80 저장소 이전 뒤의 옛 주소(#79 닫힘),
    #82 잠금 flake(#78 닫힘, 결정적 회귀 시험), #85·#90 이 파일.
  - #74 코어 나가는 길 경계(#64 닫힘): `core/src/chat/egress.ts`, oxlint 금지 규칙, stdio lsof 시험.
  - #76 ADR-0012 소유자 결정(#59 닫힘): OpenAI 호환도 https 만, 대화 기록은 앱이 AES-GCM 으로 저장(보관 기본 30일).
  - #81 Claude Code 2.1.330 재측정(#69 닫힘): MCP 가 꺼진 동안의 응답 후보 셋 가운데 권고는 c3 다. 플러그인 0.9.2.
  - #72 Mux 2(#63 닫힘, main `cc82033`): `open` 이 채널 종류를 싣고, Embed Core 가 번들 코어의 Bun 을 확인한다.
  - #84 Mux 2 번들 실기: `/Applications` 의 `cc82033` 빌드에 Claude Code 2.1.330 과 Codex 0.171.0 이 붙었다. 켜진 채
    끄자 세 채널이 닫혔고, 다시 켜자 둘 다 다시 붙었다. Claude Code 는 연결된 중계가 끝날 때 이유를 보이지 않는다(계약 §6).
  - 단계 4(#66)의 앞 넷
    - #86(A, main `070cf40`): 도구 호출의 생애를 `core/src/tools/call.ts`·`outcome.ts` 로 옮겨 MCP 와 채팅이 함께
      쓴다. 나가는 길이 `globalThis.WebSocket` 도 거부한다.
    - #87(B, main `1f73fdb`): 계약 3판, mux 3. `confirm` 이 `"channel":N` 을 싣고, 앱은 확인의 출처를 그 채널의
      종류로 가른다. MCP 스위치는 mcp 채널의 확인만 거두고 거부한다.
    - #89(C, main `31ac4f8`): 코어가 채널 종류 `chat` 과 `sherpa.chat.v1` 의 `list_models` 를 받는다(계약 §7.11).
      코어의 첫 나가는 연결이다. 오류 코드와 한도는 닫힌 목록이고, 키는 그 요청의 머리말에만 있다.
    - #88(main `fa89152`): ADR-0012 의 Mux 2 문장 옆에 3판이 mux 를 3 으로 올렸다고 적었다.
    - #91(D1, main `fa370ef`): `ai` 7.0.179 와 `@ai-sdk/*` 넷을 고정하고 울타리(봉인, 린트, 의존 닫힘 검사, TLS
      stdio 시험)를 쳤다.
    - #97(main `f3ca09a`): 빌드가 `--compile-exec-argv=--use-system-ca` 를 넣어 코어가 시스템 저장소도 믿는다.
      Bun 1.4.5 의 그 저장소는 관리자 신뢰 설정의 인증서만 넣고 사용자 신뢰 설정의 것은 넣지 않는다(실측).
  - #92 보안 결함: 0.8.0~0.8.5 의 CLI 가 실행한 폴더의 `.env`·`bunfig.toml` 을 읽었다. 앱의 코어는 cwd 가 `/` 라
    막혀 있었다. #93 이 빌드의 자동 읽기 넷을 끄고 회귀 시험과 `scripts/package.sh` 의 확인을 넣었고, #95 가 깃발 넷의
    단위 시험과 `XDG_CONFIG_HOME` 을 더했다. #94 로 0.8.6 을 냈다(태그 `v0.8.6`, tap `3ee4e2b`). 이 Mac 의
    Homebrew 0.8.6 에서 고침을 확인했고(live-evidence 2026-11-22), #92 를 닫았다.
- 소유자 결정(2026-11-22)
  - OpenAI 의 옛 `include: reasoning.encrypted_content` 는 ADR-0012 결정 7 의 예외로 둔다. D2 가 싣는다.
  - https 루프백은 이름으로 막지 않는다. 규칙은 https 와 코어가 믿는 인증서다. #89 가 실었다.
  - 한 차례의 단계 한도는 20이다. D3 이 싣는다.
  - 코어는 키체인이 신뢰한 인증서도 믿는다(#97). 사용자 신뢰 설정에서만 믿게 한 루트까지는 지금 넓히지 않고, 그런
    출처가 실제로 막히면 그때 넓힌다(ADR-0012 정정 "사용자 신뢰 설정").
- 다른 저장소: plug-hole #13·#14·#15(main `c826044`), toolbox 0.46.2(태그 `toolbox-v0.46.2` → `2baffc5`),
  swift-arch 0.9.6(태그 `swift-arch-v0.9.6`).
- 이 Mac 의 판(2026-11-22): Bun 1.4.5(Homebrew 와 `~/.bun/bin` 두 벌), Claude Code 2.1.330, Codex 0.171.0, vp 1.7.0,
  Xcode 27.2(27B52), Swift 6.4.2, swift-format 6.4.4.

## 진행 중

- 단계 4(#66): 작업자 chat-core, 워크트리 `.claude/worktrees/chat-core`. 각 PR 을 병합한 뒤 다음 것을 시작한다.
  - 지금 D2 글 차례: 네 제공자, `turn`·`cancel`·`delta`·`done`·`error`, 첫 조각과 조각 사이 120초, 결정 1. 재시도는 누가·
    몇 번·최악 대기를 계약에 적고, 도구는 다시 하지 않는다. `ai` 를 실제로 읽으면 Gateway 가 빌드한 코어에 들어오므로
    봉인과 의존 닫힘 검사가 그 길을 막는지 다시 본다.
  - D3 도구: 레지스트리를 AI SDK 도구로 넘긴다. 상태 일곱, 단계 한도 20, `toolCallConcurrency` 1, 채팅 확인의 채널 번호.
  - 그 뒤 E(대화 상태 `state`·`resume`)와 F(크기·메모리 실측, 문서, 이 파일, #66 닫기).
- 패키지 판은 넣는 날 npm 의 최신 안정판으로 다시 보고, 기존 의존의 올림은 따로 PR 로 먼저 낸다.

## 하지 말 것 (실패한 시도, 되돌린 것)

- 에이전트의 협상 규격을 손으로 보낸 `initialize` 로 재지 않는다. 클라이언트 로그나 중계 앞 tee 로 선 위를 본다.
- 확인 기록의 클라이언트를 `getClientVersion()` 으로 읽지 않는다. 2026-07-28 에서 비어 있다.
- Claude Code 의 실패·고정 캐시를 실제 서버 이름 `sherpa` 로 시험하지 않는다. 다른 이름으로 잰다. 플러그인 서버는 실패
  뒤 15분 동안 건너뛰고, 실제 프로필에서 재면 시험 항목이 `mcp-needs-auth-cache.json` 에 남는다.
- plug-hole 의 sherpa 항목은 ref 고정이 없다. `plugins/sherpa/` 변경을 main 에 병합하면 다음 갱신 때 배포된다.
- 작업자가 게이트나 커밋을 끝냈는지 보지 않고 그 워크트리를 지우지 않는다. #56 때 push 전 커밋이 사라질 뻔했다.
- 작업자의 "병합 준비" 보고만 믿고 병합하지 않는다. 병합 전에 PR head·base 와 본문의 게이트 줄을 다시 본다. 보고와
  병합 신호가 엇갈려, 옛 main 위의 head 가 준비됐다고 올라온 적이 있다(#72).
- 문서에 PR 번호를 PR 을 열기 전에 적지 않는다. 나란히 연 PR 에 번호를 두 번 빼앗겼다(#87·#88). PR 을 먼저 열어
  번호를 잡고 고친다.
- live-evidence 충돌을 한쪽 항목을 버려 풀지 않는다. 항목을 모두 남기고 실측 시각 순으로 둔다(새 것이 위).
- Orca `get-app-state --window-id` 로 "?" 팝오버를 찍지 않는다(window_not_found). `list-windows` 의 틀로
  `screencapture -R x,y,w,h` 를 쓴다. 다른 앱 화면이 함께 찍히므로 본 뒤 지운다.
- macOS 27 메뉴 막대 상태 항목을 CGWindowList·접근성 트리로 확인하려 하지 않는다. `MenuBarAgent` 가 그린다.
- 코어 테스트를 `vp test` 로 돌리지 않는다. `bun run test` 와 `bun run test:stdio`(`bun run build` 뒤)를 쓴다.
- KakaoTalk plist 를 `plutil -convert json` 으로 읽지 않는다. Reminders·Calendar 를 AppleScript·SQLite 로 읽지 않는다.
- 전체 디스크 접근은 요청 API 가 없다. 설정 화면을 연다. Automation 요청은 대상 앱을 띄운 뒤 묻는다.
- zsh 의 `log` 는 내장 명령이다. 통합 로그는 `/usr/bin/log` 로 읽는다.
- 앱의 info 줄을 뒤늦은 `log show --info` 로 찾지 않는다. 11줄 중 3줄만 돌려줬다. `open --env LOG_LEVEL=info` 로
  띄우고 `log stream --level info` 를 미리 건다.
- 앱을 `osascript` 의 quit 로 끄지 않는다. Automation 권한 창이 뜰 수 있다. `kill -TERM` 이 메뉴의 Quit 와 같은 길이다.
- Xcode 증분 빌드로 서명을 판정하지 않는다. derived data 를 지우고 빌드한다.
- Embed Core 단계에서 번들 안 코어를 직접 `codesign` 하지 않는다. `TEMP_DIR` 에서 서명하고 복사한다.

## 막힌 것 · 오너 결정 대기

- 소유자 결정 대기:
  - MCP 꺼짐 때의 응답 모양으로 c3 를 쓸지(#69 의 권고). 정하면 구현을 새 이슈로 낸다. remedy 글에는 세미콜론을
    쓰지 않는다. Claude Code 가 빼고 보낸다.
  - 대화 기록 보관 기한의 기본 30일과 선택지 1·7·30·90일(#67).
  - 이 Mac 에 깔린 플러그인 갱신(sherpa 0.9.0 → 0.9.2, toolbox 0.46.0 → 0.46.2).
  - Bun 두 벌(Homebrew, `~/.bun/bin`) 가운데 하나 정리.
  - Codex 기능 `mcp_2026_07_28` 다시 켜기. 두 `config.toml` 이 03:56:53Z 같은 순간에 다시 쓰이면서 그 줄이 빠졌다.
- 소유자 할 일: Apple Developer 에서 명시 App ID `dev.xiyo.sherpa` 를 등록하고 Developer ID provisioning profile 을
  만든다. #65(API 키 저장소와 기록 키)가 기다린다.
- 비어 있는 증명
  - MCP 를 끈 동안 채팅 도구 호출의 확인 창이 뜨는지 끝까지 보는 시험. 앱이 아직 chat 채널을 열지 못하므로
    (`MuxFrame` 은 `mcp` 뿐) #67 의 몫이다.
  - Mux 3 번들 실기. `/Applications` 의 앱은 아직 Mux 2 빌드다.
- 미확인:
  - 네 제공자의 실제 모델 목록 응답 모양, Anthropic 목록이 `anthropic-version: 2026-10-21` 과 `lifecycle` 을 문서대로
    다루는지, Google 이 `pageSize=1000` 을 받는지. 소유자의 키가 있어야 해서 #68 실기에서 잰다.
  - 관리자 신뢰 설정의 루트 뒤 출처를 코어의 `fetch` 가 끝까지 받는지, 회사 MDM 이 넣은 루트가 어느 신뢰 설정에
    드는지. 키체인을 바꾸지 않고는 재지 못하므로 #68 실기에서 본다.
  - 2026-11-22 04:29Z 게이트 실패(#78)가 잠금 원인이었는지. 그 실행은 outcome 을 남기지 않았고, 줄과 조건은 재현과 같다.
  - 게이트가 3.1 의 실패 이유 줄을 내는지 보는 결정적 시험이 없다. 증거는 #72 의 변이 실행 기록뿐이다.
  - `vp install` 이 `onFail: "download"` 일 때 Bun 1.4.5 를 받는지.
  - #83: 파이프·소켓이 CLOEXEC 없이 만들어지는 틈. 코드로 읽었고 재현하지 않았다.
  - ADR-0012 "아직 확인 전" 목록. 구현 단계와 유료 실기에서 닫는다.
  - 메뉴 막대 토글. Orca 가 상태 항목을 보지 못한다.
  - Codex 설정에서 기능 줄이 빠진 원인. 이 세션의 작업자에게는 실제 설정을 바꾸지 말라고 했다.
- 참고: 헬퍼 릴리스 빌드의 `ReminderItems.swift` "trailing closure … confusable" 경고 56개는 #73 전부터 같다.
- 기존: #29 남은 실기(계약 §13.4), 게이트에 없는 계약 §13.3 통합 시험, #46 할당기 캐시, #39 중계를 띄운 프로그램
  허용, #43·#34·#35·#33·#32, #36, #30. #31 공증·cask 는 소유자 밖으로 내는 배포라 시작 전에 확인을 받는다.

## 다음 행동

1. 단계 4 를 D1 → D2 → D3 → E → F 순서로 chat-core 와 마친다. 병합 전마다 PR head·base 와 본문의 게이트 줄을 다시
   본다.
2. 소유자에게 c3 와 Codex 기능 다시 켜기를 받는다. c3 를 정하면 구현 이슈를 내고, 켜진 채 끌 때 Claude Code 가 이유를
   보이지 않는 것(#84)도 그 이슈에서 함께 본다.
3. 단계 4 가 끝나면 main 빌드를 `/Applications` 에 두고 Mux 3 번들 실기를 한다.
4. 단계 3(#65)은 소유자의 프로필 뒤, 단계 5(#67)는 3·4 뒤, 단계 6(#68)은 마지막이다.
5. #83, #29 남은 실기, 계약 §13.3 통합 시험, #46. #31 공증·cask 는 소유자 확인을 받은 뒤 시작하고, 그 패키징에도
   실행한 폴더의 설정을 읽지 않는지 보는 확인을 넣는다(#93 의 권고).

## 저장소·세션 상태 (브랜치, 미커밋, 미푸시, pane)

- 원격과 배포 경로
  - 원격: `bunny-holes/sherpa`(공개)
  - Formula: `XIYO/homebrew-tap`(공개, 옮기지 않았다). `3ee4e2b` 가 0.8.6 을 가리킨다.
  - 마켓플레이스: `bunny-holes/plug-hole`(비공개). sherpa 항목은 `git-subdir` `plugins/sherpa` 이고 ref 가 없다.
- `main` 은 `f3ca09a`(#97)와 그 뒤 이 파일을 고친 문서 PR 이다.
- 작업자 워크트리: `.claude/worktrees/chat-core`(chat-core). 브랜치는 지금 하는 PR 의 것이다. 그 밖에는 없다.
- 이 Mac 의 CLI: Homebrew `sherpa` 0.8.6(2026-11-22 11:33Z 에 올렸다).
- 떠 있는 앱: `/Applications/Sherpa.app` 은 main `cc82033` 빌드다. main 의 앱 판은 이제 0.8.6 이다.
  - 0.8.5, Mux 2, Developer ID, 공증 전
  - MCP 켜짐, 로그 수준 기본(warn)
  - 바꾸기 전 앱의 백업은 이 세션의 임시 폴더에만 있다.
- 이 Mac 의 에이전트
  - Claude Code 프로필: `sherpa@plug-hole` 0.9.0, `toolbox@plug-hole` 0.46.0(user). 최신은 0.9.2 와 0.46.2 다.
  - Codex: sherpa 플러그인은 켜져 있다. 기능 `mcp_2026_07_28` 은 2026-11-22 03:56:53Z 부터 두 `config.toml` 에서
    빠져 있다.
- 개발 실행: `cd core && bun run build`, 앱 번들은 계약 §2 "번들 빌드".
