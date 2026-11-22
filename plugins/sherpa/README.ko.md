---
uuid: 01a0f252-d266-7311-bd25-486f59b094a3
type: guide
audience: "Claude Code나 Codex에서 Sherpa 플러그인을 설치하려는 Mac 사용자"
goal: "Sherpa.app과 플러그인 진입점 하나를 설치하고 에이전트를 앱의 MCP 서버에 연결해 첫 요청을 실행하며 어떤 데이터가 로컬에 남는지 알게 한다"
tone: "사용자에게 쓰는 합니다체. 단계 앞에 요구 조건을 먼저 밝힌다"
manner: "결과 → 설치 → 선행 조건 → 첫 사용 → 검증 → 문제 해결 → 데이터 경계 → 제한 순서를 지킨다"
---

# Sherpa

[English](README.md)

Sherpa는 플래닝 의도를 내 Mac 안에서 처리하는, 범위가 정해지고 증거를 확인하는
작업으로 바꿉니다. 스킬은 Sherpa.app의 MCP 서버를 부르고, 이 서버가 Calendar,
Reminders, Mail, iMessage, 로컬 KakaoTalk 데이터베이스를 읽고, 변경을 제안하고,
정확한 내용을 확인받은 다음에만 실행합니다. 명시적으로 보내는 것 말고는 이
컴퓨터를 벗어나지 않습니다.

## 설치

플러그인은 스킬을 담고 MCP 서버 `sherpa` 하나를 등록합니다. 서버 명령은
`/Applications/Sherpa.app/Contents/MacOS/sherpa-relay`입니다. Sherpa.app을 먼저
설치하세요.

1. `Sherpa.app`을 `/Applications`에 둡니다. 플러그인은 다른 곳을 찾지 않습니다.
   공증된 Homebrew cask는 아직 나오지 않았습니다. 그때까지는 이 저장소에서 앱을
   빌드해 내보낸 뒤(`docs/contracts/app-connection-v1.md` §2 "번들 빌드") 그곳으로
   옮깁니다.
2. Sherpa.app을 열고 메뉴 막대 메뉴의 **MCP Server**를 켭니다. **Show Sherpa
   Status…**가 여는 창 맨 위의 스위치로도 켤 수 있습니다. 첫 실행에는 꺼져 있고,
   꺼져 있는 동안 앱은 모든 에이전트를 돌려보냅니다.

그다음 플러그인을 추가합니다. GitHub 계정에 비공개 `XIYO/plug-hole` 저장소의 접근
권한이 필요합니다.

```bash
claude plugin marketplace add https://github.com/XIYO/plug-hole.git
claude plugin install sherpa@plug-hole
```

```bash
codex plugin marketplace add https://github.com/XIYO/plug-hole.git
codex plugin add sherpa@plug-hole
codex features enable mcp_2026_07_28
```

Sherpa.app은 MCP 2026-07-28 판만 씁니다. Claude Code는 기본으로 이 판을
협상합니다. Codex는 기능 `mcp_2026_07_28`이 켜져 있어야 이 판으로 엽니다. Codex가
함께 요구하는 환경 값(`CODEX_MCP_PROTOCOL_VERSION=2026-07-28`)은 플러그인의 서버
항목에 이미 들어 있습니다. 기능을 켜면 Codex는 세션 시작 때 개발 중인 기능이
켜져 있다고 경고합니다.

`plug-hole`은 이 저장소의 `plugins/sherpa/`에서 플러그인을 받습니다. 새 세션이
스킬을 불러오고 서버를 띄웁니다. 열린 세션은 이미 실은 판을 계속 씁니다. 플러그인을
설치했다면 Sherpa 상태 창이 보여 주는 `claude mcp add`나 `codex mcp add` 명령은
필요 없습니다. 그 명령은 플러그인 없이 같은 중계를 등록합니다.

## 선행 조건

- macOS 14 이상, Apple silicon
- `/Applications`에 있고 MCP Server 스위치가 켜진 Sherpa.app
- Sherpa.app의 Calendar와 Reminders 권한 — 메뉴 막대 메뉴에서 요청합니다
- Mail, iMessage, 로컬 KakaoTalk 읽기를 위한 Sherpa.app의 전체 디스크 접근 권한
- 로컬 KakaoTalk을 처음 읽기 전에, Homebrew의 `sqlcipher`와 전체 디스크 접근 권한이
  있는 터미널에서 한 번 실행한 `sherpa kakaotalk setup`

## 첫 사용

평소 말로 요청하면 `sherpa` 스킬이 알맞은 곳으로 보냅니다.

```text
오늘 일정과 할 일을 정리해줘.
새 메시지에서 일정 후보를 찾아줘.
```

스킬 다섯 개가 일을 나눠 맡습니다.

| 스킬 | 담당 |
|---|---|
| `sherpa` | 진입점. 의도를 라우팅하고 도구 결과로 증거 루프를 돌립니다. |
| `planner` | 검증된 제안과 readback을 거치는 Calendar와 Reminders. |
| `context` | 범위가 정해진 Mail·iMessage·KakaoTalk 읽기, 약속과 후보 추출. |
| `kakaotalk-local-search` | 로컬 KakaoTalk 텍스트 — 키워드 검색, 한 방 히스토리, 날짜 아카이브. |
| `agent-messenger` | 상류 CLI로 처리하는 서버 기반 KakaoTalk·Discord·iMessage·Instagram. |

에이전트는 도구를 Claude Code에서 `mcp__plugin_sherpa_sherpa__<도구>`, Codex에서
`mcp__sherpa__<도구>`로 봅니다(예: `event_list`). 삭제와 발송은 Sherpa.app이 정확한
대상을 보여 주고 허용을 묻는 동안 30초까지 기다립니다.

## 검증

Claude Code에서 `/mcp`를 실행합니다. `plugin:sherpa:sherpa`가 연결되어 있어야
합니다. Codex에서는 `codex mcp list`에 `sherpa`가 활성으로 보여야 합니다. 플러그인
자체는 `claude plugin list`와 `codex plugin list --marketplace plug-hole`로
확인합니다.

## 문제 해결

| 보이는 것 | 원인과 해결 |
|---|---|
| Claude Code: `plugin:sherpa:sherpa` 실패, MCP 로그 끝에 `ENOENT`와 `posix_spawn`. Codex: `MCP startup failed: No such file or directory (os error 2)`. | Sherpa.app이 `/Applications/Sherpa.app`에 없습니다. 그곳으로 옮깁니다. 플러그인은 다른 곳을 찾지 않습니다. |
| 서버가 실패했고 MCP 로그에 `app_not_running`이나 `mcp_disabled`가 있습니다. | Sherpa.app을 열고 MCP Server를 켠 뒤 다시 연결합니다. |
| 세션 도중 도구가 멈췄고 MCP 로그에 `app_closed_session`이 있습니다. | MCP Server가 꺼졌거나 앱이 끝났습니다. 다시 켠 뒤 `/mcp`에서 서버를 다시 연결하거나 Codex 세션을 새로 엽니다. |
| 실패 직후 Claude Code에 Sherpa 도구가 없습니다. | Claude Code는 최근 15분 안에 실패한 플러그인 서버를 건너뜁니다. `/mcp`에서 `plugin:sherpa:sherpa`의 Reconnect를 고르거나 기다립니다. |
| Codex: `-32022: Unsupported protocol version: 2025-06-18`. | 기능이 꺼져 있습니다. `codex features enable mcp_2026_07_28`을 실행하고 새 세션을 엽니다. |
| Codex가 플러그인과 다른 명령을 씁니다. | 내 `config.toml`의 `[mcp_servers.sherpa]`가 같은 이름의 플러그인 서버보다 앞섭니다. 지우거나, 같은 명령과 환경 값으로 둡니다. |
| Claude Code에서 도구가 `mcp__sherpa__<도구>`로 보입니다. | 같은 명령으로 `claude mcp add`를 직접 실행해 중계를 등록했습니다. Claude Code는 플러그인 대신 그 항목 하나만 연결합니다. 스킬은 두 이름을 모두 받습니다. |
| `kakaotalk.setup_required`나 `kakaotalk.user_id_not_found`. | 전체 디스크 접근 권한이 있는 터미널에서 `sherpa kakaotalk setup`을 한 번 실행합니다. MCP 도구가 아닙니다. |
| `eventkit.access_unavailable`이나 전체 디스크 접근 안내. | 터미널이나 에이전트 앱이 아니라 Sherpa.app에 권한을 줍니다. 메뉴 막대 메뉴에서 요청합니다. |

## 데이터 경계

읽기는 명시한 개수와 체크포인트로 범위가 정해지고, 모든 결과는 자기 커버리지를
함께 보고합니다. 로컬 KakaoTalk 읽기는 동기화된 텍스트만 다룹니다 — 첨부는
읽지 못하고, 서버에 더 없다는 증거도 되지 못합니다. 이 체크포인트는 Agent
Messenger 체크포인트와 분리되어 있고 분석을 마친 뒤에만 커밋됩니다.

보내는 메시지와 메일은 먼저 초안을 만들고, 정확한 수신자와 내용을 승인받은 다음
Sherpa.app 창에서 한 번 더 허용받아야 발송합니다. Calendar와 Reminders 변경도 같은
확인 경계를 지납니다. Sherpa는 불투명 참조만 돌려주며 제공자의 네이티브 식별자는
넘기지 않습니다.

## 제한 사항

- macOS 전용입니다. Windows와 Linux는 지원하지 않으며 검사하지도 않습니다.
- 플러그인은 `/Applications/Sherpa.app`의 Sherpa.app에만 닿습니다.
- `sherpa`는 어떤 서비스의 완전한 아카이브도 아닙니다.
- 플러그인은 Sherpa.app을 설치하거나 올리지 않습니다. 둘을 함께 올리세요. 앱이
  제공하지 않는 도구를 스킬이 부르면 그 스킬은 멈추고 알립니다.

## 개발

플러그인은 `plugins/sherpa/`에, 앱과 중계는 `apple/sherpa-app/`에, 도구를 제공하는
코어는 `core/`에 있습니다. 모두 이 저장소에서 배포합니다.

```bash
bash scripts/check-all.sh
```
