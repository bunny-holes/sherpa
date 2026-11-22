---
uuid: 01a1fd34-889b-79a0-b7de-04b056559cd9
type: spec
audience: "코어 MCP 서버(core/)와 메뉴 막대 앱·중계(apple/)를 따로 만드는 사람과 에이전트"
goal: "상대 쪽이 아직 없어도 이 문서만으로 자기 쪽을 만들고 시험하게 한다: 소켓, 서명 확인, 다중화, 중계 종료 코드, MCP 도구 규칙"
tone: "평어체 규범. 규칙마다 소유자 결정, 실측, 문서, 계약, 추론을 가르고 증명 안 된 것은 미확인으로 적는다"
manner: "경계마다 규칙을 먼저 쓰고 근거를 괄호로 붙인다. 시험 빌드의 코드는 옮기지 않고 사실만 옮긴다"
---

# 앱 연결 계약 V1

상태: 계약(2026-11-21). 코어 쪽(bunny-holes/sherpa#27)과 앱·중계(#28)가 모두 구현됐고, 배포(#31)와 소유자 실기(#29)가 남았다.
MCP 는 2026-07-28 만 받는다(소유자 결정 2026-11-22, [ADR-0011](../adr/0011-mcp-2026-07-28-only.md), §10.1). ADR-0010 2단계의
두 작업, 코어 MCP 서버(bunny-holes/sherpa#27)와 `Sherpa.app`·`sherpa-relay`(bunny-holes/sherpa#28)는 이 문서만 보고
동시에 만들고, 상대 쪽 없이 자기 쪽을 시험한다.

## 근거 표기

규칙마다 끝에 근거를 붙인다.

- **[소유자]** 소유자 결정. ADR-0010 의 결정 번호를 함께 적는다.
- **[실측]** 1단계 시험 빌드나 이 Mac 에서 잰 것. ADR-0010 실측 표, `docs/testing/live-evidence.md` 의 "Menu
  bar app and MCP spike", 또는 그 시험 빌드의 소스·기록에서 옮겼다. 시험 빌드는 저장소 밖에 있었고 지워질 수
  있다.
- **[문서]** 공식 문서나 SDK 소스에 적힌 것. 출처를 붙인다. 이 Mac 에서 재지는 않았다.
- **[계약]** 이 문서가 정한 것. 바꾸려면 이 문서를 고친다.
- **[추론]** 위에서 끌어낸 것. 재지 않았다.
- **[미확인]** 아직 증명하지 않은 것. §16 에 모은다.

## 1. 범위

```text
에이전트 (Claude Code, Codex)
   │  stdio: MCP JSON-RPC, 한 줄에 메시지 하나
   ▼
sherpa-relay ──Unix 소켓──▶ Sherpa.app ──stdin/stdout 프레임──▶ sherpa app serve
(세션마다 하나)              (권한 주체, 하나만)                   (Bun 코어, 하나만, MCP 연결 여럿)
                              ▲                                     │
                              └── 작업 요청(Worker Protocol V2)·확인 요청 ┘
```

용어: 이 문서의 "세션" 은 중계 연결 하나, 곧 앱이 매긴 채널 하나다. MCP 2026-07-28 에는 프로토콜 세션이 없고, 서버는
같은 연결의 앞선 요청으로 능력·규격·클라이언트 신원을 세우지 않는다. [문서: MCP 2026-07-28
[Overview](https://modelcontextprotocol.io/specification/2026-07-28/basic), "Statelessness"] 머리말 `too_many_sessions` 와 로그 `session-open`·`session-close` 의
"session" 도 이 뜻이다. [계약]

이 계약이 정하는 것: 번들 배치와 서명 식별자, 소켓과 단일 인스턴스, 양방향 서명 확인, 앱이 중계에 먼저 보내는
머리말, 중계의 동작과 종료 코드, 앱과 코어 사이 프레임(MCP 다중화, 작업 요청, 확인 요청), MCP 도구 규칙,
경계의 로그, 각 쪽의 시험 층, 플러그인의 MCP 등록.

정하지 않는 것: 메뉴와 창의 생김새, 공증·cask·formula 이전(3단계), 로그인 항목과 중계가 앱을 띄우는 동작(ADR-0010 의 미확인), 헬퍼 번들을 걷어 낸 뒤 `sherpa` 명령이 EventKit 에
닿는 길(§11).

판: 프레임은 `mux: 1`, 머리말은 `sherpa_app: 1`, 도구 결과는 `sherpa.mcp.tool-outcome.v1` 이다. 호환되지 않는
변경은 그 숫자를 올리고 이 문서의 새 판을 낸다. [계약]

## 2. 번들과 실행 파일

| `Sherpa.app/Contents/` 아래 | 역할 | 서명 식별자 | 권한 항목 |
| --- | --- | --- | --- |
| `MacOS/Sherpa` | 메뉴 막대 앱, macOS 권한 주체 | `dev.xiyo.sherpa` | calendars, Apple Events |
| `MacOS/sherpa-core` | Bun 코어. `sherpa` 명령과 같은 파일 | `dev.xiyo.sherpa.core` | 없음 |
| `MacOS/sherpa-relay` | Swift 중계 | `dev.xiyo.sherpa.relay` | 없음 |

- 셋 다 소유자의 Developer ID Application 인증서, hardened runtime, 보안 타임스탬프로 서명한다. 앱의 식별자와
  권한 항목, 권한 항목 없는 Bun 은 결정 그대로다. [소유자, ADR-0010 결정 1·4]
- 중계 식별자는 시험 빌드의 값이다. [실측] 코어 식별자는 이 계약이 정한다. 시험 빌드의 다중화 Bun 은 따로 만든
  `sherpa-mux`(`dev.xiyo.sherpa.mux`)였다. [계약]
- 도우미 실행 파일은 `Contents/MacOS/` 나 `Contents/Helpers/` 에 둔다. [문서: Apple, [Placing content in a
  bundle](https://developer.apple.com/documentation/bundleresources/placing-content-in-a-bundle)] 시험 빌드는
  셋을 모두 `Contents/MacOS/` 에 두고 공증을 받았다(Accepted, 문제 0건). [실측]
- 코어는 실행 파일 하나다. 앱이 띄우는 MCP 서버(`app serve` 하위 명령)와 사람이 셸에서 부르는 `sherpa` 가 같은
  파일이고, cask 는 `binary "#{appdir}/Sherpa.app/Contents/MacOS/sherpa-core", target: "sherpa"` 로 이 파일을
  `sherpa` 로 링크한다. 89 MB 인 Bun 실행 파일(`core/dist/sherpa`)을 두 번 싣지 않는다. [소유자 결정 5·6; 같은
  파일로 두는 것은 계약; 크기는 실측; `target:` 은 문서: [Homebrew Cask
  Cookbook](https://docs.brew.sh/Cask-Cookbook), "Stanza: binary"]
- 번들 안 이름이 `sherpa` 가 아니라 `sherpa-core` 인 것은 앱 실행 파일 `Sherpa` 와 같은 폴더에 있기 때문이다.
  이 Mac 의 기본 APFS 볼륨은 대소문자를 가리지 않아, `Sherpa` 를 만든 폴더에서 `sherpa` 를 열면 같은 파일이
  열린다. [실측; 이름은 계약]
- 세 실행 파일은 CLI 버전을 함께 쓴다. `sherpa-relay --version` 은 `sherpa-relay <버전>` 한 줄을 쓴다. 새로
  생기는 버전 위치는 그 파일을 만드는 작업이 `AGENTS.md` 의 버전 목록에 더한다. [계약]

### 번들 빌드

- 번들은 `apple/sherpa-app/Sherpa.xcodeproj` 의 `Sherpa` 스킴이 빌드한다(소유자 결정 2026-11-21, #49). 앱 타깃
  `Sherpa` 는 `apple/sherpa-app/App/` 의 SwiftUI 소스를 컴파일하고, 같은 폴더의 패키지 `apple/sherpa-app` 이 내는
  라이브러리 `SherpaAppConnection`·`SherpaAppServer`·`SherpaAppPlanner` 와 worker-protocol 의
  `SherpaWorkerProtocol` 을 로컬 패키지 의존성으로 링크한다. 명령 타깃 `sherpa-relay` 는 패키지의
  `Sources/SherpaRelay/main.swift` 를 그대로 컴파일하고 `SherpaRelayKit` 을 링크한다. 앱 타깃의 Embed Relay 복사
  단계(Executables, Code Sign On Copy)가 그것을 `Contents/MacOS/` 에 넣는다. 폴더는 동기화 그룹이라 소스 파일을
  더해도 `project.pbxproj` 가 바뀌지 않는다. [소유자; 동작은 실측: live-evidence 2026-11-21 "Sherpa.app built by
  an Xcode project"]
- 패키지의 `sherpa-relay`·시험 호스트·가짜 코어·가짜 앱은 패키지에 남는다. 프로세스 시험은 그것들을 `swift build`
  가 만든 그대로 띄운다(§13.2). [계약]
- 코어는 앱 타깃의 첫 단계 Embed Core(`apple/sherpa-app/scripts/embed-core.sh`)가 넣는다. Xcode 의 스크립트
  PATH 에는 bun 이 없어 이 단계는 코어를 빌드하지 않는다. xcodebuild 전에 `core/` 에서 `bun run build` 를
  한다. 단계는 빌드 설정 `SHERPA_CORE`(기본 `core/dist/sherpa`)를 `app serve </dev/null` 로 띄워 첫 줄이 채널 0
  의 Mux 1 인사이고 버전이 앱의 버전인지 본다. 아니면 `reason=core_not_mux` 로 빌드를 실패시키고, 번들에는
  서명도 실행 파일도 남지 않는다. 통과하면 식별자 `dev.xiyo.sherpa.core`, hardened runtime, 권한 항목 없이
  Xcode 가 앱에 고른 인증서(`EXPANDED_CODE_SIGN_IDENTITY`)로 서명해 `Contents/MacOS/sherpa-core` 에 둔다. [계약;
  동작은 실측]
- 스크립트 샌드박스(`ENABLE_USER_SCRIPT_SANDBOXING`)는 켜 둔다. 샌드박스 안에서도 코어는 실행된다. codesign 은
  대상 옆에 임시 파일을 써서 번들 안에서 서명하면 "Write permissions error" 로 실패하므로, 단계는 `TEMP_DIR` 의
  사본을 서명한 뒤 번들에 복사한다. [실측]
- Info.plist 는 Xcode 가 만든다(`GENERATE_INFOPLIST_FILE`). 사용 설명 세 개는 헬퍼의
  `apple/eventkit-service/Resources/Info.plist` 를 `INFOPLIST_FILE` 로 받는다. `LSUIElement` 는 빌드 설정이다. 판은
  `apple/sherpa-app/Version.xcconfig` 의 `MARKETING_VERSION` 이 `CFBundleShortVersionString` 과
  `CFBundleVersion` 이 된다. 생성된 판 키가 파일의 판 키를 덮어, `MARKETING_VERSION` 이 없으면 번들에서 판 키가
  사라지고 중계는 `version_unavailable`(70)로 끝났다. [실측]
- 릴리스 구성은 base entitlements 를 넣지 않는다(`CODE_SIGN_INJECT_BASE_ENTITLEMENTS = NO`). 넣으면 보통 빌드의
  릴리스 앱과 중계에도 `get-task-allow` 가 붙었다. 중계 타깃은 `ENTITLEMENTS_REQUIRED = NO` 다. 아니면 Xcode 가
  SDK 의 `Entitlements.plist` 에서 `com.apple.application-identifier`(`FN2KZ2J47B.`)를 넣었다. 중계 식별자는
  `OTHER_CODE_SIGN_FLAGS = --identifier dev.xiyo.sherpa.relay` 로 준다. 중계에는 Info.plist 를 박지 않는다.
  `Contents/MacOS/` 의 중계는 `Bundle.main` 으로 앱의 Info.plist 판을 읽는다. [실측]
- 아키텍처는 arm64 하나다. 코어(`bun-darwin-arm64`)가 arm64 뿐이라 Intel 에서 뜨는 앱은 코어를 띄우지 못한다.
  [계약]
- 에셋 카탈로그 `App/Assets.xcassets` 에 빈 AppIcon 자리를 둔다. 아이콘 그림은 소유자 몫이다. 메뉴 막대는 SF
  Symbol 을 쓴다. 빈 자리라 `Contents/Resources` 는 비어 있다. [소유자; 비어 있는 것은 실측]
- 배포본은 아카이브를 Developer ID 로 내보낸다. 내보내기는 세 실행 파일을 식별자·flags·runtime 을 지킨 채 다시
  서명하고 보안 타임스탬프를 붙인다. 공증과 cask 는 bunny-holes/sherpa#31 이다. [실측]

```sh
(cd core && bun run build)
xcodebuild build -project apple/sherpa-app/Sherpa.xcodeproj -scheme Sherpa -configuration Release \
  -destination 'generic/platform=macOS' -derivedDataPath apple/sherpa-app/.build/xcode
# 배포본: 아카이브와 Developer ID 내보내기
xcodebuild archive -project apple/sherpa-app/Sherpa.xcodeproj -scheme Sherpa -configuration Release \
  -destination 'generic/platform=macOS' -derivedDataPath apple/sherpa-app/.build/xcode \
  -archivePath apple/sherpa-app/.build/Sherpa.xcarchive
xcodebuild -exportArchive -archivePath apple/sherpa-app/.build/Sherpa.xcarchive \
  -exportOptionsPlist apple/sherpa-app/ExportOptions.plist -exportPath apple/sherpa-app/.build/export
```
- 에이전트의 MCP 설정은 설치된 앱 안 중계의 절대 경로를 가리키고 인자를 주지 않는다. 서버 이름은 `sherpa` 다.
  [계약; 같은 모양의 설정으로 두 에이전트가 시험 빌드 중계에 붙은 것은 실측] 플러그인은 이 설정을 아래
  "플러그인의 MCP 등록" 으로 등록한다.

```json
{"mcpServers": {"sherpa": {"command": "/Applications/Sherpa.app/Contents/MacOS/sherpa-relay", "args": []}}}
```

```toml
[mcp_servers.sherpa]
command = "/Applications/Sherpa.app/Contents/MacOS/sherpa-relay"
env = { CODEX_MCP_PROTOCOL_VERSION = "2026-07-28" }
```

- Codex 는 위 env 와 기능 `mcp_2026_07_28`(`codex features enable mcp_2026_07_28`)이 둘 다 있어야 2026-07-28 로 연다.
  하나라도 없으면 `initialize`(2025-06-18)로 열어 거부된다(§10.1). Claude Code 의 설정은 그대로다. [소유자 결정
  2026-11-22; 문서와 실측은 ADR-0011]

- 릴리스 빌드는 실행 경로, 소켓 경로, 서명 요건을 바꾸는 환경 변수나 인자를 읽지 않는다. 그런 변수가 있으면
  같은 사용자의 아무 프로세스나 `launchctl setenv` 로 앱이 다른 코드를 앱의 권한으로 실행하게 만들 수 있다.
  ADR-0010 이 닫으려는 권한 공유와 같은 구멍이다. [추론] 시험용 변수는 DEBUG 빌드에서만 읽는다(§13.2). [계약]
- 앱은 코어를 멈춘 채 띄운다(`posix_spawn` 의 `POSIX_SPAWN_START_SUSPENDED`). 그 자식은 SIGSTOP 을 받은 것처럼
  사용자 공간에서 실행을 시작하기 전에 멈춘다. [문서: macOS `posix_spawnattr_setflags(3)`] 앱은 그 자식의 실행
  중인 코드를 pid 로 얻어(`SecCodeCopyGuestWithAttributes` 와 `kSecGuestAttributePid`) §4 의 코어 요건으로
  `SecCodeCheckValidity` 하고, 통과한 뒤에만 SIGCONT 로 재개한다. 실패하면 SIGKILL 로 끝내고 거둔 뒤 다시 띄우지
  않는다(`core_failed`). 앱이 아직 거두지 않은 자식이므로 그 pid 는 다른 프로세스를 가리킬 수 없다. [계약]
- 실행 전에 경로의 정적 서명을 확인하는 단계는 두지 않는다. 경로를 확인한 뒤 같은 경로를 따로 띄우면 그 사이에
  다른 파일이 들어올 수 있다. DEBUG 시험 호스트에서 서명된 가짜 코어와 서명 없는 파일을 바꿔치기하자 16번 중
  3번 서명 없는 파일이 앱의 권한으로 실행됐다. [실측: PR #45 리뷰, 2026-11-21]
- 실행 중 확인은 이 Mac 에서 다음과 같았다. [실측: `docs/testing/live-evidence.md` 2026-11-21 "PR #45 review
  fixes"]
  - 코어 자리의 서명 없는 셸 스크립트는 실행 중인 코드가 `/bin/sh` 라 -67050(`errSecCSReqFailed`)으로
    거부된다.
  - 멈춘 뒤 경로의 파일을 서명된 사본으로 바꾸면 -67034(`errSecCSStaticCodeChanged`, 디스크의 코드가 실행
    중인 코드와 다름)로 거부된다.
  - 멈춘 자식은 SIGKILL 을 받으면 재개되지 않은 채 10 ms 안에 끝나 거둬진다. 시험 스크립트의 표식 파일은 생기지
    않았다.
  - Developer ID 로 서명하고 hardened runtime 을 켠 89 MB 코어의 실행 중 확인은 9–15 ms 걸렸다. 같은 코어의
    정적 확인(`kSecCSCheckAllArchitectures | kSecCSStrictValidate`)은 290–550 ms 였다.

### MCP 켜기와 연결 안내

소유자 요청(2026-11-22, bunny-holes/sherpa#54): 앱을 띄우면 MCP 를 켜는 곳과 에이전트를 연결하는 방법이 있게 한다. 아래
기본값은 그 이슈의 제안이다. [소유자 요청; 기본값은 계약]

- 앱에는 MCP 스위치가 있다. 켜져 있을 때만 에이전트가 중계로 붙는다. 값은 앱의 defaults(도메인 `dev.xiyo.sherpa`)
  의 Bool `mcpEnabled` 이고, 값이 없으면 꺼짐이다. 그래서 첫 실행은 꺼진 채 시작한다. 앱은 뜰 때 한 번 읽고, 사람이
  스위치를 바꾸면 쓴다. [계약; 구현은 `SherpaAppServer` 의 `MCPSetting`]
- 이 값은 같은 사용자 범위의 동의 표시이지 보안 경계가 아니다. 같은 사용자의 프로세스는
  `defaults write dev.xiyo.sherpa mcpEnabled -bool true` 로, 또는 앱을 실행 인자 `-mcpEnabled YES` 로 띄워 켤 수 있다.
  그 프로세스는 중계를 스스로 띄울 수도 있으므로 믿는 범위가 넓어지지 않는다(§4 "믿는 범위", bunny-holes/sherpa#39).
  위의 "릴리스 빌드는 실행 경로, 소켓 경로, 서명 요건을 바꾸는 환경 변수나 인자를 읽지 않는다" 는 앱이 다른 코드를
  실행하게 하는 값에 대한 규칙이고, 이 스위치는 그런 값이 아니다. [계약; 실행 인자는 실측: 2026-11-22
  `UserDefaults.standard` 를 읽는 시험 프로그램이 `-mcpEnabled YES` 로 true, 인자 없이 false 를 읽었다]
- 스위치는 메뉴 막대 메뉴(체크 항목 "MCP Server")와 상태 창의 MCP 줄에 있다. 앱은 첫 실행과, MCP 가 꺼진 채 뜰 때마다
  상태 창을 연다. 스위치가 없던 판에서 올린 앱은 첫 실행 표시가 이미 남아 있어도 꺼진 채 시작하기 때문이다. [계약]
- 꺼져 있으면 앱은 중계의 서명을 확인한 뒤 머리말 `unavailable`·`mcp_disabled` 로 돌려보낸다(§5). 켜 있다가 끄면
  열린 중계 연결을 모두 닫고(§7.6), 떠 있는 확인 창을 답 없이 닫는다(§9). 꺼져 있는 동안에도 코어는 돈다. [계약]
- 상태 창의 본문은 머리(아이콘, 버전, 코어 상태), MCP 줄, 권한 목록만 둔다. MCP 줄은 스위치와 짧은 상태(`Off`, 또는
  `On · <연결된 중계 수> connected`)만 보인다. 켜고 끌 때 일어나는 일과 메뉴 막대 아이콘을 찾는 안내는 그 줄과 머리의
  툴팁(SwiftUI `.help`)에 둔다. [계약; 소유자 결정 2026-11-22: "화면을 설명으로 덮어버리지마라"]
- 에이전트 연결 방법은 MCP 가 켜져 있을 때 MCP 줄에 보이는 macOS 표준 도움말 단추("?", SwiftUI `HelpLink`, macOS 14
  이상)를 눌러 여는 팝오버에만 있다. 끄면 단추와 팝오버가 함께 사라진다. [계약; 소유자 결정 2026-11-22: "mcp를 활성화
  하면 연결 방법은 ?를 통해서 직접 보게해라"]
- 연결 방법은 이 앱으로 잰 클라이언트인 Claude Code 와 Codex 만 적는다. 명령은 앱의 실제 중계 경로(`Bundle.main` 의
  `Contents/MacOS/sherpa-relay`)로 만들고, 경로에 셸이 특별히 읽는 글자가 있으면 작은따옴표로 감싼다. 명령과 중계
  경로는 줄을 바꿔 전부 보이고 "…" 로 자르지 않으며(bunny-holes/sherpa#52), 선택할 수 있고, 저마다 복사 단추가 그 글을
  그대로 복사한다. 앱은 에이전트의 설정 파일을 고치지 않는다. [계약; 구현은 `SherpaAppServer` 의 `AgentSetup`,
  `App/StatusSections.swift`]

| 에이전트 | 연결 방법의 명령 | 근거 |
| --- | --- | --- |
| Claude Code | `claude mcp add --scope user sherpa -- <중계 경로>` | 문서: [Claude Code MCP](https://code.claude.com/docs/en/mcp), "Option 3"(`--` 뒤는 서버 명령 그대로)와 "User scope". 실측(live-evidence 2026-11-22 "Agent registration commands"): 2.1.326 의 `claude mcp add --help`. 빈 임시 `CLAUDE_CONFIG_DIR` 의 `.claude.json` 에 `"sherpa": {"type":"stdio","command":"<중계 경로>","args":[],"env":{}}` 를 썼다 |
| Codex | `codex features enable mcp_2026_07_28`, 이어 `codex mcp add --env CODEX_MCP_PROTOCOL_VERSION=2026-07-28 sherpa -- <중계 경로>` | 실측(같은 기록): 0.171.0 의 `codex mcp add --help`, `codex features enable --help`. 빈 임시 `CODEX_HOME` 의 `config.toml` 에 `[mcp_servers.sherpa]` 의 `command`, `[mcp_servers.sherpa.env]` 의 `CODEX_MCP_PROTOCOL_VERSION = "2026-07-28"`, `[features]` 의 `mcp_2026_07_28 = true` 를 썼다. 기능과 env 의 근거는 ADR-0011 |

- 플러그인(`sherpa@plug-hole`)의 등록은 연결 방법 팝오버에 "플러그인을 쓰면 서버를 등록해 준다" 한 줄만 둔다. 그 방식은
  아래 "플러그인의 MCP 등록" 이다(bunny-holes/sherpa#55). [계약]

### 플러그인의 MCP 등록

- 플러그인 `sherpa@plug-hole`(`plugins/sherpa/`)은 루트의 `.mcp.json` 하나로 서버 `sherpa` 를 등록한다. 두
  에이전트가 같은 파일을 읽는다. Claude Code 는 플러그인 루트의 `.mcp.json` 을 기본으로 읽고, Codex 는
  `.codex-plugin/plugin.json` 의 `"mcpServers": "./.mcp.json"` 으로 읽는다. Claude 매니페스트는 `mcpServers` 를
  적지 않는다. [문서: Claude Code [Add components to a plugin](https://code.claude.com/docs/en/plugins/components), "MCP
  servers"; OpenAI [Package your plugin](https://developers.openai.com/codex/plugins/build); 실측: live-evidence
  2026-11-22 "The plugin's `.mcp.json`"]

```json
{"mcpServers": {"sherpa": {"command": "/Applications/Sherpa.app/Contents/MacOS/sherpa-relay", "args": [],
  "env": {"CODEX_MCP_PROTOCOL_VERSION": "2026-07-28"}}}}
```

- env 는 Codex 몫이다(ADR-0011). Claude Code 에서는 이 값이 있어도 협상이 2026-07-28 그대로였다. 릴리스 중계는
  환경 변수를 읽지 않는다(위 "릴리스 빌드는"). [실측]
- 경로는 `/Applications/Sherpa.app` 하나다. 플러그인은 다른 곳의 앱을 찾지 않고 찾는 실행기도 두지 않는다. 앱이
  그 자리에 없으면 Claude Code 는 `ENOENT … posix_spawn` 으로, Codex 는 `MCP startup failed: No such file or
  directory (os error 2)` 로 서버를 실패로 둔다. Claude Code 는 시작 화면에 알리지 않는다. 실패한 플러그인 stdio
  서버는 15분 동안 새 세션이 띄우지 않는다(디버그 로그 `Skipping connection (recent failure cached…)`). [실측] `/mcp`
  에서 Reconnect 하면 기다리지 않고 다시 잇는다. 이 건너뜀은 플러그인이 낸 stdio 서버에만 있다. [문서: Claude Code
  [Error reference](https://code.claude.com/docs/en/errors), "Skipping connection"]
- 도구 이름은 Claude Code 에서 `mcp__plugin_sherpa_sherpa__<도구>`, Codex 에서 `mcp__sherpa__<도구>` 다. [문서:
  Claude Code MCP(§10.3); Codex 는 openai/codex 0.171.0 소스] 사람이 같은 중계를 같은 명령으로 직접 등록하면 Claude
  Code 는 플러그인 서버를 중복으로 보고 사용자 범위의 정의 하나만 이어, 도구가 `mcp__sherpa__<도구>` 가 된다.
  [문서: Claude Code MCP, "Scope hierarchy and precedence"] Codex 는 사용자 설정의 `[mcp_servers.sherpa]` 가 같은
  이름의 플러그인 서버보다 앞선다. [문서: openai/codex 0.171.0 소스] 스킬은 두 앞머리를 다 적는다. [계약]
- 스킬은 Sherpa CLI 를 부르지 않는다. 사람이 전체 디스크 접근이 있는 터미널에서 한 번 돌리는 `sherpa kakaotalk
  setup` 만 안내한다(§10.2 가 MCP 에서 뺐다). 그래서 플러그인에는 CLI 버전 가드와 SessionStart 훅이 없다. 게이트는
  스킬이 적은 도구 이름을 코어의 도구 등록부(`core/src/mcp/registry.ts`, `core/src/mcp/core-tools.ts`)와 맞춰 보고
  (`plugins/sherpa/scripts/checks/verify_tools.py`), `.mcp.json` 이 위 모양인지 본다(`plugins/sherpa/scripts/check.sh`).
  [계약]

## 3. 소켓

- 경로는 `~/Library/Application Support/Sherpa/run/app.sock`, 잠금 파일은 같은 폴더의 `app.lock` 이다. [계약]
  바깥 폴더는 기록부(`native.sqlite3`)와 KakaoTalk 체크포인트가 이미 쓰는 Sherpa 데이터 폴더이고 코어가 0700
  으로 만든다. [실측: `core/src/journal/journal.ts`] `/tmp` 와 `$TMPDIR` 는 쓰지 않는다. 시험 빌드는 임시
  폴더에 소켓을 뒀다. [실측]
- 홈 폴더는 `$HOME` 이 아니라 사용자 데이터베이스(`getpwuid_r(getuid())`)에서 얻는다. 에이전트가 `HOME` 을
  바꿔 중계를 띄워도 앱과 같은 경로를 찾게 하려는 것이다. [계약]
- 길이: `sockaddr_un.sun_path` 는 끝의 NUL 을 포함해 104 바이트다. [문서: macOS SDK `sys/un.h`] 이 경로는
  `/Users/<이름>` 홈에서 55 바이트에 이름을 더한 길이라 이름이 48 바이트까지 들어간다. 앱과 중계는
  bind·connect 전에 UTF-8 바이트 길이를 재고, 103 바이트를 넘으면 앱은 듣지 않고 상태를 `socket_failed` 로
  두며 중계는 78 로 끝난다. 짧은 다른 경로로 몰래 바꾸지 않는다. [계약]
- 폴더: 앱이 `run/` 을 0700 으로 만든다. `lstat` 으로 심볼릭 링크가 아닌 폴더이고 소유자가 자신인지 보고,
  모드만 다르면 0700 으로 고친다. 소유자가 다르거나 링크면 듣지 않고 `socket_failed` 로 둔다. [계약]
- 소켓 파일은 bind 직후 0600 으로 바꾼다. listen 대기열은 16 이다. [실측: 시험 빌드 값] 다른 사용자는 0700
  폴더를 지나지 못하므로 bind 와 chmod 사이의 틈으로 들어올 수 없다. [추론]
- 단일 인스턴스: 앱은 시작하자마자 `app.lock` 을 열어(`O_CREAT|O_RDWR|O_CLOEXEC`, 0600)
  `flock(LOCK_EX|LOCK_NB)` 을 잡고 끝날 때까지 쥔다. 이미 잡혀 있으면 다른 앱이 떠 있는 것이므로 info 로그를
  남기고 0 으로 끝난다. Launch Services 의 단일 실행만으로는 부족하다. `open -n` 이나 실행 파일을 직접
  실행하면 둘째 프로세스가 뜬다. 시험 빌드는 `open -n` 으로 앱을 여러 번 띄웠다. [계약; `open -n` 은 실측]
- 오래된 소켓: 잠금을 쥔 앱만 살아 있는 리스너일 수 있으므로, 잠금을 잡은 뒤 남아 있는 `app.sock` 은 오래된
  것이다. 앱은 그것을 지우고 bind 한다. 앱이 죽으면 커널이 잠금을 풀고 소켓 파일만 남는다. 그 사이 중계는
  `ECONNREFUSED` 를 받아 69 로 끝난다. [계약]
- 시작 순서: 잠금 → 폴더 확인 → bind·listen → 코어 실행 → 코어 인사 대기. 코어가 준비되기 전에 온 연결은
  10초까지 기다리게 하고, 그 안에 준비되지 않으면 머리말 `unavailable`·`core_starting` 으로 돌려보낸다. [계약]
  Codex 는 서버 시작을 `startup_timeout_sec`(기본 10초)까지 기다린다. [문서: Codex MCP] 시험 빌드의 MCP
  프로브는 `tools/list` 응답까지 31–36 ms 였다. [실측] 코어가 이미 떠 있으면 연결은 그 안에 끝나고, 코어를
  처음 띄우는 동안 온 Codex 연결은 그 한도에 걸릴 수 있다. [추론]
- 정상 종료: 리스너를 닫고 소켓 파일을 지우고 잠금 파일 설명자를 닫는다. [계약]
- 동시 세션은 16 개까지다. 넘치는 연결은 머리말 `unavailable`·`too_many_sessions` 로 돌려보낸다. [계약] 실측은
  동시 3개, 8분 동안 연이어 48개다. [실측]
- 소켓과 파이프를 읽는 루프는 반복마다 autorelease 풀을 비운다. 시험 빌드의 첫 20분 실행에서 풀 없는 읽기
  스레드가 호스트를 약 78 MB 키웠고, 풀을 넣은 뒤에는 8분 동안 5.2 MB 로 고정됐다. [실측]

## 4. 서명 확인

- 방법은 양방향이 같다. 연결된 소켓에서 `getsockopt(fd, SOL_LOCAL, LOCAL_PEERTOKEN)`(각각 0, 0x006)로 상대의
  감사 토큰을 얻고, `SecCodeCopyGuestWithAttributes` 에 `kSecGuestAttributeAudit` 로 넘겨 코드 객체를 얻은 뒤,
  `SecRequirementCreateWithString` 으로 만든 요건을 `SecCodeCheckValidity` 로 확인한다. [실측: 시험 빌드가
  양쪽에서 이 순서로 확인했다; 상수는 문서: macOS SDK `sys/un.h`] PID 대신 감사 토큰을 쓰는 것은 PID 재사용을
  피하려는 것이다. [추론]
- 서명보다 먼저 감사 토큰의 실효 uid(`audit_token_to_euid`)가 자기 uid 와 같은지 본다. 같은 서명을 단 다른
  사용자의 프로세스를 가른다. [계약]
- 때: 중계는 connect 직후, 아무것도 읽거나 쓰기 전에 앱을 확인한다. 앱은 accept 직후, 머리말을 쓰거나 채널을
  열기 전에 중계를 확인한다. [실측: 시험 빌드의 순서]
- 요건 문자열. `<TEAM_ID>` 는 소유자 Developer ID 의 팀, 곧 인증서 leaf 의 OU 열 글자다.

| 확인하는 쪽 → 대상 | 요건 | 근거 |
| --- | --- | --- |
| 중계 → 앱 | `anchor apple generic and certificate leaf[subject.OU] = "<TEAM_ID>" and identifier "dev.xiyo.sherpa"` | 실측: 시험 빌드 중계 설정의 문자열. 가짜 서버는 거부(77) |
| 앱 → 중계 | `anchor apple generic and certificate leaf[subject.OU] = "<TEAM_ID>" and identifier "dev.xiyo.sherpa.relay"` | 실측: 이 식별자의 Developer ID 중계는 통과, ad-hoc 중계와 서명 없는 직접 연결은 거부 |
| 앱 → 코어 (멈춘 자식의 실행 중 코드, 재개 전) | `anchor apple generic and certificate leaf[subject.OU] = "<TEAM_ID>" and identifier "dev.xiyo.sherpa.core"` | 계약: §2 |

- 요건에 코드 해시를 넣지 않는다. 업그레이드한 바이너리도 같은 요건을 만족해야 한다. ADR-0009 의 지정 요건과
  같은 이유다. [실측: ADR-0009] `anchor apple generic` 과 팀 OU 만 보므로 같은 팀의 Apple Development 인증서로
  서명한 소유자의 개발 빌드도 통과한다. [추론]
- 팀 ID 는 소스의 상수 하나에서 앱과 중계에 컴파일해 넣고, 실행 중에는 바꿀 수 없다. 패키징 단계는
  `codesign -d -r-` 로 앱과 중계의 지정 요건에 같은 팀과 식별자가 있는지 확인한다. [계약] 팀 ID 는
  `FN2KZ2J47B` 이고 소스 상수로 커밋한다. 서명된 실행 파일마다 보이는 공개 값이다. [소유자 결정 2026-11-21;
  값은 실측: 시험 빌드 요건]
- 실패: 중계는 77 로 끝나고, 앱은 머리말 `refused` 를 쓰고 연결을 닫는다(§5). 양쪽 다 상대의 pid 와 서명
  식별자를 warn 로그로 남기고, MCP 바이트는 한 바이트도 보내지 않는다. [계약]

### 믿는 범위

- 서명 확인이 증명하는 것은 소켓 상대가 같은 사용자이고 같은 팀의 정해진 실행 파일이라는 것뿐이다. 누가 그
  실행 파일을 띄웠는지는 가리지 않는다. 같은 사용자의 아무 프로세스나 설치된 `sherpa-relay` 를 띄워 MCP
  도구를 부를 수 있다. [추론: 중계는 누구나 실행할 수 있는 실행 파일이고 앱은 중계의 서명만 본다. 재현 안 함]
- 1판은 같은 사용자를 믿는 범위 안에 둔다. [소유자 결정 2026-11-21] 1판이 막는 것은 다른 사용자(uid 확인),
  바뀌거나 가짜인 앱·중계·코어(서명 요건), 환경 변수나 인자로 경로와 요건을 바꾸는 것(§2), 사람 확인 없는
  삭제와 보내기(§9)다. 막지 않는 것은 같은 사용자의 프로세스가 중계를 거쳐 읽기·만들기·고치기 도구를 부르는
  것이다. [계약]
- 지금 헬퍼는 같은 사용자의 프로세스가 `dev.xiyo.sherpa` 의 Calendar·Reminders 권한으로 삭제까지 사람 확인
  없이 하게 둔다. [추론, ADR-0010 맥락] 1판은 이 범위를 좁히지만 닫지는 않는다. 중계를 띄운 프로그램을 앱이
  처음 한 번 사람에게 허용받는 방식은 후속 작업이다(bunny-holes/sherpa#39).

## 5. 앱 머리말

중계가 "앱이 거부했다", "앱은 있지만 코어가 없다", "정상 종료" 를 가르려면 앱이 먼저 한 줄을 말해야 한다. 시험
빌드에는 머리말이 없었다. [계약]

- 앱은 중계의 서명 확인을 마치면 MCP 바이트보다 먼저 JSON 한 줄(1 KiB 이하, LF 로 끝)을 쓴다. 키는 정확히
  넷이다. [계약]

```json
{"sherpa_app":1,"status":"ready","reason":null,"version":"0.9.0"}
```

| `status` | `reason` | 그 뒤 |
| --- | --- | --- |
| `ready` | `null` | 양방향으로 바이트를 옮긴다 |
| `refused` | `peer_signature`, `peer_user` | 앱이 닫는다 |
| `unavailable` | `mcp_disabled`, `core_starting`, `core_failed`, `core_incompatible`, `too_many_sessions`, `shutting_down` | 앱이 닫는다 |

- 앱은 중계의 서명을 확인한 뒤 이 순서로 본다: 끝나는 중(`shutting_down`), MCP 스위치(`mcp_disabled`, §2 "MCP 켜기와
  연결 안내"), 세션 수(`too_many_sessions`), 코어(`core_*`, 10초까지 기다림). 코어를 기다리는 동안 MCP 가 꺼지면
  `mcp_disabled` 로 답한다. 서명이 맞지 않는 연결은 스위치와 상관없이 `refused` 다. [계약]
- 중계는 모르는 사유도 사유 모양(소문자와 `_`, 1–64 바이트)이면 받아들여 `status` 대로 끝난다. `unavailable` 은 75,
  `refused` 는 77 이고, 그때 `remedy` 는 일반 문구다. 모양이 아니면 76 이다. 그래서 사유를 더하는 것은 호환되는
  변경이고 `sherpa_app` 판을 올리지 않는다. [계약; 동작은 `AppPreface.read` 와 `RelayExitTable`, 시험은 §13.2]

- 중계는 머리말을 표준 출력에 쓰지 않는다. MCP 서버의 표준 출력에는 MCP 메시지만 써야 한다. [문서: MCP
  2026-07-28 [stdio](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio), "The server MUST NOT write anything to its stdout that is
  not a valid MCP message"]
- 중계는 머리말을 15초까지 기다린다. 앱이 코어 준비를 기다리는 10초보다 길다. [계약]
- `ready` 뒤 앱은 중계에서 읽은 바이트를 LF 로 잘라 한 줄을 `data` 프레임 하나로 코어에 보내고, 코어가 보낸
  `data` 본문 끝에 LF 를 붙여 중계에 쓴다. 빈 줄은 보내지 않는다. [실측: 시험 빌드의 줄 단위 전달; 빈 줄
  규칙은 계약]

## 6. 중계

- 인자는 받지 않는다. `--version` 과 `--help` 만 알고, 그 밖의 인자는 64 로 끝난다. 시험 빌드는 소켓 경로와
  요건을 인자로 받았다. 이 계약은 둘을 중계 안에 고정한다(§2). [계약]
- 흐름: 경로 계산 → connect → 서명 확인 → 머리말 → 양방향 복사. 복사는 MCP 를 해석하지 않고 64 KiB 단위로
  읽는다. [실측: 시험 빌드의 동작과 버퍼 크기]
- 표준 입력이 EOF 가 되면 소켓의 쓰기 쪽을 닫고(`shutdown(SHUT_WR)`), 소켓이 EOF 가 될 때까지 읽어 옮긴 뒤 0
  으로 끝난다. [실측]
- 표준 입력이 열린 채 소켓이 EOF 가 되면 앱이 세션을 끝낸 것이다. 75 로 끝난다. [계약]
- `SIGPIPE` 는 무시한다. 표준 출력의 `EPIPE` 는 에이전트가 떠난 것으로 보고 소켓을 닫고 0 으로 끝난다. [계약]
- 신호 처리기는 두지 않는다. 기본 종료가 소켓을 닫고, 앱은 그것을 연결의 끝으로 다룬다. Claude Code 는 stdio
  서버를 SIGINT, 100 ms 뒤 SIGTERM, 다시 400 ms 뒤 SIGKILL 로 멈춘다. [문서: [Claude Code
  MCP](https://code.claude.com/docs/en/mcp)]
- 중계는 앱을 띄우지 않는다. [계약; 앱 자동 실행은 ADR-0010 의 미확인]

### 종료 코드

`sysexits.h` 의 값을 쓴다.

| 코드 | 이름 | 뜻 | 근거 |
| --- | --- | --- | --- |
| 0 | — | 정상 종료. 에이전트가 입력을 닫았고 앱이 뒤이어 닫았거나, 에이전트가 떠났다 | 계약 |
| 64 | `EX_USAGE` | 알 수 없는 인자 | 계약 |
| 69 | `EX_UNAVAILABLE` | 앱이 떠 있지 않다. 소켓이 없다(`ENOENT`) 또는 거부됐다(`ECONNREFUSED`) | 실측 |
| 70 | `EX_SOFTWARE` | 중계 내부 오류 | 계약 |
| 74 | `EX_IOERR` | 소켓이나 표준 입출력의 EOF·`EPIPE` 아닌 입출력 오류 | 계약 |
| 75 | `EX_TEMPFAIL` | 앱은 있지만 세션을 열 수 없거나 앱이 세션을 끝냈다. 머리말 `unavailable`(MCP 가 꺼진 `mcp_disabled` 포함), 머리말 15초 초과, 입력이 열린 채 소켓 EOF(MCP 를 끄거나 코어가 끝나 앱이 닫음) | 계약 |
| 76 | `EX_PROTOCOL` | 머리말이 없거나 JSON 이 아니거나 `sherpa_app` 이 1 이 아니다 | 계약 |
| 77 | `EX_NOPERM` | 앱 서명이 요건에 맞지 않는다. 또는 앱이 이 중계를 거부했다(머리말 `refused`) | 앞은 실측, 뒤는 계약 |
| 78 | `EX_CONFIG` | 소켓 경로가 103 바이트를 넘는다 | 계약 |

### 표준 오류

- 형식은 코어 로그와 같다: `<수준> [relay:<모듈>:<동작>] 키=값 …`. 0 이 아닌 코드로 끝나기 직전에 error 한
  줄을 반드시 쓰고 `reason` 과 사람이 할 일 `remedy` 를 단다. 예:
  `error [relay:socket:connect] reason=app_not_running remedy="start Sherpa.app"`. [계약] 시험 빌드는
  `app_not_running` 과 `server_signature_rejected` 를 썼다. [실측]
- MCP 가 꺼진 앱에 붙으면 75 로 끝나며 이 줄을 쓴다:
  `error [relay:preface:read] reason=app_unavailable app_reason=mcp_disabled remedy="turn on MCP in Sherpa.app, then reconnect the server (Claude Code: /mcp, then Reconnect; Codex: start a new session)"`.
  켜진 채 연결된 중계는 사람이 MCP 를 끄면 75 로 끝나며 아래 줄을 쓴다. 중계는 앱이 왜 닫았는지 모르므로 MCP 를 끈
  경우를 먼저 적는다:
  `error [relay:session:copy] reason=app_closed_session remedy="if you turned MCP off in Sherpa.app, turn it on first; then reconnect the server (Claude Code: /mcp, then Reconnect; Codex: start a new session)"`.
  모르는 사유의 `remedy` 는 `restart Sherpa.app, then reconnect` 다. [계약]
- 다시 붙는 법은 에이전트가 앞선 실패를 기억하든 아니든 맞게 적는다. Claude Code 는 `/mcp` 의 Reconnect, Codex 는 새
  세션이다. 앱의 연결 방법(§2)도 같다. [계약]
- MCP 가 꺼진 앱(75)이나 떠 있지 않은 앱(69)에서 중계가 끝나면 Claude Code 2.1.326 대화형은 그 시도 안에서 서버를 옛
  규격으로 고정해 한 번 다시 띄운다. 다시 띄운 중계는 `initialize`(2025-11-25)를 받고 같은 이유로 끝난다. 플러그인 범위,
  사용자 범위, `--mcp-config` 동적 서버가 같았다. 로그는 다음 순서다. [실측: live-evidence 2026-11-22 "Claude Code
  against a relay turned away", "Claude Code and Codex after a relay that ended"]
  - `version negotiation probe closed the stdio server (rmcp-class pre-init hard close); respawning pinned legacy`
  - 중계의 줄을 담은 `Server stderr:`
  - `Connection failed (CONNECTION_CLOSED)`
- 그 고정은 그 시도로 끝난다. 75·69 뒤에 Claude Code 는 7일 생략의 기억(설정 폴더의
  `state/mcp-discover-verdicts.json`)을 남기지 않았고, 다음 시도는 다시 `server/discover` 부터 물었다. 플러그인 범위는
  실패를 15분 실패 캐시(`mcp-needs-auth-cache.json`)에 적어 그동안 새 세션이 서버를 띄우지 않는다(§2). 사용자 범위와
  동적 서버는 적지 않았다. MCP 를 켠 뒤에는 `/mcp reconnect <서버>` 와 새 세션(플러그인 범위는 15분 뒤)이 `protocolEra`
  `modern` 으로 붙었고, 붙은 연결이 그 서버의 실패 캐시 항목을 지웠다. `/mcp` 에는 `CONNECTION_CLOSED: Connection
  closed` 만 보이고 remedy 는 MCP 로그에만 있다. [실측: live-evidence 2026-11-22 "Claude Code and Codex after a relay
  that ended"]
- 7일 생략의 기억은 `server/discover` 에 3초 안에 답하지 않고 30초 연결 시한까지 끝나지도 않는 서버에만 생겼다. 기억된
  서버가 켜진 앱에 붙으면 Claude Code 는 probe 없이 `initialize` 를 보내고, 코어의 -32022 를 받자 기억을 지우고 같은
  연결에서 `server/discover` 로 다시 띄워 붙었다. [실측: 같은 기록]
- Codex 0.171.0(기능과 env 를 켬)은 `server/discover` 뒤 끝난 중계를 다시 띄우지 않고 `connection closed: discover
  response` 로 실패로 둔다. remedy 는 Codex 가 보이는 오류에 없고 app-server 의 `INFO` 로그(`MCP server stderr`)에만
  있다. 새 스레드는 새 중계를 띄워 `server/discover` 부터 물었고, MCP 를 켠 뒤에는 붙었다. [실측: 같은 기록]
- MCP 내용과 소켓의 절대 경로(사용자 이름이 들어 있다)는 쓰지 않는다. 경로는 `socket=default` 또는
  `socket=override` 로만 적는다. [계약]
- `LOG_LEVEL` 을 따르고 기본은 warn 이다. [계약]

## 7. 앱과 코어 사이 프레임

### 7.1 코어 실행

- 앱은 코어 하나를 `Contents/MacOS/sherpa-core app serve` 로 띄우고 표준 입력·출력·오류를 파이프로 잇는다.
  코어는 소켓을 열지 않고 이 파이프만 읽는다. [소유자, ADR-0010 결정 2]
- 환경은 물려주지 않는다. `HOME`, `TMPDIR`, `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, `LOG_LEVEL` 만 넘긴다.
  [계약]
- 앱이 띄운 자식은 앱의 전체 디스크 접근 권한으로 판정된다. [실측] 코어가 띄우는 `osascript` 의 Apple Events
  가 앱의 권한과 hardened runtime 항목으로 판정되는지는 재지 않았다. [미확인]

### 7.2 문법

```text
frame   = channel HTAB type [HTAB body] LF
channel = "0" / (%x31-39 *15DIGIT)    ; 10진수, 앞자리 0 없음, 2^53-1 이하
type    = 1*16(%x61-7A / "-")         ; 소문자
body    = 1*(%x00-09 / %x0B-FF)       ; LF 없는 UTF-8 JSON 값 하나
```

- 채널 0 은 제어 채널이고, 1 이상은 MCP 연결 하나다. 앱이 연결을 받을 때마다 1 부터 올려 매기고, 코어 프로세스
  하나가 사는 동안 다시 쓰지 않는다. 번호는 늘 커진다. 앞서 쓴 번호보다 작은 `open` 은 `mux.unexpected_frame`
  이다. [계약]
- 시험 빌드의 프레임은 `<id>\t<payload>\n` 이었다. 번호는 `c1`·`c2`…, 본문은 낱말 `open`·`close` 또는 JSON-RPC
  메시지 하나였다. [실측] 바꾼 점과 이유: 형식 칸을 따로 둬 본문이 낱말인지 JSON 인지 짐작하지 않는다. 작업
  요청과 확인 요청을 실을 제어 채널이 필요하다. 번호를 숫자로 해 해석을 단순하게 한다. MCP 메시지 하나가 한
  줄이라는 성질은 그대로 쓴다. MCP stdio 메시지는 줄바꿈으로 구분되고 안에 줄바꿈을 담지 않는다. [계약; 문서:
  MCP 2026-07-28 stdio, "Messages are delimited by newlines, and MUST NOT contain embedded newlines"]

### 7.3 형식

| 채널 | 형식 | 방향 | 본문 | 뜻 |
| --- | --- | --- | --- | --- |
| 0 | `hello` | 코어 → 앱 | `{"mux":1,"version":"…"}` | 코어 준비 끝. 코어의 첫 프레임 |
| 0 | `hello` | 앱 → 코어 | `{"mux":1,"version":"…","workers":["planner"]}` | 앱이 받아들였다. 앱의 첫 프레임 |
| 0 | `request` | 코어 → 앱 | §8 | 앱 작업 요청 |
| 0 | `response` | 앱 → 코어 | §8 | 작업 응답 |
| 0 | `confirm` | 코어 → 앱 | §9 | 사람 확인 요청 |
| 0 | `confirmation` | 앱 → 코어 | §9 | 확인 결과 |
| 0 | `withdraw` | 코어 → 앱 | `{"id":N}` | 확인 요청을 거둔다 |
| 0 | `fatal` | 코어 → 앱 | `{"code":"mux.…"}` | 코어가 프로토콜 위반으로 곧 끝난다 |
| 1 이상 | `open` | 앱 → 코어 | 없음 | 확인된 중계 연결이 생겼다 |
| 1 이상 | `data` | 양방향 | MCP JSON-RPC 메시지 하나 | |
| 1 이상 | `close` | 양방향 | 없음 또는 `{"reason":"…"}` | 연결의 끝 |

- 같은 파이프에 쓰는 프레임은 한 덩이로 쓰고 서로 끼어들지 않게 한다. [계약]
- 표에 없는 조합(채널 0 의 `data`, MCP 채널의 `hello` 등), 문법 위반, 인사 전의 다른 프레임, 살아 있는 채널의
  두 번째 `open` 은 프로토콜 위반이다. 코어는 `fatal` 을 쓰고 65 로 끝난다. 앱은 코어 출력에서 위반을 보면
  코어를 끝낸다(§7.8 의 재시작 규칙을 따른다). [계약]
- `fatal` 의 코드: 문법이나 본문 모양 오류, 그리고 V2 모양이나 상관 값이 맞지 않는 `response` 본문은
  `mux.frame_invalid`, 한도 초과는 `mux.frame_too_large`, 표나 순서 위반(채널·방향에 없는 형식, 인사 전 프레임,
  두 번째 `open`·`hello`, 닫힌 번호의 `open`)은 `mux.unexpected_frame`, 앱 `hello` 의 `mux` 가 1 이 아니면
  `mux.version_unsupported` 다. 앱은 코드와 상관없이 같은 규칙으로 코어를 다룬다. [계약]
- 닫힌 채널이나 모르는 채널의 `data`·`close` 는 닫기와 엇갈린 것이므로 위반이 아니다. debug 로그만 남기고
  버린다. [계약]
- `data` 본문이 JSON 이 아니면 프레임 위반이 아니라 그 연결의 MCP 오류다. 코어는 그 채널에
  `{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}` 를 보내고 연결을 유지한다.
  [계약]

### 7.4 크기

| 대상 | 본문 한도 | 근거 |
| --- | --- | --- |
| `data` (양방향) | 4 MiB | 계약. 도구 결과 1 MiB(§10.5)가 text 와 `structuredContent` 로 두 번 실려도 들어간다 |
| `request` | 64 KiB + 1 KiB | worker-protocol 의 EventKit 요청 한도와 감싸개 |
| `response` | 8 MiB + 1 KiB | worker-protocol 의 EventKit 응답 한도와 감싸개 |
| `confirm` | 64 KiB | 계약 |
| 그 밖 | 4 KiB | 계약 |
| 한 줄 전체(머리, 본문, LF) | 8,454,144 바이트(8 MiB + 64 KiB) | 가장 큰 응답과 여유 |

- 읽는 쪽은 읽는 도중에 한도를 건다. 머리(채널과 형식)를 읽으면 그 형식의 한도를 알 수 있고, 한도를 넘는 순간
  더 쌓지 않고 위반으로 다룬다. worker-protocol 의 "enforce bounds while streaming" 과 같은 규칙이다. [계약]
- 중계에서 온 한 줄이 4 MiB 를 넘으면 앱은 그 채널에 `close` `{"reason":"message_too_large"}` 를 보내고 소켓을
  닫는다. 중계는 75 로 끝난다. 앱은 MCP 를 해석하지 않으므로 JSON-RPC 오류로 답할 수 없다. [계약]
- 코어는 4 MiB 를 넘는 `data` 를 만들지 않는다. §10.5 의 1 MiB 결과 한도가 이를 보장한다. [계약]

### 7.5 인사

1. 코어는 준비되면 첫 프레임으로 `0\thello\t{"mux":1,"version":"<코어 버전>"}` 를 쓴다.
2. 앱은 그것을 10초 안에 받아야 한다. `mux` 가 1 이고 `version` 이 앱 버전과 같으면 `hello` 로 답한다. 같은
   번들에서 나온 둘의 버전이 다르면 설치가 깨진 것이다. 앱은 코어를 끝내고 상태를 `core_incompatible` 로 두며
   다시 띄우지 않는다.
3. 코어는 앱의 `hello` 를 받기 전에 다른 프레임을 쓰지 않는다. 앱의 `mux` 가 1 이 아니면 `fatal`
   `mux.version_unsupported` 를 쓰고 65 로 끝난다.
4. 앱은 `hello` 를 보낸 뒤에만 `open` 을 보낸다. 코어는 앱의 `hello` 를 받자마자 `capabilities` 작업 요청으로
   도구 목록의 근거를 얻는다(§10.2).

모두 [계약].

### 7.6 연결 수명

- 앱은 중계를 확인하고 머리말 `ready` 를 쓴 뒤 `N\topen` 을 보낸다. 어느 채널이든 `open` 이 그 채널의 첫
  `data` 보다 앞선다. [계약]
- 코어는 `open` 마다 그 채널의 전송 객체를 만들어 `serveStdio(factory, { transport, legacy: "reject" })` 로 MCP
  연결 하나를 돌린다(§10.1). [실측: 시험 빌드; 문서: SDK 2.4.0 `dist/stdio.d.mts` 의 `ServeStdioOptions`]
- 중계 소켓이 EOF 나 오류로 끝나면 앱은 `N\tclose` 를 보낸다. 코어는 그 세션을 닫는다. 그 뒤 코어가 그 채널에
  쓴 프레임은 앱이 버린다. [계약]
- 코어가 세션을 끝내면 `N\tclose` 를 보낸다. 앱은 그 채널에 쌓인 바이트를 중계에 다 쓴 뒤 소켓을 닫는다.
  [계약]
- 사람이 MCP 를 끄면(§2) 앱은 열린 채널마다 `N\tclose\t{"reason":"mcp_disabled"}` 를 코어에 보내고, 그 중계 소켓을
  대기열을 버리고 곧바로 닫는다. 중계는 입력이 열린 채 EOF 를 받아 75 로 끝난다. 아직 코어를 기다리던 연결은 머리말
  `mcp_disabled` 를 받는다. 다시 켜면 같은 코어가 이어지는 번호로 채널을 연다. [계약]

### 7.7 흐름 제어

- 양쪽은 입력을 전용 읽기 루프에서 늘 읽고, 읽기가 쓰기를 기다리게 하지 않는다. 그래야 서로 쓰다가 멈추는
  교착이 없다. 시험 빌드도 방향마다 스레드를 뒀다. [계약; 시험 빌드의 구조는 실측]
- 코어는 표준 출력 쓰기가 버퍼를 넘기면 `drain` 을 기다린 뒤 다음 프레임을 쓴다. 시험 빌드는 기다리지 않았다.
  [계약]
- 앱은 중계 소켓마다 코어 → 중계 대기열을 16 MiB 까지 둔다. 넘치면 그 채널을 `close`
  `{"reason":"slow_consumer"}` 로 끝낸다. 한 에이전트가 읽지 않아도 다른 채널이 멈추지 않는다. [계약]
- 앱에서 코어 입력으로 가는 대기열이 16 MiB 를 넘으면 앱은 중계 소켓 읽기를 멈추고, 줄어들면 다시 읽는다. 소켓
  버퍼가 에이전트에게 압력을 되돌린다. [계약]

### 7.8 코어가 끝나거나 다시 뜰 때

- 코어가 예상 밖으로 끝나면 앱은 종료 코드나 신호를 error 로그로 남기고 모든 중계 소켓을 닫는다. 중계는 75 로
  끝난다. 연결과 진행 중 호출은 코어 안에 있으므로 다시 뜬 코어로 옮겨지지 않고, 에이전트가 다시 연결해야 한다.
  [계약]
  Claude Code 는 대화형 세션에서 stdio 서버 프로세스가 끝나면 그 서버를 실패로 표시하고, 사람이 `/mcp` 에서
  Reconnect 를 골라야 다시 띄운다. `claude -p` 와 Agent SDK 세션은 다음 도구 호출 때 다시 띄운다. [문서:
  Claude Code MCP, "Stdio servers that exit or fail to start"] 그래서 코어 재시작은 대화형 Claude Code
  사용자의 손을 부른다(§15). 시험 빌드는 코어가 끝나면 호스트도 끝났다. [실측]
- 앱은 곧바로 코어를 다시 띄우고, 연이어 끝나면 1·2·4·8·16초 간격(최대 30초)을 둔다. 120초 안에 다섯 번 끝나면
  멈추고 상태를 `core_failed` 로 두며, 메뉴에서 다시 시작할 수 있게 한다. [계약]
- 진행 중이던 작업 요청은 앱이 끝까지 실행하고 기록부에 남긴다. 결과를 받을 코어가 없으므로 버린다. 에이전트는
  다시 연결한 뒤 `operations_list` 로 확인할 수 있다. [계약]
- `sherpa app serve` 의 종료 코드: 0 은 표준 입력 EOF 뒤의 정상 종료, 65(`EX_DATAERR`)는 프레임 위반, 70 은
  내부 오류다. [계약]
- 다시 뜬 코어의 채널 번호는 1 부터 다시 매긴다. [계약]
- 중계가 끝났을 때 Codex 가 서버를 다시 띄우는지는 문서에서 찾지 못했다. 두 에이전트 모두 이 Mac 에서 재지
  않았다. [미확인]

### 7.9 중계가 호출 중에 끊길 때

- 앱이 `close` 를 보내면 코어는 그 세션의 진행 중 요청을 중단하고 답하지 않는다. SDK 의 stdio 전송도 입력이
  끝나면 진행 중 요청에 답하지 않고 중단한다. [계약; 문서: SDK 2.4.0 `dist/stdio.d.mts` 의
  `StdioServerTransport` 설명]
- 이미 앱에 보낸 작업 요청은 거두지 않는다. Worker Protocol V2 요청은 중간에 취소할 수 없다. 앱은 끝까지
  실행해 기록부에 남기고, 코어는 늦게 온 응답을 warn 로그만 남기고 버린다. [계약]
- 확인을 기다리던 호출은 `withdraw` 를 보내고 실행하지 않는다(§9). 에이전트의 `notifications/cancelled` 도
  같게 다룬다. [계약]

### 7.10 앱이 끝날 때

- 앱은 새 연결을 받지 않는다(머리말 `unavailable`·`shutting_down`). 진행 중인 작업 요청이 끝나기를 그 요청의
  마감까지 기다린 뒤 코어의 표준 입력을 닫는다. 기록부가 끝 상태에 이르게 하려는 것이다. [계약]
- 종료가 시작된 뒤 온 작업 요청은 실행하지 않고 V2 실패 `app.shutting_down`(효과 `not_started`)으로 답한다.
  기다림은 종료 시작 때 이미 받은 요청의 가장 늦은 마감까지이고, 고정 상한 35초를 넘지 않는다. [계약]
- 코어는 표준 입력 EOF 를 받으면 모든 세션을 닫고 5초 안에 0 으로 끝난다. 앱은 5초 뒤 SIGTERM, 10초 뒤 SIGKILL
  을 보내고, 그다음 중계 소켓을 닫는다. [계약]

## 8. 앱 작업 요청

Calendar 와 Reminders 는 앱 안에서 부른다. [소유자, ADR-0010 결정 1] 그래서 코어는 Worker Protocol V2 요청을
제어 채널로 앱에 넘긴다.

- 1판의 작업자는 `planner` 하나다. `mail` 과 `reminder-kit` 이름은 남겨 두고, 앱은 그 밖의 작업자에 V2 실패
  `app.unsupported_worker` 로 답한다. 코어의 Mail 읽기·보내기, iMessage, KakaoTalk 은 코어 안에서 돈다(§10.2).
  [계약]
- 요청: `0\trequest\t{"id":7,"worker":"planner","request":{…V2 요청 봉투…}}`. `id` 는 코어 프로세스 안에서
  겹치지 않는 양의 정수다. [계약]
- 응답: `0\tresponse\t{"id":7,"response":{…V2 응답…}}` 또는 `0\tresponse\t{"id":7,"report":{…명령 보고…}}`. 두
  모양은 지금 `sherpa-apple planner request` 가 표준 출력에 쓰는 두 모양, 곧 V2 응답과
  `status`·`error`·`operation_id`·`journal_error` 의 명령 보고와 같다. [계약; 모양은 실측:
  `apple/eventkit-service/Sources/SherpaNative/main.swift`]
- 앱은 헬퍼의 `planner request` 와 같게 처리한다. 64 KiB 요청 한도, V2 봉투 검증, 변경 요청의 기록부와 그 시도
  안의 `fitted(maximumBytes:)`, 8 MiB 응답 한도, 한도를 낮추기만 하는 `SHERPA_APPLE_RESPONSE_LIMIT_BYTES` 가
  같고, 같은 `native_mutations` 표에 쓴다. [계약; 규칙은 [worker-protocol.md](worker-protocol.md)]
- 앱은 책임을 놓고 다시 뜨지 않는다(`PrivacyResponsibility` 를 쓰지 않는다). 앱 자신이 권한 주체다. [소유자,
  ADR-0010]
- 앱은 요청을 받은 순서대로 하나씩 실행한다. 마감은 앱이 요청을 받은 때부터 `deadline_ms` 다. 시작하기 전에
  마감이 지났으면 실행하지 않고 V2 실패 `app.deadline_exceeded`(효과 `not_started`)로 답한다. [계약]
- 코어는 `deadline_ms` 에 5초를 더해 기다린다. 그 안에 응답이 없으면 읽기는
  `failed`·`app.worker_timeout`·`after_backoff`, 변경은
  `uncertain`·`may_have_applied`·`app.worker_timeout`·`never` 로 본다. 늦게 온 응답은 버린다. 시간 초과는
  상태가 아니라 안정 코드로 나타낸다는 worker-protocol 규칙을 따른다. [계약]

## 9. 삭제와 보내기의 매 호출 확인

- 대상: 보내기 도구(`imessage_send`, `mail_send`)와 삭제 도구(`event_delete`, `reminder_delete`,
  `event_collection_delete`, `reminder_collection_delete`). 호출마다 사람이 앱 창에서 허용해야 실행한다.
  [소유자: 이슈 #26 과 HANDOFF 의 "삭제·보내기는 매 호출 확인"; 방법은 계약]
- 앱 창으로 정한 이유:
  1. 사람이 앱에서 답하므로 답이 모델을 거치지 않고, 에이전트가 스스로 허용할 수 없다.
  2. 에이전트의 설정에 기대지 않는다. Codex 는 서버마다 `default_tools_approval_mode`, 도구마다
     `tools.<도구>.approval_mode` 로 승인 방식(`auto`, `prompt`, `writes`, `approve`)을 사용자가 고른다.
     [문서: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)]
  3. MCP elicitation 에 기대지 않는다. 2026-07-28 에서 elicitation 은 서버가 보내는 요청이 아니라 도구 결과로
     입력을 되묻는 방식(Multi Round-Trip Requests)이다. [문서: MCP 2026-07-28 [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)]
     Claude Code 는 2026-07-28 연결마다 `elicitation: {form: {}, url: {}}` 를 선언한다. [문서: [Claude Code
     MCP](https://code.claude.com/docs/en/mcp), "Elicitation modes Claude Code declares"] Codex 0.171.0 도 form 과
     url 을 선언한다. 그러나 승인 정책이 `never` 면 샌드박스에서는 거절하고, 전체 접근이면 필드 없는 폼을 사람 없이
     `{}` 로 수락하며, 검토자가 `auto_review` 면 사람 대신 검토 모델이 정한다. [문서: openai/codex `rust-v0.171.0`
     의 `codex-rs/codex-mcp/src/elicitation.rs`, 줄 번호는 ADR-0011] 폼의 답은 에이전트가 만들어 에이전트 설정에
     따라 사람 없이 나올 수 있고, 앱 창의 답은 모델과 에이전트를 거치지 않는다(이유 1). 그래서 1판은 elicitation
     을 쓰지 않는다. [소유자 결정 2026-11-22, ADR-0011] 두 에이전트가 이 Mac 의 선 위에서 무엇을 선언하는지는
     재지 않았다. [미확인]
- 흐름:
  1. 코어는 30초 시계를 시작하고, 인자를 검증하고 대상을 읽어 미리보기를 만든다. 삭제는 `*.get` 이나
     `*.source.list` 를 `deadline_ms` 5초로 읽는다. 메일 보내기는 인자 자체를 쓰고, iMessage 보내기는 인자에
     더해 로컬 chat.db 에서 그 대화의 표시 이름(없으면 식별자)과 참여자 핸들을 읽는다. 읽기가 실패하면 그
     실패로 끝내고 확인을 묻지 않는다.
  2. 코어는 `confirm` 을 보내고 30초 가운데 남은 시간을 기다린다. `timeout_ms` 는 그 남은 시간이다. 남은
     시간이 없으면 묻지 않고 `failed`·`confirmation.timed_out`·`after_user_action` 으로 끝낸다.
  3. `approved` 면 실행한다. `declined` 면 실행하지 않고 `failed`·`confirmation.declined`·`after_user_action`
     으로 끝낸다. 30초가 지나면 `withdraw` 를 보내고 `failed`·`confirmation.timed_out`·`after_user_action`.
     앱이 창을 띄울 수 없으면 `unavailable` 로 답하고 코어는
     `failed`·`confirmation.unavailable`·`after_backoff`.
  4. 기다리는 중에 호출이 취소되거나 연결이 끊기면 `withdraw` 를 보내고 실행하지 않는다. 코어의 시계가
     권위이고, `withdraw` 뒤에 앱이 보낸 답은 버린다. 실행은 원래 호출 안에서만 일어나므로 늦게 누른 허용이
     나중에 실행을 일으키지 않는다.

  흐름은 모두 [계약].
- 30초의 근거: Codex 의 도구 시간 한도 `tool_timeout_sec` 기본값이 60초다. [문서: Codex MCP] 미리보기 읽기를 포함한
  확인 30초, 작업 마감 20초, 코어의 여유 5초가 그 안에 든다. 미리보기 읽기는 마감 5초에 §8 의 여유 5초를 더해 길어야
  10초이므로 사람에게는 적어도 20초가 남는다. Claude Code 의 도구 시간 한도는 따로 정하지 않으면 약 28시간이다. [문서:
  Claude Code MCP] [계약]
- 프레임(탭은 `\t` 로 적었다):

  ```text
  0\tconfirm\t{"id":3,"tool":"reminder_delete","operation_id":"op-…","client":{"name":"claude-code","version":"2.1.326"},"title":"…","lines":[{"label":"…","value":"…"}],"timeout_ms":30000}
  0\tconfirmation\t{"id":3,"decision":"approved"}
  0\twithdraw\t{"id":3}
  ```

  `decision` 은 `approved`, `declined`, `unavailable` 중 하나다. `client` 는 그 호출의 요청 봉투
  `_meta["io.modelcontextprotocol/clientInfo"]` 의 `name`·`version` 을 옮긴 자기 신고 값이고, 봉투에 없으면 둘 다
  `unknown` 이다. 같은 연결의 다른 요청 값을 옮기지 않는다. `client` 의 두 값은 128자, `title` 은 100자, `lines` 는
  12줄, `label` 은 40자, `value` 는 2,000자까지다(자는 코드 포인트). 이름표는 코어가 도구마다 정한 Sherpa 고정
  문구이고, 값은 대상의 실제 내용이다. [계약; 규격은 `clientInfo` 를 요청마다 싣기를 권하고(SHOULD) 서버가 앞선
  요청에 기대지 않게 한다: 문서: MCP 2026-07-28 Overview, `_meta` "Per-request protocol fields", "Statelessness"]
- 앱은 확인 창을 맨 앞 창으로 띄우고 남은 시간을 보여 준다. 메뉴에만 두지 않는다. 소유자가 미리보기 앱의 메뉴
  막대 아이콘을 보지 못한 일이 있었다(원인 미확인). 창은 한 번에 하나만 띄우고 나머지는 차례를 기다린다.
  기다리는 동안에도 각자의 30초는 흐른다. 버튼은 창이 뜬 뒤 1초가 지나야 눌린다. [계약; 값은
  `apple/sherpa-app/App/ConfirmationWindows.swift` 의 `armingDelay`]
- 내보낸 앱(0.8.5, main `d2f9ad9`)에서 중계로 부른 `reminder_delete` 의 창은 호출 0.29초 안에 맞는 내용으로 떴고,
  버튼은 약 1초 뒤 눌렸다. 거부는 `confirmation.declined`(효과 `not_started`), 허용은 성공과
  `native_absence_readback` `matched`, 아무것도 누르지 않으면 30.01초 뒤 `confirmation.timed_out` 이었다. [실측:
  live-evidence 2026-11-21 "Delete confirmation through the exported app's relay"]
- 미리보기 내용은 사용자 데이터다. 앱 화면에만 보이고 로그와 기록부에 남지 않는다. [계약]
- MCP 를 끄면(§2) 모든 채널이 닫히므로, 앱은 떠 있거나 차례를 기다리는 확인 창을 답 없이 모두 닫고 그 뒤에 온 답을
  버린다. 코어는 채널이 닫혔으므로 흐름 4 대로 그 호출을 거두고 `withdraw` 를 보낸다. 꺼진 동안 온 `confirm` 은 닫힌
  채널의 호출이므로 창을 띄우지 않고 `unavailable` 로 답한다. [계약]
- Claude Code 의 `_meta["anthropic/requiresUserInteraction"]: true` 는 그 도구의 권한 창을 `bypassPermissions`
  에서도 호출마다 띄우고 "다시 묻지 않기" 를 내지 않으며, `dontAsk` 모드와 답할 사람이 없는 `-p` 실행에서는
  호출을 거부한다. [문서: Claude Code MCP, "Require approval for a specific tool"] 앱 창과 두 번 묻게 되고
  Codex 에는 효과가 없으므로 1판은 달지 않는다(§15). 2.1.326 에서 이 표시를 지원하는지 재지 않았다. [미확인]

## 10. MCP 서버와 도구

### 10.1 서버

- 공식 TypeScript SDK `@modelcontextprotocol/server` 2.4.0 과 `zod` 4 를 `core/bun.lock` 으로 고정한다. 시험
  빌드가 쓴 판이다. [실측; SDK 를 고른 것은 소유자, ADR-0010 결정 2]
- 서버 정보는 이름 `sherpa` 와 코어 버전이다. 능력은 `{"tools":{"listChanged":false}}` 하나만 낸다. 자원,
  프롬프트, 로그 알림, 에이전트에게 입력을 되묻는 일(elicitation, sampling, roots)은 쓰지 않는다. [계약] 2026-07-28
  에서 서버 정보는 `server/discover` 와 모든 결과의 `_meta["io.modelcontextprotocol/serverInfo"]` 에 실린다. [문서: SDK
  2.4.0 `Server._outboundServerInfo`; 실측: `core/tests/stdio/serve.test.ts`] sampling, roots, logging 은 그 판에서
  폐기 예정이다. [문서: MCP 2026-07-28 changelog, "Deprecated"]
- 규격: MCP 2026-07-28 만 받는다. 코어는 채널마다 `serveStdio(factory, { transport, legacy: "reject" })` 를
  돌린다. [소유자 결정 2026-11-22, ADR-0011] 연결은 `server/discover` 나 봉투를 단 첫 요청으로 열리고, 요청마다
  `_meta` 에 `io.modelcontextprotocol/protocolVersion` 2026-07-28 과 `clientCapabilities` 가 있어야 한다. [문서: MCP
  2026-07-28 [Overview](https://modelcontextprotocol.io/specification/2026-07-28/basic), `_meta` "Per-request protocol fields"]
- 2025 계열은 이렇게 거부한다. 연결은 닫지 않고, 같은 연결의 `server/discover` 나 봉투 요청이 2026-07-28 로 연다.
  [문서: SDK 2.4.0 `dist/stdio.mjs` 의 `serveStdio`, `dist/src-*.mjs` 의 `modernOnlyStrictRejection`; 실측:
  `core/tests/app-serve.test.ts`, `core/tests/stdio/serve.test.ts`]
  - 봉투 없는 `initialize`: `-32022`, message `Unsupported protocol version: <요청한 판>`, data
    `{"supported":["2026-07-28"],"requested":"<요청한 판>"}`. 연결이 2026-07-28 로 열린 뒤에도 같다.
  - 연결이 열리기 전 봉투 없는 다른 요청: `-32022`, message `Unsupported protocol version: the request did not name a
    protocol version`, data `{"supported":["2026-07-28"]}`.
  - 봉투 없는 알림(`notifications/initialized` 등): 답 없이 버린다.
  - 연결이 열린 뒤 봉투 없는 요청: `-32602`. 규격은 필수 봉투 키가 없는 요청을 -32602 로 거부하게 한다. [문서: 같은
    절]
- 규격은 지원하지 않는 판에 지원 목록을 단 `UnsupportedProtocolVersionError`(-32022)로 답하게 한다. [문서: MCP
  2026-07-28 [Versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning), "Protocol Version Negotiation"] 코어는 -32022 로 답할 때마다
  `warn [core:mcp-transport:send] refused channel=N reason=unsupported_protocol_version` 을 남긴다. [계약]
- 에이전트: Claude Code 는 stdio 서버에 기본으로 2026-07-28 을 묻는다. [문서: Claude Code MCP, "Push messages with
  channels"] 2.1.326 은 이 판의 코어를 담은 내보낸 앱의 중계에 `server/discover` 로 붙어 2026-07-28 로 열고
  `tools/list` 를 받았다. [실측: live-evidence 2026-11-22 "The exported app with the 2026-07-28-only core"] `claude -p`
  로 같은 봉투의 `tools/call` 을 보내 읽기 도구를 불렀다. [실측: live-evidence 2026-11-22 "Claude Code calls a tool"] Codex 0.171.0 은 기능 `mcp_2026_07_28` 과 서버 항목 env
  `CODEX_MCP_PROTOCOL_VERSION=2026-07-28` 이 둘 다 있을 때만 2026-07-28 로 연다(§2). [실측: 같은 기록; 문서: ADR-0011]
  기본 설정의 Codex 는 `initialize`(2025-06-18) 하나만 보내고, -32022 를 받으면 더 새 판으로 다시 묻지 않는다. 서버를
  `failed` 로 두고 `toolsError` 에 `MCP startup failed: handshaking with MCP server failed: JSON-RPC error: -32022: …`
  를 보이며, 그 서버의 도구 호출은 -32603 이다. [실측: 같은 기록] 1판 처음의 "Claude Code 2.1.326 과 Codex 0.170.0 이 2025-11-25 로 협상" 은 손으로 보낸 `initialize` 로
  잰 값이었다. [실측: live-evidence 2026-11-22 정정]
- SDK 의 공장 함수는 비동기일 수 있다. [문서: SDK `McpServerFactory`] 코어는 세션을 만들 때 시작 때 얻은 도구
  목록의 근거(§10.2)를 5초까지 기다린다. 그 안에 발견 응답이 없으면 그 순간 발견을 코어 프로세스 전체에서
  실패로 확정한다. planner 도구를 모두 빼고 error 로그를 남기며, 늦게 온 `response` 는 버린다. 목록은 코어가
  사는 동안 바뀌지 않는다(§10.2). [계약]
- 같은 연결에서 아직 끝나지 않은 요청과 같은 id 의 요청은 SDK 에 넘기지 않고 JSON-RPC -32600(Invalid Request)으로
  답한다. 규격은 요청자가 아직 답을 받지 않은 다른 요청의 id 를 다시 쓰지 않게 한다. [문서: MCP 2026-07-28
  [Overview](https://modelcontextprotocol.io/specification/2026-07-28/basic), Requests, "The request ID MUST NOT match the ID of any other request the sender has
  issued and not yet received a response for."] SDK 2.4.0 은 요청 id 마다 abort controller 하나만 두어
  둘째 호출이 첫째의 것을 덮어쓰므로, 연결이 끊기거나 `notifications/cancelled` 가 와도 둘 다 거둘 수 없다(§7.9, §9).
  [계약]

### 10.2 도구 목록

- 코어는 도구 등록부 하나를 둔다. 항목마다 capability, 출처(`app:planner` 또는 `core`), 도구 이름, 설명, 입력
  스키마, 효과 부류(§10.6), 확인 여부(§9), 마감이 있다. CLI 의 명령 분배와 MCP 도구는 같은 코어 함수를
  부른다(§11). [계약]
- `app:planner` 항목은 코어가 시작할 때 앱에 보낸 `capabilities` 요청의 서술자와 맞춘다. capability 이름,
  `effect`, `required_evidence` 가 같고 `state` 가 `supported` 인 서술자가 있는 항목만 싣는다. V2 봉투의
  정책(`effect`, `required_evidence`, `artifact_directory: null`)은 손으로 적지 않고 서술자에서 가져온다. 맞지
  않는 항목은 빼고 error 로그를 남긴다. 발견 요청이 실패하면 planner 도구를 모두 빼고 core 도구만 싣는다.
  목록은 코어 프로세스가 사는 동안 바꾸지 않는다. [계약; 서술자의 모양은 실측: `CapabilityDiscovery.swift`,
  `EventKitWorker.swift`]
- planner 에서 빼는 것은 `*.authorization.request` 다. 권한 요청은 앱 메뉴가 맡는다. [소유자, ADR-0010 결정 1]
  발견 요청 `capabilities` 는 도구가 아니다. [계약]
- 1판 도구:

| 도구 | 출처 | 효과 부류 | 확인 |
| --- | --- | --- | --- |
| `event_authorization_status`, `reminder_authorization_status` | app:planner | read | |
| `event_source_list`, `event_list`, `event_get`, `event_command_validate` | app:planner | read | |
| `reminder_source_list`, `reminder_list`, `reminder_get`, `reminder_command_validate` | app:planner | read | |
| `event_create`, `event_collection_create`, `reminder_create`, `reminder_collection_create` | app:planner | create | |
| `event_update`, `reminder_update` | app:planner | update | |
| `reminder_complete`, `reminder_reopen` | app:planner | toggle | |
| `event_delete`, `event_collection_delete`, `reminder_delete`, `reminder_collection_delete` | app:planner | delete | 예 |
| `imessage_chats`, `imessage_history` | core | read | |
| `imessage_send` | core | send | 예 |
| `kakaotalk_status`, `kakaotalk_search`, `kakaotalk_history`, `kakaotalk_archive` | core | read | |
| `kakaotalk_checkpoint` | core | local | 인자 `confirm` |
| `mail_authorization_status`, `mail_list`, `mail_read` | core | read | |
| `mail_send` | core | send | 예 |
| `operations_list` | core | read | |

- 1판에서 빼는 것: `planner request`·`mail request`·`reminder-kit request` 의 날 봉투 통과(에이전트가 봉투를
  손으로 짜는 것이 ADR-0010 이 고치려는 결함이다), `kakaotalk setup`(사용자 번호를 받아 키체인에 쓰는 한 번의
  설정), 비공개 ReminderKit(쓰기에 `SHERPA_PRIVATE_WRITES=1` 이 필요한데 앱에는 아직 그 선택이 없다), Mail
  shim(코어의 Mail 명령이 읽기와 보내기를 맡는다). [계약]

### 10.3 이름

- 도구 이름은 capability 의 `.` 과 `-` 를 `_` 로 바꾼 것이다. core 항목은 CLI 의 `<영역> <명령>` 에서
  만든다(`mail authorization-status` → `mail_authorization_status`). 이름은 `^[a-z][a-z0-9_]{0,47}$` 를
  만족하고 서버 안에서 겹치지 않으며, 게이트가 이를 확인한다. [계약]
- 근거: MCP 는 도구 이름에 점을 허용한다. [문서: MCP 2026-07-28
  [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), "Tool Names"] 그러나 Claude
  API 의 도구 이름은 `^[a-zA-Z0-9_-]{1,128}$` 이고 [문서: [Define
  tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)], Claude Code 는
  `mcp__<서버>__<도구>` 전체가 128자를 넘는 도구를 Claude 에 보내지 않고, 플러그인이 낸 서버의 도구는
  `mcp__plugin_<플러그인>_<서버>__<도구>` 로 부른다 [문서: Claude Code MCP]. 점을 쓰지 않으면 에이전트가
  이름을 고칠 일이 없다. 플러그인 `sherpa` 의 서버 `sherpa` 면 앞머리가 27자이므로 48자 이름도 전체 75자다.
  [추론]

### 10.4 입력 스키마

- planner 도구의 인자는 V2 `payload` 에서 `schema` 를 뺀 것이다. 코어가 `schema`(서술자의 `request_schema`)와
  봉투(`kind`, `protocol_version` 2.0.0, `application_contract`, `request_id`, `operation_id`,
  `idempotency_key`, `deadline_ms` 20000, `policy`)를 채운다. 세 id 에는 호출마다 새로 만든 `op-<UUIDv7>`
  하나를 쓴다. [계약] 에이전트가 봉투를 짜다 `deadline_ms` 한도와 스키마 이름을 틀리던 일(ADR-0010 맥락)이
  여기서 없어진다.
- 스키마는 코어가 Swift 요청 타입(`SherpaPlannerContract`)을 옮겨 쓴 zod 엄격
  객체(`additionalProperties: false`)다. V2 가 정확한 키만 받기 때문이다. 인자 없는 도구는
  `{"type":"object","additionalProperties":false}` 다. [계약; 빈 객체 모양은 문서: MCP 2026-07-28 Tools]
- core 도구의 인자는 그 CLI 명령이 플래그와 표준 입력으로 받는 값과 같고, 이름은 snake_case 다. 삭제와 보내기는
  §9 의 앱 창이 확인하므로 CLI 의 `--confirm` 값은 인자가 아니다. 예외로 `kakaotalk_checkpoint` 는 앱 창 없이
  CLI 와 같은 확인 값을 `confirm` 인자(상수 `"COMMIT_LOCAL_CHECKPOINT"`)로 받는다. [소유자 결정 2026-11-21]
  스키마에서 `confirm` 은 필수 string 이다. 값이 다르면 CLI 와 같은 코드로 거부하고, 없으면 SDK 입력 검증
  오류다. [계약] [계약; 명령과 입력은 실측: `core/src/cli/help.ts`]

| 도구 | 인자(`?` 는 생략 가능) | CLI 에서의 출처 |
| --- | --- | --- |
| `imessage_chats` | `limit` | `--limit` |
| `imessage_history` | `chat_id`, `start`, `end`, `limit` | 같은 이름의 플래그 |
| `imessage_send` | `chat_id`, `text` | `--chat-id`, 표준 입력의 본문 |
| `kakaotalk_status` | 없음 | |
| `kakaotalk_search` | `query`, `limit` | 표준 입력의 검색어, `--limit` |
| `kakaotalk_history` | `display_name`, `limit` | 표준 입력의 표시 이름, `--limit` |
| `kakaotalk_archive` | `since`, `time_zone`, `limit` | 같은 이름의 플래그 |
| `kakaotalk_checkpoint` | `token`, `confirm` | 표준 입력의 체크포인트 토큰, `--confirm` |
| `mail_authorization_status` | 없음 | |
| `mail_list` | `from`, `to`, `limit`, `max_body_bytes`, `cursor?` | 같은 이름의 플래그 |
| `mail_read` | `message_id`, `max_body_bytes` | 같은 이름의 플래그 |
| `mail_send` | `sender?`, `to`, `cc`, `bcc`, `subject`, `body` | 표준 입력의 JSON 과 같은 키 |
| `operations_list` | `limit` | `--limit` |

- MCP 스키마는 CLI 검증보다 엄격할 수는 있어도 느슨할 수는 없다. 공용 함수의 검증이 한 번 더 돈다. [계약]
- 나눔: zod 스키마는 정확한 키 집합(엄격 객체), 형식, 정수 여부, 필수 키까지만 싣는다. 값의 범위와 형식
  규칙은 공용 함수(core 도구) 또는 앱의 V2 검증(planner 도구)이 맡아, CLI 와 MCP 가 같은 입력을 같은
  코드(`invalidRequest`, `protocol.invalid_payload` 등)로 거부한다. 모르는 키, 형식, 필수 키 누락 같은 구조
  오류는 SDK 입력 검증 오류다. [계약]
- 입력 검증 실패는 SDK 가 `isError: true` 결과로 돌려준다. [문서: SDK 2.4.0 의 `tools/call` 처리기가 검증
  오류를 잡아 `createToolError` 로 바꾼다; MCP 2026-07-28 Tools 는 입력 검증 오류를 도구 실행 오류로 분류한다]

### 10.5 결과

모든 도구의 `outputSchema` 는 같은 감싸개 `SherpaToolOutcomeV1` 이다.

```text
schema         "sherpa.mcp.tool-outcome.v1"
status         succeeded | failed | partial | uncertain
summary        상태마다 정해진 Sherpa 고정 문장(영어)
capability     "reminder.delete" 같은 capability 이름
operation_id   string | null
effect         {kind: none | authorization_prompt | native_mutation | outbound_dispatch | local_state,
                state: not_applicable | not_started | applied | may_have_applied}
evidence       {kind, state} | null              V2 와 같은 낱말
error          {code, retry, remedy?} | null     retry: never | safe | after_backoff | after_user_action
journal_error  string | null
warnings       배열, 128개까지
result         object | null
```

- `structuredContent` 는 이 객체이고, `content` 는 같은 객체를 위 순서대로 직렬화한 text 블록 하나다. `result`
  를 맨 뒤에 둬, 에이전트가 긴 결과를 잘라도 상태와 오류가 남게 한다. [계약; text 블록은 문서: MCP 2026-07-28
  Tools, "a tool that returns structured content SHOULD also return the serialized JSON in a TextContent
  block"]
- `outputSchema` 를 내면 서버는 그에 맞는 구조화 결과를 내야 한다. [문서: MCP 2026-07-28 Tools] SDK 는
  `isError` 가 아닌 결과를 `outputSchema` 로 검증하고 어긋나면 오류 결과로 바꾼다. [문서: SDK 2.4.0
  `validateToolOutput`] 그래서 1판의 `result` 는 열린 객체(`type: object`)다. 도구별 결과 스키마는 Swift
  인코더가 null 키를 빼고 ObjC 셈은 `null` 을 쓰는 차이(HANDOFF 의 미확인)가 정리된 뒤 붙인다. [계약]

| 결과 | `isError` | 이유 |
| --- | --- | --- |
| `succeeded` | `false` | |
| `failed` (효과가 시작되지 않았다) | `true` | 도구 실행 오류는 `isError` 로 알린다 [문서: MCP 2026-07-28 Tools, "Error Handling"] |
| `partial`, `uncertain` | `false` | 효과가 이미 일어났거나 일어났을 수 있다. 규격은 `isError` 결과를 모델이 고쳐서 다시 부르라는 신호로 설명한다 [문서: 같은 절]. 적용된 변경이 일어나지 않은 것처럼 읽히면 안 된다는 worker-protocol 규칙을 따른다 [계약] |

- `summary` 의 고정 문장. [계약]
  - succeeded: "The operation completed."
  - failed: "Nothing was changed. See error.code and error.retry."
  - partial: "The change was applied but its verification or result is incomplete. Do not repeat it; report
    operation_id to the user."
  - uncertain: "The change may have been applied. Do not repeat it; check operations_list or ask the user."
- planner 의 V2 응답은 `status`, `effect`, `evidence`, `error`, `warnings` 를 그대로, `result` 는 V2 `result`,
  `operation_id` 는 봉투의 값으로 옮긴다. 명령 보고(`report`)는 그 `status` 가 `failed` 면 `failed`, 그 밖이면
  `uncertain`·`may_have_applied` 로 보고, `error.code` 는 보고의 `error`, `retry` 는 `never`, `journal_error`
  는 보고의 값이다. [계약]
- core 도구는 명령의 JSON 출력이 객체면 그대로, 배열이면 `{"items":[…]}` 로 `result` 에 둔다. 줄마다 JSON
  객체를 쓰는 명령(`imessage chats`, `imessage history`)은 줄 하나를 원소로 `{"items":[…]}` 에 담고, 빈 출력은
  빈 배열이다. `SherpaError` 는
  `failed` 와 그 `code`·`remedy` 로 옮기고, `retry` 는 `remedy` 가 있으면 `after_user_action`, 없으면 `never`
  다. `mayHaveApplied` 면 `uncertain`·`may_have_applied` 다. `JournaledMutationError` 는 그 `status`(`failed`
  또는 `uncertain`), `operation_id`, `journal_error` 를 옮긴다. 보내기는 끝났는데 기록이 실패하면 `succeeded`
  에 `journal_error` 를 단다. `kakaotalk_checkpoint` 의 효과는 `local_state`·`applied` 다. [계약; 오류 모양은
  실측: `core/src/main.ts`, `core/src/journal/journal.ts`]
- 크기: 직렬화한 text 블록이 1 MiB 를 넘으면 worker-protocol 의 맞춤 규칙을 그대로 쓴다. `result` 와
  `warnings` 를 버리고 상관 값, 효과, 증거는 남긴다. 효과가 `applied` 나 `may_have_applied` 면 `partial`(이미
  `uncertain` 이면 그대로), 아니면 `failed` 이고, 둘 다 `protocol.result_too_large`·`never` 다. 읽기에는
  범위나 `limit` 을 줄이라는 `remedy` 를 단다. [계약] Claude Code 는 25,000 토큰을 넘는 성공 결과를 파일로
  돌리고 10,000 토큰부터 경고한다. [문서: Claude Code MCP] Codex 는 모델의 기본 출력 예산에서 도구 출력을
  자르고, 도구마다 `tools.<도구>.output_token_limit` 로 그 예산을 바꾼다. [문서: Codex MCP] 기본 예산 값은
  문서에 없다. [미확인] `result` 를 맨 뒤에 둔 것이 두 에이전트의 자르기에 대비한다. [추론]
- 작업 응답의 시간 초과는 §8 의 규칙대로 옮긴다. [계약]

### 10.6 annotation

| 효과 부류 | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
| --- | --- | --- | --- | --- |
| read | true | false | true | false |
| create | false | false | false | false |
| update | false | true | true | false |
| toggle | false | false | true | false |
| delete | false | true | true | false |
| send | false | true | false | true |
| local | false | false | true | false |

- 네 힌트를 언제나 모두 적고 기본값에 기대지 않는다. 기본값은 `readOnlyHint` false, `destructiveHint` true,
  `idempotentHint` false, `openWorldHint` true 다. [문서: MCP 2026-07-28 schema 의 `ToolAnnotations`; 모두
  적는 것은 계약]
- 로컬 기록(Calendar, Reminders, 메시지 DB, Mail 색인)은 닫힌 세계로 본다. 보내기만 바깥 사람에게 닿는다.
  update 는 기존 값을 덮으므로 파괴적이고, 같은 인자로 두 번 해도 더 바뀌지 않으므로 멱등이다. [추론]
- 힌트는 에이전트의 동작만 바꾸고, 에이전트는 믿을 수 있는 서버가 아니면 힌트를 믿지 말아야 한다. [문서: MCP
  2026-07-28 Tools] Sherpa 의 확인(§9)은 힌트에 기대지 않는다. [계약] Codex 의 `writes` 승인 방식은 읽기
  전용으로 표시되지 않은 도구에 묻는다. [문서: Codex MCP] Claude Code 는 읽기 전용 호출을 다른 읽기 전용
  호출과 병렬로 돌린다. 연결이 끊길 때 걸려 있던 멱등·읽기 전용 호출은 HTTP 서버와 claude.ai 커넥터에서만 새
  연결로 한 번 다시 보내므로, stdio 서버인 Sherpa 에는 다시 보내지 않는다. [문서: Claude Code MCP, "Mark tools
  that are safe to call twice"]

### 10.7 새 오류 코드

| 코드 | 상태 | `retry` | 뜻 |
| --- | --- | --- | --- |
| `app.worker_timeout` | 읽기 `failed`, 변경 `uncertain` | `after_backoff` / `never` | 작업 응답이 마감 + 5초 안에 오지 않았다 |
| `app.deadline_exceeded` | `failed` | `after_backoff` | 앱이 시작하기 전에 마감이 지났다 |
| `app.shutting_down` | `failed` | `after_backoff` | 앱이 끝나는 중이라 작업을 시작하지 않았다(효과 `not_started`, §7.10) |
| `app.unsupported_worker` | `failed` | `never` | 앱이 모르는 작업자 |
| `confirmation.declined` | `failed` | `after_user_action` | 사람이 거부했다 |
| `confirmation.timed_out` | `failed` | `after_user_action` | 30초 안에 답이 없었다 |
| `confirmation.unavailable` | `failed` | `after_backoff` | 앱이 확인 창을 띄울 수 없었다 |
| `mux.frame_invalid`, `mux.frame_too_large`, `mux.unexpected_frame`, `mux.version_unsupported` | — | — | 코어의 `fatal` 프레임에만 쓴다 |

기존 코드(`protocol.*`, `eventkit.*`, `imessage.*`, `kakaotalk.*`, `mail.*`, `journal.*`, `sherpa.*`)는 그대로
옮긴다. [계약]

## 11. worker-protocol.md 와 `sherpa` 명령과의 관계

- Worker Protocol V2 의 봉투, 상태, 효과와 증거, 오류 코드와 `retry`, 요청·응답 한도, 맞춤 규칙은 바뀌지
  않는다. 바뀌는 것은 앱이 실행하는 요청의 전송뿐이다. 요청마다 프로세스 하나를 띄우는 대신 제어 채널에서
  `request`·`response` 한 쌍을 주고받는다. [계약]
- worker-protocol 의 프로세스 감독 분류는 이렇게 옮긴다. 시작 불가는 에이전트 쪽에서 머리말 `unavailable`,
  시간 초과는 `app.worker_timeout`, 프로토콜 경계 실패는 프레임 위반(`fatal` 과 코어 재시작), 어댑터 실행
  실패는 지금처럼 V2 실패 응답이다. [계약]
- `sherpa` 명령과 `sherpa app serve` 는 같은 실행 파일이다. MCP 도구 처리기와 CLI 분배는 같은 코어 함수(검증,
  기록부, 출력 모양)를 부르고, 같은 입력을 같은 안정 코드로 거부한다. CLI 의 JSON 출력은 ADR-0008 결정 4 대로
  그대로이고, MCP 는 그것을 §10.5 의 감싸개에 담기만 한다. [소유자, ADR-0010 결정 5; 방법은 계약]
- 코어의 planner 포트에는 어댑터가 둘이다. CLI 의 헬퍼 프로세스(`sherpa-apple`)와 `app serve` 의 제어
  채널이다. 조립 지점이 하나를 고른다. [계약; 아키텍처 문서의 조립 지점 규칙]
- 2단계(bunny-holes/sherpa#27, #28, #29) 동안 CLI 는 지금의 헬퍼 경로(`SherpaHelper.app` 의 `sherpa-apple`)를
  그대로 쓴다. 헬퍼 번들을 걷어 내는 일과 CLI 가 앱 소켓에 붙어 EventKit 에 닿는 길은 3단계
  (bunny-holes/sherpa#31)에서 함께 정하고 이 계약의 다음 판에 적는다. [소유자 결정 2026-11-21]
- 메뉴의 "최근 작업" 은 기록부(`native_mutations`)를 읽어 보여 준다. 1판에는 그것을 위한 프레임이 없다. [계약]

## 12. 로그

- 형식은 `<수준> [<층>:<모듈>:<동작>] 키=값 …` 이고 층은 `app`, `relay`, `core` 다. 외부 경계(소켓 accept 와
  서명 확인, 코어 실행·인사·종료, 작업 요청, 확인 요청, 도구 호출)는 시작, 성공, 실패를 남긴다. error 는 실패,
  warn 은 회복 가능한 거부(서명 거부, `slow_consumer`, 늦은 응답), info 는 주요 흐름(코어 준비, 세션 열림과
  닫힘, 도구 호출의 끝), debug 는 세부(프레임 크기)다. [계약; 형식은 기존 `core/src/log.ts` 와 같다]
- `LOG_LEVEL` 이 수준을 정하고 기본은 warn 이다. 앱은 자기 환경의 `LOG_LEVEL` 을 코어에 넘긴다. [계약]
- 코어와 중계는 표준 오류에 쓴다. 앱은 통합 로그(subsystem `dev.xiyo.sherpa`)에 같은 줄을 쓰고, 코어 표준
  오류의 줄을 category `core` 로 옮긴다(한 줄은 4 KiB 에서 자른다). 읽을 때는
  `/usr/bin/log show --predicate 'subsystem == "dev.xiyo.sherpa"'` 를 쓴다. [계약] MCP 클라이언트는 서버 표준
  오류를 잡거나 버릴 수 있고, 그것을 오류로 여기지 않아야 한다. [문서: MCP 2026-07-28 stdio]
- MCP 스위치(§2)는 바뀔 때 `info [app:mcp:switch] enabled=<true|false> sessions_closed=N confirmations_withdrawn=M`
  을 남긴다. 꺼진 동안 온 중계는 `warn [app:session:open] status=unavailable reason=mcp_disabled pid=N`, 끈 뒤 온 확인
  요청은 `warn [app:confirm:request] id=N status=refused reason=mcp_disabled decision=unavailable` 이다. [계약]
- 남겨도 되는 값: 채널 번호, 도구와 capability 이름, `operation_id`, 작업 요청 `id`, 상태, 오류 코드, `retry`,
  걸린 시간, 바이트 수, 종료 코드와 신호, 상대의 pid 와 서명 식별자, mux·앱·코어 버전, 확인 결과 낱말, 요청 봉투
  `clientInfo` 의 이름과 버전. [계약]
- 남기면 안 되는 값: MCP 메시지 본문, 도구 인자와 결과, 확인 미리보기, 제목·이름·전화번호·메일 주소·대화
  id·`native_locator`, 메시지와 메일 본문, 홈 경로와 사용자 이름이 든 경로(소켓 절대 경로 포함). [계약;
  아키텍처 품질 목표 6, worker-protocol 의 "Sensitive values"]

## 13. 시험 층

게이트(`scripts/check-all.sh`)는 결정적인 층을 모두 돈다. 실기 층은 소유자가 돌리고
`docs/testing/live-evidence.md` 에 적는다. [AGENTS.md]

### 13.1 코어 (bunny-holes/sherpa#27)

단위 시험(`bun run test`):

- 프레임: §14 의 벡터 전부, 형식별 한도의 경계값(한도와 한도 + 1), 읽는 도중 한도를 넘으면 더 쌓지 않음.
- 다중화: `open`·`data`·`close` 순서, 닫힌 채널과 엇갈린 프레임, 두 번째 `open` 위반, 인사 순서와 `mux`
  불일치(`fatal`, 65).
- 작업 요청: `id` 상관, 늦은 응답 버림, 시간 초과에서 읽기와 변경의 구분, `report` 모양 옮기기.
- 확인: `approved`·`declined`·`unavailable`·30초 초과, 취소와 연결 끊김의 `withdraw`, `withdraw` 뒤 답 무시,
  실행이 원래 호출 안에서만 일어남.
- 도구 등록부: 이름 규칙과 중복, 효과 부류별 annotation 표, 가짜 발견 응답과 맞추기(맞지 않는 서술자는 빠짐),
  발견 실패에서 core 도구만 남음.
- 결과: 상태와 효과의 조합마다 `isError`, `structuredContent`, text 의 키 순서, 1 MiB 맞춤, 모든 결과가
  `outputSchema` 를 통과함.
- 규격(ADR-0011): 2025-11-25·2025-06-18 `initialize` 와 봉투 없는 요청은 -32022 이고 아무 도구도 돌지 않음, 봉투
  없는 알림은 답이 없음, 거부 뒤 같은 채널의 `server/discover` 와 도구 호출, 열린 뒤 봉투 없는 요청은 -32602, 확인
  기록의 `client` 는 요청마다 그 봉투에서 옴(없으면 `unknown`).
- planner 입력 스키마: 도구마다 예시 인자로 만든 V2 요청의 키가 Swift 요청 타입이 받는 키와 같음. 권한이 필요
  없는 경로(`*.authorization.status`, `*.command.validate`)는 게이트가 빌드하는 `sherpa-apple planner request`
  에 실제로 넣어 `protocol.invalid_payload` 가 아님을 확인한다. 변경 capability 는 헬퍼에 넣지 않는다.
  소유자의 Mac 은 권한이 있어 실제로 바뀐다.

MCP stdio 명령 시험(빌드한 `core/dist/sherpa app serve` 를 가짜 앱 시험기가 프레임으로 몬다):

- 인사 → 채널 셋 열기 → 채널마다 `server/discover`(2026-07-28), 봉투를 단 `tools/list`, 읽기 `tools/call`(가짜
  `response`). 시험 빌드의 동시 세 세션 시험과 같은 모양이다.
- 2025-11-25·2025-06-18 `initialize` → -32022, 봉투 없는 `tools/list` → -32022, 같은 채널의 `server/discover` 뒤 도구
  35개와 읽기 호출, 표준 오류의 `reason=unsupported_protocol_version`.
- 삭제 도구 → `confirm` → `approved` 면 `request` 가 나가고, `declined` 면 나가지 않음.
- 호출 중 `close` → 답이 없고 코어는 계속 돈다.
- 한도를 넘는 줄 → `fatal` 과 65. 표준 입력 EOF → 5초 안에 0.

### 13.2 앱과 중계 (bunny-holes/sherpa#28)

단위 시험(`swift test`. 새 패키지는 `check-all.sh` 의 `SWIFT_PACKAGES` 에 더한다):

- 프레임: §14 의 벡터 전부. 코어와 같은 벡터다.
- 머리말의 직렬화와 중계의 해석, 종료 코드를 고르는 표. `mcp_disabled` 는 75 와 MCP 를 켜라는 `remedy`, 모르는 사유는
  `status` 대로 75·77 과 일반 `remedy`, 사유 모양이 아니면 76.
- 소켓 경로 계산(홈은 사용자 데이터베이스에서), 103 바이트 경계.
- MCP 스위치 값(§2): 값이 없는 defaults 에서 꺼짐, 쓴 값을 읽음. 에이전트 명령: Claude Code 와 Codex 의 명령 글,
  경로 따옴표, 따옴표 친 경로를 `/bin/sh`·`/bin/zsh`·`/bin/bash` 가 한 낱말 그대로 받음(빈칸, 작은따옴표, `$`,
  역따옴표, `*`, `~`, 한글).

소켓과 서명(실제 프로세스, 임시 폴더, DEBUG 빌드):

- 단일 인스턴스: 둘째 인스턴스가 잠금에 막혀 0 으로 끝남. 오래된 소켓 파일을 지우고 bind 함. 폴더가 링크이거나
  남의 것이면 듣지 않음.
- 서명: ad-hoc 서명한 시험 자식은 운영 요건에 거부되고, 그 자식의 식별자만 요구하는 시험 요건에는 통과함.
  게이트에 소유자의 인증서가 없어도 돈다. 서명 없는 직접 연결은 거부됨.
- 코어의 실행 중 확인(§2): 코어 자리의 서명 없는 스크립트와 다른 식별자로 서명한 가짜 코어는 한 번도 재개되지
  않음. 스크립트의 표식 파일과 가짜 코어의 시작 기록이 없어야 한다.
- 중계 종료 코드: 69(소켓 없음), 77(ad-hoc 가짜 서버), 76(잘못된 머리말), 75(`unavailable` 머리말, 입력이 열린
  채 EOF), 78(긴 경로), 64(인자), 0(정상).
- 가짜 코어(프레임을 말하는 작은 시험 프로그램)와 다중화: 인사와 버전 불일치(`core_incompatible`, 재시작 안
  함), 연결마다 `open`·`close`, 코어가 끝나면 모든 중계가 75, 재시작 간격과 다섯 번 뒤 멈춤(시간은 주입), 코어
  준비 전 연결의 10초 대기, `slow_consumer` 가 다른 채널을 멈추지 않음, 16개 초과 거부, 확인 요청에 시험용
  결정기로 답함.
- MCP 스위치(§2, §5, §7.6, §9): 시험 호스트는 `--mcp on|off` 로 시작하고, 없으면 앱의 첫 실행처럼 꺼진 채
  시작한다. 표준 입력의 `mcp on`·`mcp off` 한 줄이 앱의 스위치처럼 바꾼다. 꺼진 호스트에서 직접 연결은 여전히
  `peer_signature` 이고, 중계는 75·`mcp_disabled` 로 끝나며 코어에 `open` 이 가지 않음. 켜면 같은 호스트가 중계에
  채널을 엶. 켜진 채 끄면 열린 중계 둘이 75(`app_closed_session`), 코어가 채널마다 `close`
  `{"reason":"mcp_disabled"}` 를 받고, 떠 있던 확인 창이 닫히며, 새 중계는 `mcp_disabled`. 다시 켜면 같은 코어의 다음
  채널. 끈 뒤 도착한 확인 요청은 창 없이 `unavailable`. 스위치에는 시험용 환경 변수가 없다. 이 인자와 표준 입력은
  DEBUG 시험 호스트만 읽고(릴리스 시험 호스트는 `--print-configuration` 만 한다), 앱은 defaults 만 읽는다.
- 릴리스 빌드는 시험용 변수를 읽지 않음: 릴리스 중계에 시험용 변수를 줘도 기본 경로와 운영 요건을 쓴다. 게이트
  (`scripts/check-all.sh`)가 아래 이름이 DEBUG 빌드에는 있고 릴리스 빌드에는 없는지 본다. 보는 파일은 패키지의
  `sherpa-relay` 와 Xcode 가 빌드한 Debug·Release 번들의 `Sherpa`·`sherpa-relay` 다. Debug 앱 타깃은
  `ENABLE_DEBUG_DYLIB = NO` 다. 켜면 앱의 코드가 `Sherpa.debug.dylib` 로 가 실행 파일에서 이름을 찾을 수 없다.
  [계약]
  Swift 최적화기는 15 바이트 이하의 문자열 리터럴을 명령어 안에 넣어 grep 이 찾지 못한다. 15 바이트인
  `SHERPA_CORE_BIN` 을 `#if DEBUG` 밖으로 옮긴 릴리스 빌드에서 grep 이 0건이었다. [실측: PR #45 리뷰,
  2026-11-21] 그래서 이름은 16 바이트 이상이고, 게이트가 그 길이도 확인한다. [계약]
- 게이트는 릴리스 빌드를 돌려도 본다. 릴리스 중계는 시험용 소켓 경로를 무시해야 한다. 릴리스 시험 호스트
  (`sherpa-app-testhost --print-configuration`, 앱과 같은 설정 해석)는 시험용 변수를 모두 받고도 기본 소켓, 번들
  배치의 코어 경로, 운영 요건을 써야 한다. 같은 변수를 받은 DEBUG 시험 호스트는 그 값을 쓰는지 보는 대조다.
  [계약]
- 번들(§2 "번들 빌드"): 게이트는 소유자의 Developer ID 인증서로 Xcode Release 번들을 빌드하고 배치(`Contents/MacOS/`
  의 셋), Info.plist(식별자, 판, `LSUIElement`, 사용 설명, Xcode 표준 키), 세 식별자와 hardened runtime, 지정
  요건의 팀, 앱만 가진 권한 항목, `codesign --verify --strict --deep`, 번들 중계의 `--version` 을 본다. 오류
  봉투를 쓰는 가짜 코어를 `SHERPA_CORE` 로 주면 빌드가 `core_not_mux` 로 실패하고 번들에 서명과 실행 파일이
  없어야 한다. 보안 타임스탬프는 내보낸 번들에만 있어 게이트는 보지 않는다. [계약]

DEBUG 빌드만 읽는 시험용 변수: 앱은 `SHERPA_APP_SOCKET`, `SHERPA_TEST_CORE_BIN`, `SHERPA_RELAY_REQUIREMENT`,
`SHERPA_CORE_REQUIREMENT`, 중계는 `SHERPA_APP_SOCKET`, `SHERPA_APP_REQUIREMENT`. 릴리스 빌드에는 컴파일되지
않는다. 코어 요건을 바꿀 수 있어야 게이트에서 ad-hoc 서명한 가짜 코어를 띄울 수 있다. [계약]

### 13.3 두 작업이 합쳐진 뒤

- DEBUG 앱, 빌드한 코어, 중계(시험 요건)로 세 세션이 동시에 `server/discover`, `tools/list`, 읽기 호출을 한다.
  나중에 병합되는 쪽이 게이트에 더한다. [계약] 2026-11-22 에 이 시험이 게이트에 없음을 확인했다. 앱의 프로세스 시험은
  가짜 코어(`sherpa-fake-core`)만 띄운다. [실측: `apple/sherpa-app/Tests/SherpaAppProcessTests/Support.swift`]

### 13.4 소유자 실기

- Developer ID 로 서명하고 공증한 번들: Claude Code 와 Codex(기능과 env 를 켠, §2) 설정으로 `tools/list` 와 읽기
  호출, 기본 설정 Codex 의 거부, 앱을 끈 상태의 69, 코어를 `kill -9` 했을 때 중계 75 와 재시작 뒤 에이전트의 재연결.
  2026-11-22 공증 전 내보낸 앱(이 판의 코어)으로 Codex 의 `tools/list`·읽기 호출, 기본 설정 Codex 의 거부, Claude
  Code 의 `server/discover`·`tools/list` 를 쟀다. [실측: live-evidence 2026-11-22 "The exported app with the 2026-07-28-only core"]
  같은 날 `main` `8de36c6` 을 처음부터 빌드해 내보낸 앱으로 Claude Code 의 읽기 호출(`claude -p`)과 Codex 의
  읽기 호출·기본 설정의 거부를 다시 쟀다. [실측: live-evidence 2026-11-22 "Claude Code calls a tool"] 공증한 번들과
  앱을 끈 상태의 69, 코어 `kill -9` 는 남았다.
- 삭제와 보내기: 확인 창이 맨 앞에 뜨는지, 허용·거부·30초 초과, 호출이 Codex 기본 60초 안에 끝나는지. 삭제의
  창·허용·거부·30초는 2026-11-21 내보낸 앱으로 쟀다(§9). 보내기와 Codex 를 거친 호출은 남았다.
- Codex 가 띄운 중계가 `~/Library/Application Support/Sherpa/run/app.sock` 에 붙는지. 2026-11-22 Codex 0.171.0
  `app-server` 가 띄운 중계(앞에 tee)가 내보낸 앱의 기본 소켓에 붙었다. [실측: live-evidence 2026-11-22]
- 앱이 띄운 코어의 `osascript` 보내기가 앱의 Apple Events 권한으로 판정되는지.
- 오래 켜 둔 앱과 코어의 메모리. 시험 빌드는 8분 동안 코어 13.6 MB, 호스트 5.2 MB 로 고정됐다.
- MCP 스위치와 상태 창(bunny-holes/sherpa#54, #52, §2). 2026-11-22 메인 세션이 이 작업의 `e0e2670` 을 내보낸 앱으로
  쟀다. 첫 실행에 MCP 가 꺼진 채 상태 창이 저절로 열렸다. 꺼진 동안 중계는 75 와 remedy 로 끝났고 Codex 는 서버를
  `failed` 로 두었다. 창의 스위치로 켜자 Codex 가 붙어 도구 35개를 보았고 호출은 `succeeded` 였다. Bun 프로그램이 직접
  띄워 `server/discover` 를 보낸 중계는 창의 스위치로 끄자 0.87초 안에 75 `app_closed_session` 으로 끝났다. 창의 중계
  경로는 잘리지 않았다. [실측: live-evidence 2026-11-22 "The MCP switch in the exported app"] 같은 앱의 중계를 Claude Code
  2.1.326 대화형의 `--mcp-config` 동적 서버로 붙이자, 꺼진 동안은 `Server stderr:` 에 remedy 를 남기고 실패했고
  켠 뒤 새 세션은 붙었다(§6). [실측: live-evidence 2026-11-22 "Claude Code against a relay turned away"] 남은 것은
  다음과 같다.
  - 연결 방법을 "?" 팝오버로 옮긴 뒤의 창: 높이, 도움말 단추, 팝오버, 툴팁.
  - 메뉴의 켜기·끄기, 켜진 채 끌 때 연결된 Claude Code·Codex 가 보이는 것.
  - 사용자 범위로 등록한 Claude Code 가 꺼진 동안 실패한 뒤, 켜고 `/mcp` 의 Reconnect 로 붙는지.
  - 복사한 명령을 그대로 넣어 붙는지.
  - `/Applications/Sherpa.app` 보다 긴 설치 경로에서 명령과 경로가 잘리지 않고, 선택해 복사한 값과 복사 단추의 값이
    `Contents/MacOS/sherpa-relay` 로 끝나는 전체 경로인지.

## 14. 시험 벡터

`←` 는 코어가 쓰는 프레임, `→` 는 앱이 쓰는 프레임이다. 탭은 `\t`, LF 는 `\n` 으로 적었다. 버전 `0.9.0` 은
보기다.

맞는 프레임:

```text
← 0\thello\t{"mux":1,"version":"0.9.0"}\n
→ 0\thello\t{"mux":1,"version":"0.9.0","workers":["planner"]}\n
← 0\trequest\t{"id":1,"worker":"planner","request":{"kind":"request","protocol_version":"2.0.0","application_contract":"sherpa.planner.v2","request_id":"op-1","operation_id":"op-1","capability":"capabilities","payload":{"schema":"sherpa.planner.capabilities.request.v2"},"deadline_ms":20000,"idempotency_key":"op-1","policy":{"effect":"read","required_evidence":"none","artifact_directory":null}}}\n
→ 0\tresponse\t{"id":1,"response":{"application_contract":"sherpa.planner.v2","capability":"capabilities","effect":{"kind":"none","state":"not_started"},"error":{"code":"protocol.unsupported_capability","retry":"never"},"kind":"response","operation_id":"op-1","protocol_version":"2.0.0","request_id":"op-1","status":"failed","warnings":[]}}\n
→ 0\tresponse\t{"id":2,"report":{"error":"sherpa.internal_failure","status":"failed"}}\n
→ 1\topen\n
→ 1\tdata\t{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n
← 1\tdata\t{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n
← 0\tconfirm\t{"id":3,"tool":"reminder_delete","operation_id":"op-2","client":{"name":"t","version":"0"},"title":"t","lines":[],"timeout_ms":30000}\n
→ 0\tconfirmation\t{"id":3,"decision":"declined"}\n
← 0\twithdraw\t{"id":3}\n
→ 1\tclose\n
← 2\tclose\t{"reason":"server_closed"}\n
← 0\tfatal\t{"code":"mux.frame_invalid"}\n
```

`data` 본문은 프레임 층이 해석하지 않는 보기다. 2026-07-28 의 실제 요청은 `params._meta` 에 봉투를 단다(§10.1).

위반(코어가 받으면 `fatal` 과 65, 앱이 코어 출력에서 보면 코어를 끝낸다):

```text
01\tdata\t{}\n                    앞자리 0
1\tDATA\t{}\n                     대문자 형식
1 data {}\n                       탭 없음
1\tdata\n                         본문 없는 data
1\tdata\t\n                       빈 본문
0\topen\n                         제어 채널의 open
1\thello\t{"mux":1}\n             MCP 채널의 hello
9007199254740992\topen\n          2^53
1\topen\n 를 두 번                 살아 있는 채널의 두 번째 open
1\topen\n 이 첫 프레임             인사 전 프레임
줄 끝 없이 8,454,144 바이트 초과    줄 한도
```

위반이 아닌 것:

```text
5\tdata\t{"jsonrpc":"2.0","method":"x"}\n   닫힌 채널: 버리고 debug 로그
1\tdata\tnot json\n                         그 채널에 -32700 오류, 연결 유지
0\tresponse\t{"id":99,"report":{"error":"x","status":"failed"}}\n   모르는 id(늦은 응답): 버리고 warn 로그
```

머리말(중계가 받는 줄과 그 결과):

```text
{"sherpa_app":1,"status":"ready","reason":null,"version":"0.9.0"}\n                 이어서 옮긴다
{"sherpa_app":1,"status":"unavailable","reason":"core_starting","version":"0.9.0"}\n 75
{"sherpa_app":1,"status":"unavailable","reason":"mcp_disabled","version":"0.9.0"}\n  75
{"sherpa_app":1,"status":"refused","reason":"peer_signature","version":"0.9.0"}\n    77
{"sherpa_app":2,"status":"ready","reason":null,"version":"9.0.0"}\n                 76
not json\n                                                                           76
15초 동안 아무것도 오지 않음                                                          75
```

## 15. 소유자 결정 (2026-11-21, 2026-11-22)

두 작업이 시작되기 전에 소유자가 이 계약의 선택을 정했다.

1. 삭제와 보내기는 앱 창에서 확인한다(§9). Claude Code 의 도구 권한 창이 켜져 있으면 두 번 묻는다. 그대로 둔다.
2. 확인 대기는 30초다. 그대로 둔다.
3. 1판 도구 목록(§10.2)은 그대로이고, `kakaotalk_checkpoint` 는 CLI 와 같은 확인 값을 `confirm` 인자로
   받는다(§10.4).
4. 팀 ID 를 소스 상수로 커밋한다(§4).
5. 코어와 CLI 는 같은 실행 파일(`sherpa app serve`), 식별자 `dev.xiyo.sherpa.core`, 번들 안 이름
   `sherpa-core` 다(§2).
6. 소켓 경로는 `~/Library/Application Support/Sherpa/run/app.sock` 이다(§3).
7. 2단계 동안 CLI 는 헬퍼 경로를 쓰고, 헬퍼 제거와 CLI 의 앱 소켓 연결은 3단계에서 정한다(§11).
8. 코어가 다시 뜨면 모든 MCP 연결이 끊기는 것을 1판은 받아들인다(§7.8).
9. 1판은 같은 사용자를 믿는 범위로 둔다(§4 "믿는 범위"). 중계를 띄운 프로그램의 허용은
   bunny-holes/sherpa#39 이다.
10. (2026-11-22) MCP 는 2026-07-28 만 받는다. 기본 설정 Codex 0.171.0 이 붙지 못하는 것을 받아들이고, 삭제·보내기
    확인은 elicitation 이 아니라 앱 창 그대로다(§9, §10.1, ADR-0011).

## 16. 미확인

- 중계가 앱을 띄우는 동작과 로그인 항목(ADR-0010).
- Claude Code 가 기능 플래그로 서버를 옛 규격에 두어 2025-11-25 `initialize` 로 붙고 거부되는 일(ADR-0011 의 위험). 7일
  생략은 2026-11-22 에 답도 종료도 없는 시험 서버에서만 일어났고, 켜진 앱에서는 그 연결 안에서 풀렸다(§6). Codex 가
  2025-06-18 로 내려가는 조건도 시험 서버로 쟀다(ADR-0011 의 위험). 설치한 `sherpa` 항목으로는 재지 않았다.
- MCP 가 꺼졌거나 앱이 없을 때 remedy 를 두 에이전트의 화면에 보이는 응답 모양. 지금은 둘 다 연결이 닫혔다고만
  보인다(§6). 시험 서버로 잰 세 후보는 live-evidence 2026-11-22 "Claude Code and Codex after a relay that ended" 에
  있다.
- Codex 가 같은 세션 안에서 실패한 서버를 다시 띄우는 길. app-server 에 `config/mcpServer/reload` 가 있으나 부르지
  않았다.
- 이 Mac 의 선 위에서 Claude Code 와 Codex 가 2026-07-28 봉투의 `clientCapabilities` 에 선언하는 elicitation(Claude
  Code 는 문서에, Codex 는 소스에 있다).
- Claude Code 2.1.326 의 `anthropic/requiresUserInteraction` 지원.
- Codex 의 모델 기본 도구 출력 예산 값.
- 앱이 띄운 코어의 `osascript` 보내기가 앱의 Apple Events 권한으로 판정되는지.
- 중계가 끝났을 때 Codex 가 서버를 다시 띄우는지, 그리고 이 Mac 에서 Claude Code 가 문서대로 동작하는지.
- Developer ID 로 양방향 서명이 통과하는 경로. 인증서가 소유자 키체인에만 있어 게이트는 거부 쪽과 시험 요건만
  돈다.
- DEBUG 앱·빌드한 코어·중계의 통합 시험(§13.3). 게이트에 없다.
- 내보낸 앱의 메뉴 막대 아이콘이 보이는지와 미리보기 앱에서 보이지 않은 원인, 메뉴의 Quit, 오래 켜 둔 앱과 코어의
  메모리. 2026-11-21 의 #29 실기에서 재지 않았다.
- 도구별 결과 스키마. Swift 와 ObjC 응답의 null 키 차이가 정리된 뒤 정한다.
- MCP 스위치와 상태 창의 실기(§13.4): "?" 팝오버로 바꾼 창, 메뉴의 켜고 끄기, 끌 때 에이전트가 보이는 것, 복사한
  명령, 긴 설치 경로에서 #52 가 고쳐졌는지. 게이트는 서버의 동작과 명령 글만 보고, 창의 배치는 보지 않는다.

닫힌 것: 2026-11-21 #29 실기는 내보낸 앱에서 삭제 확인 창의 내용·허용·거부·30초와 1초 무장, 상태 창의 권한
표시를 쟀다(§9). 같은 실기에서 상태 창이 중계 경로를 "…" 로 자른 결함은 bunny-holes/sherpa#52 다. 2026-11-22 Codex
실측은 Codex 가 띄운 중계의 기본 소켓 연결과, 기능과 env 를 켠 Codex 의 2026-07-28 연결을 쟀다. 같은 날 이 판의
코어를 담은 내보낸 앱으로 Claude Code 의 2026-07-28 연결과 기본 설정 Codex 의 거부(서버 `failed`, 도구 호출 -32603,
다시 묻지 않음)를 쟀다(§10.1). `main` `8de36c6` 을 처음부터 빌드해 내보낸 앱으로 Claude Code 2.1.326 이 `claude -p`
에서 `server/discover`·`tools/list`·`tools/call` 을 모두 2026-07-28 봉투로 보내 `reminder_authorization_status` 를
불렀다(결과 `succeeded`). 이로써 내보낸 앱 경로의 Claude Code 도구 호출이 닫혔다(ADR-0011). 같은 날 `e0e2670` 을
내보낸 앱으로 첫 실행 창, 꺼진 동안의 거부(중계 75, Codex `failed`), 창의 스위치로 켠 뒤의 Codex 연결과 호출을
쟀다. 연결된 중계가 끌 때 75 `app_closed_session` 으로 끝나는 것과, 동적 서버로 머리말 단계 실패 뒤 Claude Code 가
다시 띄우는 모양과 다음 세션도 쟀다(§6, §13.4). 같은 날 `plug-hole` 로 설치한 플러그인 0.9.0 이
`/Applications/Sherpa.app` 에 두 에이전트의 실제 설정으로 붙었다. Claude Code 는 2026-07-28 로 이어 haiku 로 도구를
한 번 불렀다. Codex 는 `-c` 덮어쓰기 없이 기능 `mcp_2026_07_28` 만 켠 채 35개 도구로 이어 도구를 불렀다(§2
"플러그인의 MCP 등록").

## Related

- [ADR-0010: 메뉴 막대 앱과 MCP](../adr/0010-menu-bar-app-and-mcp.md)
- [ADR-0011: MCP 는 2026-07-28 만 받는다](../adr/0011-mcp-2026-07-28-only.md)
- [ADR-0009: Developer ID 로 서명한 헬퍼 번들](../adr/0009-developer-id-signed-helper-bundle.md)
- [ADR-0008: Bun + TypeScript 코어](../adr/0008-bun-typescript-core.md)
- [Worker protocol](worker-protocol.md)
- [System architecture](../architecture/README.md)
- [Test strategy](../testing/README.md)
- [실측 기록](../testing/live-evidence.md)
