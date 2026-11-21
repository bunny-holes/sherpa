# sherpa HANDOFF — 2026-11-21 16:20 KST

## 목표

Sherpa 를 SwiftUI 메뉴 막대 앱(`Sherpa.app`, 권한 주체)으로 내고, 에이전트에는 앱 안의 TS MCP 서버를
Swift 중계로 연다(소유자 결정 2026-11-21, `docs/adr/0010-menu-bar-app-and-mcp.md`). 공개 앱으로 배포한다
(공증 + Homebrew cask). 지금 배포본은 CLI 0.8.5(Bun 코어 + `SherpaHelper.app`)다.

## 끝난 것 (커밋·태그·실측 근거)

- 1단계 시험 빌드 전부 끝(버리는 코드, ADR-0010 실측 표와 `live-evidence.md` 의 "Menu bar app and MCP spike"):
  기존 권한 이어짐, Calendar 는 calendars 권한 항목 필요·Reminders 는 불필요, Bun 은 hardened runtime 에 권한
  항목 없이 실행, 서명 확인 소켓 + 다중화 Bun 이 Claude Code·Codex 와 동작, 장시간 메모리 고정,
  앱에 전체 디스크 접근을 켜면 앱이 띄운 Bun 자식 읽기 성공, 앱 + Bun + 중계 번들 공증 Accepted(36초, 문제 0건)
  와 스테이플 뒤 Gatekeeper 통과. 기록 커밋 `228eee5`(PR bunny-holes/sherpa#24, 게이트 exit 0).
- 공증 자격 증명: 이 Mac 로그인 키체인에 `notarytool` 프로필 `sherpa-notary`(Apple ID 앱 전용 암호 방식).
  `xcrun notarytool history --keychain-profile sherpa-notary` 로 확인한다.
- 0.8.5(태그 `v0.8.5`): 초과 응답 경로의 명령 시험. 0.8.4(태그 `v0.8.4`): 변경 뒤 초과 응답을
  `partial`/`uncertain` + `protocol.result_too_large` 로 보고. 0.8.0~0.8.3: Bun 코어, Developer ID 헬퍼 번들.

## 진행 중

- 메뉴 막대 미리보기 앱(버리는 코드, `dev.xiyo.sherpa` 로 서명): 실제 Calendar·Reminders·전체 디스크 접근
  상태와 설정 열기 버튼을 메뉴와 창으로 보여 준다. 소스와 번들은
  `/private/tmp/claude-501/-Users-gimtaehui-IdeaProjects-xiyo-sherpa/74cc733f-0fa7-4384-bce6-dc81f6431ab2/scratchpad/preview/`
  (`main.swift`, `Sherpa.app`, `ent.plist`). 빌드: `swiftc -O -parse-as-library main.swift -o SherpaPreview` 후
  번들에 넣고 `codesign --force --options runtime --entitlements ent.plist -s <Developer ID>`.
- 소유자는 미리보기를 연 뒤 메뉴 막대 아이콘이 보이지 않았다고 했다. 앱은 상태 항목을 등록했고(로그의
  `com.apple.appkit.status-items` 장면), 창은 화면에 떴다(CGWindowList). 원인 후보는 노치 뒤로 밀림 또는
  시스템 설정 → 메뉴 막대의 앱별 허용 꺼짐이다(미확인). 소유자의 캡처를 기다리는 중이다.
- 시험 빌드 파일은 세션 임시 폴더(`…/scratchpad/spike`, `…/scratchpad/preview`, `…/scratchpad/mcp-mem`)에만
  있고 저장소에는 없다. 지워질 수 있으니 2단계는 ADR-0010 과 이 파일을 기준으로 다시 만든다.

## 하지 말 것 (실패한 시도, 되돌린 것)

- 코어 테스트를 `vp test` 로 돌리지 않는다. Node 에서 돌아 `bun:sqlite` 를 못 읽는다. `bun run test` 를 쓴다.
- KakaoTalk plist 를 `plutil -convert json` 으로 읽지 않는다. data/date 값 때문에 실패한다.
- Reminders·Calendar 를 AppleScript 나 SQLite 로 읽지 않는다. EventKit `reminder.list` 가 1초 안에 끝난다.
- 전체 디스크 접근은 요청 API 가 없다. 권한 창을 기다리지 말고 설정 화면
  (`x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles`)을 연다.
- zsh 에서 `log` 는 셸 내장 명령이다. 통합 로그는 `/usr/bin/log` 로 읽는다.
- 한 파일짜리 SwiftUI `@main` 은 `swiftc -parse-as-library` 가 필요하다. 여러 파일이면 최상위 코드는
  `main.swift` 에만 둔다.

## 막힌 것 · 오너 결정 대기

- 소유자 선택 대기: 2단계 실제 앱 구현을 바로 시작할지, 미리보기 화면을 먼저 다듬을지.
- 지금 배포본의 헬퍼는 권한 책임을 놓고 다시 떠서 같은 사용자의 다른 프로세스가 `dev.xiyo.sherpa` 권한을
  쓸 수 있다(추론, 재현 안 함). ADR-0010 구현이 이 경로를 없앤다.
- 화면 녹화: 소유자가 Claude Code(`com.anthropic.claude-code`)에 화면 녹화를 켰지만, Claude 데스크톱 앱 세션은
  재시작 전이라 반영되지 않았다(캡처가 검은 화면). 터미널에서 띄운 CLI 는 그 터미널 앱의 권한을 따른다.
- kakaocli 상류 이슈 등록(외부 게시)은 소유자 확인이 필요하다.
- 실기 소유자 조작: Mail 한 통 실제 보내기와 Automation 권한 프롬프트 확인, KakaoTalk 로컬 체크포인트 커밋,
  로그인된 Claude Code·Codex 세션에서 스킬 호출, `SR-CX-013` 재검증, Discord 이모지·스티커 명령.
- 미확인: Swift 헬퍼 응답은 null 인 키(`result`·`error`)를 빼고, ObjC 셈(Mail·ReminderKit)은 `null` 로
  쓴다. `worker-protocol.md` 의 "exact-key" 가 응답에도 걸리는지 계약이 정하지 않았다.

## 다음 행동

1. 미리보기에서 메뉴 막대 아이콘이 보이는지 소유자 확인을 받고, 안 보이면 원인을 정해 2단계 앱의 첫 실행
   동작(창을 띄울지)에 반영한다.
2. ADR-0010 2단계 구현: `apple/` 에 SwiftUI 앱 타깃(권한 상태·요청, 소켓 서버, 감사 토큰 서명 확인, Bun 다중화),
   Swift 중계 타깃, `core/` 에 MCP 서버(TS SDK v2 `@modelcontextprotocol/server`, 도구는 capabilities 에서 만들고
   읽기·쓰기 annotation, 삭제·보내기는 매 호출 확인). 층별 시험(단위 → MCP stdio 명령 → 앱·소켓 → 실기)과 게이트.
3. 3단계: `scripts/package.sh` 에 공증(`notarytool submit --keychain-profile sherpa-notary --wait`, 스테이플)
   추가, Homebrew cask(`binary` 로 `sherpa` 링크), formula 이전, 플러그인에 MCP 등록과 스킬 축소, 설치본 실기 검증.
4. plist 파서 중복 정리: `core/src/imessage/bplist.ts` 와 `core/src/kakaotalk/plist.ts`.
5. 문서 부채: `docs/testing/verification-matrix.md` 재검토, 21개 문서의 옛 front matter 키,
   `docs/contracts/worker-protocol.md:98` 가 가리키는 없는 `protocols/worker-v2.schema.json`.
6. 웹 수집 소스(patchright 등)는 코어의 새 어댑터로 붙인다(ADR-0008). 착수 전 대상 소스를 정한다.

## 저장소·세션 상태 (브랜치, 미커밋, 미푸시, pane)

- `main` 은 `f897535`(PR #24 병합) 이후다. 원격은 `bunny-holes/sherpa`(`XIYO/sherpa` 가 같은 저장소로
  리다이렉트), Formula 는 `XIYO/homebrew-tap`. 병합된 로컬 브랜치 여럿이 남아 있다.
- 실행 중인 시험 프로세스: 미리보기 앱 `SherpaPreview`, 1단계 호스트 `SherpaSpike host`(소켓
  `/private/tmp/claude-501/sherpa-spike.sock`). 더 쓰지 않으면 `pkill -x SherpaPreview`,
  `pkill -f "SherpaSpike host"` 로 끈다.
- 개발 실행: `cd core && bun run build`, `swift build --package-path apple/eventkit-service`, 그리고
  `SHERPA_APPLE_BIN=apple/eventkit-service/.build/debug/sherpa-apple core/dist/sherpa …`.
