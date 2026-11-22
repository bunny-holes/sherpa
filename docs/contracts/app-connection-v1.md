---
uuid: 01a1fd34-889b-79a0-b7de-04b056559cd9
type: spec
audience: "코어 MCP 서버(core/)와 메뉴 막대 앱·중계(apple/)를 따로 만드는 사람과 에이전트"
goal: "상대 쪽이 아직 없어도 이 문서만으로 자기 쪽을 만들고 시험하게 한다: 소켓, 서명 확인, 다중화, 중계 종료 코드, MCP 도구 규칙"
tone: "평어체 규범. 규칙마다 소유자 결정, 실측, 문서, 계약, 추론을 가르고 증명 안 된 것은 미확인으로 적는다"
manner: "경계마다 규칙을 먼저 쓰고 근거를 괄호로 붙인다. 시험 빌드의 코드는 옮기지 않고 사실만 옮긴다"
---

# 앱 연결 계약 V3

상태: 계약 3판(2026-11-22, bunny-holes/sherpa#66). 1판(2026-11-21)의 코어 쪽(bunny-holes/sherpa#27)과 앱·중계(#28)가
모두 구현됐고, 배포(#31)와 소유자 실기(#29)가 남았다. 2판(2026-11-22, #63)은 [ADR-0012](../adr/0012-in-app-chat.md)
구현 단계 1 이다. `open` 이 채널 종류를 싣고(§7.3) MCP 스위치는 `mcp` 채널만 닫는다(§7.6, §9). 3판은 같은 ADR 의
구현 단계 4 의 몫이다. `confirm` 이 그 호출이 온 채널을 싣고, 앱은 확인의 출처를 그 채널의 종류로 가리며, 스위치는
`mcp` 채널의 확인만 거둔다(§9). 그래서 인사의 `mux` 가 3 이 되고 1 과 2 는 받지 않는다(§7.5). 같은 3판에 단계 4 의
다음 몫이 채널 종류 `chat` 과 그 첫 메시지인 모델 목록(§7.11)을 더했다. 종류를 더한 것이라 `mux` 는 3 그대로다. 같은
판에서 단계 4 의 AI SDK 울타리가 시작 때의 셋째 거부(§7.1)와 그 로그 줄(§12)을 더했고, 이어서 글 차례와 모델이
부르는 도구(§7.11)가 메시지를 더했다. 그 밖의 규칙은 앞 판 그대로이고, 본문에 "1판" 으로 적은 범위(작업자, 도구 목록, 믿는 범위 등)도 3판에 그대로 이어진다.
링크와 시험이 이 경로를 읽으므로 파일 이름은 바꾸지 않는다.
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

용어: 이 문서의 "세션" 은 중계 연결 하나, 곧 앱이 종류 `mcp` 로 연 채널 하나다(§7.3). MCP 2026-07-28 에는
프로토콜 세션이 없고, 서버는 같은 연결의 앞선 요청으로 능력·규격·클라이언트 신원을 세우지 않는다. [문서: MCP 2026-07-28
[Overview](https://modelcontextprotocol.io/specification/2026-07-28/basic), "Statelessness"] 머리말 `too_many_sessions` 와 로그 `session-open`·`session-close` 의
"session" 도 이 뜻이다. [계약]

이 계약이 정하는 것: 번들 배치와 서명 식별자, 소켓과 단일 인스턴스, 양방향 서명 확인, 앱이 중계에 먼저 보내는
머리말, 중계의 동작과 종료 코드, 앱과 코어 사이 프레임(MCP 다중화, 작업 요청, 확인 요청), MCP 도구 규칙,
경계의 로그, 각 쪽의 시험 층, 플러그인의 MCP 등록.

정하지 않는 것: 메뉴와 창의 생김새, 공증·cask·formula 이전(3단계), 로그인 항목과 중계가 앱을 띄우는 동작(ADR-0010 의 미확인), 헬퍼 번들을 걷어 낸 뒤 `sherpa` 명령이 EventKit 에
닿는 길(§11).

판: 프레임은 `mux: 3`, 머리말은 `sherpa_app: 1`, 도구 결과는 `sherpa.mcp.tool-outcome.v1`, 채팅 채널의 메시지는
`sherpa.chat.v1`(§7.11)이다. 호환되지 않는 변경은 그 숫자를 올리고 이 문서의 새 판을 낸다. [계약] 2판은 `open` 에
채널 종류를 실으며 `mux` 를 1 에서 2 로 올렸다. [계약; ADR-0012 "앱과 코어 사이 채널"] 3판은 `confirm` 본문에
`channel` 을 더하며 `mux` 를 2 에서 3 으로 올렸다. 앱은 정해진 키만 가진 `confirm` 본문을 읽으므로(§9), 판이 섞이면
2판의 앱은 3판 코어의 확인을, 3판의 앱은 2판 코어의 확인을 모두 잘못된 본문으로 보고 `unavailable` 로 답한다. 인사가
그 섞임을 확인 전에 가려 낸다(§7.5). 머리말과 도구 결과의 숫자는 그대로다. [계약; ADR-0012 "확인 흐름"]

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
  의 Mux 3 인사이고 버전이 앱의 버전인지 본다. 아니면 `reason=core_not_mux` 로 빌드를 실패시키고, 번들에는
  서명도 실행 파일도 남지 않는다. 인사를 통과한 코어는 `BUN_BE_BUN=1 <코어> --version` 이 `core/package.json` 의
  `devEngines.packageManager` 가 선언한 Bun 판이어야 한다. 아니면 `reason=core_runtime_mismatch`(답이 없으면
  `core_runtime_unreadable`)로 같은 식으로 실패한다. 선언 판은 게이트와 `scripts/package.sh` 가 쓰는
  `scripts/lib/bun-pin.sh` 가 PATH 의 bun 없이 읽는다(bunny-holes/sherpa#71). 통과하면 식별자
  `dev.xiyo.sherpa.core`, hardened runtime, 권한 항목 없이 Xcode 가 앱에 고른 인증서(`EXPANDED_CODE_SIGN_IDENTITY`)로
  서명해 `Contents/MacOS/sherpa-core` 에 둔다. [계약; 동작은 실측]
- 스크립트 샌드박스(`ENABLE_USER_SCRIPT_SANDBOXING`)는 켜 둔다. 샌드박스 안에서도 코어는 실행된다. codesign 은
  대상 옆에 임시 파일을 써서 번들 안에서 서명하면 "Write permissions error" 로 실패하므로, 단계는 `TEMP_DIR` 의
  사본을 서명한 뒤 번들에 복사한다. [실측] Xcode 27.2 가 만드는 샌드박스 프로필은 `SRCROOT` 와 빌드 폴더만 막고
  그 안에서는 선언한 입력·출력과 `TEMP_DIR` 만 연다. 그래서 단계는 `SRCROOT` 밖의 `scripts/lib/bun-pin.sh` 와
  `core/package.json` 을 입력으로 적지 않아도 읽었다. 둘을 입력으로 적는 것은 어느 하나가 바뀌면 단계가 다시
  돌게 하려는 것이다. 적기 전에는 `core/package.json` 만 바뀐 증분 빌드가 단계를 건너뛰었다. [실측: 2026-11-22,
  bunny-holes/sherpa#63]
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
  열린 중계 연결을 모두 닫고(§7.6), 그 연결의 호출이 띄운 확인 창을 답 없이 닫는다(§9). 꺼져 있는 동안에도 코어는 돈다. [계약]
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
- 단일 인스턴스: 앱은 시작하자마자 `app.lock` 을 열어(`O_CREAT|O_RDWR|O_CLOEXEC|O_NOFOLLOW`, 0600)
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
- 정상 종료: 리스너를 닫고 소켓 파일을 지우고, 잠금을 `flock(LOCK_UN)` 으로 푼 뒤 잠금 파일 설명자를 닫는다.
  [계약] 닫기만 하면 그 열린 파일을 가리키는 마지막 설명자가 닫힐 때에야 잠금이 풀린다. [문서: `man 2 close`,
  `man 2 flock`] 같은 프로세스의 다른 스레드가 `posix_spawn`·`fork` 로 만드는 자식은 `O_CLOEXEC` 설명자까지
  복사해 쥐다가 exec 에서 닫으므로, 그 사이에는 닫은 잠금이 풀리지 않았다.
  [실측: live-evidence 2026-11-22 "The instance lock outlived its close", bunny-holes/sherpa#78]
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
- 연결된 중계가 켜진 채 끈 MCP 로 끝나면 Codex 0.171.0 은 위 줄을 로그(INFO)에 남기고 서버를 `failed` 로 두며, 같은
  스레드에서는 다시 띄우지 않는다. 새 세션은 붙는다. Claude Code 2.1.330 은 플러그인 서버를 `✘ failed` 로 두고 스스로
  다시 붙지 않으며, `/mcp` 의 Reconnect 로 붙는다. 그 서버 페이지에는 `Issue`·`Log` 가 없고, 디버그 로그와 서버의
  MCP 로그에도 중계의 줄과 닫힘이 남지 않는다. 그래서 Claude Code 에서는 이 remedy 가 사람에게 보이지 않는다.
  [실측: live-evidence 2026-11-22 "The Mux 2 bundle"]
- MCP 가 꺼진 앱(75)이나 떠 있지 않은 앱(69)에서 중계가 끝나면 Claude Code 2.1.326 과 2.1.330 대화형은 그 시도 안에서
  서버를 옛 규격으로 고정해 한 번 다시 띄운다. 다시 띄운 중계는 `initialize`(2025-11-25)를 받고 같은 이유로 끝난다.
  플러그인 범위, 사용자 범위, `--mcp-config` 동적 서버가 같았다(2.1.330 은 앞의 두 범위만 쟀다). 로그는 다음 순서다.
  [실측: live-evidence 2026-11-22 "Claude Code against a relay turned away", "Claude Code and Codex after a relay that
  ended", "Claude Code 2.1.330 after a relay that ended"]
  - `version negotiation probe closed the stdio server (rmcp-class pre-init hard close); respawning pinned legacy`
  - 중계의 줄을 담은 `Server stderr:`
  - `Connection failed (CONNECTION_CLOSED)`
- 그 고정은 그 시도로 끝난다. 75·69 뒤에 Claude Code 는 7일 생략의 기억(설정 폴더의
  `state/mcp-discover-verdicts.json`)을 남기지 않았고, 다음 시도는 다시 `server/discover` 부터 물었다. 플러그인 범위는
  실패를 15분 실패 캐시(`mcp-needs-auth-cache.json`)에 적어 그동안 새 세션이 서버를 띄우지 않는다(§2). 사용자 범위와
  동적 서버는 적지 않았다. MCP 를 켠 뒤에는 `/mcp` 의 Reconnect(서버 페이지의 메뉴와 `/mcp reconnect <서버>`)와 새
  세션(플러그인 범위는 15분 뒤)이 `protocolEra` `modern` 으로 붙었고, 붙은 연결이 그 서버의 실패 캐시 항목을 지웠다.
  페이지의 Reconnect 는 실패 캐시를 기다리지 않았다(2.1.330). [실측: live-evidence 2026-11-22 "Claude Code and Codex
  after a relay that ended", "Claude Code 2.1.330 after a relay that ended"]
- 2.1.330 의 `/mcp` 서버 페이지는 `Issue: CONNECTION_CLOSED: Connection closed` 와, 중계의 줄이 든 MCP 로그 파일을
  가리키는 `Log` 줄을 보인다. 다시 이어도 실패하면 페이지는 `Couldn't reconnect to <서버>` 를 더하고 열린 채 남는다.
  tool search 가 켜진 세션에서 모델은 첫 요청부터 실패한 서버 목록의 `<서버> (CONNECTION_CLOSED): "Connection closed"`
  한 줄만 받는다. remedy 는 그 MCP 로그에만 있다. [실측: live-evidence 2026-11-22 "Claude Code 2.1.330 after a relay
  that ended"]
- 7일 생략의 기억은 `server/discover` 에 3초 안에 답하지 않고 30초 연결 시한까지 끝나지도 않는 서버에만 생겼다. 기억된
  서버가 켜진 앱에 붙으면 Claude Code 는 probe 없이 `initialize` 를 보내고, 코어의 -32022 를 받자 기억을 지우고 같은
  연결에서 `server/discover` 로 다시 띄워 붙었다. [실측: live-evidence 2026-11-22 "Claude Code and Codex after a relay
  that ended", "Claude Code 2.1.330 after a relay that ended"]
- Codex 0.171.0(기능과 env 를 켬)은 `server/discover` 뒤 끝난 중계를 다시 띄우지 않고 `connection closed: discover
  response` 로 실패로 둔다. remedy 는 Codex 가 보이는 오류에 없고 app-server 의 `INFO` 로그(`MCP server stderr`)에만
  있다. 새 스레드는 새 중계를 띄워 `server/discover` 부터 물었고, MCP 를 켠 뒤에는 붙었다. [실측: live-evidence
  2026-11-22 "Claude Code and Codex after a relay that ended"]
- MCP 내용과 소켓의 절대 경로(사용자 이름이 들어 있다)는 쓰지 않는다. 경로는 `socket=default` 또는
  `socket=override` 로만 적는다. [계약]
- `LOG_LEVEL` 을 따르고 기본은 warn 이다. [계약]

## 7. 앱과 코어 사이 프레임

### 7.1 코어 실행

- 앱은 코어 하나를 `Contents/MacOS/sherpa-core app serve` 로 띄우고 표준 입력·출력·오류를 파이프로 잇는다.
  코어는 앱과 이 파이프로만 주고받고 듣는 소켓을 열지 않는다. 코어가 여는 연결은 채팅 채널(§7.11)이 사람이 고른
  제공자의 출처로 내는 HTTPS 요청뿐이다. [소유자, ADR-0012 결정 3 이 ADR-0010 결정 2 를 고쳤다] 코어는 어느 명령이든 시작할 때
  `globalThis.fetch` 를 모든 호출을 거부하는 함수로, `globalThis.WebSocket` 을 모든 연결을 거부하는 생성자로,
  `globalThis.AI_SDK_DEFAULT_PROVIDER` 를 모든 모델을 거부하는 제공자로 바꾸고(`core/src/chat/egress.ts`), 셋 다 다시
  쓰거나 재정의하지 못하게 한다. AI SDK 는 문자열로 받은 모델 id 를 그 전역이 비었을 때만 Vercel AI Gateway 로
  푼다. 코어 린트 규칙은 소켓·HTTP·WebSocket·이름 풀이 API 를 `core/src` 어디서나, `fetch` 를 그 모듈 밖에서
  막는다. 린트는 코어가 번들하는 패키지를 보지 않으므로 그 패키지는 단위 시험이 패턴으로 읽고(§13.1), 그 패키지가
  전역 `fetch`·`WebSocket`·기본 제공자로 가는 길은 시작 때의 거부가 막는다. [계약; ADR-0012 "코드로 지키기"]
  빌드한 코어는 MCP 연결을 받는 동안 인터넷 소켓도 듣는 Unix 소켓도 쥐지 않는다. 나가는 길이 막는 출처(평문 http
  루프백)의 모델 목록은 연결 없이 `egress_denied` 로 끝나고, 그 뒤에도 소켓이 없다. 같은 출처의 글 차례도 그 출처에
  연결 하나 오지 않은 채 `egress_denied` 로 끝나고, 그 뒤에도 소켓이 없으며, 코어는 AI SDK 를 싣지 않는다. 자체 서명
  인증서의 https 루프백 출처에는 연결하지만 TLS 확인이 거부해 그 서버의 처리기에 요청이 닿지 않는다. 시험이 넘긴 인증
  기관(아래)이 서명한 https 루프백 출처의 모델 목록과 글 차례는 그 서버에 닿고, 서버가 답을 잡고 있는 동안 코어의
  인터넷 소켓은 모두 그 서버로 가는 연결이다. 그 서버가 받은 요청은 모델 목록 하나와 차례 둘뿐이다. 모델 목록에 그
  출처가 보낸 리디렉트는 따르지 않는다. [실측: `core/tests/stdio/egress.test.ts`]
- 환경은 물려주지 않는다. `HOME`, `TMPDIR`, `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, `LOG_LEVEL` 만 넘긴다.
  [계약] 그래서 Bun 이 시작 때 읽는 `NODE_EXTRA_CA_CERTS`, `NODE_USE_SYSTEM_CA`, `BUN_OPTIONS` 는 앱이 띄운 코어에
  닿지 않는다. Bun 1.4.5 로 빌드한 코어는 `NODE_EXTRA_CA_CERTS` 가 가리킨 인증 기관을 믿고, 시험만 이것으로 믿을 수
  있는 로컬 TLS 서버를 만든다. [실측: `core/tests/stdio/egress.test.ts`] 그 밖에 코어는 Bun 에 든 인증 기관과
  macOS 의 시스템 저장소를 믿는다. [소유자, 2026-11-22] Bun 은 시스템 저장소를 `--use-system-ca` 나
  `NODE_USE_SYSTEM_CA=1` 이 있을 때만 더하므로 `bun run build` 가 `--compile-exec-argv=--use-system-ca` 로 그 깃발을
  코어에 넣고, 앱처럼 `/` 에서 띄운 빌드한 코어의 기본 저장소는 Bun 에 든 것과 시스템 저장소를 함께 갖는다. [실측:
  `core/tests/stdio/egress.test.ts`] 이 Mac 에서 Bun 1.4.5 의 시스템 저장소는 키체인에 있고 관리자 신뢰 설정이 믿는
  인증서 5개였다. 사용자 신뢰 설정의 인증서 10개는 모두 키체인에 있고 7개는 SSL 서버에 신뢰했는데도 하나도 들지
  않았다. [실측: live-evidence 2026-11-22] 사용자 신뢰 설정에서만 믿게 한 루트까지는 넓히지 않는다. [소유자,
  2026-11-22] 그 저장소의 루트 뒤의 출처를 코어의 `fetch` 가 끝까지 받는지는 키체인을
  바꾸지 않고는 재지 못해 재지 않았다. [미확인; §16]
- 앱이 띄운 자식은 앱의 전체 디스크 접근 권한으로 판정된다. [실측] 코어가 띄우는 `osascript` 의 Apple Events
  가 앱의 권한과 hardened runtime 항목으로 판정되는지는 재지 않았다. [미확인]
- 빌드한 코어는 실행한 폴더의 `.env` 파일(`.env.local`, `.env.<NODE_ENV>` 포함), `bunfig.toml`, `tsconfig.json`,
  `package.json` 과 HOME·`XDG_CONFIG_HOME` 의 `.bunfig.toml` 을 읽지 않는다. Bun 의 단일 실행 파일은 빌드가 끄지 않으면 실행한 폴더의
  `.env` 파일과 `bunfig.toml` 을 읽어 그 환경과 설정을 코어에 적용하고, `tsconfig.json`·`package.json` 은 빌드가 켤
  때 읽는다. `bun run build` 는 `--no-compile-autoload-dotenv`, `--no-compile-autoload-bunfig`,
  `--no-compile-autoload-tsconfig`, `--no-compile-autoload-package-json` 으로 넷을 모두 끈다. 뒤의 둘은 1.4.5 의
  기본이 이미 꺼짐이지만, 다음 Bun 이 기본을 바꿔도 열리지 않게 적는다. 1.4.5 는 그 둘을 `.env` 파일을 읽을 때만
  읽으므로 빌드한 코어의 동작으로는 그 깃발이 보이지 않는다. 그래서 단위 시험이 build 명령에 네 깃발이 모두 있고
  다시 켜는 깃발은 없음을 본다. HOME·`XDG_CONFIG_HOME` 의 `.bunfig.toml` 은 1.4.5 의 단일 실행 파일이 깃발 없이도
  읽지 않으므로, 시험의 그 경우는 다음 Bun 을 지킨다. `scripts/package.sh` 는 배포할 코어를 그 파일들을 둔 폴더와
  HOME·`XDG_CONFIG_HOME` 으로 한 번 돌려 보고, 무언가 읽으면 `core_reads_working_directory` 로 멈춘다. [계약; 실측:
  `core/tests/stdio/cli.test.ts`, `core/tests/build.test.ts`, live-evidence 2026-11-22; 문서: Bun 1.4.5
  `bun build --help`] 앱은 코어에 작업 폴더를 주지 않으므로 코어는 앱의 작업 폴더를 물려받고, 떠 있는 앱과 코어는
  `/` 에 있었다. [실측: live-evidence 2026-11-22]

### 7.2 문법

```text
frame   = channel HTAB type [HTAB body] LF
channel = "0" / (%x31-39 *15DIGIT)    ; 10진수, 앞자리 0 없음, 2^53-1 이하
type    = 1*16(%x61-7A / "-")         ; 소문자
body    = 1*(%x00-09 / %x0B-FF)       ; LF 없는 UTF-8 JSON 값 하나
```

- 채널 0 은 제어 채널이고, 1 이상은 앱이 연 채널 하나다. 채널의 종류는 그 채널의 `open` 이 정하고(§7.3), `mcp`
  채널은 MCP 연결 하나다. 앱은 채널을 열 때마다 종류와 상관없이 한 계수기로 1 부터 올려 매기고, 코어 프로세스
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
| 0 | `hello` | 코어 → 앱 | `{"mux":3,"version":"…"}` | 코어 준비 끝. 코어의 첫 프레임 |
| 0 | `hello` | 앱 → 코어 | `{"mux":3,"version":"…","workers":["planner"]}` | 앱이 받아들였다. 앱의 첫 프레임 |
| 0 | `request` | 코어 → 앱 | §8 | 앱 작업 요청 |
| 0 | `response` | 앱 → 코어 | §8 | 작업 응답 |
| 0 | `confirm` | 코어 → 앱 | §9 | 사람 확인 요청 |
| 0 | `confirmation` | 앱 → 코어 | §9 | 확인 결과 |
| 0 | `withdraw` | 코어 → 앱 | `{"id":N}` | 확인 요청을 거둔다 |
| 0 | `fatal` | 코어 → 앱 | `{"code":"mux.…"}` | 코어가 프로토콜 위반으로 곧 끝난다 |
| 1 이상 | `open` | 앱 → 코어 | `{"kind":"mcp"}` 또는 `{"kind":"chat"}` | 그 종류의 채널이 생겼다. `mcp` 는 확인된 중계 연결 하나, `chat` 은 앱 안 채팅 하나다(§7.11) |
| 1 이상 | `data` | 양방향 | `mcp` 는 MCP JSON-RPC 메시지 하나, `chat` 은 `sherpa.chat.v1` 메시지 하나 | |
| 1 이상 | `close` | 양방향 | 없음 또는 `{"reason":"…"}` | 채널의 끝 |

- 같은 파이프에 쓰는 프레임은 한 덩이로 쓰고 서로 끼어들지 않게 한다. [계약]
- `open` 의 본문은 키 `kind` 하나만 가진 JSON 객체이고, 그 값은 형식과 같은 문법의 낱말(`1*16(%x61-7A / "-")`)인
  채널 종류다. 3판의 코어가 받는 종류는 `mcp`(중계 연결 하나, §7.6)와 `chat`(채팅 하나, §7.11) 둘이다. [계약;
  ADR-0012 "앱과 코어 사이 채널"]
- 표에 없는 조합(채널 0 의 `data`, 채널 1 이상의 `hello` 등), 문법 위반, 인사 전의 다른 프레임, 살아 있는 채널의
  두 번째 `open` 은 프로토콜 위반이다. 코어는 `fatal` 을 쓰고 65 로 끝난다. 앱은 코어 출력에서 위반을 보면
  코어를 끝낸다(§7.8 의 재시작 규칙을 따른다). [계약]
- `fatal` 의 코드: 문법이나 본문 모양 오류, 그리고 V2 모양이나 상관 값이 맞지 않는 `response` 본문은
  `mux.frame_invalid`, 한도 초과는 `mux.frame_too_large`, 표나 순서 위반(채널·방향에 없는 형식, 인사 전 프레임,
  두 번째 `open`·`hello`, 닫힌 번호의 `open`)은 `mux.unexpected_frame`, 앱 `hello` 의 `mux` 가 3 이 아니면
  `mux.version_unsupported` 다. 본문 없는 `open`(Mux 1 의 `open`)과 모양이 틀린 `open` 본문(JSON 이 아님, `kind`
  가 없음, 낱말이 아닌 값, 다른 키)은 본문 모양 오류다. 앱은 코드와 상관없이 같은 규칙으로 코어를 다룬다. [계약]
- 모양이 맞지만 코어가 받지 않는 종류의 `open` 은 위반이 아니다. 코어는 그 채널에
  `N\tclose\t{"reason":"unsupported_kind"}` 를 쓰고 warn 로그를 남기며(§12) 다른 채널과 함께 계속 돈다. 그 번호는
  쓴 번호이므로 같은 번호의 `open` 은 닫힌 번호의 `open` 이고, 엇갈려 온 그 채널의 `data`·`close` 는 아래 규칙대로
  버린다. [계약]
  이유: 위반은 표, 문법, 순서가 어긋난 것이고 (채널 1 이상, `open`, 앱 → 코어, 본문 있음)은 표에 있는 조합이다.
  종류는 그 본문의 값이고 그 채널 하나에만 걸린다. 그래서 JSON 이 아닌 `data` 본문을 그 연결의 MCP 오류로 다루고
  (아래) 모르는 작업자를 그 요청의 V2 실패 `app.unsupported_worker` 로 다루듯(§8) 그 채널만 닫는다. 종류 하나를
  모른다고 코어를 끝내면 다른 채널의 연결과 진행 중 호출이 모두 끊긴다(§7.8). [추론]
- 닫힌 채널이나 모르는 채널의 `data`·`close` 는 닫기와 엇갈린 것이므로 위반이 아니다. debug 로그만 남기고
  버린다. [계약]
- `mcp` 채널의 `data` 본문이 JSON 이 아니면 프레임 위반이 아니라 그 연결의 MCP 오류다. 코어는 그 채널에
  `{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}` 를 보내고 연결을 유지한다.
  `chat` 채널에서는 `error` `invalid_message` 를 보내고 채널을 유지한다(§7.11). [계약]

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
- 코어는 4 MiB 를 넘는 `data` 를 만들지 않는다. `mcp` 채널은 §10.5 의 1 MiB 결과 한도가, `chat` 채널은 §7.11 의
  한도(모델 id 1,000개, 하나에 256 바이트)가 이를 보장한다. [계약]

### 7.5 인사

1. 코어는 준비되면 첫 프레임으로 `0\thello\t{"mux":3,"version":"<코어 버전>"}` 를 쓴다.
2. 앱은 그것을 10초 안에 받아야 한다. `mux` 가 3 이고 `version` 이 앱 버전과 같으면 `hello` 로 답한다. 같은
   번들에서 나온 둘의 `mux` 나 버전이 다르면 설치가 깨진 것이다. 앱은 코어를 끝내고 상태를 `core_incompatible` 로
   두며 다시 띄우지 않는다.
3. 코어는 앱의 `hello` 를 받기 전에 다른 프레임을 쓰지 않는다. 앱의 `mux` 가 3 이 아니면 `fatal`
   `mux.version_unsupported` 를 쓰고 65 로 끝난다.
4. 앱은 `hello` 를 보낸 뒤에만 `open` 을 보낸다. 코어는 앱의 `hello` 를 받자마자 `capabilities` 작업 요청으로
   도구 목록의 근거를 얻는다(§10.2).

모두 [계약].

3판의 앱과 코어는 앞 판(Mux 1, Mux 2)을 받지 않는다. 앱과 코어는 한 번들로 나가고 인사에서 버전이 같아야 하므로
두 판을 함께 받을 까닭이 없다. [계약; ADR-0012 "앱과 코어 사이 채널"] CLI 버전은 병합마다 오르지 않아 3판 전에
빌드한 코어도 같은 버전을 말할 수 있으므로, 그 코어는 `mux` 로 가려 낸다. 번들 빌드도 Mux 3 인사가 아닌 코어를
넣지 않는다(§2 "번들 빌드"). [계약]

### 7.6 연결 수명

- 앱은 중계를 확인하고 머리말 `ready` 를 쓴 뒤 `N\topen\t{"kind":"mcp"}` 를 보낸다. 어느 채널이든 `open` 이 그
  채널의 첫 `data` 보다 앞선다. [계약]
- 코어는 `mcp` 채널의 `open` 마다 그 채널의 전송 객체를 만들어 `serveStdio(factory, { transport, legacy: "reject" })`
  로 MCP 연결 하나를 돌린다(§10.1). [실측: 시험 빌드; 문서: SDK 2.4.0 `dist/stdio.d.mts` 의 `ServeStdioOptions`]
- 중계 소켓이 EOF 나 오류로 끝나면 앱은 `N\tclose` 를 보낸다. 코어는 그 세션을 닫는다. 그 뒤 코어가 그 채널에
  쓴 프레임은 앱이 버린다. [계약]
- 코어가 세션을 끝내면 `N\tclose` 를 보낸다. 앱은 그 채널에 쌓인 바이트를 중계에 다 쓴 뒤 소켓을 닫는다.
  [계약]
- 사람이 MCP 를 끄면(§2) 앱은 열린 `mcp` 채널마다 `N\tclose\t{"reason":"mcp_disabled"}` 를 코어에 보내고, 그 중계
  소켓을 대기열을 버리고 곧바로 닫는다. 중계는 입력이 열린 채 EOF 를 받아 75 로 끝난다. 아직 코어를 기다리던 연결은
  머리말 `mcp_disabled` 를 받는다. 다시 켜면 같은 코어가 이어지는 번호로 채널을 연다. 스위치는 다른 종류의 채널을
  닫지 않는다. 채팅 채널은 앱의 "AI 연결하기" 쪽이 따로 열고 닫는다(ADR-0012 결정 6, "앱과 코어 사이 채널"). [계약]

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

### 7.11 채팅 채널

앱이 `N\topen\t{"kind":"chat"}` 로 연 채널 하나가 앱 안 채팅 하나다. [계약; ADR-0012 "앱과 코어 사이 채널"] 이
판의 코어는 모델 목록과 글 차례(`turn`·`cancel` 과 `delta`·`tool`·`done`)를 받고, 차례의 모델은 코어의 도구를
부른다("도구"). `text` 없는 `turn` 은 대화를 그대로 다시 보낸다("다시 보내기"). 대화 상태(`resume`·`state`)는
구현 단계 4(bunny-holes/sherpa#66)의 다음 작업이 이 절에 더하고, 그때 `error` 의 코드도 늘어난다. 메시지를 더하는
것이라 이 문서의 판은 그대로다. [계약]

- `data` 하나에 `sherpa.chat.v1` 메시지 하나를 싣는다. 메시지는 UTF-8 JSON 객체이고 `type` 으로 가른다. 앱과
  코어는 한 번들로 나가고 인사에서 버전이 같아야 하므로(§7.5) 메시지마다 판을 싣지 않는다. 호환되지 않는 변경은
  이름의 판을 올리고 이 문서의 새 판을 낸다. [계약] `done` 과 `turn` 에 답하는 `error` 의 `resend`("다시
  보내기")는 이름의 판을 올리지 않고 더했다. 이 메시지를 읽는 앱(구현 단계 5, bunny-holes/sherpa#67)이 아직 없어
  키를 더해 깨질 쪽이 없고, 앱은 처음부터 그 키를 읽는다. [계약]
- 코어는 채팅 채널을 넷까지 둔다. 넷이 열려 있을 때 온 `open` 은 그 채널만 `N\tclose\t{"reason":"chat_limit"}`
  로 닫고 warn 로그를 남긴다(§12). 앱이 닫은 채널은 자리를 비운다. 1판의 앱은 채팅을 하나만 열고 새 채팅을 열면
  앞 채널을 닫으므로, 넷은 닫기가 늦게 닿는 동안의 여유다. [계약; ADR-0012 "앱과 코어 사이 채널", "메모리와 크기"]
- 앱이 채널을 닫거나 코어의 표준 입력이 끝나면 그 채널에서 도는 요청은 멈추고 답하지 않는다. [계약]

| 방향 | `type` | 키 | 뜻 |
| --- | --- | --- | --- |
| 앱 → 코어 | `list_models` | `provider`, `api_key`, `base_url`(OpenAI 호환만) | 제공자의 모델 목록을 묻는다 |
| 코어 → 앱 | `models` | `models`(모델 id 의 배열), `truncated` | `list_models` 의 답 |
| 앱 → 코어 | `turn` | `provider`, `api_key`, `base_url`(OpenAI 호환만), `model`, `text`(다시 보내기에는 없다) | 사람의 글 하나로 차례를 시작한다. `text` 가 없으면 대화를 그대로 다시 보낸다("다시 보내기") |
| 앱 → 코어 | `cancel` | 없음 | 도는 차례를 멈춘다 |
| 코어 → 앱 | `delta` | `text` | 모델 답의 글 조각 |
| 코어 → 앱 | `tool` | `call_id`, `name`, `status`, `code`, `operation_id` | 모델이 부른 도구 호출 하나가 시작했거나 끝났다("도구") |
| 코어 → 앱 | `done` | `reason`, `input_tokens`, `output_tokens`, `resend` | 차례가 끝났다. `resend` 는 바로 뒤의 `text` 없는 `turn` 을 코어가 받는지다("다시 보내기") |
| 코어 → 앱 | `error` | `in_reply_to`, `code`, `retryable`, `status`, `resend`(`in_reply_to` 가 `"turn"` 일 때만) | 앞의 메시지가 답 없이 끝났다. `in_reply_to` 가 `"turn"` 이면 그 `turn` 이 요청 전에 거절됐거나 그 차례가 오류로 끝났다 |

- `list_models` 와 `turn` 의 `provider` 는 `anthropic`, `openai`, `google`, `openai-compatible` 중 하나다. 앞의 셋은 코어가 출처를 정하므로
  `base_url` 을 싣지 않고 `api_key` 가 있어야 한다. `openai-compatible` 은 `base_url` 이 있어야 하고, 키가 없는
  서버면 `api_key` 를 빼고 보낸다. 그러면 코어는 인증 머리말 없이 묻는다. [계약; ADR-0012 "제공자 면", "OpenAI
  호환의 base URL"]
- `api_key` 는 1~512 바이트의 `!`~`~`(0x21~0x7E)다. 공백과 줄바꿈이 없으므로 머리말을 깨지 못한다. `base_url` 은
  2,048 바이트까지이고 제어 문자가 없다. 다른 키, 빠진 키, 이 한도를 넘는 값은 `invalid_message` 다. [계약]
- `base_url` 이 나가는 길의 규칙(https, userinfo·query·fragment 없음, §7.1)을 어기면 요청 없이 `egress_denied` 다.
  https 루프백(`https://localhost`, `https://127.0.0.1` 등)은 이름으로 막지 않는다. 규칙은 https 와 코어가 믿는
  인증서이고, 믿지 않는 인증서는 `provider_certificate` 로 끝난다. [소유자, 2026-11-22; ADR-0012 "OpenAI 호환의
  base URL"]
- 키는 그 메시지에만 있다. 코어는 키를 그 요청의 머리말에만 쓰고 답을 보내면 놓는다. 키는 로그, `error`, 다른
  프레임 어디에도 없다. 앱은 메시지마다 키를 키체인에서 읽어 싣는다. [계약; ADR-0012 "키"]
- `list_models` 마다 답이 하나 온다. `models` 이거나, `in_reply_to` 가 `"list_models"` 인 `error` 다. 답을 기다리는
  동안 온 둘째 `list_models` 는 곧바로 `busy` 를 받고, 도는 것은 그대로 돈다. 코어는 답을 쓰기 전에 다음 요청을 받을
  준비를 마치므로, 앱은 답을 받자마자 다음 것을 보내도 된다. [계약]
- 읽지 못한 `data`(UTF-8 JSON 객체가 아님, `type` 이 없거나 앱이 보내는 이 판의 메시지가 아님)는 `in_reply_to` 가
  `null` 인 `invalid_message` 이고, 모양이 틀린 `list_models`·`turn`·`cancel` 은 `in_reply_to` 가 그 `type` 인
  `invalid_message` 다. 어느 것도 채널을 닫지 않는다. 같은 번들의 앱이 보냈다면 결함이다. [계약]

#### 모델 목록

| `provider` | 목록 요청 | 키를 싣는 머리말 | 다음 쪽 | 남기는 모델 |
| --- | --- | --- | --- | --- |
| `anthropic` | `GET https://api.anthropic.com/v1/models?limit=1000` | `x-api-key`. `anthropic-version: 2026-10-21` 을 함께 싣는다 | `has_more` 가 참이면 `after_id=<last_id>` | `lifecycle` 이 `active` 이거나 없는 것 |
| `openai` | `GET https://api.openai.com/v1/models` | `authorization: Bearer <키>` | 없음 | 모두 |
| `google` | `GET https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000` | `x-goog-api-key` | `nextPageToken` 이 비어 있지 않으면 `pageToken=<값>` | 모두. id 는 `name` 에서 `models/` 를 뗀 것이고, 그렇게 시작하지 않는 이름은 뺀다 |
| `openai-compatible` | `GET <base_url>/models`(`base_url` 끝의 `/` 는 뗀다) | 키가 있을 때만 `authorization: Bearer <키>` | 없음 | 모두 |

[문서: Anthropic [List Models](https://platform.claude.com/docs/en/api/models/list), OpenAI [List
models](https://developers.openai.com/api/reference/resources/models/methods/list), Google
[Models](https://aistudio.google.com/api-reference/models); 키를 싣는 머리말은 `@ai-sdk/anthropic` 4.0.107·
`@ai-sdk/openai` 4.0.122·`@ai-sdk/google` 4.0.124·`@ai-sdk/openai-compatible` 3.0.94 가 싣는 것과 같다]
`anthropic-version` 은 SDK 의 기본(2023-06-01)이 아니라 차례에 쓸 판과 같은 2026-10-21 이다(ADR-0012 "Anthropic API
판"). [계약]

- Anthropic 은 active 모델만 남긴다(ADR-0012 결정 7). 요청 인자 `lifecycle` 대신 답에서 거른다. 문서가 그 배열
  인자의 URL 표기를 적지 않았기 때문이다. OpenAI 와 Google 은 거르지 않는다. 채팅에 쓰지 못하는 모델도 섞이지만
  id 로 짐작하지 않고, 고른 모델이 거절되면 그 오류를 보인다. Google 문서의 예는 키를 `?key=` 에 싣지만 코어는
  머리말로만 보내 키가 URL 에 남지 않는다. [계약; ADR-0012 "비용과 모델 선택"]
- `models` 는 제공자가 준 차례를 지키고 같은 id 는 한 번만 싣는다. 비어 있을 수 있다. [계약]

| 대상 | 한도 | 넘으면 |
| --- | --- | --- |
| 모델 id 하나 | 1~256 바이트의 온전한 UTF-8, 제어 문자 없음 | 그 id 를 빼고 센다(§12 의 `skipped`) |
| `models` 의 id | 1,000개 | 거기서 멈추고 `truncated: true` |
| 요청 | `list_models` 하나에 10번 | 거기서 멈추고 `truncated: true` |
| 응답 몸 하나 | 풀어 낸 바이트로 4 MiB | 더 읽지 않고 `provider_invalid_response` |
| `list_models` 하나 | 모든 쪽을 합쳐 30초 | 요청을 멈추고 `timeout` |

- id 한도는 `models` 가 4 MiB `data`(§7.4)에 늘 들어가게 한다. 응답 한도는 설명과 가격을 함께 싣는 OpenAI 호환
  모음 서버의 목록도 받게 한다. 그런 서버의 공개 목록인 `GET https://openrouter.ai/api/v1/models` 가 2026-11-22 에
  925,503 바이트였다. [계약; 실측: 이 Mac 에서 `curl` 로 잰 응답 크기]
- 응답 몸은 풀어 낸 바이트로 센다. `content-encoding` 이 없는 몸은 `content-length` 가 한도를 넘으면 읽지 않고
  거절하고, 압축한 몸은 읽으면서 센다. Bun 1.4.5 의 `fetch` 는 gzip 몸을 풀어 내주면서 `content-length` 는 압축한
  길이로 두기 때문이다. [계약; 실측: Bun 1.4.5 의 `fetch` 로 gzip 몸을 내는 로컬 서버를 읽은 2026-11-22 의 탐침]

#### 글 차례

- `turn` 의 `model` 은 1~256 바이트이고 제어 문자가 없다. `text` 는 1 바이트부터 UTF-8 로 64 KiB 까지이고, 빼면
  "다시 보내기" 다. 한도를 넘는 값과 문자열이 아닌 `text`(`null` 포함)는 `in_reply_to` 가 `"turn"` 인
  `invalid_message` 다. [계약]
- 차례마다 `delta` 와 `tool` 이 0개 이상 오고, 끝에 `done` 이나 `in_reply_to` 가 `"turn"` 인 `error` 가 하나 온다. 차례가
  도는 동안 온 둘째 `turn` 은 곧바로 `busy` 를 받고, 도는 것은 그대로 돈다. `list_models` 는 차례와 따로 답한다.
  코어는 끝의 메시지를 쓰기 전에 다음 `turn` 을 받을 준비를 마친다. [계약]
- `cancel` 은 도는 차례를 멈춘다. 모델 요청 중이면 그 요청을 끊고, 차례는 받은 글을 `delta` 로 다 보낸 뒤 `done`
  `aborted` 로 끝나며 토큰 수는 `null` 이다. 한 단계의 호출이 도는 동안이면 호출은 "도구" 의 규칙대로 끝나고, 차례는
  다음 모델 요청 없이 `done` `aborted` 로 끝나며 토큰 수는 끝난 단계들의 것이다. 도는 차례가 없는 `cancel` 은 답이
  없다. 채널이 닫히면 차례는 멈추고 아무것도 쓰지 않는다. [계약]
- 채팅의 첫 차례가 그 채팅의 제공자, 요청이 시작하는 base URL(끝의 `/` 를 뗀 것), 모델을 정한다. 다른 것을 실은
  `turn` 은 이 채팅의 것이 아니므로 요청 없이 `invalid_message` 다. 모델이나 제공자, base URL 을 바꾸려면 앱이 새
  채팅을 연다. 제공자가 다음 요청에서 되돌려 받는 값(Anthropic 의 thinking 서명 등)이 대화에 들어 있기 때문이다. 키는 바뀌어도 된다. 요청 전에
  거절된 차례(`invalid_message`, `busy`, `egress_denied`)는 아무것도 정하지 않는다. [계약; ADR-0012 "앱과 코어 사이
  채널"]
- 코어는 채팅마다 대화(모델 메시지의 목록)를 메모리에 두고, 차례마다 지시문, 도구 정의, 그 대화, 새 글(다시
  보내기에는 없다)을 보낸다. 사람의 글은 차례가 어떻게 끝나든 대화에 남는다. 모델 요청의 단계가 끝나면 그 응답
  메시지를 더하되, 오류로 끝난 단계(AI SDK 의 끝난 까닭 `error`), 끝을 알리기 전에 닫힌 단계(`interrupted`), 거절로
  끝난 단계(`content-filter`)는 더하지 않는다. 그래서 실패한 차례 뒤의 요청에는 사람의 글이 잇달아 놓인다. 도구를
  부른 단계는 호출과 그 결과를 함께 더하고, AI SDK 가 돌리지 않은 호출에는 코어가 결과를 단다("도구"). reasoning 은
  대화에 남고 앱에는 가지 않는다. [계약; ADR-0012 "스트리밍", "상태를 넘기는 때"]
- 코어는 차례를 시작할 때 코어의 시계와 시간대로 읽은 지금 시각을 사람의 글 앞에
  `[Current time: 2026-11-22T21:56:31+09:00 (Sunday), time zone: Asia/Seoul]` 꼴의 한 줄로 붙이고, 빈 줄 하나 뒤에
  글을 둔다. 초까지의 시각과 UTC 오프셋(ISO 8601), 영어 요일, IANA 시간대 이름이다. 그 줄은 글과 함께 대화에 그대로
  남고, 새 글이 없는 다시 보내기는 줄을 붙이지 않는다. 지시문은 그 줄을 Sherpa 가 붙인 보낸 시각이고 사람의 지시가
  아니라고 적고, 날짜를 담지 않는다. 지시문이 차례마다 같아야 Anthropic 이 캐시하고, 시각이 메시지에 있으면 그 캐시의
  접두도 대화 상태가 지시문으로 만드는 지문도 바뀌지 않기 때문이다. [계약; ADR-0012 "비용과 모델 선택", "무엇을
  저장하나"]
- [설계] 줄과 글은 text part 하나로 보낸다. 둘로 나누면 OpenAI 호환 요청의 user `content` 가 문자열이 아니라 part 의
  배열이 되는데, 배열을 받지 않는 서버가 있을 수 있다 [추론]. 하나면 네 제공자가 모두 한 part 로 받고, OpenAI 호환
  요청의 `content` 는 문자열이다. [실측: `core/tests/chat-turn.test.ts`]
- 앱은 환경을 비워 코어를 띄우므로(§7.1) 코어에는 `TZ` 가 없다. 그래도 빌드한 코어는 이 Mac 에 설정한 시간대,
  곧 `/etc/localtime` 이 가리키는 시간대를 읽는다. [실측: `core/tests/stdio/egress.test.ts`, macOS 27.3, Bun 1.4.5]
- `delta` 는 답의 글만 싣고 reasoning 과 도구 입력은 싣지 않는다. 코어는 글을 50 ms 까지 모아 하나로 보내고, 하나가
  UTF-8 로 4 KiB 를 넘지 않게 문자(code point) 사이에서 자른다. `tool` 을 쓰기 전과 차례가 끝날 때는 남은 글을 먼저
  보낸다. [계약]
- `done` 의 `reason` 은 `stop`(모델이 답을 마쳤다), `length`(출력 토큰 한도에 닿았다), `content-filter`(제공자가
  거절했다), `step-limit`(모델 요청이 차례의 한도에 닿았다, "도구"), `aborted`(`cancel`), `other`(그 밖의 까닭) 중
  하나다. 도구를 부른 단계에서 멈춘 차례는 `cancel` 이면 `aborted`, 한도면 `step-limit`, 그 밖이면 `other` 이고,
  `length`·`content-filter` 는 그 단계에 호출이 있어도 그 까닭이다. `input_tokens`·`output_tokens` 는 제공자가
  알린 차례 전체의 입력·출력 토큰 수이고, 알리지 않았으면 `null` 이다. [계약]

| `provider` | 차례 요청 | 키를 싣는 머리말 | 함께 싣는 것 |
| --- | --- | --- | --- |
| `anthropic` | `POST https://api.anthropic.com/v1/messages` | `x-api-key` | `anthropic-version: 2026-10-21`. 지시문은 `system` 에 `cache_control: {"type":"ephemeral"}` 과 함께 싣고, 몸의 맨 위에도 같은 `cache_control` 을 둔다("도구"). `temperature`·`top_p`·`top_k` 는 싣지 않는다 |
| `openai` | `POST https://api.openai.com/v1/responses` | `authorization: Bearer <키>` | `store: false`. 지시문은 `input` 의 첫 메시지이고 reasoning 모델이면 `developer` 다 |
| `google` | `POST https://generativelanguage.googleapis.com/v1beta/interactions` | `x-goog-api-key` | `store: false`. 지시문은 `system_instruction` 이다 |
| `openai-compatible` | `POST <base_url>/chat/completions` | 키가 있을 때만 `authorization: Bearer <키>` | `stream_options: {"include_usage": true}`. 지시문은 `messages` 의 첫 `system` 메시지다 |

모두 `stream: true` 의 server-sent events 요청이고, 몸은 `ai` 7.0.179 와 위 패키지가 만든다. 도구 정의 35개는 네
제공자 모두 몸의 `tools` 에 실린다("도구"). [계약; 실측: `core/tests/chat-turn.test.ts`·`core/tests/chat-tools.test.ts` 가
손으로 쓴 응답으로 본 요청]

- OpenAI 의 reasoning 모델(카탈로그가 reasoning 모델로 아는 것)에는 AI SDK 가 `store: false` 일 때
  `include: ["reasoning.encrypted_content"]` 를 조건 없이 더한다. OpenAI 는 `store: false` 응답에도
  `encrypted_content` 를 기본으로 싣고, `include` 의 그 값은 호환으로만 받는 옛 값이라고 적는다. 소유자가 이것을
  ADR-0012 결정 7 의 예외로 두었다. [소유자, 2026-11-22; 문서: `@ai-sdk/openai` 4.0.122 `dist/index.js`, OpenAI
  [Reasoning models](https://developers.openai.com/api/docs/guides/reasoning)]
- 코어는 출력 토큰 한도(`maxOutputTokens`)를 넘기지 않는다. Anthropic 은 `max_tokens` 를 받아야 하므로
  `@ai-sdk/anthropic` 4.0.107 이 채운다. 패키지가 아는 모델에는 그 모델의 최대를 보낸다(지금의 Claude 는 128,000).
  모르는 모델 id 에는 compatibility 경고(`maxOutputTokens`, §12)를 내고, `claude-` 가 든 id 는 지금의 Claude 처럼
  128,000 으로, 그 밖의 id 와 `claude-3` 같은 옛 이름은 4,096 으로 묶는다. 그 한도에 닿은 답은 `done` `length` 로
  끝난다. [문서: `@ai-sdk/anthropic` 4.0.107 `resolveRuntimeDefinition`; 실측: `core/tests/chat-turn.test.ts`]

| 대상 | 한도 | 넘으면 |
| --- | --- | --- |
| `model` | 1~256 바이트, 제어 문자 없음 | `invalid_message` |
| `text`(있을 때) | 1 바이트~64 KiB | `invalid_message` |
| 대화 | 모델 메시지 전체(지시문은 빼고)를 JSON 으로 적어 2 MiB. 차례를 시작할 때, 답이 흐르는 동안, 호출마다 그 앞에서, 단계가 끝날 때 잰다("대화 한도") | `conversation_limit`. 시작할 때 넘으면 요청하지 않는다. 그 채팅은 뒤의 차례도 받지 않는다 |
| 모델 요청의 첫 출력 | 보낸 때부터 600초 | 차례를 멈추고 `timeout` |
| 출력 사이 | 600초 | 차례를 멈추고 `timeout` |
| 연결에 바이트가 오가지 않는 사이 | Bun 의 유휴 한도(문서의 기본 5분, 이 Mac 에서 잰 값 360초) | 차례를 멈추고 `timeout` |
| 2xx 가 아닌 응답의 몸 | 64 KiB 까지 읽는다 | 나머지는 읽지 않는다 |
| `delta` 하나 | 50 ms, UTF-8 4 KiB | 다음 `delta` 로 넘긴다 |
| 모델 요청 | 한 차례에 20번 | 더 보내지 않고 `done` `step-limit` |
| 도구 결과 하나 | 모델이 읽는 결과 봉투의 JSON 으로 64 KiB | §10.5 의 맞춤 규칙 |
| 스키마가 거절한 호출의 까닭 | 코어가 적는 글이 대화의 JSON 으로 2 KiB | 들지 않는 첫 줄은 잘라 표시하고, 그 뒤의 issue 는 수만 적는다("도구") |

- [설계] 대화 한도 2 MiB 는 ADR-0012 "메모리와 크기" 가 구현 이슈에 맡긴 값이다. 대화 상태(`state`)가 4 MiB
  `data`(§7.4)에 들어가게 한다. 코어가 차례 안에서도 재고 답의 셈이 단계가 남길 것의 위를 잡으므로, 한 차례가
  한도를 넘겨 남길 수 있는 것은 셈이 놓친 것이 있을 때 단계가 끝나며 넘은 단계 하나다("대화 한도"). 닿으면 앱은 새
  채팅을 권한다. [ADR-0012 "상태를 넘기는 때", "메모리와 크기"]
- 출력은 답의 글, reasoning 의 글, 도구 호출과 그 입력, 파일이다. 첫 출력의 한도는 코어가 차례에 하나 둔다. AI SDK 가
  요청을 보낼 때마다(다시 보낼 때도) 새로 켜고, 그 요청의 첫 출력, fetch 의 실패, 2xx 가 아닌 응답의 몸을 64 KiB 까지
  읽은 때에 끈다. 차례가 끝나거나 `cancel` 이 오거나 채널이 닫혀도 끈다. AI SDK 의 `timeout.firstChunkMs` 는 넘기지
  않는다. 그 시계는 응답이 흐르기 시작한 뒤에야 돌아, 머리말을 기다리는 동안과 OpenAI·Anthropic 패키지가 흐름의 첫
  조각을 미리 읽는 동안을 재지 않기 때문이다. 출력 사이의 한도는 AI SDK 의 `timeout.chunkMs` 다. [계약; 문서: `ai`
  7.0.179 `src/generate-text/stream-text.ts`, `@ai-sdk/openai` 4.0.122 `throwIfOpenAIStreamErrorBeforeOutput`]
- [설계; 추론] 첫 출력의 한도가 600초인 까닭: 코어는 Anthropic 요청에 `thinking` 을 싣지 않는다. [실측:
  `core/tests/chat-turn.test.ts`] 그래도 Claude 5 이후의 모델(Opus 5.5·5, Sonnet 5.5·5, Haiku 5.5, Fable 5.x, Mythos
  5.x)은 adaptive thinking 으로 스스로 정한 만큼 생각하고, thinking 의 `display` 기본이 `omitted` 여서 생각하는
  동안 글을 흘리지 않고 빈 thinking delta 와 서명 하나만 보낸다. 그래서 생각하는 시간이 모두 첫 출력 전의 기다림이다.
  Opus 5.5·Sonnet 5.5·Fable 5.x·Mythos 5.x 는 thinking 을 끌 수도 없다. Opus 4.8·4.7 은 `display` 기본이 같지만
  `thinking` 이 없으면 생각하지 않는다. [문서: Claude
  [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking) "Configuring thinking", "Controlling
  thinking display", [Streaming](https://platform.claude.com/docs/en/build-with-claude/streaming) "Thinking delta"]
  `@ai-sdk/anthropic` 4.0.107 도 Opus 5.5·Sonnet 5.5·Fable 5.x 의 thinking 을 끌 수 없는 것으로
  둔다(`thinkingCanBeDisabled: false`). 한도가 짧으면 이미 값을 치른 생각을 버리고, "다시" 를 눌러도 같은 곳에서
  끊긴다. 오래 기다리는 차례는 사람이 `cancel` 로 멈출 수 있다. `display: "summarized"` 를 보내 생각을 출력으로
  흘리는 길은 쓰지 않는다. 요청의 모양과 대화 상태가 바뀌고, OpenAI 와 Google 에는 같은 길이 없으며, OpenAI 의
  reasoning 요약은 조직 인증을 요구할 수 있기 때문이다 [추론]. 모델이 첫 출력 전에 얼마나 생각하는지는 재지
  않았다(§16).
- [설계; 추론] 출력 사이도 600초인 까닭: 모델은 글을 쓴 뒤 다음 글이나 도구 호출 전에도 출력 없이 생각할 수 있고, 한도가
  짧으면 첫 출력 전처럼 값을 치른 생각을 버린다. 도구가 도는 동안에는 이 한도가 돌지 않는다. AI SDK 는 모델의 응답이
  끝난 뒤에 도구를 돌리고, 다음 요청은 첫 출력의 한도를 새로 켠다. [실측: `core/tests/chat-tools.test.ts` 의 11분 뒤 답한
  변경] 모델이 글 사이에 얼마나 생각하는지는 재지 않았다(§16).
- 연결에 바이트가 오가지 않는 사이는 Bun 의 유휴 한도가 끊는다. 바이트가 오갈 때마다 다시 켜지는 소켓 한도이고,
  문서의 기본은 5분이다. 코어의 나가는 길은 Bun 의 `timeout` 선택을 떨구므로 기본이 쓰인다. [문서: bun-types 1.4.5
  `BunFetchRequestInit.timeout`] 이 Mac 에서 머리말을 기다리는 요청과 머리말 뒤 몸을 기다리는 요청 모두 360초에
  끊겼고, Bun 은 둘 다 `DOMException` `TimeoutError`("The operation timed out.")를 던졌다. [실측:
  live-evidence 2026-11-22 "Bun's fetch idle timeout", Bun 1.4.5, macOS 27.3] AI SDK 는 그 오류를 중단으로 읽어 다시 보내지 않고, 코어는 차례를
  `timeout` 으로 끝낸다. [문서: `@ai-sdk/provider-utils` 5.0.83 `isAbortError`; 실측:
  `core/tests/chat-turn.test.ts`] 그러므로 제공자가 생각하는 동안 바이트를 하나도 보내지 않으면 600초보다 먼저
  Bun 이 끊는다. 어느 제공자가 생각하는 동안 바이트(Anthropic 의 `ping` 등)를 보내는지는 확인하지 않았다(§16).

#### 도구

- 채팅의 모델은 MCP 와 같은 도구(§10.2)를 부른다. 차례는 도구 목록의 근거를 MCP 세션처럼 5초까지 기다린 뒤 첫 요청을
  보낸다(§10.1). 호출은 MCP 의 `tools/call` 과 같은 처리기와 같은 호출 수명(`core/src/tools/call.ts`)으로 돌고,
  처리기는 그 채팅 채널의 번호와 `client` `{"name":"sherpa-chat","version":"<코어 버전>"}` 을 받는다(§9). [계약;
  ADR-0012 "도구"]
- 모델에 보내는 입력 스키마는 zod 스키마의 JSON Schema 에서 `$schema` 키 35개와 `z.int()` 가 넣는 안전한 정수의
  경계 쌍 145개를 뺀 것이다. 둘은 모델에 쓸모가 없고, 입력은 그대로 zod 스키마로 검사한다. 35개 도구의 이름·설명·입력
  스키마를 Anthropic 요청의 `tools` 배열 모양으로 적으면 43,871자에서 33,901자로 준다. [계약; 실측: 2026-11-23 코어의
  `modelSchema` 로 적은 배열의 길이]
- 모델은 MCP 와 같은 결과 봉투(§10.5)를 읽는다. 봉투의 JSON 이 64 KiB 를 넘으면 §10.5 의 맞춤 규칙을 그 한도로 쓴다.
  결과는 대화에 남아 그 채팅의 뒤 요청마다 다시 나가기 때문이다. [계약]
- 한 차례의 모델 요청은 20번까지다. 스무째 요청이 도구를 불러 그 결과로 끝나면 더 보내지 않고 `done` `step-limit`
  이다. 대화는 그 결과로 끝나고 다음 차례가 그 뒤에 이어진다. [소유자, 2026-11-22; 실측: `core/tests/chat-tools.test.ts`]
- 한 단계의 호출은 모델이 준 차례대로 하나씩 돈다. 앱은 확인 창을 한 번에 하나만 띄우고(§9), 다른 호출 뒤에서 기다린
  창은 30초를 이미 썼을 것이기 때문이다. [계약]
- `tool` 은 호출마다 두 번 온다. 호출이 시작할 때 `status` `started` 로, 끝날 때 그 끝으로 온다. 도구 인자와 결과는
  싣지 않는다. [계약; ADR-0012 "앱과 코어 사이 채널"]
  - `call_id`: 채널마다 1부터 세는 호출 번호. 한 호출의 둘이 같은 번호를 쓰고, 그 채널의 뒤 차례는 이어서 센다. 앱은
    같은 채널 안에서만 둘을 짝짓는다.
  - `name`: 코어 등록부의 도구 이름. 모델이 코어에 없는 도구를 불렀으면 `null` 이다. 모델이 지어낸 이름은 모델의
    출력이기 때문이다.
  - `status`: `started`, `succeeded`, `failed`, `partial`, `uncertain`, `declined`, `withdrawn` 중 하나. 끝의
    상태는 결과 봉투의 `status` 이되, 확인 창에서 거부한 호출은 `declined`, 사람의 `cancel` 이 바뀐 것 없이 거둔 호출은
    `withdrawn` 이다. `partial`·`uncertain` 은 변경이 일어났거나 일어났을 수 있다는 뜻이므로 앱은 `failed` 로 읽지
    않는다(§10.5).
  - `code`: 끝의 오류 코드. 결과 봉투의 `error.code` 이거나 아래 표의 채팅 코드이고, `started` 와 오류 없는 끝은
    `null` 이다.
  - `operation_id`: 결과 봉투의 `operation_id`. `started` 와 `operation_id` 가 없는 끝은 `null` 이다.

| `code` | 결과 봉투 | `tool` 의 끝 | 언제 |
| --- | --- | --- | --- |
| `chat.cancelled` | `failed`, 효과 `not_started`, `retry` `after_user_action` | `withdrawn` | 사람의 `cancel` 이 바뀐 것 없이 거둔 호출, 그 뒤라 시작하지 않은 호출 |
| `chat.invalid_call` | 없다. 모델은 AI SDK 의 오류 글을 그 호출의 결과로 읽는다. 스키마가 거절한 까닭은 코어가 적는다(아래) | `failed` | 코어에 없는 도구나 스키마가 거절한 인자. AI SDK 가 돌리기 전에 거절했다 |
| `chat.not_run` | `failed`, 효과 `not_started`, `retry` `safe` | `failed` | AI SDK 가 돌리지 않은 호출. 그 단계가 `stop`·`tool-calls` 밖의 까닭으로 끝났다 |
| `chat.conversation_limit` | `failed`, 효과 `not_started`, `retry` `never` | `failed` | 그 결과가 대화 한도를 넘길 수 있어 코어가 돌리지 않은 호출, 그 단계에서 그 뒤의 호출("대화 한도") |

- 코어가 만드는 세 봉투(`chat.cancelled`·`chat.not_run`·`chat.conversation_limit`)의 `capability` 는 그 도구의
  것이고 `operation_id`·`evidence`·`result` 는 `null`, 효과의 `kind` 는 그 도구의 효과 부류가 정한다.
  `chat.cancelled` 의 `retry` 가 `after_user_action` 인 것은 사람이 멈췄기 때문이고, `chat.not_run` 이 `safe` 인
  것은 아무도 멈추지 않았고 아무것도 바뀌지 않았기 때문이며, `chat.conversation_limit` 이 `never` 인 것은 그 채팅이
  뒤의 차례를 받지 않기 때문이다. [계약]
- `chat.invalid_call` 의 오류 글은 AI SDK 가 짓는다. 코어에 없는 도구에는 그 이름과 코어의 도구 이름 전부를, 풀리지
  않는 입력에는 받은 입력 그대로와 Bun 의 JSON 오류를, 스키마가 거절한 입력에는 그 입력을 JSON 으로 다시 적은 것과
  그 오류의 글을 적는다. [문서: `ai` 7.0.179 `src/error/no-such-tool-error.ts`, `src/error/invalid-tool-input-error.ts`,
  `src/generate-text/parse-tool-call.ts`, `@ai-sdk/provider` 4.0.39 `src/errors/json-parse-error.ts`,
  `src/errors/type-validation-error.ts`; 실측: `core/tests/chat-limit.test.ts`]
- 그 오류의 글, 곧 스키마가 거절한 까닭은 코어가 쓴다. zod 의 issue 를 낸 차례대로 한 줄에 하나씩
  `<경로>: <message>` 로 적는다. 경로는 zod 의 표기(`alarms[0]`, `["b c"][0]`, `d.e`)이고, 입력의 뿌리에 난 issue
  는 message 만 적는다. 글 전체는 대화의 JSON 이 적는 바이트로 2 KiB(`chatLimits.toolIssueBytes`)까지이고, 그 바이트는
  UTF-8 보다 적지 않다. 들지 않는 첫 줄은 코드 포인트 경계에서 잘라 `... (truncated)` 를 붙이고, 그 뒤에 issue 가 남으면 마지막 줄에
  `and N more issues`(하나면 `and 1 more issue`)를 적는다. 그 줄도 2 KiB 안에 들고, 한 글자도 들지 않는 줄은 그 수에
  든다. 같은 입력에는 같은 글이다. [계약; 실측: `core/tests/chat-limit.test.ts`, `core/tests/chat-tools.test.ts`]
- [설계] zod 의 글은 모든 issue 를 들여 쓴 JSON 이라, 그대로 두면 issue 2,000 개를 낸 호출 하나가 그 단계에 400 KB
  넘게 남긴다. 코어의 글은 오류 글을 AI SDK 의 앞글과 입력의 되풀이와 2 KiB 로 묶어 답의 셈이 그 위를 잡게
  하고("대화 한도"), 모델은 앞의 issue 와 남은 수로 고칠 곳을 찾는다.
- 차례: 답의 글과 호출마다의 `started`·끝이 일어난 차례대로 오고, 끝에 `done` 이나 `error` 가 온다. 코어는 `tool` 을
  쓰기 전에 모은 글을 먼저 보낸다. AI SDK 가 거절한 호출의 둘은 답이 흐르는 동안, 돌리지 않은 호출의 둘은 그 단계가
  끝난 뒤 `done` 앞에 온다. 번호는 앱이 `started` 를 받은 차례이므로, 한 단계에 둘이 섞이면 모델이 부른 차례와 다를
  수 있다. [계약; 실측: `core/tests/chat-tools.test.ts`]
- `cancel` 이 한 단계의 호출이 도는 동안 오면, 바뀐 것이 없는 호출(확인을 기다리는 것 포함)은 거두고, planner 읽기는
  끊고, 뒤의 호출은 시작하지 않으며, 다음 모델 요청은 보내지 않는다. 시작하지 않은 뒤의 호출도 `started` 뒤에
  `withdrawn` 을 받는다. 변경을 이미 청한 호출(앱에 작업 요청을 보냈거나, 허용 뒤 명령을 시작한 것)은 끝까지 기다려
  모델과 사람이 그 결과를 알게 한다. 앱은 보낸 작업 요청을 끝까지 실행한다(§7.8). 코어가 스스로 도는 읽기(SQLite
  읽기와 명령)도 신호를 받지 않아 그 한도까지 돌고 결과를 남긴다. 그 단계는 결과와 함께 대화에 남고, 차례는 `done`
  `aborted` 로 끝나며 토큰 수는 끝난 단계들의 것이다. [계약; 실측: `core/tests/chat-tools.test.ts`]
- 모델이 도구를 부른 뒤 그 응답이 끝나기 전에 온 `cancel` 은 모델 요청 중의 것과 같다. AI SDK 는 응답이 끝난 뒤에야
  호출을 돌리므로 아무 도구도 돌지 않고, 그 단계는 대화에 남지 않으며, 토큰 수는 `null` 이다. [계약; 문서: `ai`
  7.0.179 `src/generate-text/execute-tools-from-stream.ts`; 실측: `core/tests/chat-tools.test.ts`]
- 채널이 닫히면 도는 호출의 결과는 아무에게도 닿지 않는다. 앱에 보낸 작업 요청은 앱이 끝까지 실행하고 기록부에
  남긴다(§7.8). [계약; 실측: `core/tests/chat-tools.test.ts`]
- 호출에는 코어가 따로 두는 시간 한도가 없고, 도구가 도는 동안에는 모델 요청의 한도도 돌지 않는다. 채팅에 넘기는
  도구는 저마다 자기 한도를 갖는다. 한도 없는 비동기 기다림을 가진 도구를 더하는 것은 결함이다. 지금의 한도는 planner
  도구가 작업 마감 20초와 여유 5초(§8), 확인을 거치는 planner 삭제가 미리보기 읽기를 포함한 확인 30초(§9)와 그 25초,
  `imessage_send` 가 확인 30초와 `osascript` 60초, `mail_send` 가 확인 30초와 `osascript` 120초다. 나머지 core
  도구는 동기 SQLite 읽기이거나 10초나 30초 한도의 명령이다. AI SDK 의 `timeout.toolMs` 는 쓰지 않는다. 호출이 받은
  신호를 끊을 뿐이라, 신호를 받지 않는 처리기는 멈추지 않기 때문이다. [계약; 문서: `ai` 7.0.179
  `src/generate-text/execute-tool-call.ts`; 실측: `core/tests/chat-tools.test.ts` 의 11분 뒤 답한 변경]
- 그래서 `mail_send` 하나는 150초까지 돈다. 그동안 앱이 무엇을 보일지는 구현 단계 5(bunny-holes/sherpa#67)가 정한다.
  [계약]
- AI SDK 는 한 단계의 호출을 그 단계가 `stop` 이나 `tool-calls` 로 끝났을 때만 돌린다. 출력 토큰 한도(`length`)나
  그 밖의 까닭(`other`)으로 끝난 단계의 호출은 돌지 않고, 결과가 없는 호출이 있으면 다음 단계도 보내지 않는다. 결과
  없는 호출이 든 대화는 AI SDK 가 요청 전에 거절하므로(`MissingToolResultsError`), 코어는 남기는 단계의 호출 가운데
  결과가 없는 것마다 `chat.not_run` 결과를 호출의 차례대로 단다. 앱은 그 호출마다 `started` 와 `failed`·`chat.not_run`
  을 받고 warn 로그가 남는다(§12). 차례는 `done` `length` 나 `other` 로 끝나고, 대화는 그 결과로 끝나며, 다음 차례의
  요청이 나간다. 코어는 끝난 까닭이 아니라 결과가 없는 호출을 잡으므로, 뒤의 AI SDK 가 다른 까닭으로 실행을 막아도
  같다. [계약; 문서: `ai` 7.0.179 `src/generate-text/execute-tools-from-stream.ts`,
  `src/generate-text/stream-text.ts`, `src/prompt/convert-to-language-model-prompt.ts`; 실측:
  `core/tests/chat-tools.test.ts`]
- `stop`·`tool-calls` 밖의 까닭으로 끝난 단계 뒤에는 요청하지 않는다. 그 단계의 호출은 결과(AI SDK 의 오류나
  `chat.not_run`)와 함께 남고, 차례는 그 까닭의 `done` 으로 끝난다(`content-filter` 는 남기지 않는다). 흐름이 보낸
  오류로 끝난 단계도 남지 않고, 차례는 그 오류의 `error` 로 끝난다. AI SDK 는 한 단계의 호출이 모두 결과(AI SDK 가
  거절한 호출의 오류도 결과다)를 가지면, 끝난 까닭이 `interrupted` 가 아닌 한 `length`·`content-filter`·`error`·
  `other` 여도 `stopWhen` 만 보고 다음 요청을 보내므로, 코어가 `stopWhen` 에 이 조건을 둔다. 같은 파일의
  `StopCondition` 주석은 `tool-calls` 밖의 까닭이면 멈춘다고 적지만 코드는 그렇지 않다. 그대로 두면 출력 토큰 한도에
  인자가 끊긴 호출은 다시 불러도 같은 한도에 다시 끊기기 쉬워 단계마다 출력 한도만큼 쓰며 20번째 요청까지 가고
  [추론], 거절이나 오류로 끝나 대화에 남지 않는 단계 위에서 다음 요청이 나가 그 답이 대화에 남는다. [계약; 문서: `ai`
  7.0.179 `src/generate-text/stream-text.ts` 의 `shouldStartNextStep`, `src/generate-text/stop-condition.ts`; 실측:
  `core/tests/chat-tools.test.ts`]
- 출력 토큰 한도가 인자 JSON 한가운데를 끊은 호출은 AI SDK 가 잘못 만든 호출로 읽는다(`chat.invalid_call`). 차례는
  그 요청 하나로 `done` `length` 로 끝나고, 대화는 그 호출과 AI SDK 의 오류를 결과로 간직해 다음 차례의 요청이 그
  오류를 싣는다. OpenAI 호환과 Anthropic 패키지는 끊긴 인자를 그대로 넘겨 이 길로 간다. [실측:
  `core/tests/chat-tools.test.ts`]
- 한계: 도구를 부른 응답을 `tool_calls`·`function_call`·`stop` 밖의 까닭으로 끝내는 OpenAI 호환 서버에서는 도구가
  하나도 돌지 않고, 그 차례는 `chat.not_run` 과 `done` `other` 로 끝난다. `@ai-sdk/openai-compatible` 3.0.94 는 그
  셋 밖의 까닭을 `other` 로, `length` 를 `length` 로 읽는다. 어느 서버가 그런지는 확인하지 않았다(§16). [문서:
  `@ai-sdk/openai-compatible` 3.0.94 `mapOpenAICompatibleFinishReason`; 실측: `core/tests/chat-tools.test.ts`]
- Anthropic 요청은 캐시 표시를 둘 싣는다. 지시문의 `system` 블록에 하나를 달고, 몸의 맨 위에 `cache_control` 을 두어
  Anthropic 이 대화의 마지막 블록에 표시를 옮기게 한다(자동 캐시). 캐시하는 접두는 도구, 지시문, 대화의 차례라 지시문의
  표시가 도구 정의를 덮으므로 도구에는 표시를 달지 않는다. 두 표시 모두 기본 5분 수명이다. [계약; 문서: Claude [Prompt
  caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching); 실측: `core/tests/chat-tools.test.ts`]
  실제 API 가 그 접두를 읽는지(`cache_read_input_tokens`)는 재지 않았다(§16).

#### 대화 한도

- 대화 한도는 지시문을 뺀 모델 메시지 전체를 JSON 으로 적은 바이트로 2 MiB 다. 코어는 차례마다 네 곳에서 잰다. 한
  차례가 대화에 더한 것은 끝난 단계마다 정확히 더하고, 도는 모델 요청의 몫은 위로 어림한다. [계약]
  1. 차례를 시작할 때: 사람의 글을 더한 대화(`text` 없는 `turn` 은 그대로의 대화)를 잰다. 넘으면 요청 없이
     `conversation_limit` 이다.
  2. 답이 흐르는 동안: 응답의 조각마다 그 단계가 대화에 더할 몫을 센다. 대화와 그 몫이 2 MiB 를 넘을 조각이 오면 그 앞까지만
     넘기고 응답을 끊는다. 끊는 것은 흐름 안의 오류 조각이라 AI SDK 가 그 요청을 다시 보내지 않고, 그 단계의 호출은 돌지
     않으며 단계는 대화에 남지 않는다. 첫 조각이 이미 넘으면 앱은 `delta` 없이 끝을 받는다.
  3. 호출마다 그 앞에서: 대화, 그 단계의 답, 그 단계에서 앞서 돈 호출의 결과에 가장 큰 결과(64 KiB)를 더해 넘으면 그 호출을
     돌리지 않는다. 앱은 그 호출의 `started` 와 `failed`·`chat.conversation_limit` 을 받고, 그 단계의 뒤 호출도 같다. 그
     단계는 그 결과와 함께 대화에 남는다.
  4. 단계가 끝날 때: 남기는 단계의 메시지를 정확히 더한다. 넘었으면 그 단계는 남는다. 그 호출들이 이미 돌았기 때문이다.
- 2·3·4 에서 넘은 차례는 다음 모델 요청을 보내지 않고 `error` `conversation_limit`(`retryable` 거짓, `resend` 거짓)로
  끝난다. 그 채팅은 뒤의 차례를 `text` 가 있든 없든 받지 않고, 앱은 새 채팅을 권한다. 그 앞에 보낸 `delta` 와 `tool` 은
  그대로다. [계약; 실측: `core/tests/chat-turn.test.ts`, `core/tests/chat-tools.test.ts`]
- 답의 몫은 AI SDK 7.0.179 가 단계의 메시지에 남기는 모양으로 센다. 글과 reasoning 의 덩이마다 부분 하나와 JSON 이 적는
  글자, 그 덩이가 실은 가장 큰 제공자 메타데이터(SDK 는 마지막 것을 남긴다), 호출의 id·이름·입력과 제공자 메타데이터,
  base64 로 적은 파일, 메시지와 부분의 키다. 호출의 메타데이터는 그 호출이 돌면 결과에도 남으므로 두 번 센다. 호출의
  입력은 흐르는 동안 받은 바이트로 세다가 호출이 오면 남는 모양으로 바꾼다. [문서: `ai` 7.0.179
  `src/generate-text/stream-text.ts`, `src/generate-text/to-response-messages.ts`,
  `src/generate-text/execute-tool-call.ts`; 실측: `core/tests/chat-limit.test.ts`]
- AI SDK 가 돌리기 전에 거절한 호출의 오류 글은 제 앞글과 까닭 하나를 적는다. 까닭은 셋 가운데 하나다. 스키마가 거절한
  입력에는 코어가 적는 까닭(2 KiB, "도구"), 풀리지 않는 입력에는 Bun 의 글, 없는 도구에는 코어의 도구 이름 전부다. 앞의
  둘은 입력도 다시 적는다. 풀리지 않는 입력은 받은 그대로, 스키마가 거절한 입력은 풀어 JSON 으로 다시 적은 것이라 받은
  것보다 길 수 있다(`9e20` 은 21자리로 다시 적힌다). 그래서 셈은 호출마다 키와 가장 긴 앞글에 셋 가운데 가장 긴 것을
  더하고, 받은 입력과 다시 적은 것 중 긴 쪽을 더한다. 잰 값은 키가 메타데이터의 키까지 172 바이트, 앞글이 스키마가
  거절한 입력에 124 바이트(풀리지 않는 입력에 115, 없는 도구에 79), Bun 의 글이 JSC 가 따옴표로 적는 식별자를 잘라
  258자이고 JSON 으로 260 바이트, 도구 이름이 35개에 658 바이트다. [문서: `ai` 7.0.179
  `src/generate-text/parse-tool-call.ts`, `src/error/no-such-tool-error.ts`, `src/error/invalid-tool-input-error.ts`,
  `@ai-sdk/provider` 4.0.39 `src/errors/type-validation-error.ts`, `src/errors/json-parse-error.ts`; 실측: 2026-11-23
  Bun 1.4.5, `core/tests/chat-limit.test.ts`]
- 시험은 글(JSON 이 이스케이프하는 글자와 반으로 나뉜 이모지), 마지막에 온 reasoning 의 서명, 흐르는 동안 바뀌는
  메타데이터, 파일, 호출(돈 것, 메타데이터를 실은 돈 것, 없는 도구, 풀리지 않는 입력, JSC 가 자른 식별자를 적는 입력,
  스키마가 거절한 입력, `9e20` 2,000 개처럼 수를 입력보다 길게 다시 적는 입력, issue 2,000 개를 낸 두 입력, 2 KiB 가
  이모지나 따옴표와 제어 문자 안에 떨어지는 키를 실은 두 입력, 객체가 아닌 입력)마다 이 몫이 SDK 가 남긴 JSON 보다 작지
  않음을 본다. 스키마가 거절한 호출의 몫은 남긴 것보다 512 바이트 넘게 크지도 않다. 까닭 셋을 다 더하지 않기 때문이다.
  [실측: `core/tests/chat-limit.test.ts`]
- 답의 셈이 단계가 남길 것의 위를 잡고 3 이 결과의 자리를 보므로, 4 가 넘음을 찾는 것은 셈이 놓친 것이 있을 때뿐이다.
  4 는 그 안전망이다. 시험은 답을 세지 않는 방으로 4 만이 넘음을 찾는 단계를 만들어, 그 단계가 호출의 결과와 남고 다음
  요청이 없음을 본다. [설계; 실측: `core/tests/chat-tools.test.ts`]

#### 재시도

- 모델 요청 하나를 다시 보내는 것은 AI SDK 다. 코어는 `streamText` 에 `maxRetries: 2` 를 적어 SDK 의 기본값이
  바뀌어도 이 규칙이 그대로이게 한다. `streamRetries` 는 두지 않는다. 0 이라도 두면 `onError` 가 한 단계를 다시
  돌릴 수 있기 때문이다. 코어는 차례 전체를 스스로 다시 돌리지 않고, 도구 실행은 어떤 경우에도 스스로 다시 하지
  않는다. 앱은 `resend` 가 참인 `done`·`error` 뒤에 "다시" 를 보이고, 누르면 `text` 없는 `turn` 이다("다시 보내기").
  `error` 의 `retryable` 은 같은 실패가 되풀이될지의 짐작일 뿐이라 차례의 "다시" 를 정하지 않는다. [계약; 문서: `ai`
  7.0.179 `src/generate-text/stream-text.ts`]
- AI SDK 가 다시 보내는 것은 응답이 흐르기 전에 실패한 요청뿐이다. 408·409·429·5xx 상태, 응답 전에 맺어지지 않았거나
  끊긴 연결, 그리고 OpenAI 와 Anthropic 에서 첫 출력 전에 흐름이 보낸 오류다. 두 패키지는 흐름의 첫 조각을 미리 읽어
  그런 오류를 요청의 실패로 바꾼다. 401·403·그 밖의 4xx, 믿지 않는 인증서, 리디렉트와 나가는 길의 거절, `cancel`,
  첫 출력 한도와 Bun 의 유휴 한도, 출력이 나온 뒤의 오류는 다시 보내지 않는다. 그래서 이미 앱에 보낸 글은 되풀이되지
  않는다. [계약; 문서:
  `@ai-sdk/provider-utils` 5.0.83 `handleFetchError`, `@ai-sdk/openai` 4.0.122 `throwIfOpenAIStreamErrorBeforeOutput`,
  `@ai-sdk/anthropic` 4.0.107 `doStream`; 실측: `core/tests/chat-turn.test.ts`]
- 도구를 부른 단계 뒤의 요청이 응답 전에 실패해 AI SDK 가 다시 보내면, 몸은 처음과 같고 도구는 다시 돌지 않는다. [실측:
  `core/tests/chat-tools.test.ts`]
- 처음 요청 뒤 두 번까지, 2초 뒤와 그 4초 뒤에 보낸다. 실패한 응답의 `retry-after-ms` 나 `retry-after` 가 0 이상
  60초 미만이면 그 값만큼 기다린다. [문서: `ai` 7.0.179 `src/util/retry-with-exponential-backoff.ts`; 실측:
  `core/tests/chat-turn.test.ts`]
- 첫 출력의 한도는 다시 보낸 요청마다 새로 켜진다. 상태로 실패한 요청 뒤의 기다림은 그 몸을 읽은 뒤이므로 한도에
  들지 않는다. 2xx 로 흐르다 첫 출력 전에 오류를 보낸 응답은 fetch 가 성공했으므로 한도를 끄지 않고, 그 뒤의
  기다림은 다음 요청이 한도를 새로 켤 때까지 그 요청의 한도에 든다. 그러므로 첫 출력까지 가장 오래 기다리는 것은
  요청 셋의 600초와 기다림 둘의 60초 미만을 합한 1,920초 미만이다. 첫 출력 뒤에는 출력 사이가 600초를 넘으면
  끝난다. 답 전체의 길이에는 시간 한도가 없다. [계약]
- [설계] 모델 목록과 달리 차례에서 다시 보내는 까닭: 다시 보내는 요청은 출력 전의 것뿐이라 앱이 본 것도 도구가 한
  것도 없어 아무것도 되풀이되지 않는다. 그리고 제공자가 적은 기다림을 따라, 사람이 다시 누르기 전에 지나가는
  과부하(429, Anthropic 의 529)를 넘긴다. 모델 목록은 사람이 모델을 고를 때 묻는 가벼운 GET 이고, 30초 한도 안에
  기다림을 둘 자리가 작으며, "다시" 한 번이 같은 일을 한다.

#### 다시 보내기

- `text` 없는 `turn` 은 새 글 없이 대화를 그대로 다시 보낸다. 대화의 마지막 메시지가 모델이 답할 것, 곧 사람의
  글이나 도구 결과일 때만 받는다. 대화가 비었거나 모델의 답으로 끝났으면 다시 보낼 것이 없으므로 요청 없이
  `invalid_message` 로 답하고, warn 로그의 까닭은 `nothing_to_retry` 다(§12). 대화는 그대로이고, 빈 대화면 채팅의
  제공자·base URL·모델도 정하지 않는다. [계약; 실측: `core/tests/chat-turn.test.ts`]
- 그 밖은 글을 실은 `turn` 과 같다. 도는 차례가 있으면 `busy`, 나가는 길이 막은 `base_url` 은 `egress_denied`, 이
  채팅의 것이 아닌 것은 `invalid_message` 이고, 키는 바뀌어도 된다. 대화 한도는 같은 2 MiB 를 새 글 없이 재고,
  `conversation_limit` 뒤의 채팅은 이것도 `conversation_limit` 로 거절한다. 새 글이 없으므로 시각 줄도 붙이지
  않는다. 그래서 다음 요청에는 사람의 글이 보낸 때의 시각 줄과 함께 한 번만 실린다. [계약; 실측:
  `core/tests/chat-turn.test.ts`, `core/tests/chat-tools.test.ts`]
- 코어는 `turn` 을 이 차례로 보고 처음 걸린 것으로 요청 없이 답한다. 모양이 틀림(`invalid_message`), 도는
  차례(`busy`), 나가는 길이 막은 `base_url`(`egress_denied`), 이 채팅의 것이 아님(`invalid_message`), 한도를
  넘었던 채팅(`conversation_limit`), 다시 보낼 것이 없는 `text` 없는 `turn`(`invalid_message`), 2 MiB 를 넘는
  대화(`conversation_limit`)다. 한도를 넘었던 채팅을 다시 보낼 것이 있는지보다 먼저 보므로, 그 채팅은 `text` 가
  있든 없든 어떤 `turn` 에도 `conversation_limit` 로 답한다. [계약; 실측: 두 시험]
- [설계] 같은 글을 실은 새 `turn` 은 대화에 그 글을 두 번 남긴다. 그래서 앱의 "다시" 는 `text` 없는 `turn` 이다.
  흔한 채팅 앱의 다시 만들기와 같고, 끝난 도구 호출을 되풀이할 길도 줄인다. 모델의 답으로 끝난 대화에는 모델이 답할
  것이 없으므로 받지 않는다.
- `done` 과 `in_reply_to` 가 `"turn"` 인 `error` 는 `resend` 를 싣는다. 그 메시지 바로 뒤에 같은 채팅으로 그
  채팅의 `provider`·`base_url`·`model` 을 실은 `text` 없는 `turn` 을 보내면 코어가 받는지다. 차례를 끝낸 것과
  요청 전에 거절한 것 모두 싣는다. 코어는 대화가 그 끝을 남기고 도는 차례가 없어진 뒤에 잰다. 그 채팅의 출처는
  첫 차례 때 나가는 길을 지났고, 그 규칙은 URL 만 읽으므로 다시 막히지 않는다. 앱(구현 단계 5,
  bunny-holes/sherpa#67)은 "다시" 와 "계속" 을 `resend` 가 참일 때만 보인다. [계약; 실측:
  `core/tests/chat-turn.test.ts`, `core/tests/chat-tools.test.ts`]
- [설계] 받는지는 대화의 마지막 메시지를 가진 코어만 정확히 안다. 아래 주석의 셋처럼 앱이 받은 프레임으로 가를 수
  없는 길이 있으므로, 앱이 아래 표를 다시 구현하게 하지 않고 코어가 답을 싣는다.
- `resend` 는 `retryable` 과 다르다. `retryable` 은 같은 요청이 나중에 될 수 있는지이고, `resend` 는 대화가 지금
  `text` 없는 `turn` 을 받는지다. 그래서 `provider_auth` 의 `error` 는 `retryable` 이 거짓이어도 `resend` 는 참이라
  키를 바꾸고 다시 보낼 수 있고, `busy` 는 둘 다 거짓이다. `resend` 가 참이어도 실패한 까닭이 그대로면 다시 보낸
  차례도 같게 끝날 수 있다. [계약; 실측: `core/tests/chat-turn.test.ts`]
- 코어가 `resend` 로 알리고, 아래 표는 그 값이 언제 참인지를 설명한다. 차례가 끝난 길과 요청 전의 거절마다 대화의
  마지막 메시지와 `resend` 를 적는다. 줄마다 시험이 있어 그 끝의 `resend` 를 보고, 같은 시험에서 바로 뒤에 `text`
  없는 `turn` 을 보내 받는지가 `resend` 와 같은지 본다. 도구가 없는 줄은 `core/tests/chat-turn.test.ts`, 있는 줄은
  `core/tests/chat-tools.test.ts` 에 있다. [계약; 실측: 두 시험]

| 코어가 쓴 것 | 대화의 마지막 메시지 | `resend` |
| --- | --- | --- |
| 첫 차례 전에 거절한 `turn` 의 `error` | 없다 | 거짓 |
| `done` `stop` | 모델의 답 | 거짓 |
| `done` `length`·`other`, 마지막 단계에 호출이 없다 | 모델의 답 | 거짓 |
| `done` `length`·`other`, 마지막 단계에 호출이 있다. 앱은 그 호출마다 `tool` 둘을 `chat.not_run` 이나 `chat.invalid_call` 로 받았다 | 그 호출들의 결과(`chat.not_run` 봉투나 AI SDK 의 오류) | 참 |
| `done` `content-filter` | 그 단계 앞의 것: 사람의 글이나 앞 단계의 도구 결과. 거절로 끝난 단계는 남지 않는다 | 참 |
| `done` `aborted`, 모델 요청 중의 `cancel` | 그 단계 앞의 것. 끊긴 단계는 남지 않는다 | 참 |
| `done` `aborted`, 호출이 도는 동안의 `cancel` | 그 단계의 도구 결과. 거둔 호출은 `chat.cancelled` 다 | 참 |
| `done` `step-limit` | 스무째 단계의 도구 결과 | 참. 도구 고리를 다시 모델 요청 20번까지 잇는다 |
| 시작한 차례의 `error`: `network`, `timeout`, `provider_*`, 리디렉트의 `egress_denied`, `internal` | 실패한 단계 앞의 것: 사람의 글이나 앞 단계의 도구 결과 | 참 |
| 시작한 차례의 `error` `conversation_limit`("대화 한도") | 답이 흐르다 끊겼으면 그 단계 앞의 것. 코어가 호출을 돌리지 않았거나 단계가 끝날 때 넘었으면 그 단계의 도구 결과 | 거짓. 그 채팅은 뒤의 차례를 받지 않는다 |
| 첫 차례가 시작한 뒤에 요청 전에 거절한 `turn` 의 `error`: `invalid_message`, `busy`, 나가는 길이 막은 `base_url` 의 `egress_denied`, `conversation_limit` | 그대로 | 그 앞의 끝, 곧 바로 앞에 `turn` 에 답한 `done`·`error` 와 같다. `busy` 와 `conversation_limit` 는 거짓이다. 도는 차례가 있을 때 온 모양이 틀린 `turn` 의 `invalid_message` 도 `busy` 처럼 거짓이고, 도는 차례는 그 끝에서 자기 `resend` 를 싣는다 |

- 대화 한도에 닿은 채팅은 차례를 시작할 때 넘었든 차례 안에서 넘었든 그 뒤의 끝마다 `resend` 가 거짓이고, 다음
  `turn` 은 `text` 가 없어도 `conversation_limit` 다("대화 한도"). [계약; 실측: `core/tests/chat-turn.test.ts`,
  `core/tests/chat-tools.test.ts`]
- `cancel` 이 답의 끝과 겹치면 차례는 코어가 먼저 본 쪽으로 끝나고, `resend` 가 어느 쪽인지 알린다. 코어가 모델
  응답의 끝을 읽기 전에 닿은 `cancel` 은 차례를 `done` `aborted` 로 끝내고 그 단계를 남기지 않아 `resend` 가
  참이다. 끝을 읽은 뒤에 닿은 것은 멈출 것이 없어 차례는 `done` `stop` 이고 `resend` 는 거짓이다. 앱은 `cancel` 을
  보냈어도 받은 `done` 의 `resend` 를 따른다. [실측: `core/tests/chat-turn.test.ts`. 시험은 응답 전체를 흐름에 한
  번에 넣고 닫은 뒤, 같은 태스크에서, 마이크로태스크 하나 뒤에, 답의 글이 앱에 닿은 뒤에, 1 ms 뒤에 `cancel` 을
  보낸다. 앞의 둘은 `aborted`, 뒤의 둘은 `stop` 이다]
- AI SDK 가 돌리지 않은 호출의 `chat.not_run` 이나 잘못 만든 호출의 AI SDK 오류가 대화의 마지막이면 받는다. 모델은
  다음 요청에서 그 결과를 읽고, `chat.not_run` 은 `retry` 가 `safe` 이므로 같은 호출을 다시 부를 수 있다. 출력
  토큰 한도에 끊긴 호출은 다시 불러도 같은 한도에 끊기기 쉽다 [추론]. [계약; 실측: `core/tests/chat-tools.test.ts`]
- `step-limit` 뒤의 `text` 없는 `turn` 은 그 일을 잇는 "계속" 이다. 모델은 스무째 단계의 결과를 읽고, 도구를 다시
  부르면 한도를 새로 세어 모델 요청 20번까지 간다. 그 차례도 `step-limit` 로 끝날 수 있다. 호출 중의 `cancel` 뒤에
  보내면 모델은 거둔 호출의 `chat.cancelled` 를 읽는다. 지시문은 거부되거나 거둔 호출을 사람이 청하지 않으면 다시
  부르지 말라고 적는다. 이어 갈지는 사람이 누르는 것으로 정한다. [계약; 소유자, 2026-11-22 의 20번; 실측:
  `core/tests/chat-tools.test.ts`]
- 표의 주석: 아래 셋은 앱이 받은 프레임으로는 가를 수 없는 끝이다. 그래서 코어가 `resend` 를 싣고, 셋은 그 값의
  예다. `resend` 가 거짓일 때 보낸 `text` 없는 `turn` 은 거절되고 대화는 그대로다. [실측: `core/tests/chat-turn.test.ts`,
  `core/tests/chat-tools.test.ts`]
  - 글도 reasoning 도 호출도 없는 답은 AI SDK 가 메시지로 남기지 않는다. 그래서 `done` 의 까닭이 무엇이든 그 앞의 것이
    마지막이고 `resend` 가 참이다. reasoning 만 있는 답은 남으므로 거짓이다. 앱에는 둘 다 `delta` 없이 `done` 만
    온다. [문서: `ai` 7.0.179 `src/generate-text/to-response-messages.ts`]
  - 도구 단계 뒤에 reasoning 만 내고 `length`·`other` 로 끝난 단계는 남으므로 거짓이다. 앱이 그 차례에서 마지막으로
    받은 것은 앞 단계의 `tool` 이다.
  - 한 단계에서 잘못 만든 호출 뒤에 글이 오면 대화는 그 호출의 결과로 끝나므로 참이다. Anthropic 패키지는 호출을 그
    블록이 끝날 때 알려 앱은 `tool` 둘 뒤에 그 글의 `delta` 를 받는다. OpenAI 호환 패키지는 호출을 응답이 끝날 때
    알려 `tool` 둘이 `delta` 뒤에 온다.

#### 오류

| `code` | `retryable` | `status` | 언제 |
| --- | --- | --- | --- |
| `invalid_message` | 거짓 | `null` | 읽지 못했거나 모양이 틀린 메시지, 이 채팅의 것이 아닌 `turn`, 다시 보낼 것이 없는 `text` 없는 `turn`("다시 보내기") |
| `busy` | 거짓 | `null` | `list_models` 에는 답을 기다리는 `list_models` 가, `turn` 에는 도는 차례가 있다 |
| `egress_denied` | 거짓 | `null` | 나가는 길이 막은 `base_url`, 또는 제공자의 리디렉트(§7.1) |
| `network` | 참 | `null` | 연결이 맺어지지 않았거나 끊겼다(이름 풀이, 거부, 끊김). 차례에서는 제공자 패키지가 흐름이 끝을 알리기 전에 닫혔다고 알린 것(AI SDK 의 끝난 까닭 `interrupted`)도 이것이다 |
| `timeout` | 참 | `null` | `list_models` 가 30초 안에 끝나지 않았거나, 차례의 모델 요청이 한도 안에 출력을 내지 않았거나, 차례의 연결이 Bun 의 유휴 한도 동안 바이트를 주고받지 않았다 |
| `provider_certificate` | 거짓 | `null` | 출처의 인증서를 코어가 믿지 않는다 |
| `provider_auth` | 거짓 | 401·403 | 제공자가 키를 거절했다 |
| `provider_rate_limited` | 참 | 429 | 제공자가 요청 수를 막았다 |
| `provider_unavailable` | 참 | 408·409·5xx | 제공자가 지금 답하지 못한다 |
| `provider_rejected` | 거짓 | 그 밖의 4xx | 제공자가 요청을 거절했다. 목록 끝점이 없는 OpenAI 호환 서버의 404 도 이것이다 |
| `provider_invalid_response` | 거짓 | 그 응답의 상태. 차례에서는 `null` | 2xx 인데 몸이 한도를 넘거나, UTF-8 JSON 이 아니거나, 모양이 다르다. 차례에서는 흐름이 패키지가 읽지 못하는 모양이거나 끝난 까닭 없이 끝났다 |
| `conversation_limit` | 거짓 | `null` | 대화가 한도를 넘는다. 차례를 시작할 때이거나, 차례 안에서 답·호출의 결과·끝난 단계가 넘길 때다("대화 한도"). 그 채팅은 뒤의 차례도 받지 않는다 |
| `internal` | 거짓 | `null` | 코어의 결함. 코어가 만든 대화를 AI SDK 가 요청 전에 거절한 것(결과 없는 도구 호출 등)도 이것이다 |

- `list_models` 의 `error` 는 `retryable` 이 참이면 앱이 "다시" 를 보이고, 누르면 새 `list_models` 다. 차례의 "다시" 는
  `retryable` 이 아니라 `resend` 로 보인다("다시 보내기"). 코어는 `list_models` 를 스스로 다시 보내지 않는다(차례는
  "재시도"). HTTP 상태는 AI SDK 의 `APICallError` 처럼 읽는다(408·409·429·5xx 가
  다시 해 볼 만하다). 모델 목록과 차례가 같은 상태를 같은 코드로 읽게 하려는 것이다. [계약; 문서: `@ai-sdk/provider`
  4.0.39 `src/errors/api-call-error.ts`]
- 차례의 응답이 흐르는 도중에 제공자가 보낸 오류는 그 종류가 뜻하는 HTTP 상태로 읽는다. 상태는 제공자 패키지와 AI
  SDK 가 정한다(Anthropic 의 `overloaded_error` 는 529). 상태가 없으면 AI SDK 가 다시 해 볼 만하다고 본 것은
  `provider_unavailable`, 그 밖은 `provider_rejected` 이고 `status` 는 `null` 이다. [계약; 문서: `ai` 7.0.179
  `normalizeStreamProviderError`, `@ai-sdk/anthropic` 4.0.107 `getAnthropicStreamErrorMetadata`; 실측:
  `core/tests/chat-turn.test.ts`]
- 끝을 알리기 전에 닫힌 흐름을 무엇으로 읽는지는 제공자 패키지가 정한다. OpenAI 와 Google 패키지는 언제든, Anthropic
  패키지는 출력이 나온 뒤에만 끝난 까닭 `interrupted` 를 알리고, 코어는 그것을 `network` 로 읽는다. 출력 전에 닫힌
  Anthropic 흐름에는 끝난 까닭이 없고, OpenAI 호환 패키지는 끝난 까닭 없이 닫힌 흐름을 오류로 알리므로 둘은
  `provider_invalid_response` 다. [계약; 문서: `@ai-sdk/anthropic` 4.0.107, `@ai-sdk/openai` 4.0.122,
  `@ai-sdk/google` 4.0.124, `@ai-sdk/openai-compatible` 3.0.94 의 `dist/index.js`; 실측: `core/tests/chat-turn.test.ts`]
- 코어가 만든 대화를 AI SDK 가 요청 전에 거절하면(`MissingToolResultsError`, `InvalidPromptError`,
  `InvalidMessageRoleError`, `MessageConversionError`) 제공자가 아니라 코어의 결함이므로 `internal` 이다. 요청은
  나가지 않고 error 로그가 남아(§12) 같은 구멍이 다시 생기면 드러난다. [계약; 문서: `ai` 7.0.179
  `src/prompt/convert-to-language-model-prompt.ts`; 실측: `core/tests/chat-tools.test.ts`]
- Bun 1.4.5 의 `fetch` 는 믿지 않는 인증서를 `TypeError` 로 거부하고, 그 `code` 에 Node 의 OpenSSL 오류
  이름(`DEPTH_ZERO_SELF_SIGNED_CERT`, `SELF_SIGNED_CERT_IN_CHAIN`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE` 등)을 싣는다.
  코어는 그 이름들과 `ERR_TLS_CERT_ALTNAME_INVALID` 를 `provider_certificate` 로, 그 밖의 연결 실패를 `network` 로
  읽는다. 자체 서명 인증서의 https 루프백 서버에는 연결하지만 그 처리기에 요청이 닿지 않는다. [실측:
  `core/tests/stdio/egress.test.ts`; 문서: Node.js [OpenSSL error
  codes](https://nodejs.org/api/errors.html#openssl-error-codes)] 시험이 `NODE_EXTRA_CA_CERTS` 로 넘긴 인증 기관과
  macOS 시스템 저장소의 인증서는 코어의 저장소에 든다(§7.1). 그 루트 뒤의 출처를 `fetch` 가 끝까지 받는지는 재지
  않았다(§16).

#### 보기

`→` 는 앱, `←` 는 코어가 쓴다:

```text
→ 3\topen\t{"kind":"chat"}\n
→ 3\tdata\t{"type":"list_models","provider":"openai-compatible","base_url":"https://models.example/v1"}\n
← 3\tdata\t{"type":"models","models":["m-1","m-2"],"truncated":false}\n
→ 3\tdata\t{"type":"list_models","provider":"openai-compatible","base_url":"http://127.0.0.1:8080/v1"}\n
← 3\tdata\t{"type":"error","in_reply_to":"list_models","code":"egress_denied","retryable":false,"status":null}\n
→ 3\tdata\t{"type":"x"}\n
← 3\tdata\t{"type":"error","in_reply_to":null,"code":"invalid_message","retryable":false,"status":null}\n
← 7\tclose\t{"reason":"chat_limit"}\n        넷이 열려 있을 때 연 채팅 채널
→ 3\tdata\t{"type":"turn","provider":"anthropic","api_key":"sk-ant-…","model":"claude-sonnet-5-5","text":"안녕"}\n
← 3\tdata\t{"type":"delta","text":"안녕하세요. "}\n
← 3\tdata\t{"type":"delta","text":"무엇을 도와드릴까요?"}\n
← 3\tdata\t{"type":"done","reason":"stop","input_tokens":812,"output_tokens":14,"resend":false}\n
→ 3\tdata\t{"type":"turn","provider":"anthropic","api_key":"sk-ant-…","model":"claude-sonnet-5-5","text":"내일 점심 약속 지워줘"}\n
← 3\tdata\t{"type":"delta","text":"찾아볼게요."}\n
← 3\tdata\t{"type":"tool","call_id":1,"name":"event_list","status":"started","code":null,"operation_id":null}\n
← 3\tdata\t{"type":"tool","call_id":1,"name":"event_list","status":"succeeded","code":null,"operation_id":"op-…"}\n
← 3\tdata\t{"type":"tool","call_id":2,"name":"event_delete","status":"started","code":null,"operation_id":null}\n
← 0\tconfirm\t{"id":7,"tool":"event_delete","operation_id":"op-…","channel":3,"client":{"name":"sherpa-chat","version":"0.8.6"},"title":"…","lines":[…],"timeout_ms":29400}\n        미리보기를 읽은 뒤
→ 0\tconfirmation\t{"id":7,"decision":"declined"}\n
← 3\tdata\t{"type":"tool","call_id":2,"name":"event_delete","status":"declined","code":"confirmation.declined","operation_id":"op-…"}\n
← 3\tdata\t{"type":"delta","text":"지우지 않았어요."}\n
← 3\tdata\t{"type":"done","reason":"stop","input_tokens":2871,"output_tokens":96,"resend":false}\n
→ 3\tdata\t{"type":"turn","provider":"anthropic","api_key":"sk-ant-…","model":"claude-sonnet-5-5","text":"내일 일정은?"}\n
→ 3\tdata\t{"type":"cancel"}\n
← 3\tdata\t{"type":"done","reason":"aborted","input_tokens":null,"output_tokens":null,"resend":true}\n
→ 3\tdata\t{"type":"turn","provider":"openai","api_key":"sk-…","model":"gpt-5.1","text":"안녕"}\n
← 3\tdata\t{"type":"error","in_reply_to":"turn","code":"invalid_message","retryable":false,"status":null,"resend":true}\n        이 채팅은 Anthropic 의 그 모델로 정해졌다
→ 3\tdata\t{"type":"turn","provider":"anthropic","api_key":"sk-ant-…","model":"claude-sonnet-5-5"}\n        "다시": 끊긴 "내일 일정은?" 을 그대로 다시 보낸다
← 3\tdata\t{"type":"delta","text":"내일은 일정이 둘 있어요."}\n
← 3\tdata\t{"type":"done","reason":"stop","input_tokens":2902,"output_tokens":12,"resend":false}\n
```

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
     앱이 창을 띄울 수 없거나 그 호출의 채널이 앱에 열려 있지 않으면 `unavailable` 로 답하고 코어는
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
  0\tconfirm\t{"id":3,"tool":"reminder_delete","operation_id":"op-…","channel":1,"client":{"name":"claude-code","version":"2.1.326"},"title":"…","lines":[{"label":"…","value":"…"}],"timeout_ms":30000}
  0\tconfirmation\t{"id":3,"decision":"approved"}
  0\twithdraw\t{"id":3}
  ```

  `decision` 은 `approved`, `declined`, `unavailable` 중 하나다. `client` 는 그 호출의 요청 봉투
  `_meta["io.modelcontextprotocol/clientInfo"]` 의 `name`·`version` 을 옮긴 자기 신고 값이고, 봉투에 없으면 둘 다
  `unknown` 이다. 같은 연결의 다른 요청 값을 옮기지 않는다. `client` 의 두 값은 128자, `title` 은 100자, `lines` 는
  12줄, `label` 은 40자, `value` 는 2,000자까지다(자는 코드 포인트). 이름표는 코어가 도구마다 정한 Sherpa 고정
  문구이고, 값은 대상의 실제 내용이다. [계약; 규격은 `clientInfo` 를 요청마다 싣기를 권하고(SHOULD) 서버가 앞선
  요청에 기대지 않게 한다: 문서: MCP 2026-07-28 Overview, `_meta` "Per-request protocol fields", "Statelessness"]

  `channel` 은 그 호출이 온 채널의 번호(§7.2, 1 이상 2^53-1 이하의 정수)다. 본문은 위의 여덟 키만 가진다.
  `channel` 이 없거나 정수가 아니거나 범위 밖이면, 다른 키가 틀린 본문처럼 잘못된 본문이고 앱은 창 없이
  `unavailable` 로 답한다. `id` 를 읽을 수 없는 본문만 프로토콜 위반이다. 앱은 확인의 출처를 그 번호로 자기 채널
  표에서 찾은 종류로 가리고 `client` 로 가리지 않는다. `client` 는 클라이언트가 스스로 댄 값이라 어느 MCP
  클라이언트든 `sherpa-chat` 같은 남의 이름을 댈 수 있다. [계약; ADR-0012 "확인 흐름"]
- 앱은 확인 창을 맨 앞 창으로 띄우고 남은 시간을 보여 준다. 메뉴에만 두지 않는다. 소유자가 미리보기 앱의 메뉴
  막대 아이콘을 보지 못한 일이 있었다(원인 미확인). 창은 한 번에 하나만 띄우고 나머지는 차례를 기다린다.
  기다리는 동안에도 각자의 30초는 흐른다. 버튼은 창이 뜬 뒤 1초가 지나야 눌린다. [계약; 값은
  `apple/sherpa-app/App/ConfirmationWindows.swift` 의 `armingDelay`]
- 창은 묻는 쪽을 그 호출의 채널 종류로 밝힌다. `mcp` 채널이면 MCP 에이전트가 묻는다고 쓰고, `client` 의 이름과
  버전은 그 에이전트가 스스로 댄 이름으로만 붙인다("An MCP agent that calls itself claude-code 2.1.326 asks to run
  reminder_delete."). [계약; 글은 `apple/sherpa-app/App/ConfirmationWindows.swift` 의 `asker`]
- 내보낸 앱(0.8.5, main `d2f9ad9`)에서 중계로 부른 `reminder_delete` 의 창은 호출 0.29초 안에 맞는 내용으로 떴고,
  버튼은 약 1초 뒤 눌렸다. 거부는 `confirmation.declined`(효과 `not_started`), 허용은 성공과
  `native_absence_readback` `matched`, 아무것도 누르지 않으면 30.01초 뒤 `confirmation.timed_out` 이었다. [실측:
  live-evidence 2026-11-21 "Delete confirmation through the exported app's relay"]
- 미리보기 내용은 사용자 데이터다. 앱 화면에만 보이고 로그와 기록부에 남지 않는다. [계약]
- MCP 를 끄면(§2) 모든 `mcp` 채널이 닫히므로(§7.6), 앱은 `mcp` 채널의 호출이 띄운 확인 창을 떠 있든 차례를
  기다리든 답 없이 닫고 그 뒤에 온 답을 버린다. 코어는 채널이 닫혔으므로 흐름 4 대로 그 호출을 거두고 `withdraw` 를
  보낸다. 다른 종류의 채널에서 온 확인은 스위치가 닫지 않는다. [계약]
- 앱은 `channel` 이 자기 채널 표에 열려 있지 않은 `confirm` 에 창을 띄우지 않고 `unavailable` 로 답한다. 그 코어에서
  이미 쓴 번호(스위치가 닫았거나 중계가 끝난 채널)와 그 코어가 아직 쓰지 않은 번호가 그렇다. 꺼진 동안 온 `mcp`
  채널의 `confirm` 은 닫힌 채널의 호출이다. 거부는 스위치가 아니라 채널이 열려 있는지로 정하므로, 열린 채팅 채널의
  호출이 부른 확인은 MCP 가 꺼져 있어도 창을 띄운다. [계약; ADR-0012 "확인 흐름"]
- 채팅 채널의 호출(§7.11 "도구")도 같은 흐름이다. `confirm` 의 `channel` 은 그 채팅 채널의 번호이고 `client` 는 코어가
  정한 `{"name":"sherpa-chat","version":"<코어 버전>"}` 이다. 채팅의 `cancel` 은 기다리는 확인을 흐름 4 대로 거둔다.
  창이 채팅의 확인임을 어떤 글로 밝히는지는 구현 단계 5(bunny-holes/sherpa#67)가 정한다. [계약; 실측:
  `core/tests/chat-tools.test.ts`]
- 3판의 앱은 `mcp` 채널만 연다. 앱이 채팅 채널을 여는 것은 ADR-0012 구현 단계 5(bunny-holes/sherpa#67)이고, MCP 가
  꺼진 동안 채팅의 확인이 창을 띄우는지와 스위치를 끌 때 그 창이 남는지를 끝까지 보는 시험도 그 단계가 더한다.
  지금의 시험은 `mcp` 채널 쪽만 본다(§13.2, §16). [계약]
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
  channels"] 2.1.326 은 2026-07-28 만 받는 코어를 담은 내보낸 앱의 중계에 `server/discover` 로 붙어 2026-07-28 로 열고
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
  범위나 `limit` 을 줄이라는 `remedy` 를 단다. 채팅은 같은 규칙을 64 KiB 에 쓴다(§7.11 "도구"). [계약] Claude Code 는 25,000 토큰을 넘는 성공 결과를 파일로
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
| `confirmation.unavailable` | `failed` | `after_backoff` | 앱이 확인 창을 띄울 수 없었다. 그 호출의 채널이 앱에 열려 있지 않거나 본문이 잘못된 때도 같다(§9) |
| `chat.cancelled` | `failed` | `after_user_action` | 채팅의 `cancel` 이 바뀐 것 없이 거둔 호출(§7.11 "도구") |
| `chat.not_run` | `failed` | `safe` | AI SDK 가 돌리지 않은 채팅의 호출(§7.11 "도구") |
| `chat.invalid_call` | — | — | 채팅의 `tool` 메시지에만 쓴다. 모델은 AI SDK 의 오류 글을 읽고, 스키마가 거절한 까닭은 코어가 2 KiB 안에 적는다(§7.11 "도구") |
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
  서명 확인, 코어 실행·인사·종료, 작업 요청, 확인 요청, 도구 호출, 코어 나가는 길의 `fetch`)는 시작, 성공, 실패를
  남긴다. error 는 실패, warn 은 회복 가능한 거부(서명 거부, `slow_consumer`, 늦은 응답, 나가는 길이 막은 요청),
  info 는 주요 흐름(코어 준비, 세션 열림과 닫힘, 도구 호출의 끝), debug 는 세부(프레임 크기)다. [계약; 형식은 기존
  `core/src/log.ts` 와 같다]
- `LOG_LEVEL` 이 수준을 정하고 기본은 warn 이다. 앱은 자기 환경의 `LOG_LEVEL` 을 코어에 넘긴다. [계약]
- 코어와 중계는 표준 오류에 쓴다. 앱은 통합 로그(subsystem `dev.xiyo.sherpa`)에 같은 줄을 쓰고, 코어 표준
  오류의 줄을 category `core` 로 옮긴다(한 줄은 4 KiB 에서 자른다). 읽을 때는
  `/usr/bin/log show --predicate 'subsystem == "dev.xiyo.sherpa"'` 를 쓴다. [계약] MCP 클라이언트는 서버 표준
  오류를 잡거나 버릴 수 있고, 그것을 오류로 여기지 않아야 한다. [문서: MCP 2026-07-28 stdio]
- info 줄(인사, 채널 열기와 닫기, 스위치)은 기본 warn 에서 쓰이지 않는다. 실기에서 보려면 띄우기 전에
  `/usr/bin/log stream --level info --predicate 'subsystem == "dev.xiyo.sherpa"'` 를 걸고 앱을
  `open --env LOG_LEVEL=info /Applications/Sherpa.app` 으로 띄운다. 2026-11-22 뒤늦게 부른 `log show --info` 는
  같은 구간에서 stream 이 받은 인사·열기·스위치 줄 11개 중 3개만 돌려줬다. [실측: live-evidence 2026-11-22 "The Mux 2
  bundle"]
- MCP 스위치(§2)는 바뀔 때 `info [app:mcp:switch] enabled=<true|false> sessions_closed=N confirmations_withdrawn=M`
  을 남긴다. `sessions_closed` 는 닫은 `mcp` 채널 수, `confirmations_withdrawn` 은 그 채널의 호출이 띄워 함께 닫은
  확인 창 수다. 꺼진 동안 온 중계는 `warn [app:session:open] status=unavailable reason=mcp_disabled pid=N` 이다.
  [계약]
- 앱은 창을 띄우는 확인 요청에
  `info [app:confirm:request] id=N channel=C kind=<종류> tool=… operation_id=… client=… client_version=…` 를,
  채널이 열려 있지 않은 확인 요청에
  `warn [app:confirm:request] id=N channel=C status=refused reason=<channel_closed|channel_unknown> decision=unavailable`
  을 남긴다. `channel_closed` 는 그 코어에서 이미 쓴 번호(끈 뒤 온 `mcp` 채널의 확인이 이것이다), `channel_unknown`
  은 아직 쓰지 않은 번호다. 잘못된 본문은 `warn [app:confirm:request] id=N status=invalid decision=unavailable` 이다.
  코어의 확인 줄(`[core:control:confirm] start`·`withdraw`)도 `channel=C` 를 싣는다. [계약]
- 채널을 열 때 앱은 `info [app:session:open] channel=N kind=mcp …` 를, 코어는
  `info [core:mux:session-open] channel=N kind=<종류> sessions=M` 을 남긴다. 받지 않는 종류의 `open`(§7.3)은
  `warn [core:mux:open] refused channel=N kind=<종류> reason=unsupported_kind` 다. [계약]
- 코어 나가는 길(§7.1, `core/src/chat/egress.ts`)의 줄은 아래와 같다. URL, 요청 헤더와 본문, 키, URL 을 담는 오류
  메시지는 싣지 않는다. [계약; 줄은 `core/src/chat/egress.ts`]
  - `debug [core:egress:install] success global_fetch=refused global_websocket=refused ai_sdk_default_provider=refused`:
    어느 명령이든 시작할 때 전역 `fetch`·`WebSocket` 과 AI SDK 의 기본 제공자를 거부로 바꾼 뒤.
  - `warn [core:egress:fetch] refused reason=<사유>`: 나가기 전에 막은 요청과 따르지 않은 리디렉트. 사유는
    `global_fetch`, `invalid_url`, `not_https`, `userinfo`, `other_origin`, `preconnect`, `redirect` 다.
  - `warn [core:egress:websocket] refused reason=global_websocket`: 전역 `WebSocket` 으로 열려던 연결. 연결은
    열리지 않는다.
  - `warn [core:egress:default-provider] refused reason=string_model_id`: AI SDK 에 문자열로 준 모델 id. 요청은
    나가지 않는다.
  - `warn [core:egress:base-url] refused reason=<사유>`: 받지 않은 제공자 base URL. 사유는 `invalid_url`,
    `not_https`, `userinfo`, `query`, `fragment` 다.
  - `warn [core:egress:fetch] dropped options=<이름,…>`: 요청에서 뺀 Bun 확장 선택지의 이름.
  - `info [core:egress:fetch] start`, `info [core:egress:fetch] success status=<HTTP 상태> ms=<걸린 시간>`,
    `info [core:egress:fetch] abandoned ms=<걸린 시간>`(차례의 신호로 멈춘 요청),
    `error [core:egress:fetch] failure error_type=<오류 이름> code=<Bun 의 한 낱말 코드> ms=<걸린 시간>`. `code` 는
    오류에 한 낱말 코드가 있을 때만 붙는다.
- 채팅 채널(§7.11)의 줄은 아래와 같다. 키, 메시지 본문(사람의 글, 지금 시각 줄, 모델의 답), 제공자 요청·응답 몸은
  싣지 않는다. 제공자는 이름으로만 적고 `base_url` 과 그 출처, 모델 id 도 싣지 않는다. 앞의 세 제공자는 이름이 출처를
  정하고, OpenAI 호환의 출처는 사람이 적은 호스트 이름이며, OpenAI 호환의 모델 id 도 사람이 적은 값이다. [계약; 줄은
  `core/src/chat/session.ts`·`core/src/chat/turn.ts`·`core/src/chat/calls.ts`·`core/src/tools/call.ts`]
  - `info [core:chat:list-models] start channel=N provider=<제공자>`
  - `info [core:chat:list-models] success channel=N provider=<제공자> models=<수> pages=<요청 수> skipped=<뺀 id 수> truncated=<true|false> ms=<걸린 시간>`
  - `warn [core:chat:list-models] failure channel=N provider=<제공자> code=<코드> status=<HTTP 상태|none> ms=<걸린 시간>`:
    `error` 로 끝난 목록. 코어의 결함은 `error [core:chat:list-models] failure … code=internal error_type=<오류 이름>
    ms=<걸린 시간>` 이다.
  - `info [core:chat:list-models] abandoned channel=N provider=<제공자> ms=<걸린 시간>`: 채널이 닫혀 멈춘 목록.
  - `warn [core:chat:list-models] refused channel=N reason=busy`
  - `debug [core:chat:load] success ms=<걸린 시간>`: AI SDK 와 네 제공자를 실었다. 프로세스의 첫 차례에서 한 번이다.
  - `info [core:chat:turn] start channel=N provider=<제공자>`
  - `info [core:chat:turn] success channel=N provider=<제공자> reason=<stop|length|content-filter|step-limit|other> steps=<단계 수> input_tokens=<수|none> output_tokens=<수|none> ms=<걸린 시간>`:
    `done` 으로 끝난 차례. 단계는 끝난 모델 요청이다.
  - `info [core:chat:turn] cancelled channel=N provider=<제공자> steps=<단계 수> ms=<걸린 시간>`: `cancel` 로 멈춘 차례.
  - `warn [core:chat:turn] failure channel=N provider=<제공자> code=<코드> status=<HTTP 상태|none> steps=<단계 수> ms=<걸린 시간>`:
    `error` 로 끝난 차례. 코어의 결함은 `error [core:chat:turn] failure … code=internal error_type=<오류 이름> steps=<단계
    수> ms=<걸린 시간>` 이다.
  - `info [core:chat:turn] abandoned channel=N provider=<제공자> ms=<걸린 시간>`: 채널이 닫혀 멈춘 차례.
  - `warn [core:chat:turn] refused channel=N reason=<busy|egress_denied|other_chat|nothing_to_retry|conversation_limit>`:
    요청 전에 거절한 차례. `other_chat` 은 이 채팅의 것이 아닌 `turn`, `nothing_to_retry` 는 다시 보낼 것이 없는
    `text` 없는 `turn` 이고("다시 보내기"), 둘은 `invalid_message` 로 답한다.
  - `info [core:chat:tool-call] start channel=N tool=<도구>`, `info [core:chat:tool-call] success channel=N tool=<도구> status=<상태> code=<코드|none> operation_id=<id|none> ms=<걸린 시간>`:
    모델이 부른 호출(§7.11 "도구"). MCP 와 같은 호출 수명의 줄이고 결과는 채팅의 한도로 맞춘 것이다. `failed` 로 끝난
    호출은 `warn [core:chat:tool-call] failure …` 이고, 던진 처리기는 그 앞에 `error [core:chat:tool-call] failure
    channel=N tool=<도구> error_type=<오류 이름>` 을 남긴다.
  - `info [core:chat:tool-call] abandoned channel=N tool=<도구> ms=<걸린 시간>`: 결과 없이 끝난 호출. `cancel` 이 거둔
    호출과 채널이 닫힌 호출이다.
  - `info [core:chat:tool-call] withdrawn channel=N tool=<도구>`: `cancel` 뒤라 시작하지 않은 호출.
  - `warn [core:chat:tool-call] invalid channel=N tool=<도구|unknown>`: AI SDK 가 돌리기 전에 거절한 호출.
  - `warn [core:chat:tool-call] not_run channel=N tool=<도구|unknown>`: AI SDK 가 돌리지 않은 호출.
  - `warn [core:chat:tool-call] refused channel=N tool=<도구> reason=conversation_limit`: 결과가 대화 한도를 넘길 수 있어
    코어가 돌리지 않은 호출(§7.11 "대화 한도"). 차례 안에서 한도에 닿은 차례는 `warn [core:chat:turn] failure …
    code=conversation_limit status=none` 으로 끝난다.
  - 코어에 없는 도구 이름은 `unknown` 이다. 모델이 지어낸 이름은 모델의 출력이므로 어느 줄에도 싣지 않는다. 도구 인자와
    결과도 싣지 않는다.
  - `warn [core:chat:message] refused channel=N reason=<not_json|unknown_type|schema> bytes=<바이트 수>`
  - `warn [core:chat:open] refused channel=N reason=chat_limit chats=4`
- AI SDK 의 경고(`core/src/chat/warnings.ts`)는 경고마다
  `warn [core:chat:sdk-warning] type=<unsupported|compatibility|deprecated|other> subject=<기능이나 설정의 이름|none> provider=<AI SDK 의 제공자 id|none>`
  한 줄이다. `subject` 는 `unsupported`·`compatibility` 의 `feature`, `deprecated` 의 `setting` 이다. 요청에서 온
  값을 담을 수 있는 경고의 `details` 와 `message` 는 싣지 않는다. 값은 낱말 문자와 `.`·`:`·`/`·`-` 만 남기고
  나머지는 `_` 로 바꾸며 64자에서 자른다. [계약; ADR-0012 "제공자 면"]
- 남겨도 되는 값: 채널 번호와 종류, 도구와 capability 이름, `operation_id`, 작업 요청 `id`, 상태와 HTTP 상태, 오류
  코드와 오류 이름, 거부 사유, 뺀 `fetch` 선택지의 이름, `retry`, 걸린 시간, 바이트 수, 종료 코드와 신호, 상대의
  pid 와 서명 식별자, mux·앱·코어 버전, 확인 결과 낱말, 요청 봉투 `clientInfo` 의 이름과 버전, 채팅 제공자의 이름,
  모델 수와 요청 수, 차례의 끝난 까닭·단계 수·토큰 수, AI SDK 경고의 종류와 그것이 가리키는 기능·설정 이름, AI SDK 의
  제공자 id. [계약]
- 남기면 안 되는 값: MCP 메시지 본문, 도구 인자와 결과, 확인 미리보기, 제목·이름·전화번호·메일 주소·대화
  id·`native_locator`, 메시지와 메일 본문, 홈 경로와 사용자 이름이 든 경로(소켓 절대 경로 포함), API 키, 채팅
  메시지 본문, 제공자 요청·응답 몸, OpenAI 호환의 `base_url` 과 그 출처, 채팅의 모델 id, 모델이 지어낸 도구 이름. [계약;
  아키텍처 품질 목표 6, worker-protocol 의 "Sensitive values"]

## 13. 시험 층

게이트(`scripts/check-all.sh`)는 결정적인 층을 모두 돈다. 실기 층은 소유자가 돌리고
`docs/testing/live-evidence.md` 에 적는다. [AGENTS.md]

### 13.1 코어 (bunny-holes/sherpa#27)

단위 시험(`bun run test`):

- 프레임: §14 의 벡터 전부, 형식별 한도의 경계값(한도와 한도 + 1), 읽는 도중 한도를 넘으면 더 쌓지 않음.
- 다중화: `open`·`data`·`close` 순서, 닫힌 채널과 엇갈린 프레임, 두 번째 `open` 위반, 인사 순서와 `mux`
  불일치(`fatal`, 65). Mux 1·2 앱 인사는 `mux.version_unsupported`, 본문 없는 `open` 과 모양이 틀린 종류는
  `mux.frame_invalid`. `mcp` 와 `chat` 의 `open` 은 그 종류의 처리기에 닿는다. 받지 않는 종류(`no-such-kind`,
  객체 원형의 이름 `constructor`)의 `open` 은 그 채널만 `unsupported_kind` 로 닫고, 그 번호의 다음 `open` 은
  위반이며, 다른 채널은 계속 돈다.
- 채팅 채널(§7.11): 메시지 모양과 한도의 경계값(키 512 바이트와 513, base URL 2,048 바이트와 그 너머), 읽지 못한
  메시지의 `invalid_message` 와 그 `in_reply_to`, 제공자마다 나가는 목록 요청의 URL 과 머리말(키는 머리말에만 있고
  Google 에 `?key=` 가 없음), 쪽 넘김과 Anthropic 의 active 거르기, id·요청·응답 한도와 `truncated`, HTTP 상태·인증서
  ·연결 실패의 코드와 `retryable`, `busy`, `timeout`, 닫힘의 중단, 다섯째 채널의 `chat_limit`, 로그(debug 포함)와
  다른 프레임에 키가 없음. 런타임 `fetch` 는 나가는 길 뒤의 가짜다.
- 글 차례(§7.11, `chat-turn.test.ts`): 네 제공자마다 나가는 요청의 URL·머리말·몸(키는 머리말에만, Anthropic 의 판과
  지시문과 대화의 캐시 제어와 표집 설정·`thinking` 없음과 아는 모델의 `max_tokens` 128,000, OpenAI 의 `store: false` 와 reasoning
  모델에만 붙는 옛 `include`, Google 의 Interactions 와 `store: false`, OpenAI 호환의 `stream_options`)과 `done` 의
  토큰 수, Anthropic 이 모르는 모델의 `max_tokens`(128,000 과 4,096)와 그 경고와 `length`, 50 ms 의 `delta` 와 4 KiB 를
  문자 사이에서 자르기, 대화의 이어짐(오류·끊김·거절로 끝난 단계는 빠지고, reasoning 은 서명과 함께 남되 앱에 가지
  않음), 제공자마다 일찍 닫힌 흐름의 코드, 주입한 시계와 시간대로 만든 지금 시각 줄(차례마다 다시 읽고, OpenAI
  호환에는 문자열 하나), 다른 채팅의 `turn`, `busy`, `cancel`, 닫힘, 재시도(실패 셋은 세 번 보내고 마지막 상태의
  코드, 503 뒤 200 은 503 이 적은 `retry-after-ms` 뒤, AI SDK 가 다음 요청을 기다리는 동안의 `cancel` 은 곧바로 `done`
  `aborted` 이고 더 보내지 않음, 401·403·400·404·인증서·리디렉트는 한 번, 연결 실패는 2초와 4초 간격, OpenAI·Anthropic
  의 첫 출력 전 흐름 오류는 세 번, `onError` 를 넘겨도 출력 뒤의 흐름 오류는 한 번과 그 코드), 짧게 줄인 첫 출력과
  출력 사이의 한도(첫 출력 한도는 한 번 보내고 끝남, 상태로 실패한 뒤의 기다림은 한도에 들지 않음), 가짜 시계 위의
  600초 한도(한도 1초 전에 첫 출력 전 오류를 보낸 OpenAI 응답 뒤에 다시 보낸 요청은 한도를 새로 켜, 첫 요청의 마감
  뒤에 답해도 `timeout` 이 아님), 가짜 시계 위에서 출력마다 새로 켜지는 출력 사이의 600초, Bun 의 유휴 한도가 머리말 전·몸 도중·출력 뒤에 던지는
  `TimeoutError` 가 한 번 보내고 `timeout` 으로 끝남, 2 MiB 대화 한도(글이 넘길 차례는 요청 없이 거절, 네 제공자에서
  넘길 답은 그 앞까지 보내고 끊으며 요청은 한 번, 첫 조각이 이미 넘으면 `delta` 없이, 그 뒤의 차례는 `text` 가 있든
  없든 거절), 다시 보내기("다시 보내기" 의 표에서 도구가
  없는 줄마다 시험이 있고, 거절을 포함해 `turn` 에 답한 것마다 그 `resend` 와 바로 뒤의 `text` 없는 `turn` 을 받는지가
  같음: 빈 대화에서 거절한 `text` 없는 `turn` 과 막은 `base_url` 뒤, `stop`·`length`·`other` 의 답 뒤에는
  `nothing_to_retry` 이고 대화가 그대로임, 글·reasoning·호출이 없는 답과
  `content-filter`·`aborted`·시작한 차례의 `error` 뒤에는 사람의 글을 시각 줄 하나와 함께 한 번만 실음, reasoning
  만 있는 답 뒤는 거절, 답의 끝과 겹친 `cancel` 의 네 때, `provider_auth` 뒤 바뀐 키, 도는 차례 중의 `busy` 와 모양이
  틀린 `turn` 은 `resend` 가 거짓, 그 밖의 모양이 틀린 `turn`·다른 채팅·막은 `base_url` 은 앞의 끝이 참이든 거짓이든
  그 `resend` 를 싣고 대화를 그대로 둠, `conversation_limit` 뒤에는 이것도 `conversation_limit`), 로그(debug 포함)에 키·글·답이 없음. 모든 시험은
  패키지가 아는 모델 id 를 쓰고, 기대하지 않은 AI SDK 경고가 하나라도 나오면 실패한다. 응답은 손으로 쓴 server-sent
  events 이고, 네 제공자의 응답 모양은 `tests/support/provider-events.ts` 가 `chat-tools.test.ts` 와 함께 쓴다.
- 도구(§7.11 "도구", `chat-tools.test.ts`): planner 의 서술자로 지은 35개 도구를 `app serve` 처럼 넘긴 채팅이 네
  제공자에 도구 정의를 `$schema` 와 안전한 정수의 경계 없이 보내고 결과 봉투를 그 호출의 id 로 돌려받음, 호출이 호출
  수명을 거쳐 `tool` 둘로 앱에 알려지고 그 앞의 글이 먼저 감, 한 단계의 호출이 하나씩 모델이 준 차례대로 돎, 도구 단계
  뒤 실패한 요청을 다시 보내도 도구는 다시 돌지 않음, 20번째 요청 뒤의 `step-limit` 과 그 뒤 차례, 64 KiB 맞춤(읽기는
  `failed`, 일어난 변경은 `partial`), 잘못 만든 호출과 없는 도구의 `chat.invalid_call`(이름 `null`, 로그 `unknown`),
  채널마다 1부터 이어 세는 번호, 11분 뒤 답한 변경, 확인 창의 거부와 30초 초과와 그 `channel`·`client`, 호출 중의
  `cancel`(기다리는 창을 거둠, planner 읽기를 끊음, 청한 변경은 끝까지 기다림, core 의 보내기와 읽기는 끝까지 돎,
  응답이 끝나기 전에는 아무것도 돌지 않고 남지 않음), 호출 중 닫힌 채널, AI SDK 가 돌리지 않은 호출(OpenAI 호환과
  Anthropic 의 `length`, OpenAI 호환의 모르는 까닭에서 `chat.not_run` 봉투와 `tool` 둘과 warn 줄과 다음 차례의
  요청, 앞의 글이 먼저 감, 잘못 만든 호출과 섞이면 결과가 호출 차례대로이고 그 결과는 AI SDK 의 앞글 뒤에 코어가 적은
  까닭임, 번호가 이어짐), `stop`·`tool-calls` 밖의 까닭으로 끝난 단계 뒤의 요청 없음(인자 한가운데서 끊긴 호출은 잘못
  만든 호출로 읽히고 요청 하나로 `done` `length` 이며 다음 차례의 요청이 그 호출과 오류를 실음, 잘못 만든 호출이 든
  OpenAI 호환의 `content_filter` 와 Anthropic 의 거절은 `done` `content-filter` 이고 대화에 남는 것이 없음, 모르는
  까닭은 `done` `other`, 흐름의 오류는 `error` 이고 남는 것이 없음), 결과 없는 호출이 든 대화는 요청 없이 `internal` 과
  error 줄 하나, 다시 보내기("다시 보내기" 의 표에서 도구가 있는 줄마다 하나이고, 줄마다 그 끝의 `resend` 와 받는지가
  같음: 호출이 든 `length`·`other`(`chat.not_run`, 잘못 만든 호출, 인자 한가운데서 끊긴 호출)와 호출 중의 `cancel`
  과 도구 단계 뒤의 `error` 뒤에는 그 결과로 끝나는 대화를 사람의 글 한 번과 함께 보냄, `step-limit` 뒤에는 모델 요청
  20번을 더 보냄, 도구 단계 뒤 reasoning 만 내고 `length` 로 끝난 단계 뒤는 거절, 잘못 만든 호출 뒤에 글이 온
  Anthropic 과 OpenAI 호환의 단계는 `tool` 과 `delta` 의 차례가 달라도 받음), 차례 안의
  대화 한도(결과가 한도를 넘길 수 있는 호출은 돌지 않고 `chat.conversation_limit` 과 warn 줄을 남기며 차례가
  `conversation_limit` 로 끝나고, 그 끝의 `resend` 가 거짓이며 뒤의 차례를 `text` 가 없든 있든 받지 않음("다시
  보내기" 의 표에서 `conversation_limit` 의 줄), 앞서 돈 호출의 결과도 세어 그 단계의 뒤 호출이 돌지 않음, 뒤 단계에서
  끊긴 답은 앞 단계와 그 호출의 결과를 남김, 답을 세지 않는 방에서 단계가 끝날 때만 넘음을 찾은 단계는 그 호출의
  결과와 남고 다음 요청이 없음), Anthropic 의 맨 위 `cache_control` 과 표시 없는 도구, 로그에 인자·결과·지어낸 이름이
  없음. 기대하지 않은 AI SDK 경고가 하나라도 나오면 실패한다.
- 대화 한도(§7.11 "대화 한도", `chat-limit.test.ts`): 차례의 방이 끝난 단계의 메시지를 차례를 시작할 때의 잼과 바이트까지
  같게 더함, 한도를 넘는 첫 바이트에서 한 번 넘고 채팅을 가득 참으로 두며 넘은 채로 남음, 가장 큰 결과의 자리를 답과
  앞의 결과 곁에서 봄, 답의 셈이 AI SDK 7.0.179 가 단계에 남긴 JSON 보다 작지 않음(이스케이프하는 글자와 반으로 나뉜
  이모지, 마지막에 온 reasoning 의 서명과 바뀌는 메타데이터, 파일, 돈 호출·메타데이터를 실은 돈 호출·없는 도구·풀리지
  않는 입력·스키마가 거절한 입력·`9e20` 2,000 개처럼 수를 길게 다시 적는 입력·객체가 아닌 입력, issue 2,000 개를 낸 두
  호출, 2 KiB 가 이모지나 따옴표와 제어 문자 안에 떨어지는 키를 실은 두 호출), 스키마가 거절한 호출의 셈은 남긴 것보다
  512 바이트 넘게 크지 않음(까닭 셋 가운데 하나만 더함), 스키마가 거절한 까닭(AI SDK 의 앞글 뒤 2 KiB 안에, `alarms` 의
  숫자 2,000 개는 앞의 issue 를 차례대로 적고 첫 줄이 그 경로와 message 이며 남은 수가 맞음, 모르는 키 2,000 개는 zod 가
  낸 issue 하나를 자름, 이모지의 키는 그 2 KiB 가 떨어지는 글자 앞에서, 따옴표와 제어 문자의 키는 JSON 이 적는 바이트로
  자름, 풀리지 않는 입력은 AI SDK 의 글 그대로이고 JSC 가 자른 식별자를 적는 글은 260 바이트, 없는 도구의 글은 35개 도구의
  이름 658 바이트, zod 의 차례와 표기와 같은 입력의 같은 글, 2 KiB 가 4 바이트 글자 안에 떨어지는 자름, 남은 수 곁의
  자름, 한 글자도 들지 않는 줄의 셈, JSON 이 적는 바이트), 미들웨어는 맞는 데까지 넘긴 뒤 오류 조각 하나(`ChatFailure`
  `conversation_limit`)로 끊고 응답을 취소하며 첫 조각이 넘으면 곧바로 끊음, AI SDK 는 `maxRetries: 2` 에서도 그 요청을
  한 번만 보내고 그 단계를 `error` 로 끝냄. 모델은 AI SDK 의 mock 이라 요청이 없다.
- 호출의 되돌릴 수 없는 때(`mcp-tools.test.ts`): planner 변경은 요청을 보내는 같은 차례에, 삭제와 보내기는 허용 뒤 그
  요청이나 명령 바로 앞에, core 읽기는 명령 바로 앞에 `committed` 를 알리고, 그 뒤에 끊긴 신호는 그 걸음을 멈추지
  않으며, 그 걸음 전에 끝난 호출은 알리지 않는다. 채팅의 `cancel` 은 이것으로 거둘 호출을 가린다.
- AI SDK 의 울타리: `ai` 7.0.179 의 `generateText`·`streamText`·`embed` 에 문자열 모델 id 를 주면 기본 제공자가
  요청 전에 `egress_denied` 로 거부하고, 그 전역과 경고의 전역은 다시 쓰지 못하며, SDK 의 경고는 `details`·`message`
  없이 Sherpa 로그로만 간다(`chat-sdk-globals.test.ts`; 시험 파일마다 프로세스가 따로라 진짜 전역을 바꾼다). 코어가
  번들하는 패키지(`core/package.json` 의 의존과 그 의존, 선택이 아닌 peer)의 JavaScript 를 Bun 의 transpiler 로 읽어
  린트와 같은 네트워크 모듈, 파일·경로·OS·암호·process 밖의 Node 모듈, `bun`, `Bun`·`Worker`·네이티브 바인딩, 이름을
  실행 때 짓는 모듈 읽기가 없음을 보고, 시험을 돌리는 Bun 에 `fetch`·`WebSocket` 밖의 네트워크 전역이 없음을 본다
  (`dependency-network.test.ts`). 코어 린트 규칙은 일부러 어긴 시험 파일에 돌려 형태마다 잡는지 본다
  (`egress-lint.test.ts`).
- 작업 요청: `id` 상관, 늦은 응답 버림, 시간 초과에서 읽기와 변경의 구분, `report` 모양 옮기기.
- 확인: `approved`·`declined`·`unavailable`·30초 초과, 취소와 연결 끊김의 `withdraw`, `withdraw` 뒤 답 무시,
  실행이 원래 호출 안에서만 일어남. `confirm` 본문은 앱이 읽는 여덟 키만 가지고 `channel` 은 그 호출의 채널임.
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

stdio 시험(`core/tests/stdio/**`, `bun run build` 뒤 `bun run test:stdio`). 빌드한 `core/dist/sherpa` 를 임시
`HOME` 으로 띄우고, `app serve` 는 가짜 앱 시험기(`core/tests/stdio/fake-app.ts`)가 프레임으로 몬다. 게이트는
코어를 빌드한 뒤 이 층을 돈다:

- 인사 → 채널 셋 열기 → 채널마다 `server/discover`(2026-07-28), 봉투를 단 `tools/list`, 읽기 `tools/call`(가짜
  `response`). 시험 빌드의 동시 세 세션 시험과 같은 모양이다.
- 2025-11-25·2025-06-18 `initialize` → -32022, 봉투 없는 `tools/list` → -32022, 같은 채널의 `server/discover` 뒤 도구
  35개와 읽기 호출, 표준 오류의 `reason=unsupported_protocol_version`.
- 삭제 도구 → `confirm` → `approved` 면 `request` 가 나가고, `declined` 면 나가지 않음. 채널 2 와 3 에서 부른
  삭제의 `confirm` 은 `channel` 이 2 와 3 임.
- 호출 중 `close` → 답이 없고 코어는 계속 돈다.
- Mux 2 앱 인사 → `fatal` `mux.version_unsupported` 와 65, 작업 요청 없음, 표준 오류의 `app_mux=2`. 본문 없는 `open`
  → `fatal` `mux.frame_invalid` 와 65. 받지 않는 종류의 `open` → 그 채널에 `close` `unsupported_kind` 와 warn 로그,
  그 채널의 `data` 는 답이 없고, 다음 채널은 열리며, 표준 입력 EOF 뒤 0.
- 한도를 넘는 줄 → `fatal` 과 65. 표준 입력 EOF → 5초 안에 0.
- 나가는 길(§7.1, `egress.test.ts`): 인사부터 두 MCP 연결, 읽기 호출, 사람을 기다리는 삭제 호출까지 코어에 인터넷
  소켓(`lsof -i`)도 듣는 Unix 소켓(`lsof -U`)도 없다. `lsof` 는 소켓 없는 프로세스와 끝난 pid 에 똑같이 아무것도
  내지 않으므로 시험 프로세스의 듣는 소켓과 코어의 fd 0–2 를 먼저 보는 양성 대조를 둔다. `--version` 도 전역
  `fetch`·`WebSocket` 과 AI SDK 의 기본 제공자를 거부로 바꾼 줄(§12)을 남긴다. 채팅 채널의 모델 목록: 평문 http
  루프백 출처는 `egress_denied` 이고 그 서버에 연결이 오지 않으며 코어에 소켓이 없다. 자체 서명 인증서의 https 루프백
  출처는 `provider_certificate` 이고 그 서버의 처리기에 요청이 닿지 않는다. 시험마다 `/usr/bin/openssl` 로 만든 인증
  기관을 `NODE_EXTRA_CA_CERTS` 로 넘긴 코어에서, 그 기관이 서명한 https 루프백 출처는 `models` 로 끝나고 서버는
  `GET /v1/models` 하나를 `authorization: Bearer <키>` 와 함께 받는다. 서버가 답을 잡고 있는 동안 코어의 인터넷
  소켓은 모두 그 서버로 가는 연결이고 듣는 Unix 소켓은 없다. 리디렉트 회귀: 그 출처가 다른 출처로 보낸 307 과 같은
  출처로 보낸 302 는 `egress_denied` 로 끝나고 리디렉트 대상에는 요청이 가지 않는다. 글 차례: 평문 http 루프백
  출처는 `egress_denied` 이고, 그 포트에서 듣는 시험 프로세스는 연결을 하나도 받지 않으며, 그 뒤 코어에 소켓이 없고,
  코어는 AI SDK 를 싣지 않는다(`[core:chat:load]` 줄 없음). 같은 기관이 서명한 출처에서는 모델 목록이 AI SDK 없이
  답하고, 첫 차례가 AI SDK 를 한 번 싣는다. 그 차례는 서버가 답의 나머지를 잡고 있는 동안 첫 `delta` 를 앱에 내고(그때
  코어의 인터넷 소켓은 모두 그 서버로 가는 연결이고 듣는 Unix 소켓은 없다) `done` 으로 끝나며, 둘째 차례는 첫 답을
  대화에 싣는다. 서버가 받은 요청은 모델 목록 하나와 차례 둘이고, 사람 글 앞의 시각 줄은 `TZ` 없는 코어가 읽은 이
  Mac 의 시간대(`/etc/localtime`)를 단다. 코어의 `HOME` 에 만료된 Vercel CLI 로그인을, 작업 폴더에
  `.vercel/project.json` 을 두고 돌아도 두 파일의 바이트와 수정 시각은 그대로이고 거부 줄이 없다. 대조로, 같은 두
  파일을 둔 임시 `HOME` 의 자식 프로세스에서 preload 로 `fetch` 를 막고 진짜 `@vercel/oidc` 의
  `getVercelOidcToken` 을 부르면 `VercelOidcTokenError` 를 던지고 `fetch` 는 부르지 않은 채 로그인을 `{}` 로
  덮어쓴다(ADR-0012 "제공자 면"). 어느 경우든 키가 표준 오류와 프레임에 없다.
- 채팅의 도구(`chat-tools.test.ts`): 발견을 답한 코어에서, 시험이 믿게 한 https 루프백의 모델이 `event_delete` 를
  부르면 채널 0 에 미리보기 읽기(`event.get`)와 `confirm` 이 온다. `confirm` 의 `channel` 은 채팅 채널의 번호이고
  `client` 는 `sherpa-chat` 과 코어의 버전이다. 허용하면 `event.delete` 가 나가 `tool` 이 그 확인의
  `operation_id` 로 `succeeded` 이고, 다음 모델 요청이 그 결과를 싣는다. 거부하면 작업 요청이 더 나가지 않고
  `tool` 은 `declined`·`confirmation.declined` 이며, 모델은 바뀐 것이 없다는 결과를 읽는다. 창이 떠 있는 동안의
  `cancel` 은 채널 0 에 그 확인의 `withdraw` 를 보내고, 차례는 `withdrawn`·`chat.cancelled` 와 `resend` 가 참인
  `done` `aborted` 로 끝난다. 그 뒤의 `text` 없는 `turn` 은 그 결과로 끝나는 대화를 사람의 글 한 번과 함께 보낸다. 표준 오류에 키,
  사람의 글, 답, 도구 인자가 없다. 시험마다 만드는 인증 기관은 `tls.ts` 가 `egress.test.ts` 와 함께 쓴다.
- 실제 시계(`waits.test.ts`): 답 없는 확인은 30초에 `withdraw` 되고 호출은 `confirmation.timed_out` 으로 실패하며
  늦은 승인은 아무것도 돌리지 않는다. 답 없는 발견은 5초 뒤 core 도구만 남기고 늦은 답은 버린다. planner 작업자가
  없는 앱은 core 도구를 곧바로 받는다.
- 같은 층의 `cli.test.ts` 는 이 계약 밖의 CLI 인자 검사다.

### 13.2 앱과 중계 (bunny-holes/sherpa#28)

단위 시험(`swift test`. 새 패키지는 `check-all.sh` 의 `SWIFT_PACKAGES` 에 더한다):

- 프레임: §14 의 벡터 전부. 코어와 같은 벡터다. 다만 `open` 본문의 종류와 앱 `hello` 의 `mux` 는 앱 → 코어 프레임을
  읽는 코어가 보므로, 앱의 프레임 읽기 시험은 본문 없는 `open` 까지만 본다.
- 확인 요청 본문(§9): 여덟 키만 받고, `channel` 은 1 부터 2^53-1 까지의 정수만 받는다. 없거나 0, 음수, 2^53, 소수,
  문자열, null, 불이면 그 `id` 의 잘못된 본문이다.
- 머리말의 직렬화와 중계의 해석, 종료 코드를 고르는 표. `mcp_disabled` 는 75 와 MCP 를 켜라는 `remedy`, 모르는 사유는
  `status` 대로 75·77 과 일반 `remedy`, 사유 모양이 아니면 76.
- 소켓 경로 계산(홈은 사용자 데이터베이스에서), 103 바이트 경계.
- 단일 인스턴스 잠금(§3): 한 번만 잡히고 `run/` 은 0700, `app.lock` 은 0600 이며, 풀면 다시 잡힌다. 같은 열린
  파일을 가리키는 설명자 사본이 열려 있어도 풀린다(bunny-holes/sherpa#78).
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
- 가짜 코어(프레임을 말하는 작은 시험 프로그램)와 다중화: 인사의 버전이나 `mux` 불일치(Mux 2 가짜 코어 포함,
  `core_incompatible`, 재시작 안 함), 연결마다 `{"kind":"mcp"}` 의 `open` 과 `close`, 코어가 끝나면 모든 중계가
  75, 재시작 간격과 다섯 번 뒤 멈춤(시간은 주입), 코어 준비 전 연결의 10초 대기, `slow_consumer` 가 다른 채널을
  멈추지 않음, 16개 초과 거부, 확인 요청에 시험용 결정기로 답함(결정기는 채널 번호와 그 종류 `mcp` 를 받는다).
- MCP 스위치(§2, §5, §7.6, §9): 시험 호스트는 `--mcp on|off` 로 시작하고, 없으면 앱의 첫 실행처럼 꺼진 채
  시작한다. 표준 입력의 `mcp on`·`mcp off` 한 줄이 앱의 스위치처럼 바꾼다. 꺼진 호스트에서 직접 연결은 여전히
  `peer_signature` 이고, 중계는 75·`mcp_disabled` 로 끝나며 코어에 `open` 이 가지 않음. 켜면 같은 호스트가 중계에
  채널을 엶. 켜진 채 끄면 열린 중계 둘이 75(`app_closed_session`), 코어가 `mcp` 채널마다 `close`
  `{"reason":"mcp_disabled"}` 를 받고, 떠 있던 `mcp` 채널의 확인 창이 그 `id` 로 닫히며(한꺼번에 거두지 않는다), 새
  중계는 `mcp_disabled`. 다시 켜면 같은 코어의 다음 채널. 끈 뒤 도착한 확인 요청은 창 없이 `unavailable`
  (`channel_closed`). 켜진 동안에도 닫힌 채널과 연 적 없는 채널을 대는 확인 요청은 창 없이 `unavailable`
  (`channel_closed`, `channel_unknown`). 채팅 채널의 확인은 앱이 그 채널을 열 때(bunny-holes/sherpa#67) 더한다(§9).
  스위치에는 시험용 환경 변수가 없다. 이 인자와 표준 입력은 DEBUG 시험 호스트만 읽고(릴리스 시험 호스트는
  `--print-configuration` 만 한다), 앱은 defaults 만 읽는다.
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
  요건의 팀, 앱만 가진 권한 항목, `codesign --verify --strict --deep`, 번들 중계의 `--version`, 번들 코어의
  `BUN_BE_BUN=1 … --version` 이 선언한 Bun 판인지를 본다(bunny-holes/sherpa#71). 오류 봉투를 쓰는 가짜 코어를
  `SHERPA_CORE` 로 주면 빌드가 `core_not_mux` 로 실패하고 번들에 서명과 실행 파일이 없어야 한다. 인사는 맞고
  런타임만 `0.0.1` 이라고 답하는 가짜 코어는 `core_runtime_mismatch` 로 실패하고 마찬가지로 아무것도 남지 않아야
  한다. 보안 타임스탬프는 내보낸 번들에만 있어 게이트는 보지 않는다. [계약]

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
  2026-11-22 공증 전 내보낸 앱(2026-07-28 만 받는 코어)으로 Codex 의 `tools/list`·읽기 호출, 기본 설정 Codex 의 거부, Claude
  Code 의 `server/discover`·`tools/list` 를 쟀다. [실측: live-evidence 2026-11-22 "The exported app with the 2026-07-28-only core"]
  같은 날 `main` `8de36c6` 을 처음부터 빌드해 내보낸 앱으로 Claude Code 의 읽기 호출(`claude -p`)과 Codex 의
  읽기 호출·기본 설정의 거부를 다시 쟀다. [실측: live-evidence 2026-11-22 "Claude Code calls a tool"] 공증한 번들과
  앱을 끈 상태의 69, 코어 `kill -9` 는 남았다.
- Mux 2 번들(2판, bunny-holes/sherpa#63): 2026-11-22 `main` `cc82033` 을 처음부터 빌드해 내보낸 앱(Developer ID,
  공증 전)을 `/Applications` 에 두고 쟀다. 인사는 `mux=2` 였고 채널 열기 줄은 모두 `kind=mcp` 였다. Claude Code
  2.1.330 은 플러그인 서버로 `Connected` 였고 `claude -p` 로 읽기 호출을 했다. Codex 0.171.0 은 설정 파일에 기능이
  없어 실행마다 `-c` 로 켠 채 35개 도구를 보고 읽기 호출을 했다. 켜진 채 창의 스위치로 끄자 세 연결(Claude Code
  대화형, Codex 스레드, Bun 이 띄운 중계)이 닫혔고(`sessions_closed=3`), Bun 이 띄운 중계는 75 와
  `app_closed_session` 줄로 끝났다. Codex 는 그 줄을 남기고 서버를 `failed` 로 두었고, Claude Code 는 줄 없이
  `✘ failed` 만 보였다(§6). 다시 켜자 Claude Code 는 `/mcp` 의 Reconnect 로, Codex 는 새 세션으로 붙었다. [실측:
  live-evidence 2026-11-22 "The Mux 2 bundle"] 두 에이전트가 띄운 중계의 종료 코드는 에이전트가 남기지 않아 읽지
  못했다. 그 앞의 실기는 모두 Mux 1 번들로 쟀다.
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
  - 메뉴의 켜기·끄기. 창의 스위치로 켜진 채 끌 때 연결된 두 에이전트가 보이는 것은 위 "Mux 2 번들" 에서 쟀다.
  - 사용자 범위로 등록한 Claude Code 가 꺼진 동안 실패한 뒤, 켜고 `/mcp` 의 Reconnect 로 붙는지.
  - 복사한 명령을 그대로 넣어 붙는지.
  - `/Applications/Sherpa.app` 보다 긴 설치 경로에서 명령과 경로가 잘리지 않고, 선택해 복사한 값과 복사 단추의 값이
    `Contents/MacOS/sherpa-relay` 로 끝나는 전체 경로인지.

## 14. 시험 벡터

`←` 는 코어가 쓰는 프레임, `→` 는 앱이 쓰는 프레임이다. 탭은 `\t`, LF 는 `\n` 으로 적었다. 버전 `0.9.0` 은
보기다.

맞는 프레임:

```text
← 0\thello\t{"mux":3,"version":"0.9.0"}\n
→ 0\thello\t{"mux":3,"version":"0.9.0","workers":["planner"]}\n
← 0\trequest\t{"id":1,"worker":"planner","request":{"kind":"request","protocol_version":"2.0.0","application_contract":"sherpa.planner.v2","request_id":"op-1","operation_id":"op-1","capability":"capabilities","payload":{"schema":"sherpa.planner.capabilities.request.v2"},"deadline_ms":20000,"idempotency_key":"op-1","policy":{"effect":"read","required_evidence":"none","artifact_directory":null}}}\n
→ 0\tresponse\t{"id":1,"response":{"application_contract":"sherpa.planner.v2","capability":"capabilities","effect":{"kind":"none","state":"not_started"},"error":{"code":"protocol.unsupported_capability","retry":"never"},"kind":"response","operation_id":"op-1","protocol_version":"2.0.0","request_id":"op-1","status":"failed","warnings":[]}}\n
→ 0\tresponse\t{"id":2,"report":{"error":"sherpa.internal_failure","status":"failed"}}\n
→ 1\topen\t{"kind":"mcp"}\n
→ 1\tdata\t{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n
← 1\tdata\t{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n
← 0\tconfirm\t{"id":3,"tool":"reminder_delete","operation_id":"op-2","channel":1,"client":{"name":"t","version":"0"},"title":"t","lines":[],"timeout_ms":30000}\n
→ 0\tconfirmation\t{"id":3,"decision":"declined"}\n
← 0\twithdraw\t{"id":3}\n
→ 1\tclose\n
← 2\tclose\t{"reason":"server_closed"}\n
← 1\tclose\t{"reason":"unsupported_kind"}\n
← 0\tfatal\t{"code":"mux.frame_invalid"}\n
```

`data` 본문은 프레임 층이 해석하지 않는 보기다. 2026-07-28 의 실제 요청은 `params._meta` 에 봉투를 단다(§10.1).

위반(코어가 받으면 `fatal` 과 65, 앱이 코어 출력에서 보면 코어를 끝낸다):

```text
01\tdata\t{}\n                              앞자리 0
1\tDATA\t{}\n                               대문자 형식
1 data {}\n                                 탭 없음
1\tdata\n                                   본문 없는 data
1\tdata\t\n                                 빈 본문
0\topen\t{"kind":"mcp"}\n                   제어 채널의 open
1\thello\t{"mux":3}\n                       채널 1 이상의 hello
9007199254740992\topen\t{"kind":"mcp"}\n    2^53
1\topen\n                                   본문 없는 open(Mux 1 의 open): mux.frame_invalid
1\topen\t{}\n                               종류 없는 open: mux.frame_invalid
1\topen\t{"kind":"MCP"}\n                   낱말이 아닌 종류: mux.frame_invalid
1\topen\t{"kind":"mcp"}\n 를 두 번          살아 있는 채널의 두 번째 open
1\topen\t{"kind":"mcp"}\n 이 첫 프레임      인사 전 프레임
0\thello\t{"mux":2,"version":"0.9.0","workers":["planner"]}\n   Mux 2 앱 인사: mux.version_unsupported
줄 끝 없이 8,454,144 바이트 초과            줄 한도
```

위반이 아닌 것:

```text
5\tdata\t{"jsonrpc":"2.0","method":"x"}\n   닫힌 채널: 버리고 debug 로그
1\tdata\tnot json\n                         그 채널에 -32700 오류, 연결 유지
0\tresponse\t{"id":99,"report":{"error":"x","status":"failed"}}\n   모르는 id(늦은 응답): 버리고 warn 로그
1\topen\t{"kind":"no-such-kind"}\n          받지 않는 종류: 그 채널에 1\tclose\t{"reason":"unsupported_kind"}\n, 코어는 계속 돈다
← 0\tconfirm\t{"id":4,"tool":"reminder_delete","operation_id":"op-3","client":{"name":"t","version":"0"},"title":"t","lines":[],"timeout_ms":30000}\n   channel 없는 확인: 앱은 창 없이 → 0\tconfirmation\t{"id":4,"decision":"unavailable"}\n 로 답한다
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
  보인다(§6). 시험 서버로 잰 세 후보는 live-evidence 2026-11-22 "Claude Code and Codex after a relay that ended" 에,
  Claude Code 2.1.330 의 서버 페이지·Reconnect·모델 알림으로 다시 잰 것은 "Claude Code 2.1.330 after a relay that ended"
  에 있다. 켜진 채 끈 뒤에는 Claude Code 가 그 줄조차 남기지 않는다(§6).
- Codex 가 같은 세션 안에서 실패한 서버를 다시 띄우는 길. app-server 에 `config/mcpServer/reload` 가 있으나 부르지
  않았다.
- 이 Mac 의 선 위에서 Claude Code 와 Codex 가 2026-07-28 봉투의 `clientCapabilities` 에 선언하는 elicitation(Claude
  Code 는 문서에, Codex 는 소스에 있다).
- Claude Code 2.1.326 의 `anthropic/requiresUserInteraction` 지원.
- Codex 의 모델 기본 도구 출력 예산 값.
- 앱이 띄운 코어의 `osascript` 보내기가 앱의 Apple Events 권한으로 판정되는지.
- 연결된 뒤 중계가 끝났을 때 이 Mac 의 Claude Code 가 문서대로 동작하는지. 2026-11-22 켜진 채 끈 실기에서 Codex 는 같은
  스레드에서 서버를 다시 띄우지 않았고, Claude Code 도 스스로 다시 붙지 않았다(§6). 연결 전(머리말 단계)에 끝난 경우도
  같은 날 쟀다(§6).
- Developer ID 로 양방향 서명이 통과하는 경로. 인증서가 소유자 키체인에만 있어 게이트는 거부 쪽과 시험 요건만
  돈다.
- DEBUG 앱·빌드한 코어·중계의 통합 시험(§13.3). 게이트에 없다.
- MCP 가 꺼진 동안 채팅 채널의 호출이 부른 확인이 창을 띄우는지와, 스위치를 끌 때 그 창이 남는지(§9). 3판의
  앱은 채팅 채널을 열지 못해 게이트는 `mcp` 채널 쪽만 본다. 앱이 채팅 채널을 여는 bunny-holes/sherpa#67 이 시험을
  더한다.
- 내보낸 앱의 메뉴 막대 아이콘이 보이는지와 미리보기 앱에서 보이지 않은 원인, 메뉴의 Quit, 오래 켜 둔 앱과 코어의
  메모리. 2026-11-21 의 #29 실기에서 재지 않았다.
- 도구별 결과 스키마. Swift 와 ObjC 응답의 null 키 차이가 정리된 뒤 정한다.
- 채팅의 글 차례(§7.11): 네 제공자의 실제 API 가 코어의 요청(Anthropic 의 `anthropic-version: 2026-10-21`, Google
  Interactions 의 `store: false`, OpenAI 의 옛 `include`)을 받는지, 실제 흐름과 흐름 안 오류의 모양이 시험의 손으로
  쓴 응답과 같은지, 실패한 차례 뒤 잇달아 놓인 사람의 글을 OpenAI·Google·OpenAI 호환이 받는지. 지금의 모델이 첫
  출력 전에 얼마나 생각하는지와, 그동안 제공자가 바이트(Anthropic 의 `ping` 등)를 보내는지. 보내지 않으면 코어의
  600초보다 먼저 Bun 의 유휴 한도가 차례를 끊는다. 유료 호출이라 소유자 실기(bunny-holes/sherpa#68)에서 잰다.
- 채팅의 도구(§7.11 "도구"): 네 제공자의 실제 API 가 코어의 도구 정의를 받는지, 실제 도구 왕복(Google 은 모의
  서버로도 재지 않았다), Anthropic 의 캐시가 실제로 읽히는지(`cache_read_input_tokens`), 모델이 글 뒤나 출력 사이에
  얼마나 생각하는지와 그동안 바이트(`ping` 등)를 보내는지, 도구를 부른 응답을 `tool_calls`·`function_call`·`stop`
  밖의 까닭으로 끝내는 OpenAI 호환 서버가 있는지. 그런 서버에서는 도구가 하나도 돌지 않는다. 유료 호출이라 소유자
  실기(bunny-holes/sherpa#68)에서 잰다.
- 채팅 채널의 모델 목록(§7.11): 네 제공자의 실제 목록 응답이 문서의 모양과 같은지, Anthropic 의 `/v1/models` 가
  `anthropic-version: 2026-10-21` 을 받는지, Google 이 `pageSize=1000` 을 받는지. 목록은 유료 호출이 아니지만
  소유자의 키가 있어야 하므로 소유자 실기(bunny-holes/sherpa#68)에서 잰다. 시스템 프록시 뒤의 https 출처에 빌드한
  코어가 닿는지도 재지 않았다. 빌드는 `--compile-exec-argv=--use-system-ca` 로 macOS 시스템 저장소를 코어의 저장소에
  더한다(§7.1). 그 저장소의 루트 뒤의 출처(회사가 TLS 를 가로채는 망, 로컬 인증 기관을 쓰는 https 루프백 서버 등)를
  코어의 `fetch` 가 끝까지 받는지는 키체인을 바꿔야 잴 수 있어, 같은 소유자 실기에서 잰다(ADR-0012 위험 9, "아직
  확인 전").
- MCP 스위치와 상태 창의 실기(§13.4): "?" 팝오버로 바꾼 창, 메뉴의 켜고 끄기, 복사한 명령, 긴 설치 경로에서 #52 가
  고쳐졌는지. 게이트는 서버의 동작과 명령 글만 보고, 창의 배치는 보지 않는다.

닫힌 것: 2026-11-21 #29 실기는 내보낸 앱에서 삭제 확인 창의 내용·허용·거부·30초와 1초 무장, 상태 창의 권한
표시를 쟀다(§9). 같은 실기에서 상태 창이 중계 경로를 "…" 로 자른 결함은 bunny-holes/sherpa#52 다. 2026-11-22 Codex
실측은 Codex 가 띄운 중계의 기본 소켓 연결과, 기능과 env 를 켠 Codex 의 2026-07-28 연결을 쟀다. 같은 날 2026-07-28 만
받는 코어를 담은 내보낸 앱으로 Claude Code 의 2026-07-28 연결과 기본 설정 Codex 의 거부(서버 `failed`, 도구 호출 -32603,
다시 묻지 않음)를 쟀다(§10.1). `main` `8de36c6` 을 처음부터 빌드해 내보낸 앱으로 Claude Code 2.1.326 이 `claude -p`
에서 `server/discover`·`tools/list`·`tools/call` 을 모두 2026-07-28 봉투로 보내 `reminder_authorization_status` 를
불렀다(결과 `succeeded`). 이로써 내보낸 앱 경로의 Claude Code 도구 호출이 닫혔다(ADR-0011). 같은 날 `e0e2670` 을
내보낸 앱으로 첫 실행 창, 꺼진 동안의 거부(중계 75, Codex `failed`), 창의 스위치로 켠 뒤의 Codex 연결과 호출을
쟀다. 연결된 중계가 끌 때 75 `app_closed_session` 으로 끝나는 것과, 동적 서버로 머리말 단계 실패 뒤 Claude Code 가
다시 띄우는 모양과 다음 세션도 쟀다(§6, §13.4). 같은 날 `plug-hole` 로 설치한 플러그인 0.9.0 이
`/Applications/Sherpa.app` 에 두 에이전트의 실제 설정으로 붙었다. Claude Code 는 2026-07-28 로 이어 haiku 로 도구를
한 번 불렀다. Codex 는 `-c` 덮어쓰기 없이 기능 `mcp_2026_07_28` 만 켠 채 35개 도구로 이어 도구를 불렀다(§2
"플러그인의 MCP 등록"). 같은 날 시험 호스트와 새 이름의 서버로, 꺼진 앱(75)과 앱 없음(69) 뒤에 Claude Code 의 옛 규격
고정이 플러그인·사용자 범위 모두 그 시도로 끝나 7일 기억을 남기지 않는 것과, Codex 가 새 스레드에서 다시 붙는 것을
쟀다(§6). Claude Code 2.1.330 에서도 같았다. 같은 날 `cc82033` 을 처음부터 빌드한 Mux 2 번들을 `/Applications` 에 두고
두 에이전트의 연결과 읽기 호출, 켜진 채 끈 세 연결의 끝, 다시 켠 뒤의 재연결, 통합 로그의 `mux=2`·`kind=mcp` 를
쟀다(§13.4).

## Related

- [ADR-0010: 메뉴 막대 앱과 MCP](../adr/0010-menu-bar-app-and-mcp.md)
- [ADR-0011: MCP 는 2026-07-28 만 받는다](../adr/0011-mcp-2026-07-28-only.md)
- [ADR-0009: Developer ID 로 서명한 헬퍼 번들](../adr/0009-developer-id-signed-helper-bundle.md)
- [ADR-0008: Bun + TypeScript 코어](../adr/0008-bun-typescript-core.md)
- [Worker protocol](worker-protocol.md)
- [System architecture](../architecture/README.md)
- [Test strategy](../testing/README.md)
- [실측 기록](../testing/live-evidence.md)
