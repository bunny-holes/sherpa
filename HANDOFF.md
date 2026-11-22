# sherpa HANDOFF — 2026-11-23 06:29 KST

## 목표

Sherpa 를 SwiftUI 메뉴 막대 앱(`Sherpa.app`, 권한 주체)으로 내고, 에이전트에는 앱 안의 TS MCP 서버를 Swift
중계로 연다(ADR-0010). MCP 는 2026-07-28 규격만 받는다(ADR-0011). 앱 첫 화면은 두 타일이다. "AI 연결하기" 는 앱 안
채팅이고(ADR-0012), "MCP 활성화하기" 는 스위치이며 연결 방법은 "?" 뒤에 둔다. 지금은 ADR-0012 구현 단계 4(#66, 코어
채팅 경계)를 하고 있다. 그 뒤로 단계 3·5·6(#65·#67·#68)과 공증·Homebrew cask 배포(#31)가 남았다. CLI 배포본은
0.8.6 이다. `Sherpa.app` 은 공증 전이라 이 저장소에서 빌드해 `/Applications` 에 둔다.

## 끝난 것 (커밋·태그·실측 근거)

- 바탕: 앱 연결 계약(#26)~Xcode 빌드(#49), MCP 2026-07-28 전용(#51), MCP 스위치와 "?"(#54·#52), ADR-0012 설계(#59).
- 2026-11-22~23 병합. 모두 PR head 에서 `bash scripts/check-all.sh` exit 0 을 확인하고 손으로 병합했다.
  - #73 swift-format(`e3ed524` 는 `.git-blame-ignore-revs`), #77 Bun 고정(`devEngines`, 새 판은 경고만), #80 옛 주소
    (#79 닫힘), #82 잠금 flake(#78 닫힘, 결정적 회귀 시험), #85·#90·#96·#98·#100·#103·#105 이 파일.
  - #75·#81 Claude Code 2.1.326·2.1.330 실측(#69 닫힘): MCP 가 꺼진 동안의 응답 후보 셋 가운데 권고는 c3. 플러그인 0.9.2.
  - #74 코어 나가는 길 경계(#64 닫힘): `core/src/chat/egress.ts`, oxlint 금지 규칙, stdio lsof 시험.
  - #76 ADR-0012 소유자 결정(#59 닫힘): OpenAI 호환도 https 만, 대화 기록은 앱이 AES-GCM 으로 저장(보관 기본 30일).
  - #72 Mux 2(#63 닫힘, `cc82033`)와 #84 그 번들 실기(Claude Code 2.1.330·Codex 0.171.0, 켜진 채 끄고 다시 켜기).
  - 단계 4(#66)
    - #86(A, `070cf40`) 호출 생애 모듈(`core/src/tools/call.ts`·`outcome.ts`), #87(B, `1f73fdb`) 계약 3판·mux 3
      (`confirm` 의 `"channel":N`, 확인의 출처는 채널 종류로 가른다), #89(C, `31ac4f8`) 채널 종류 `chat` 과 `list_models`.
    - #91(D1, `fa370ef`) `ai` 7.0.179 와 `@ai-sdk/*` 넷의 고정과 울타리, #97(`f3ca09a`) 시스템 인증서 저장소(실측).
    - #99(D2, `26a369b`)·#101(`80599e1`): 네 제공자의 글 차례(`delta`·`done`·`error`). 재시도는 SDK 의 `maxRetries: 2`
      (첫 출력 전만), 첫 출력·출력 사이 600초. 실행 파일 +2.0 MB, 시작 +12 ms(까닭은 추론), 점유 +2.3 MB.
    - #102(D3a, `f300ba3`): 모델이 MCP 와 같은 도구를 부른다(`tool` 둘, 상태 일곱, 단계 한도 20, 한 번에 한 호출, 결과
      64 KiB). 취소는 커밋 전 호출만 거둔다. SDK 가 돌리지 않은 호출에는 `chat.not_run` 결과를 달고, `stop`·
      `tool-calls` 밖의 까닭으로 끝난 단계 뒤에는 요청하지 않는다.
    - #104(D3b, `5426502`)·#106(`e1954e0`): `text` 없는 `turn`("다시 보내기")과 끝마다 싣는 `resend`(계약 §7.11 의 표).
    - #107(E1, `2a79ee7`): 대화 2 MiB 를 차례 안에서도 잰다(시작, 흐르는 답의 위쪽 어림, 호출 앞의 64 KiB 자리, 단계
      끝의 정확한 잼). 넘을 답은 미들웨어가 흐름 안의 `error` 조각으로 끊어 요청은 한 번이고, 넘은 차례는 `error`
      `conversation_limit`(`resend` 거짓)로 끝나 채팅이 가득 찬다. 스키마가 거절한 까닭은 코어가 2 KiB 안에
      적는다(`chatLimits.toolIssueBytes`). zod 의 글을 그대로 두면 issue 2,000개인 호출 하나가 409,491 B 를 남겼다.
  - #92 보안 결함: 0.8.0~0.8.5 CLI 가 실행한 폴더의 `.env`·`bunfig.toml` 을 읽었다. #93·#95 가 고쳤고 #94 가 0.8.6 을 냈다.
- 소유자 결정(2026-11-22): OpenAI 의 옛 `include: reasoning.encrypted_content` 는 ADR-0012 결정 7 의 예외(#99), https
  루프백은 이름으로 막지 않음(#89), 단계 한도 20(#102), 키체인이 신뢰한 인증서까지 믿고 사용자 신뢰 설정에서만 믿게 한
  루트는 그런 출처가 실제로 막힐 때 넓힘(#97, ADR-0012 정정 "사용자 신뢰 설정").
- 이 Mac 의 판(2026-11-22): Bun 1.4.5(Homebrew 와 `~/.bun/bin` 두 벌), Claude Code 2.1.330, Codex 0.171.0, vp 1.7.0,
  Xcode 27.2(27B52), Swift 6.4.2, swift-format 6.4.4.

## 진행 중

- 단계 4(#66): 작업자 chat-core, 워크트리 `.claude/worktrees/chat-core`. 각 PR 을 병합한 뒤 다음 것을 시작한다.
  - E 설계는 2026-11-23 에 승인했고 E1(#107, 끝남)·E2·E3 을 PR 하나씩 병합한다.
  - 지금 E2(대화 상태): 코어는 사람의 글을 더할 때, 단계를 남길 때, 변경하는 호출이 커밋할 때 `state` 를 보낸다.
    `{"type":"state","state":"<S 의 base64>"}` 의 S 는 `sherpa.chat.state.v1` 봉투(제공자, OpenAI 호환의 `base_url`,
    모델, 지시문과 도구 정의의 지문, `pending`, 메시지)의 JSON 이다. 앱은 푼 바이트를 그대로 암호화해 두었다가 새 chat
    채널의 첫 메시지 `resume` 으로 같은 base64 를 되돌린다. 코어는 base64 를 엄격하게 풀고(다시 싸서 같아야 한다),
    받으면 `resumed`(`resend` 를 싣는다), 깨진 상태는 `in_reply_to` "resume" 의 `chat_state_invalid`, 제공자·`base_url`·
    모델이 다른 `turn` 은 `chat_state_mismatch` 다. 지문이 바뀌면 Anthropic 만 reasoning 을 뺀다. `call_id` 는 채널마다
    1부터, 4 MiB `data` 울타리는 base64 뒤로 재고 넘으면 `internal` 이다. 앱은 받은 `state` 를 저장한 뒤 그 뒤의
    프레임(특히 채널 0 의 `request`)을 처리하고, 닫은 채널에 늦게 온 `state` 도 그 채팅의 기록에 쓴다.
  - E3: 변경하는 호출은 나가기 전에 `committed(operation_id)` 에서 그 호출을 `pending` 에 실은 `state` 를 보낸다. 이어
    쓴 뒤 첫 글 차례에 코어가 기록부에서 결과를 읽어 사람의 글 앞 한 줄로 알리고, 미결이 있는 동안 `resend` 는 거짓이다.
  - E 뒤에도 남는 틈(계약 §16): 코어가 스스로 도는 명령은 `state` 를 쓴 뒤 앱의 저장을 기다리지 않고, 커밋 직전에
    닫은 채널의 늦은 `state` 보다 같은 채팅의 새 채널이 먼저 열릴 수 있다. 둘 다 그 미결이 채팅에서 빠지고 기록부에만 남는다.
  - 그 뒤 F(크기·메모리 실측, 문서, 이 파일, #66 닫기). 첫 차례 뒤 메모리, hardened runtime 의 값, 시작 +12 ms 를
    줄이는 길(`--bytecode` 등)을 잰다.
- #102 가 남긴 한계: 취소해도 코어가 스스로 도는 읽기(SQLite 읽기·명령)와 허용 뒤의 보내기는 신호를 받지 않아 자기
  한도(명령 10·30초)까지 돈다(계약 §7.11). 코어 명령에 신호를 넘기는 일은 아직 이슈가 없다.
- 패키지 판은 넣는 날 npm 의 최신 안정판으로 다시 보고, 기존 의존의 올림은 따로 PR 로 먼저 낸다.

## 하지 말 것 (실패한 시도, 되돌린 것)

- 에이전트의 협상 규격을 손으로 보낸 `initialize` 로 재지 않는다. 클라이언트 로그나 중계 앞 tee 로 선 위를 본다.
- 확인 기록의 클라이언트를 `getClientVersion()` 으로 읽지 않는다. 2026-07-28 에서 비어 있다.
- Claude Code 의 실패·고정 캐시를 실제 서버 이름 `sherpa` 로 시험하지 않는다. 다른 이름으로 잰다. 플러그인 서버는 실패
  뒤 15분 동안 건너뛰고, 실제 프로필에서 재면 시험 항목이 `mcp-needs-auth-cache.json` 에 남는다.
- plug-hole 의 sherpa 항목은 ref 고정이 없다. `plugins/sherpa/` 변경을 main 에 병합하면 다음 갱신 때 배포된다.
- 작업자가 게이트나 커밋을 끝냈는지 보지 않고 그 워크트리를 지우지 않는다. #56 때 push 전 커밋이 사라질 뻔했다.
- 작업자의 "병합 준비" 보고만 믿고 병합하지 않는다. PR head·base, 본문의 게이트 줄, 지시를 반영했는지 다시 본다.
  오래 도는 작업자는 그 사이 온 메시지를 차례가 끝난 뒤에 읽어 지시와 PR 이 엇갈린다(#72·#104·#107).
- 문서에 PR 번호를 PR 을 열기 전에 적지 않는다(#87·#88 에서 두 번 빼앗겼다). PR 을 먼저 열어 번호를 잡는다.
- AI SDK 의 동작을 주석만 보고 정하지 않는다. 7.0.179 의 `StopCondition` 주석은 `tool-calls` 밖의 까닭이면 멈춘다고
  적었지만 `shouldStartNextStep` 은 호출마다 결과가 있으면 이어 간다(#102). 그 소스를 읽고 시험으로 고정한다.
  오류 글의 크기도 입력으로 어림하지 않는다. zod 의 글은 모든 issue 의 JSON 이고, SDK 는 푼 입력을 다시 적는다(#107).
- live-evidence 충돌을 한쪽 항목을 버려 풀지 않는다. 항목을 모두 남기고 실측 시각 순으로 둔다(새 것이 위).
- Orca `get-app-state --window-id` 로 "?" 팝오버를 찍지 않는다(window_not_found). `list-windows` 의 틀로
  `screencapture -R x,y,w,h` 를 쓴다. 다른 앱 화면이 함께 찍히므로 본 뒤 지운다.
- macOS 27 메뉴 막대 상태 항목을 CGWindowList·접근성 트리로 확인하려 하지 않는다. `MenuBarAgent` 가 그린다.
- 코어 테스트를 `vp test` 로 돌리지 않는다. `bun run test` 와 `bun run test:stdio`(`bun run build` 뒤)를 쓴다.
- KakaoTalk plist 를 `plutil -convert json` 으로 읽지 않는다. Reminders·Calendar 를 AppleScript·SQLite 로 읽지 않는다.
- 전체 디스크 접근은 요청 API 가 없다. 설정 화면을 연다. Automation 요청은 대상 앱을 띄운 뒤 묻는다.
- 앱의 info 줄을 뒤늦은 `log show --info` 로 찾지 않는다. 11줄 중 3줄만 돌려줬다. `open --env LOG_LEVEL=info` 로
  띄우고 `/usr/bin/log stream --level info` 를 미리 건다(zsh 의 `log` 는 내장 명령이다).
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
- 비어 있는 증명: MCP 를 끈 동안 채팅 도구 호출의 확인 창이 뜨는지 끝까지 보는 시험(앱이 아직 chat 채널을 열지
  못해 #67 의 몫), Mux 3 번들 실기(`/Applications` 의 앱은 아직 Mux 2 빌드).
- 미확인:
  - 네 제공자의 실제 모델 목록과 차례 응답(흐름, 흐름 안 오류, 프레임 차례, `resend`)의 모양, Anthropic 의
    `anthropic-version: 2026-10-21`·`lifecycle`, Google 의 `pageSize=1000`. 소유자의 키로 #68 실기에서 잰다(계약 §16).
  - 제공자가 생각하는 동안 바이트(ping 등)를 보내는지와 첫 출력 전에 생각하는 시간. 바이트가 없으면 Bun 의 유휴
    한도(이 Mac 실측 360초)가 600초보다 먼저 차례를 끊는다. 유료라 #68 실기에서 잰다.
  - 일찍 닫힌 답의 코드가 제공자마다 다르다(OpenAI·Google 은 늘 `network`, OpenAI 호환과 출력 전 Anthropic 은
    `provider_invalid_response`). 맞출지는 정하지 않았고, 지금 동작은 시험 여섯이 고정한다(계약 §7.11).
  - 도구 호출 응답을 `tool_calls`·`function_call`·`stop` 밖의 까닭으로 끝내는 OpenAI 호환 서버가 있는지. 있으면 그
    서버에서는 도구가 하나도 돌지 않고, 차례마다 `chat.not_run` 과 `done` `other` 로 끝난다(계약 §16).
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

1. 단계 4 를 E2 → E3 → F 순서로 chat-core 와 마친다. 병합 전마다 PR head·base 와 본문의 게이트 줄을 다시 본다.
2. 소유자에게 c3 와 Codex 기능 다시 켜기를 받는다. c3 를 정하면 구현 이슈를 내고, 켜진 채 끌 때 Claude Code 가 이유를
   보이지 않는 것(#84)도 그 이슈에서 함께 본다.
3. 단계 4 가 끝나면 main 빌드를 `/Applications` 에 두고 Mux 3 번들 실기를 한다.
4. 단계 3(#65)은 소유자의 프로필 뒤, 단계 5(#67)는 3·4 뒤, 단계 6(#68)은 마지막이다.
5. #83, #29 남은 실기, 계약 §13.3 통합 시험, #46. #31 공증·cask 는 소유자 확인을 받은 뒤 시작하고, 그 패키징에도
   실행한 폴더의 설정을 읽지 않는지 보는 확인을 넣는다(#93 의 권고).

## 저장소·세션 상태 (브랜치, 미커밋, 미푸시, pane)

- 원격: `bunny-holes/sherpa`(공개). Formula: `XIYO/homebrew-tap`(공개, 옮기지 않았다, `3ee4e2b` 가 0.8.6).
  마켓플레이스: `bunny-holes/plug-hole`(비공개). sherpa 항목은 `git-subdir` `plugins/sherpa` 이고 ref 가 없다.
- `main` 은 `2a79ee7`(#107)와 그 뒤 이 파일을 고친 문서 PR 이다.
- 작업자 워크트리: `.claude/worktrees/chat-core`(chat-core). 브랜치는 지금 하는 PR 의 것이다. 그 밖에는 없다.
- 이 Mac 의 CLI: Homebrew `sherpa` 0.8.6(2026-11-22 11:33Z 에 올렸다).
- 떠 있는 앱: `/Applications/Sherpa.app` 은 main `cc82033` 빌드다(0.8.5, Mux 2, Developer ID, 공증 전, MCP 켜짐,
  로그 수준 기본 warn). main 의 앱 판은 이제 0.8.6 이다. 바꾸기 전 앱의 백업은 이 세션의 임시 폴더에만 있다.
- 이 Mac 의 에이전트: Claude Code 프로필의 `sherpa@plug-hole` 0.9.0, `toolbox@plug-hole` 0.46.0(user, 최신은 0.9.2 와
  0.46.2). Codex 의 sherpa 플러그인은 켜져 있고, 기능 `mcp_2026_07_28` 은 2026-11-22 03:56:53Z 부터 두
  `config.toml` 에서 빠져 있다.
- 개발 실행: `cd core && bun run build`, 앱 번들은 계약 §2 "번들 빌드".
