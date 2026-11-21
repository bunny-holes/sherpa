---
uuid: 01a1fca4-498c-7009-a75a-3c3a5eada9fa
type: adr
audience: "Sherpa 를 앱·MCP 로 옮기는 작업을 하거나 그 구조를 다시 보는 사람"
goal: "Sherpa 가 왜 SwiftUI 메뉴 막대 앱 + TS MCP 서버 + Swift 중계 구조인지, 무엇을 실측해 정했고 무엇이 아직 확인 전인지 알게 한다"
tone: "평어체. 소유자 결정, 실측, 추론을 가른다"
manner: "결정 본문은 고치지 않고 바뀐 사실은 정정으로 덧붙인다"
---

# Sherpa 는 SwiftUI 메뉴 막대 앱이고, MCP 는 앱 안의 TS 서버로 낸다

> **정정 (2026-11-21).** "결과" 의 "권한 공유 구멍이 닫힌다" 는 맞지 않다. 서명 확인은 중계를 띄운 쪽을 가리지
> 않아, 같은 사용자의 프로세스는 중계를 거쳐 읽기·만들기·고치기 도구를 부를 수 있다(추론, 재현 안 함). 구멍은
> 좁아질 뿐이다. 삭제·보내기는 앱 창 확인을 거치고, 다른 사용자·바뀐 실행 파일·환경 변수 주입은 거부된다.
> 1판은 같은 사용자를 믿는 범위로 둔다(소유자 결정). [앱 연결 계약](../contracts/app-connection-v1.md) 의
> "믿는 범위" 를 보라.
>
> **정정 (2026-11-21, 상태).** 2단계 구현이 병합됐다: 코어 MCP 서버(#27, PR #44)와 `Sherpa.app`·`sherpa-relay`
> (#28, PR #45). 배포(공증·cask, #31)와 소유자 실기(#29)가 남았다.
>
> **정정 (2026-11-22).** 실측 표의 "협상 규격 2025-11-25" 는 에이전트가 협상한 값이 아니라 손으로 보낸 `initialize`
> 로 서버를 잰 값이었다. Claude Code 2.1.326 은 stdio 서버에 기본으로 2026-07-28 을 묻고, Codex 0.171.0 은 기본이
> `initialize`(2025-06-18)다. 소유자는 MCP 를 2026-07-28 만 받기로 했다
> ([ADR-0011](0011-mcp-2026-07-28-only.md)). 그 판에는 프로토콜 세션이 없으므로, 결정 2 의 "연결마다 MCP 세션 하나"
> 는 채널마다 MCP 연결 하나로 읽는다.

상태: 채택(소유자 결정, 2026-11-21). 구현 전이다. ADR-0009 의 "헬퍼 번들" 과 헬퍼가 권한 책임을 놓고
다시 뜨는 방식(`PrivacyResponsibility`)을 이 결정이 대체한다. 번들 식별자 `dev.xiyo.sherpa`, Developer ID
서명, Bun + TypeScript 코어(ADR-0008)는 그대로다.

## 맥락

- 에이전트는 지금 플러그인 스킬이 `sherpa` 명령에 Worker Protocol V2 봉투를 손으로 만들어 넘긴다. 스키마
  실수(`deadline_ms` 한도, 스키마 이름)가 실기에서 거듭 났다.
- 헬퍼는 권한 창을 띄우려고 책임을 놓고 다시 뜬다. 그러면 같은 사용자의 아무 프로세스나 헬퍼를 실행해
  `dev.xiyo.sherpa` 의 Calendar·Reminders 권한을 쓸 수 있다(추론. 같은 구조였던 FradSer/mcp-server-apple-events
  가 같은 이유로 그 방식을 걷어냈다).
- 소유자 요구(2026-11-21): 앱으로 완전히 내고 MCP 로 연다. 메모리가 중요하다. MCP SDK 는 성숙도가 더 중요하다.

## 결정

1. **앱:** `Sherpa.app`, SwiftUI `MenuBarExtra`(Dock 아이콘 없음). 번들 식별자 `dev.xiyo.sherpa`, Developer ID,
   hardened runtime. 앱이 macOS 권한의 주체이고, 기존 Swift 코드(EventKit·Mail 자동화·비공개 ReminderKit)를
   앱 안에서 부른다. 권한 상태와 요청, 최근 작업을 메뉴로 보여 준다.
2. **MCP 서버:** 공식 TypeScript SDK v2(`@modelcontextprotocol/server`, Tier 1)로 Bun 코어 안에 둔다. 앱이
   오래 떠 있는 Bun 프로세스 하나를 띄우고, 연결마다 MCP 세션 하나를 `serveStdio(factory, { transport })` 로
   돌린다. Bun 은 소켓을 열지 않고 앱과의 표준 입출력 파이프만 읽는다.
3. **연결:** 에이전트는 세션마다 작은 Swift 중계(`sherpa-relay` 류)를 stdio 로 띄운다. 중계는 앱의 Unix 소켓에
   붙어 앱의 코드 서명을 확인하고, 앱은 연결한 쪽의 감사 토큰(`LOCAL_PEERTOKEN`)으로 중계의 서명을 확인한다.
   요건은 같은 팀(`certificate leaf[subject.OU]`)과 식별자다. 앱은 확인된 연결에 번호를 붙여 Bun 으로
   다중화한다.
4. **권한 항목:** 앱은 `com.apple.security.personal-information.calendars` 와 Apple Events 항목을 가진다.
   Bun 실행 파일은 hardened runtime 에 권한 항목 없이 서명한다.
5. **`sherpa` 명령은 남는다.** 시험·디버깅·게이트의 바깥 어댑터이고, 코어 함수와 계약은 MCP 와 공유한다.
6. **배포:** 공증한 앱을 Homebrew cask 로 내고, cask 의 `binary` 로 `sherpa` 명령 링크를 단다. 기존 formula 는
   옮긴다. 공증은 ADR-0009 의 "공증하지 않음" 을 대체한다(cask 는 내려받은 앱에 항상 격리 속성을 붙인다).

## 실측 (2026-11-21, 이 Mac, 버리는 시험 빌드)

| 확인한 것 | 결과 |
| --- | --- |
| 기존 권한 이어짐 | 다른 이름·실행 파일의 번들도 `dev.xiyo.sherpa` 면 Calendar·Reminders `full_access`, 미리알림 663건·일정 26건 읽힘. hardened runtime 에서도 같다 |
| hardened runtime 권한 항목 | 새 식별자로 요청: Calendar 는 calendars 항목 없이 즉시 거부(tccd 가 항목 없음을 기록), 있으면 권한 창. Reminders 는 항목 없이 권한 창 |
| Bun 과 hardened runtime | 권한 항목 없이 실행됨. JIT 를 허용하지 않아 MCP 프로브 실제 점유가 22.7 → 16.5 MB, iMessage 대화 500개 읽기 시간 같음(0.03 s) |
| 앱이 띄운 Bun 자식의 전체 디스크 접근 | 앱에 권한이 없을 때 자식의 chat.db 읽기 거부(`imessage.store_unreadable`), 같은 명령을 셸에서 돌리면 성공. 소유자가 앱에 권한을 켠 뒤 같은 자식이 읽기 성공(종료 0). 자식은 앱의 권한으로 판정된다. 권한 창은 없고, 접근을 시도한 앱이 목록에 꺼진 채 올라간다 |
| 공증 | 앱(calendars 항목) + 권한 항목 없는 Bun 실행 파일 + 중계를 hardened runtime·타임스탬프로 서명한 번들(zip 41 MB)이 36초 만에 Accepted, 문제 0건. 스테이플 뒤 격리 속성을 붙인 사본을 Gatekeeper 가 `Notarized Developer ID` 로 통과, 공증된 중계로 MCP 호출 성공 |
| 소켓·중계 | 서명된 중계 3개 동시 세션이 Bun 프로세스 하나에서 따로 돈다. 서명 없는 직접 연결·ad-hoc 중계는 거부, 가짜 서버는 중계가 거부(종료 77), 앱이 없으면 종료 69 |
| 실제 에이전트 | Claude Code 2.1.326(`--mcp-config`)과 Codex 0.170.0(`mcp_servers`)이 중계를 거쳐 도구 호출 성공. 협상 규격은 재지 않았다(정정 2026-11-22: 처음 적은 2025-11-25 는 손으로 보낸 `initialize` 의 값) |
| 메모리 | MCP 서버: Bun(TS SDK) 대기 20.5 MB, Rust(rmcp) 2.6 MB. 다중화 Bun 8분 941회·세션 48개 13.6 MB 고정, Swift 호스트 5.2 MB 고정. SwiftUI 메뉴 막대 최소 앱 17 MB(모두 실제 점유) |

## 아직 확인 전

- 앱이 꺼져 있을 때 중계가 앱을 띄우는 동작, 로그인 항목(`SMAppService`).
- 에이전트가 2026-07-28 로 붙는 조건과 남은 확인은 [ADR-0011](0011-mcp-2026-07-28-only.md) 로 옮겼다.

## 검토한 대안

- **Tauri v2:** 웹 화면과 내장 공증이 장점이지만 맥 플러그인은 Rust 전용이라 Swift 코드를 옮기거나 감싸야
  하고, 사이드카 전체에 권한 항목 파일 하나가 붙는다. 웹 화면 프로세스가 메모리를 더 쓴다. 큰 웹 화면이
  필요해지면 다시 본다.
- **Rust MCP(rmcp):** 세션마다 띄우면 가장 작다. 그러나 중계 구조에서는 MCP 서버가 하나라 차이가 20 MB 안팎이고,
  언어가 셋이 된다.
- **Swift MCP SDK:** 언어가 둘로 줄지만 1.0 전(Tier 3)이고 규격이 한 판 뒤처진다. 소유자는 성숙도를 택했다.
- **전부 Rust:** 코어(iMessage·KakaoTalk·Mail·저널·명령)와 시험을 다시 짜야 하고, 얻는 것은 요청 때만 뜨는
  작업 프로세스의 10 MB 남짓이다. patchright 때문에 Bun 은 남는다.
- **에이전트가 CLI 를 직접 MCP 서버로 띄우기:** 권한이 에이전트 호스트에 붙거나, 지금처럼 책임을 놓아 권한을
  공유하게 된다.
- **앱의 localhost HTTP:** 같은 사용자의 아무 프로세스나 포트에 닿아 토큰 관리가 필요하다.

## 결과

- 권한은 앱 하나에 모이고, 권한 공유 구멍이 닫힌다.
- 유지할 언어는 Swift 와 Bun 둘이다.
- 앱이 떠 있어야 MCP 가 돈다. 중계는 앱이 없으면 분명한 코드로 끝난다.
- 공증과 cask 로 배포가 바뀌고, 릴리스는 소유자의 공증 자격 증명(키체인 프로필 `sherpa-notary`)이 있는 Mac
  에서만 낼 수 있다. 애플이 개발자 프로그램 약관을 고치면 소유자가 다시 동의하기 전까지 공증이 HTTP 403
  으로 막힌다.

## Related

- [ADR-0008: Bun + TypeScript 코어](0008-bun-typescript-core.md)
- [ADR-0009: Developer ID 로 서명한 헬퍼 번들](0009-developer-id-signed-helper-bundle.md)
- [실측 기록](../testing/live-evidence.md)
- [앱 연결 계약](../contracts/app-connection-v1.md)
- [ADR-0011: MCP 는 2026-07-28 만 받는다](0011-mcp-2026-07-28-only.md)
