# sherpa HANDOFF — 2026-11-22 15:48 KST

## 목표

Sherpa 를 SwiftUI 메뉴 막대 앱(`Sherpa.app`, 권한 주체)으로 내고, 에이전트에는 앱 안의 TS MCP 서버를 Swift
중계로 연다(ADR-0010). MCP 는 2026-07-28 규격만 받는다(ADR-0011). 앱 첫 화면은 두 타일이다. "AI 연결하기" 는 앱 안
채팅이고(ADR-0012), "MCP 활성화하기" 는 스위치이며 연결 방법은 "?" 뒤에 둔다. 남은 일은 ADR-0012 구현 단계 3~6(#65~#68)과
그 뒤의 공증·Homebrew cask 배포(#31)다. CLI 배포본은 0.8.5 다. `Sherpa.app` 은 공증 전이라 이 저장소에서 빌드해
`/Applications` 에 둔다.

## 끝난 것 (커밋·태그·실측 근거)

- 바탕: 앱 연결 계약(#26)부터 Xcode 빌드(#49)까지 PR #44·#45·#48·#50. MCP 2026-07-28 전용(#51, PR #53). MCP 스위치와
  "?" 안내(#54·#52, PR #56). 플러그인 0.9.0 배포와 실측(#55, PR #57·#60). ADR-0012 설계(#59, PR #61).
- 2026-11-22 병합. 모두 PR head 에서 `bash scripts/check-all.sh` exit 0 을 확인하고 손으로 병합했다.
  - #73 swift-format: 루트 `.swift-format`, 게이트 1단계 `swift format lint --strict`. 서식 커밋 `e3ed524` 는
    `.git-blame-ignore-revs` 에 있다.
  - #75 Claude Code 2.1.326 실측(MCP 꺼짐·앱 없음 뒤의 첫 연결), 플러그인 0.9.1.
  - #74 코어 나가는 길 경계(#64 닫힘): `core/src/chat/egress.ts`, oxlint 금지 규칙, stdio lsof 시험. 지킨 `fetch` 는
    아직 부르는 곳이 없다.
  - #76 ADR-0012 소유자 결정(#59 닫힘): OpenAI 호환 제공자도 https 만 받는다. 대화 기록은 앱이 AES-GCM 으로
    저장하고, 보관 기한은 기본 30일에 1·7·30·90일 중에서 고른다.
  - #77 최신판 규칙(#71 닫힘): `core/package.json` 의 `devEngines` 로 Bun 1.4.5 를 고정했다. 확인은
    `scripts/lib/bun-pin.sh` 가 맡고, 새 판 알림은 경고만 낸다.
  - #81 Claude Code 2.1.330 재측정(#69 닫힘): 옛 규격 고정은 남지 않는다. 꺼진 동안의 응답 후보 c2·c2open·c3 를
    두 에이전트에 대 보았고 권고는 c3 다. 플러그인 0.9.2(새 저장소 주소).
  - #80 저장소 이전 뒤 남은 옛 주소(#79 닫힘): 문서, `scripts/package.sh` 의 `RELEASE_REPOSITORY`,
    `scripts/check-release.sh`.
  - #82 잠금 flake(#78 닫힘): `InstanceLock.release()` 가 close 앞에 `flock(LOCK_UN)` 을 한다. 결정적 회귀 시험이 있다.
  - #72 Mux 2(#63 닫힘, main `cc82033`):
    - `open` 이 `{"kind":"mcp"}` 를 싣는다. 모르는 종류는 그 채널만 `unsupported_kind` 로 닫고, Mux 1 은 양쪽 다
      받지 않는다.
    - Embed Core 단계가 번들 코어의 Bun 런타임을 확인하고, 게이트 3.1 이 그 거부를 시험한다.
    - 게이트의 `xcode_failed` 가 이유 줄을 쓰기 전에 끝나던 결함을 고쳤다.
  - #84 Mux 2 번들 실기(main `5c6e029`):
    - `/Applications` 에 main `cc82033` 빌드를 두었다.
    - Claude Code 2.1.330 과 Codex 0.171.0 이 붙었다. `tools/list` 와 읽기 호출은 succeeded 였다.
    - 켜진 채 MCP 를 끄자 세 채널이 닫혔다. 관찰용 중계는 75 `app_closed_session` 으로 끝났다.
    - 다시 켜자 둘 다 다시 붙었다. 채널 열기 줄은 모두 `kind=mcp` 였다.
    - Claude Code 는 연결된 중계가 끝날 때 이유를 보이지 않는다(계약 §6).
- 다른 저장소:
  - plug-hole #13·#14·#15 (main `c826044`)
  - toolbox 0.46.1·0.46.2 (태그 `toolbox-v0.46.2` → `2baffc5`)
  - swift-arch 0.9.6 (태그 `swift-arch-v0.9.6`)
- 이 Mac 의 판(2026-11-22):
  - Bun 1.4.5 (Homebrew 와 `~/.bun/bin` 두 벌)
  - Claude Code 2.1.330, Codex 0.171.0
  - vp 1.7.0, Xcode 27.2(27B52)·Swift 6.4.2

## 진행 중

- 없음. 이 세션이 띄운 작업자는 모두 끝났고 워크트리도 지웠다.

## 하지 말 것 (실패한 시도, 되돌린 것)

- 에이전트의 협상 규격을 손으로 보낸 `initialize` 로 재지 않는다. 클라이언트 로그나 중계 앞 tee 로 선 위를 본다.
- 확인 기록의 클라이언트를 `getClientVersion()` 으로 읽지 않는다. 2026-07-28 에서 비어 있다.
- Claude Code 의 실패·고정 캐시를 실제 서버 이름 `sherpa` 로 시험하지 않는다. 다른 이름으로 잰다.
  - 플러그인 서버는 실패 뒤 15분 동안 건너뛴다.
  - 실제 프로필에서 재면 시험 항목이 `mcp-needs-auth-cache.json` 에 남는다.
- plug-hole 의 sherpa 항목은 ref 고정이 없다. `plugins/sherpa/` 변경을 main 에 병합하면 다음 갱신 때 배포된다.
- 작업자가 게이트나 커밋을 끝냈는지 보지 않고 그 워크트리를 지우지 않는다. #56 때 push 전 커밋이 사라질 뻔했다.
- 작업자의 "병합 준비" 보고만 믿고 병합하지 않는다. 병합 전에 PR head·base 와 본문의 게이트 줄을 다시 본다. 보고와
  병합 신호가 엇갈려, 옛 main 위의 head 가 준비됐다고 올라온 적이 있다(#72).
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
  - 이 Mac 에 깔린 플러그인 갱신. Claude Code 프로필의 `sherpa@plug-hole` 은 0.9.0 이고 최신은 0.9.2 다.
  - Bun 두 벌(Homebrew, `~/.bun/bin`) 가운데 하나 정리.
  - Codex 기능 `mcp_2026_07_28` 다시 켜기. 두 `config.toml` 이 03:56:53Z 같은 순간에 다시 쓰이면서 그 줄이 빠졌다.
- 소유자 할 일: Apple Developer 에서 명시 App ID `dev.xiyo.sherpa` 를 등록하고 Developer ID provisioning profile 을
  만든다. #65(API 키 저장소와 기록 키)가 기다린다.
- 다음 릴리스의 소유자 실기: tap 에 게시된 0.8.5 Formula 는 옛 `XIYO/sherpa` 주소를 적는다. 301 로 넘어가므로 설치는
  된다. 다음 `scripts/package.sh --publish` 와 tap 복사가 바꾼다.
- 미확인:
  - 2026-11-22 04:29Z 게이트 실패(#78)가 잠금 원인이었는지. 그 실행은 outcome 을 남기지 않았고, 줄과 조건은 재현과 같다.
  - 게이트가 3.1 의 실패 이유 줄을 내는지 보는 결정적 시험이 없다. 증거는 #72 의 변이 실행 기록뿐이다.
  - `vp install` 이 `onFail: "download"` 일 때 Bun 1.4.5 를 받는지.
  - #83: 파이프·소켓이 CLOEXEC 없이 만들어지는 틈. 코드로 읽었고 재현하지 않았다.
  - ADR-0012 "아직 확인 전" 목록. 구현 단계와 유료 실기에서 닫는다.
  - 메뉴 막대 토글. Orca 가 상태 항목을 보지 못한다.
  - Codex 설정에서 기능 줄이 빠진 원인. 이 세션의 작업자에게는 실제 설정을 바꾸지 말라고 했다.
- 참고: 헬퍼 릴리스 빌드에서 `ReminderItems.swift` 의 "trailing closure … confusable" 경고 56개가 나온다. #73 전부터
  같은 수다.
- 기존:
  - #29 남은 실기(메뉴의 스위치, 사용자 범위 Claude Code, 공증한 번들 등, 계약 §13.4)
  - 계약 §13.3 통합 시험이 게이트에 없음, #46 할당기 캐시
  - #39 중계를 띄운 프로그램 허용, #43·#34·#35·#33·#32, #36, #30
  - #31 공증·cask: 소유자 밖으로 내는 배포라 시작 전에 확인을 받는다.

## 다음 행동

1. 소유자에게 c3 를 묻는다. 정하면 구현 이슈를 낸다. 켜진 채 끌 때 Claude Code 가 이유를 보이지 않는 것(#84)도
   그 이슈에서 함께 본다.
2. Codex 기능 `mcp_2026_07_28` 을 다시 켤지 소유자에게 받는다. 켜기 전에는 이 Mac 의 Codex 가 Sherpa 에 붙지 못한다.
3. 단계 4(#66) 코어 채팅 경계를 시작한다. 프로필이 필요 없다. 그 뒤 순서는 다음과 같다.
   - 단계 3(#65): 소유자의 프로필 뒤
   - 단계 5(#67): 3·4 뒤
   - 단계 6(#68): 마지막
4. #83, #29 남은 실기, 계약 §13.3 통합 시험, #46.
5. #31 공증·cask 는 소유자 확인을 받은 뒤 시작한다.

## 저장소·세션 상태 (브랜치, 미커밋, 미푸시, pane)

- 원격과 배포 경로
  - 원격: `bunny-holes/sherpa`(공개)
  - Formula: `XIYO/homebrew-tap`(공개, 옮기지 않았다)
  - 마켓플레이스: `bunny-holes/plug-hole`(비공개). sherpa 항목은 `git-subdir` `plugins/sherpa` 이고 ref 가 없다.
- `main` 은 `5c6e029`(#84)와 그 뒤 이 파일을 고친 문서 PR 이다. 작업자 워크트리는 없다.
- 떠 있는 앱: `/Applications/Sherpa.app` 은 main `cc82033` 빌드다.
  - 0.8.5, Mux 2, Developer ID, 공증 전
  - MCP 켜짐, 로그 수준 기본(warn)
  - 바꾸기 전 앱의 백업은 이 세션의 임시 폴더에만 있다.
- 이 Mac 의 에이전트
  - Claude Code 프로필: `sherpa@plug-hole` 0.9.0(user)
  - Codex: sherpa 플러그인은 켜져 있다. 기능 `mcp_2026_07_28` 은 2026-11-22 03:56:53Z 부터 두 `config.toml` 에서
    빠져 있다.
- 개발 실행: `cd core && bun run build`, 앱 번들은 계약 §2 "번들 빌드".
