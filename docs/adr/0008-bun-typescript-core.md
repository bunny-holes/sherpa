---
uuid: 01a1f734-120a-76d9-a653-32a0bc25edc3
type: adr
audience: "Sherpa CLI 의 언어·실행 경계·배포 구성을 바꾸거나 다시 보는 사람"
goal: "CLI 코어가 왜 Bun + TypeScript 이고 Swift 는 왜 Apple 헬퍼로만 남는지, 무엇을 측정해 정했는지 확인하게 한다"
tone: "평어체. 소유자 결정, 실측, 추론을 가른다"
manner: "결정 본문은 고치지 않고 바뀐 사실은 정정으로 덧붙인다"
---

# CLI 코어는 Bun + TypeScript, Swift 는 Apple 헬퍼다

> **정정 (2026-11-20, CLI 0.8.1).** 헬퍼에 Info.plist 를 박는 것만으로는 권한을 받지 못했다. macOS 는
> 셸을 띄운 앱(책임 프로세스)의 이름으로 권한을 묻기 때문에, Calendar 사용 설명이 없는 Claude 데스크톱에서
> 부르면 권한 창 없이 `not_determined` 로 남았다. 헬퍼는 이제 책임을 놓고 자신을 한 번 다시 띄워
> `dev.xiyo.sherpa` 로 권한을 받는다(`live-evidence.md` 같은 날짜 항목). 결정은 그대로다.
>
> **정정 (2026-11-20, CLI 0.8.2).** 헬퍼는 `libexec/sherpa-apple` 이 아니라 Developer ID 로 서명한
> `libexec/SherpaHelper.app` 번들이고, 코어는 그 안의 `Contents/MacOS/sherpa-apple` 을 찾는다(ADR-0009).
>
> **정정 (2026-11-22, 단일 실행 파일이 읽는 설정, bunny-holes/sherpa#92).** `bun build --compile` 의 실행
> 파일은 빌드가 끄지 않으면 실행한 폴더의 `.env` 파일과 `bunfig.toml` 을 읽어 코어에 적용한다. Bun 코어를 낸 CLI
> 0.8.0~0.8.5 가 그렇게 빌드됐고 0.8.5 에서 재현했다(`live-evidence.md` 같은 날짜 항목). `bun run build` 는 이제
> 그것과 `tsconfig.json`·`package.json` 의 자동 읽기를 모두 끈다(app-connection-v1 §7.1). 결정은 그대로다.

## 맥락

0.7.1 의 `sherpa` 는 Swift 실행 파일 하나였다. 소유자가 2026-11-20 실제 조사(Reminders·Mail·iMessage·
KakaoTalk 을 읽어 정산 근거를 모으는 일)에 쓰다가 여러 곳에서 막혀 `kakaocli`·`imsg`·`sqlite3`·
AppleScript 를 직접 부르며 우회했다. 같은 날 측정한 결함:

| 결함 | 실측 | 원인 |
| --- | --- | --- |
| `sherpa context sync` → `invalidRequest` | 0.7.1 도움말에 `context` 가 없다 | `docs/testing/live-validation.md` 가 Rust 시절 명령을 그대로 안내했고, `context` 스킬은 Mail·iMessage 명령을 하나도 적지 않았다 |
| `mail list` 가 1000건에서 멈춤 | `--limit 50000` 은 27,964건을 돌려준다 | 상한이 아니라 다음 페이지 신호가 없었다. 잘렸는지 알 수 없으니 호출자가 기간을 쪼갰다 |
| KakaoTalk "file is not a database" | KakaoTalk Mac 26.10.0 | `kakaocli` 0.6.0 의 사용자 ID 자동 탐지가 실패하고 키 없이 암호화 DB 를 연다. sherpa 는 ID·키를 넘길 길이 없었다 |
| `kakaocli status` 가 앱을 활성화 | — | sherpa 는 `status` 를 부르지 않지만 사용자가 진단으로 불렀다. 소유자는 화면 제어 없는 DB 읽기만 원한다 |
| `imessage` → `executableUnavailable` | `imsg` 미설치 | 외부 CLI 의존을 Formula 가 선언하지 않았고 오류에 설치 안내가 없었다 |
| Reminders 조회 120초 타임아웃 | AppleScript `whose` | sherpa 경로가 아니다. sherpa 의 EventKit `reminder.list` 는 663건 0.43초. 플래너 스킬이 요청 JSON 모양을 적지 않아 첫 호출이 `protocol.invalid_payload` 로 끝나기 쉬웠다 |

## 결정

1. **CLI 코어를 Bun + TypeScript 로 바꾼다** (소유자 결정, 2026-11-20). 코어가 명령 해석, 검증, 기록부,
   출력, 그리고 여러 도구를 묶는 일을 맡는다. 웹에서 근거를 모아야 하는 소스는 patchright 같은
   브라우저 자동화를 같은 코어에서 어댑터로 붙인다(소유자 발언: "코어가 bun ts 가 되고 여러 개를 다
   하려고 한다"). 툴체인은 Vite+ 다: `vp check`·`vp fmt`·`vp lint`, 테스트는 Vite+ 의 vitest 를 Bun
   런타임으로 돌린다(`bun --bun vitest run`). 배포물은 `bun build --compile` 단일 실행 파일이다.
2. **Swift 는 `sherpa-apple` 헬퍼로만 남는다.** EventKit Calendar·Reminders, 격리된 private
   ReminderKit, Mail shim 처럼 Apple 프레임워크와 Info.plist 가 박힌 네이티브 실행 파일이 필요한
   일만 맡는다. 코어는 `planner request`·`mail request`·`reminder-kit request` 를 표준 입출력 그대로
   헬퍼에 넘기고, 헬퍼는 지금처럼 Worker Protocol V2 를 검증하고 planner 변경을 기록한다.
3. **iMessage 와 KakaoTalk 은 로컬 DB 를 직접 읽는다** (소유자 결정, 2026-11-20 "둘 다 직접 읽기").
   iMessage 는 `~/Library/Messages/chat.db` 를 `bun:sqlite` 읽기 전용으로, KakaoTalk 은 키를 코어에서
   유도해 SQLCipher(`brew install sqlcipher` 의 라이브러리를 `Database.setCustomSQLite` 로 적재)로
   연다. `imsg`·`kakaocli` 는 더 이상 부르지 않으며 KakaoTalk 앱을 띄우거나 조작하지 않는다.
   KakaoTalk 사용자 번호는 `sherpa kakaotalk setup` 이 한 번 찾아 로그인 키체인에 둔다.
4. **명령과 JSON 은 0.7.1 과 호환한다** (소유자 결정, 2026-11-20). 기존 명령·플래그·출력 키를
   유지하고 더하기만 한다: `mail list --cursor` 와 `limit_reached`·`next_cursor`, `kakaotalk setup`·
   `kakaotalk status`, 오류 보고의 `remedy`. 그래서 MAJOR 를 올리지 않고 0.8.0 으로 낸다.

## 검토한 대안

- **순수 TypeScript + AppleScript 쓰기.** Swift 를 없애지만 같은 날 AppleScript Reminders 조회가 120초에
  타임아웃됐고, 쓰기 뒤 EventKit 수준의 되읽기 검증을 잃는다.
- **bun:ffi 로 Objective-C 런타임 호출.** 단일 바이너리지만 `bun build --compile` 산출물에 Info.plist 를
  박을 길이 없어 Calendar·Reminders 권한 요청이 실패할 위험이 크다(추론, 실측 안 함).
- **외부 CLI 유지.** `imsg`·`kakaocli` 를 Formula 의존성으로 선언하는 길. KakaoTalk 결함이 상류에 남고,
  `kakaocli` 는 앱 자동화 기능까지 함께 들여온다.

## 결과

- 배포 아카이브는 `bin/sherpa`(Bun)와 `libexec/sherpa-apple`(Swift) 둘을 담는다. Formula 는
  `sqlcipher` 에 의존한다. 코어는 자기 실제 경로의 `../libexec/sherpa-apple` 을 찾는다
  (`SHERPA_APPLE_BIN` 으로 바꿀 수 있다).
- 기록부 파일과 스키마(`~/Library/Application Support/Sherpa/native.sqlite3`)는 그대로다. 코어는
  iMessage·Mail 보내기를, 헬퍼는 planner 변경을 같은 표에 쓴다. KakaoTalk 로컬 체크포인트 저장소도
  그대로라 0.7 의 체크포인트가 이어진다.
- 게이트는 Swift 패키지 셋, 코어의 `vp check` 와 테스트, 플러그인·문서 검사, 릴리스 스모크를 돈다.
- `kakaocli` 자동 탐지 결함은 상류 결함이라 이 저장소가 고치지 않는다. 증거는 소유자에게 따로
  보고한다.
