---
uuid: 01a200fd-7154-7206-a55c-9ebab5d2b7fb
type: adr
audience: "앱 안 채팅(AI 연결하기)을 만들거나, 코어의 네트워크·키·확인 경계를 바꾸는 사람"
goal: "채팅이 어느 프로세스에서 어떤 채널로 돌고, 키·네트워크·확인·개인정보·대화 기록을 어떻게 지키는지, 무엇이 소유자 결정 대기이고 무엇이 아직 확인 전인지 알게 한다"
tone: "평어체. 소유자 결정, 실측, 문서, 설계, 추론을 가른다"
manner: "결정 본문은 고치지 않고 바뀐 사실은 정정으로 덧붙인다"
---

# 앱 안 채팅은 코어의 새 경계에서 AI SDK 로 돌고, 코어가 여는 연결은 고른 제공자의 HTTPS 뿐이다

> **정정 (2026-11-22, 남은 결정 1).** 소유자가 OpenAI 호환도 https 만 받기로 했다(bunny-holes/sherpa#59). 권고와
> 같다. 루프백의 평문 http 서버(`http://localhost`, `http://127.0.0.1` 등)는 받지 않는다. "OpenAI 호환의 base
> URL" 의 https 규칙이 그대로 규칙이다.
>
> **정정 (2026-11-22, 남은 결정 2).** 소유자가 대화 기록을 디스크에 저장하기로 했다(bunny-holes/sherpa#59).
> 권고(저장하지 않음)와 반대다. 설계는 새 절 "대화 기록" 이다. 앱이 대화마다 파일 하나를 이 Mac 에만 두고, data
> protection keychain 의 키로 AES-GCM 암호화하며, Time Machine 백업에서 뺀다. 사람이 지우거나, 마지막 차례 뒤
> 사람이 고른 보관 기한(기본 30일, 길어야 90일)이 지나면 지운다. 코어는 대화를 디스크에 쓰지 않는다. 본문에서
> 대화가 코어 메모리에만 있다고 적은 곳(채널, 스트리밍, 코어가 다시 뜰 때, 개인정보)에는 정정 표시를 달았고,
> 실측, 위험(10~14), 되돌리기(4), 소유자가 할 일(4), 구현 단계, 아직 확인 전, 검토한 대안에는 저장이 더하는 것을
> 덧붙였다. [아키텍처](../architecture/README.md) 의 "long-lived content archive" 금지 규칙에는 이 기록을 예외로
> 적었다.
>
> **정정 (2026-11-22, #64).** 구현 단계 2, 코어 나가는 길(bunny-holes/sherpa#64)이 PR #74 로 들어갔고, 그 작업이
> 잰 사실을 실었다. Bun 1.4.5 의 `redirect: "error"` 도 1.4.4 처럼 리디렉트를 거부했다. 전역 `fetch` 를 바꿔도
> `Bun.fetch` 와 `Worker` 의 `fetch` 는 막히지 않고 네트워크 모듈 여럿이 설치 없이 풀리므로, 구현의 정적 검사는
> "코드로 지키기" 3 의 목록보다 넓다. 차례 메시지가 아직 없어, 빌드한 코어의 소켓 시험은 차례 대신 MCP 연결 중에
> 본다. 고친 곳은 상태 줄, "맥락", "코드로 지키기" 2·3, "시험으로 지키기", "실측", "구현 단계" 4,
> "아직 확인 전" 이다.

상태: 채택(소유자 결정, 2026-11-22, bunny-holes/sherpa#59). 구현 단계 2(코어 나가는 길 경계와 정적 검사, #64)는
PR #74 로 들어갔고 나머지 단계는 구현 전이다(정정 2026-11-22, #64: 처음에는 "구현 전이다" 로 적었다). 이 결정은
[ADR-0010](0010-menu-bar-app-and-mcp.md) 결정 2 의 "Bun 은 소켓을 열지 않고 앱과의 표준 입출력 파이프만 읽는다"
를 고친다. 앱이 코어 하나를 띄우는 구조, 중계, MCP 는 2026-07-28 만 받는
것([ADR-0011](0011-mcp-2026-07-28-only.md)), 삭제·보내기의 앱 창 확인([앱 연결
계약](../contracts/app-connection-v1.md) §9)은 그대로다. 남은 결정 둘(로컬 서버, 대화 기록)은 같은 날
소유자가 정했다(정정 2026-11-22: 처음에는 소유자 결정 대기로 적었다).

근거 표시는 계약의 "근거 표기" 를 따른다. 더하는 것은 둘이다. **[설계]** 는 이 ADR 이 고른 것으로, 구현할 때
계약의 다음 판으로 옮겨 [계약] 이 된다. **[코드]** 는 `main` 075aa28 의 저장소 코드에서 읽은 것이다. 이 ADR 의
[실측] 은 2026-11-21~22 에 저장소 밖 버리는 시험에서 잰 것이고("실측" 절), 유료 API 는 부르지 않았다.
[실측: #64] 는 코어 나가는 길(#64)이 Bun 1.4.4 와 1.4.5 에서 잰 것이고, 기록은
[실측 기록](../testing/live-evidence.md) 의 2026-11-22 #64 항목이다(정정 2026-11-22, #64).

## 맥락

- 지금 Sherpa 를 쓰는 길은 에이전트(Claude Code, Codex)가 `sherpa-relay` 를 거쳐 MCP 로 붙는 것 하나다.
  에이전트가 없는 사람은 앱만으로 일정·미리알림·메시지를 다룰 수 없다.
- 코어는 소켓을 열지 않는다. 계약 §7.1 은 "코어는 소켓을 열지 않고 이 파이프만 읽는다" 를 ADR-0010 결정 2 에
  기대 적었다. 코어 소스에는 `fetch`, `WebSocket`, `Bun.connect`·`listen`·`serve`, `node:net` 류가 없다. [코드:
  `core/src` 검색] (정정 2026-11-22, #64: 단계 2 뒤로는 `core/src/chat/egress.ts` 의 지킨 `fetch` 가 런타임의
  `fetch` 를 쥐지만 부르는 곳이 아직 없어, 코어에는 `fetch` 에 닿는 길이 없다. 나머지는 지금도 없다.
  [코드: `main` 3fda0e2 의 `core/src` 검색]) 채팅은 모델 제공자로 나가는 연결이 있어야 하므로 그 결정과
  부딪친다.
- 코어에는 이미 35개 도구의 레지스트리와 삭제·보내기 확인이 있다. 도구마다 `handle(args, { signal, client })` 가
  있고, 확인이 필요한 6개 도구는 핸들러 안에서 계약 §9 의 앱 창 확인을 낸다. [코드: `core/src/mcp/tools.ts`,
  `core/src/mcp/confirmation.ts`]
- 2026-11-22 npm 의 최신 판은 `ai` 7.0.179, `@ai-sdk/anthropic` 4.0.107, `@ai-sdk/openai` 4.0.122,
  `@ai-sdk/google` 4.0.124, `@ai-sdk/openai-compatible` 3.0.94, `@ai-sdk/provider-utils` 5.0.83, `@ai-sdk/mcp`
  2.0.102 다. [문서: registry.npmjs.org 의 각 패키지 `latest`] 아래의 AI SDK 사실은 이 판들의 패키지 안 문서와
  소스, 그리고 [AI SDK 7 이행 안내](https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0) 에서 읽었다.

## 결정

1. 채팅은 코어(Bun TypeScript)의 새 경계에서 돈다. 모델 호출은 Vercel AI SDK v7(`ai` 7.x 와 `@ai-sdk/*`)로 한다.
   [소유자]
2. 제공자는 Anthropic, OpenAI, Google, OpenAI 호환 넷이다. [소유자]
3. ADR-0010 결정 2 를 고친다. 허용하는 것은 사람이 고른 제공자로 나가는 HTTPS 뿐이다. 다른 나가는 연결과 듣는
   소켓은 여전히 금지한다. [소유자]
4. API 키는 data protection keychain 에 둔다. 소유자가 App ID `dev.xiyo.sherpa` 의 Developer ID provisioning
   profile 을 만든다("소유자가 할 일"). [소유자]
5. 채팅은 MCP 와 같은 35개 도구(코어 레지스트리)를 쓴다. 삭제와 보내기는 MCP 경로와 같은 앱 확인 창을 거친다.
   [소유자]
6. 앱 첫 화면은 "AI 연결하기" 와 "MCP 활성화하기" 를 나란히 둔다(Figma 같은 느낌). 설명으로 화면을 덮지 않고,
   방법 안내는 "?" 같은 보조 표시 뒤에 둔다. [소유자, 앞선 결정과 계약 §2]
7. 레거시를 철저히 뺀다는 원칙(ADR-0011)을 채팅에도 쓴다. 폐기 예정 API, 옛 SDK 경로, 제공자가 옛것으로 부르는
   면은 쓰지 않는다. [소유자]

아래 절은 이 결정에서 끌어낸 설계다.

## 경계

### 채팅 루프가 도는 곳

- 루프는 앱이 띄운 코어 프로세스 하나(`sherpa-core app serve`) 안의 새 모듈 `core/src/chat/` 에서 돈다.
  `app/serve.ts` 가 MCP 와 나란히 묶는다. `ai` 와 `@ai-sdk/*` 를 가져오는 모듈은 `chat/` 하나다. [설계]
- 두 번째 코어 프로세스는 띄우지 않는다. 결정 1 의 "코어의 새 경계" 와 맞고, 감독(계약 §7.8)이 하나로 남고, 대기
  메모리를 한 벌 더 쓰지 않는다("메모리와 크기"). 실패 영역을 MCP 와 나누는 값은 "위험" 1 과 "되돌리기" 에
  적는다. [설계]
- 코어 실행 파일은 `sherpa` 명령과 같은 파일이지만(계약 §2) `sherpa` 명령에는 채팅 하위 명령을 두지 않는다.
  명령은 시험·디버깅·게이트의 바깥 어댑터이고(ADR-0010 결정 5), 키를 받을 길이 없다. [설계]
- 앱은 화면, 키, 동의, 제공자·모델 고르기를 맡는다. 앱은 제공자를 직접 부르지 않는다. [설계]

### 앱과 코어 사이 채널

지금의 Mux 1 은 채널 0 이 제어(`hello`, 작업 요청 `request`/`response`, 확인
`confirm`/`confirmation`/`withdraw`)이고, 1 이상은 중계 연결 하나에 MCP 연결 하나다. `open` 에는 본문이 없고,
표에 없는 조합은 프로토콜 위반이다. [계약 §7.3] 채팅은 이렇게 더한다. [설계]

- 채팅 하나에 채널 하나. 앱이 중계 채널과 같은 번호 계수기에서 연다. 1판의 앱은 한 번에 채팅 하나를 열고, 새
  채팅을 열면 앞 채널을 닫는다.
- `open` 이 채널 종류를 싣는다: `N\topen\t{"kind":"mcp"}` 또는 `{"kind":"chat"}`. 본문 없는 `open` 을 받던
  코어에는 맞지 않는 변경이므로 인사의 `mux` 를 2 로 올리고 1 은 받지 않는다. 앱과 코어는 한 번들로 나가고
  인사에서 버전이 같아야 하므로(계약 §7.5) 두 판을 함께 받을 까닭이 없다.
- 채팅 채널의 `data` 하나에 `sherpa.chat.v1` JSON 메시지 하나를 싣는다.

| 방향 | 메시지 | 싣는 것 |
| --- | --- | --- |
| 앱 → 코어 | `turn` | `provider`, `model`, `base_url`(OpenAI 호환만), `api_key`, `text` |
| 앱 → 코어 | `cancel` | 없음. 도는 차례를 멈춘다 |
| 앱 → 코어 | `list_models` | `provider`, `base_url`, `api_key` |
| 앱 → 코어 | `resume` | 앱이 저장한 대화 상태(`sherpa.chat.state.v1`). 이어 쓰는 채팅 채널의 첫 메시지다("대화 기록", 정정 2026-11-22) |
| 코어 → 앱 | `delta` | 모델 답의 글 조각(몇 십 ms 나 몇 KiB 씩 묶는다) |
| 코어 → 앱 | `tool` | `call_id`, 도구 이름, `status`(`started`·`succeeded`·`failed`·`declined`·`withdrawn`), 오류 코드, `operation_id`. 인자와 결과는 싣지 않는다 |
| 코어 → 앱 | `done` | 끝난 까닭(`stop`·`length`·`content-filter`·`step-limit`·`aborted` 등), 토큰 수 |
| 코어 → 앱 | `error` | 코드(`provider_auth`·`provider_rate_limited`·`provider_unavailable`·`egress_denied`·`network` 등), `retryable` |
| 코어 → 앱 | `models` | 모델 id 목록 |
| 코어 → 앱 | `state` | 대화 상태 전체(`sherpa.chat.state.v1`). 상태가 바뀔 때마다 보내고 앞의 것을 바꾼다("대화 기록", 정정 2026-11-22) |

- 대화(모델 메시지 목록)는 채팅 동안 그 채널의 코어 메모리에 있고, 코어는 바뀔 때마다 그 사본을 `state` 로 앱에
  넘긴다(정정 2026-11-22: 처음에는 "코어 메모리에만 있다" 로 적었다. "대화 기록" 을 보라). 앱은 차례마다 새 글만
  보낸다. 제공자, 출처, 모델은 채팅의 첫 차례에 정해지고, 바꾸면 새 채팅이다. Anthropic 의 thinking 서명처럼
  제공자가 다음 요청에서 되돌려 받는 값이 대화에 들어 있기 때문이다([실측] 2단계 요청이 서명을 되돌려 보냈다).
- 확인은 채널 0 에 그대로 둔다. 채팅 요청 종류를 채널 0 에 더하는 방식은 뺐다. 채널 0 은 코어 전체의 제어이고,
  채팅마다 닫기와 흐름 제어를 하려면 채널이 맞는 단위다.
- 흐름 제어는 계약 §7.7 을 채팅 채널에도 쓴다. 앱이 채팅 화면으로 넘기는 대기열이 16 MiB 를 넘으면 그 채널만
  `close` `{"reason":"slow_consumer"}` 로 끝낸다.
- MCP 스위치(계약 §2, §7.6)는 중계 채널만 닫고, 로그의 `sessions_closed` 도 중계 채널만 센다. 채팅은 "AI
  연결하기" 쪽이 따로 켜고 끈다. 지금의 §7.6 과 §9 는 "열린 채널마다"·"모든 채널" 을 닫는다고 적었으므로 구현 때
  고친다.

### 스트리밍

- 코어는 `streamText(...)` 결과의 `stream` 을 읽어 part 를 위 메시지로 옮긴다. v7 에서 `fullStream` 은 폐기 예정
  별칭이라 쓰지 않는다. [문서: AI SDK 7 이행 안내, `ai` 7.0.179 `src/generate-text/stream-text-result.ts` 의
  `@deprecated`] [설계]
- 글 part 는 `delta`, 도구 part(`tool-call`·`tool-result`·`tool-error`)는 `tool`, `finish` 는 `done`,
  `error`·`abort` 는 `error` 나 `done`(`aborted`)이 된다. reasoning part 는 앱에 넘기지 않고 대화 안에만 둔다.
  대화 안의 reasoning 은 `state` 에 실려 앱의 암호화한 기록에 들어가지만, 앱은 `state` 를 해석하지 않으므로
  화면에 나오지 않는다(정정 2026-11-22). [설계]
- 모의 Anthropic 서버로 잰 도구 왕복의 part 순서는 `start`, `start-step`, `custom`, `reasoning-*`,
  `tool-input-*`, `tool-call`, `tool-result`, `finish-step`, `text-start`·`text-delta`·`text-end`, `finish`
  였다. [실측]
- 앱은 모델 답을 그릴 때 원격 자원(이미지 등)을 불러오지 않고, 링크는 사람이 누를 때만 연다. 도구 결과에 심은
  지시가 모델에게 내용을 담은 이미지 주소를 쓰게 해 내보내는 길을 막는다. [설계; 추론]

### 중단

- 앱의 `cancel` 이나 채널 닫힘은 그 차례의 `AbortController` 를 끊는다. 신호는 `streamText({ abortSignal })` 로
  모델 요청을 끊고, 도는 도구의 `execute` 가 받은 신호로 `handle(args, { signal })` 에 닿는다. 확인을 기다리던
  호출은 계약 §9 흐름 4 대로 `withdraw` 를 보내고 실행하지 않는다. [설계; 계약 §9]
- 모델 요청 중에 끊으면 `abort` part 가 나오고 모의 서버가 연결 닫힘을 봤다. 도구 중에 끊으면 도구의 신호가
  울리고 다음 모델 요청이 나가지 않았다. [실측]
- 이미 앱으로 보낸 작업 요청은 MCP 경로처럼 앱이 끝까지 실행하고 기록부에 남긴다. [계약 §7.8]

### 재시도

- AI SDK 의 요청 재시도는 기본값 그대로 둔다: `maxRetries` 2, 2초부터 두 배, 응답의
  `retry-after`·`retry-after-ms` 가 60초 안이면 따른다. 스트림 중간 재시도 `streamRetries` 는 기본 0 그대로
  둔다. 이미 앱에 보낸 글과 도구 호출이 되풀이될 수 있기 때문이다. [문서: [Error
  handling](https://ai-sdk.dev/docs/ai-sdk-core/error-handling),
  [streamText](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text), `ai` 7.0.179
  `src/util/retry-with-exponential-backoff.ts`] [설계]
- 차례 전체는 저절로 다시 돌리지 않는다. 도구가 이미 보내기나 삭제를 했을 수 있다. `error.retryable` 이 참이면
  앱이 "다시" 를 보이고, 누르면 새 차례다. [설계]
- 도구 루프의 단계 한도는 `stopWhen: isStepCount(N)` 으로 둔다. v7 의 `streamText` 기본은 `isStepCount(1)` 이라
  정하지 않으면 도구 결과 뒤에 답이 없다. `ToolLoopAgent` 의 기본은 20 이다. N 은 구현 이슈에서 정한다. [문서:
  [streamText](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text) 의 `stopWhen`, `ai` 7.0.179
  `docs/07-reference/01-ai-sdk-core/16-tool-loop-agent.mdx`] [설계]
- 멈춘 스트림은 `timeout` 의 `firstChunkMs`·`chunkMs` 로 끊는다. `toolMs` 는 핸들러 자신의 한도(확인 30초,
  미리보기 읽기 마감 5초)보다 짧게 두지 않는다. 값은 구현 이슈에서 정한다. [문서:
  [Settings](https://ai-sdk.dev/docs/ai-sdk-core/settings)] [설계]

### 코어가 끝나거나 다시 뜰 때

- 처리되지 않은 거부는 코어를 70 으로 끝내고 모든 MCP 연결을 떨군다. [계약 §7.8] 채팅의 오류는 채팅 세션의
  경계에서 모두 잡아 `error` 로 바꾸고, 로그를 남긴다. [설계]
- 코어가 다시 뜨면 그 채널의 채팅은 끝난다. 앱은 보이는 대화를 그대로 두고 그 차례를 끊긴 것으로 표시한다. 이어
  쓰면 앱이 새 채팅 채널을 열고 마지막으로 받은 `state` 를 `resume` 으로 돌려준다(정정 2026-11-22: 처음에는
  대화가 코어 메모리에만 있으므로 새 채팅을 연다고 적었다. "대화 기록" 을 보라). [설계]

### 도구

- 레지스트리(`ToolBasis.resolved()`)의 도구마다 AI SDK `tool({ description, inputSchema, execute })` 하나를
  만든다. `execute` 는 MCP 의 `tools/call` 과 같은 `handle(args, { signal, client })` 를 부른다. [설계; 코드:
  `core/src/mcp/tools.ts`]
- 호출의 수명(시작·끝 로그, 도는 호출 목록 `activeCalls`, 계약 §10.5 의 `SherpaToolOutcomeV1` 결과 봉투)은 지금
  `core/src/mcp/server.ts` 안에 있다. 구현 때 MCP 에도 채팅에도 속하지 않는 모듈로 옮겨 둘이 함께 쓴다. [코드;
  설계]
- 모델에는 같은 결과 봉투를 준다. 1 MiB 맞춤(계약 §10.5)은 MCP 의 한도이므로 채팅은 더 작은 한도를 둔다. 값은
  구현 이슈에서 정한다. [설계]
- 35개 도구의 이름·설명·입력 스키마(`z.toJSONSchema`)는 43,871자이고, `$schema` 키 35개와 `z.int()` 가 넣는
  ±2^53 경계 쌍 145개를 담는다. [실측] 모델에 보내는 JSON Schema 에서는 이 둘을 뺀다. 입력 검사는 그대로 zod
  스키마로 한다. AI SDK 도 도구 입력을 스키마로 검사하고 어긋나면 `InvalidToolInputError` 를 낸다. [문서: `ai`
  7.0.179 `src/generate-text/parse-tool-call.ts`] 토큰 수는 재지 않았고 11~15K 로 추정한다. [추론]
- 확인 기록의 `client` 는 코어가 `{"name":"sherpa-chat","version":"<코어 버전>"}` 로 정한다. MCP 의 요청
  봉투처럼 자기 신고 값이 아니다. [설계; 계약 §9]

### MCP 를 자기 자신에게 되돌려 거는 방식은 뺐다

`@ai-sdk/mcp` 의 클라이언트로 코어 자신의 MCP 서버에 붙어 도구를 받는 방식은 쓰지 않는다. [설계]

1. 같은 프로세스의 같은 `handle` 을 부르는데 JSON-RPC 직렬화와 연결 한 겹이 더해질 뿐이다.
2. 채팅 도구가 MCP 스위치에 묶인다. 결정 6 은 둘을 따로 켠다.
3. 확인 기록의 `client` 가 다시 자기 신고 봉투 값이 된다.
4. `@ai-sdk/mcp` 2.0.102 는 `LATEST_PROTOCOL_VERSION` 이 2026-07-28 이지만 `SUPPORTED_PROTOCOL_VERSIONS` 에
   2025-11-25 와 2025-06-18 을 두고, `protocolVersionDiscovery` 로 물었다가 옛 판으로 내려간다. [문서: 패키지
   소스] 결정 7 과 맞지 않는다.
5. 네 제공자에 `@ai-sdk/mcp` 를 더하면 대기 RSS 가 1.5 MB, 실제 점유가 2 MB 더 늘었다. [실측]

사람이 고른 바깥 MCP 서버를 채팅에 붙이는 것은 1판에 없다. 그 서버로 가는 연결은 결정 3 이 허용하는 연결이
아니다.

## 제공자 면

| 제공자 | 패키지 | 쓰는 면 | 제공자 쪽 저장 | 기본 출처 |
| --- | --- | --- | --- | --- |
| Anthropic | `@ai-sdk/anthropic` 4.0.107 | `createAnthropic({ apiKey, baseURL, fetch, headers })(model)`, Messages API | 상태 없는 요청 | `https://api.anthropic.com/v1` |
| OpenAI | `@ai-sdk/openai` 4.0.122 | `createOpenAI({ apiKey, baseURL, fetch })(model)`, Responses API | 기본 `store` 참. `store: false` 로 보낸다 | `https://api.openai.com/v1` |
| Google | `@ai-sdk/google` 4.0.124 | `createGoogle({ apiKey, baseURL, fetch }).interactions(model)`, `POST /v1beta/interactions` | 기본 저장(유료 55일, 무료 1일). `store: false` 로 보낸다 | `https://generativelanguage.googleapis.com/v1beta` |
| OpenAI 호환 | `@ai-sdk/openai-compatible` 3.0.94 | `createOpenAICompatible({ name, baseURL, apiKey, fetch }).chatModel(model)`, `/chat/completions` | 서버마다 다르다 | 사람이 적은 base URL |

[문서: 각 패키지의 `docs/` 와 [Anthropic](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic),
[OpenAI](https://ai-sdk.dev/providers/ai-sdk-providers/openai),
[Google](https://ai-sdk.dev/providers/ai-sdk-providers/google), [OpenAI
Compatible](https://ai-sdk.dev/providers/openai-compatible-providers) 제공자 문서; Google 저장 기간은
[Interactions API](https://aistudio.google.com/docs/interactions-overview) "Data storage and retention"] [설계]

- **Google:** `google(model)` 은 `generateContent` 면이다. Google 은 Interactions API 를 2026년 6월에 GA 로 내고
  새 프로젝트의 권고 면으로 두며, `generateContent` 를 "now considered legacy" 로 부른다(지원은 이어진다).
  [문서: Interactions API] 결정 7 에 따라 `interactions` 를 쓴다. `createGoogleGenerativeAI` 는 폐기 예정
  이름이고 `createGoogle` 을 쓴다. [문서: `@ai-sdk/google` 4.0.124 `src/index.ts` 의 `@deprecated`] 키는
  `x-goog-api-key` 머리말로 간다. [문서: 같은 패키지 `docs/`]
- **OpenAI:** `openai(model)` 은 AI SDK 5 부터 Responses API 다. Chat Completions(`openai.chat`)는 OpenAI 에
  쓰지 않는다. [문서: `@ai-sdk/openai` 4.0.122]
- **Anthropic API 판:** `@ai-sdk/anthropic` 4.0.107 은 모든 요청에 `anthropic-version: 2023-06-01` 을 싣는다.
  [문서: 패키지 `src/anthropic-provider.ts`] Anthropic 의 최신 판은 2026-10-21 이고 Anthropic 은 최신 판을
  권한다. 2026-10-21 의 Messages 변경은 요청 입력 셋이다: assistant 메시지 안 `document` 블록, user 메시지
  `text` 블록의 `citations`, `temperature`·`top_p`·`top_k` 가 400 이 된다. [문서: [API
  versions](https://platform.claude.com/docs/en/api/versioning), [Migrating to API version
  2026-10-21](https://platform.claude.com/docs/en/api/migration-2026-10-21)] 제공자 설정의 `headers` 가 그
  머리말 뒤에 펼쳐져 덮으므로 [문서: 같은 소스의 `createHeaders`], 코어는
  `headers: { "anthropic-version": "2026-10-21" }` 을 넘기고 그 셋을 보내지 않는다. 시험은 나가는 머리말과 몸을
  본다. 실제 API 가 AI SDK 의 요청을 그 판으로 받는지는 확인 전이다("아직 확인 전"). [설계]
- **쓰지 않는 것:** 문자열 모델 id 와 전역 제공자(기본이 Vercel AI Gateway 라 고르지 않은 곳으로 나간다 [문서:
  [Provider management](https://ai-sdk.dev/docs/ai-sdk-core/provider-management)]), `@ai-sdk/gateway`(`ai` 의
  의존으로 설치되지만 가져오지 않는다), 제공자가 실행하는 도구(웹 검색, 코드 실행 등), 원격 측정. 폐기 예정 이름
  `fullStream`, `system`, `stepCountIs`, `needsApproval`, `onFinish`·`onStepFinish`, `experimental_telemetry` 도
  쓰지 않는다. 각각 `stream`, `instructions`, `isStepCount`, `toolApproval`, `onEnd`·`onStepEnd`, `telemetry` 가
  새 이름이다. [문서: AI SDK 7 이행 안내] [설계]
- **원격 측정:** v7 은 통합을 등록할 때만 원격 측정을 내고, OpenTelemetry 는 `@ai-sdk/otel` 로 옮겼다. [문서:
  [Telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry)] 코어는 통합을 등록하지 않는다. [설계]
- **경고:** AI SDK 의 경고는 `globalThis.AI_SDK_LOG_WARNINGS` 가 `false` 나 함수가 아니면 기본 기록기로 나간다.
  [문서: `ai` 7.0.179 `src/logger/log-warnings.ts`] 코어는 이 값을 Sherpa 로그로 옮기는 함수로 두고, 시험은 폐기
  예정 경고가 하나라도 나오면 실패한다. [설계]
- **판 고정:** `ai` 와 `@ai-sdk/*` 는 정확한 판으로 고정하고(`^` 없음), 올릴 때 이행 안내와 이 절을 다시 본다.
  [설계]

## 키

### 저장

- 키는 앱만 다룬다. 일반 암호 항목(`kSecClassGenericPassword`)에 `kSecUseDataProtectionKeychain` 을 참으로 둔다.
  서비스는 `sherpa.chat.<제공자>`, 계정은 `api-key` 이고, OpenAI 호환은 계정을 base URL 의 출처로 둔다. 출처가
  다른 서버에 그 키가 가지 않게 하려는 것이다. [설계; 문서:
  [kSecUseDataProtectionKeychain](https://developer.apple.com/documentation/security/ksecusedataprotectionkeychain)]
- `kSecAttrAccessible` 은 `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` 이고, `kSecAttrSynchronizable` 은 두지
  않는다(iCloud 키체인에 올리지 않는다). [설계]
- `kSecAttrAccessGroup` 은 두지 않는다. 키체인 접근 그룹을 정하지 않은 앱의 기본 그룹은 App
  ID(`<TeamID>.dev.xiyo.sherpa`)다. [문서: [Sharing access to keychain items among a collection of
  apps](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps)]
  macOS 의 App ID 권한 항목은 `com.apple.application-identifier` 이고, 그 항목은 provisioning profile 이
  허락해야 한다. macOS 는 프로필을 `Sherpa.app/Contents/embedded.provisionprofile` 에서 찾는다. [문서:
  [TN3125](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles)]
- 코어와 중계는 그 그룹의 항목을 읽지 못한다. 둘은 권한 항목 없이 서명한 따로 선 실행 파일이고(계약 §2), 따로 선
  실행 파일은 프로필을 담을 수 없다. [문서: TN3125; 읽지 못하는 것은 추론, 재현 안 함]
- 파일 기반 키체인(`SecKeychain*`)은 쓰지 않는다. Apple 은 그것을 "on the road to deprecation" 으로 적는다.
  [문서: [TN3137](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains)]

### 코어로 넘기기

- 앱은 차례마다 키를 주 스레드 밖에서 읽어 그 `turn`(또는 `list_models`) 메시지에만 싣는다. 코어는 키를 그
  요청의 제공자 객체에만 쥐어 두고 차례가 끝나면 놓는다. [설계]
- 코어는 제공자를 만들 때 `apiKey` 와 `baseURL` 을 늘 명시한다. 빠지면 제공자는
  `ANTHROPIC_API_KEY`·`ANTHROPIC_BASE_URL`, `OPENAI_API_KEY`·`OPENAI_BASE_URL`, `GOOGLE_GENERATIVE_AI_API_KEY`
  를 읽는다. [문서: 각 패키지의 `loadApiKey`·`loadOptionalSetting`] 앱이 코어 환경을 `HOME`·`TMPDIR`·고정
  `PATH`·`LOG_LEVEL` 로 비우지만(계약 §7.1), 시험은 값이 빠진 제공자 생성을 따로 막는다. [설계]
- 키는 디스크, 환경 변수, 실행 인자, 로그 어디에도 남기지 않는다. 앱과 코어는 채팅 프레임을 바이트 수로만
  적는다. AI SDK 의 `APICallError` 는 `requestBodyValues` 와 `responseBody` 를 들고 있으므로, 코어는 오류의
  이름과 HTTP 상태만 적는다. [설계; 문서: `@ai-sdk/provider` 의 `APICallError`]
- 코어가 키체인을 직접 읽는 방식은 뺐다. 그러려면 코어에 App ID 권한 항목과 프로필이 있어야 하는데, 따로 선 실행
  파일은 프로필을 담을 수 없다. [문서: TN3125]

### 바꾸기와 지우기

- 입력은 `SecureField` 로 받는다. 바꾸기는 `SecItemUpdate` 이고, 항목이 없으면(`errSecItemNotFound`, -25300)
  `SecItemAdd` 다. 지우기는 `SecItemDelete` 다. 화면은 키를 다시 보이지 않고 "저장됨"·"없음" 만 보인다. [설계]
- 기기가 잠겨 읽지 못하면(`errSecInteractionNotAllowed`, -25308) 항목을 지우지 않고 그 차례를 키 없음으로
  끝낸다. 제공자가 401·403 으로 답해도 지우지 않고 "키가 거절됨" 을 보인다. [설계]
- OpenAI 호환의 base URL 을 바꿔 출처가 달라지면 새 키를 묻고 옛 출처의 항목은 지운다. [설계]

### 프로필이 없을 때

- 프로필이 없는 빌드(개발 빌드, 프로필 전의 릴리스)에서 data protection keychain 은
  `errSecMissingEntitlement`(-34018)로 거부한다고 본다. 값은 SDK `SecBase.h` 의 것이고, 이 조건에서 그 값이
  나오는지는 재지 않았다. [미확인]
- 그때 앱은 "AI 연결하기" 를 쓸 수 없음으로 보이고, 파일 기반 키체인이나 다른 저장으로 물러서지 않는다. MCP 는
  영향이 없다. [설계]
- 시험은 메모리 안의 키 저장소를 쓴다. 게이트의 앱 번들 빌드와 권한 항목 검사(`scripts/check-all.sh`)는 프로필이
  들어오는 단계에서 함께 고친다. [설계]

## 네트워크

### 규칙

코어가 여는 연결은 사람이 고른 제공자의 출처(scheme, host, port)로 나가는 HTTPS 요청뿐이다. 채팅 차례와 모델
목록 받기만 그런 요청을 낸다. 듣는 소켓, 다른 출처, 평문 HTTP, WebSocket, UDP 는 없다. 앱과 중계는 지금처럼 Unix
소켓만 쓴다. [소유자 결정 3; 설계]

### 코드로 지키기

1. 나가는 길 모듈 하나(`core/src/chat/egress.ts`)가 코어 시작 때 진짜 `fetch` 를 쥐고 `globalThis.fetch` 를 늘
   거부하는 함수로 바꾼다. AI SDK 의 `getOriginalFetch` 는 요청마다 `globalThis.fetch` 를 읽으므로 [문서:
   `@ai-sdk/provider-utils` 5.0.83 소스], `fetch` 설정이 빠진 길(전역 제공자와 Gateway 포함)도 막힌다. [설계]
2. 차례마다 그 차례의 제공자에 지킨 `fetch` 를 넘긴다. https 이고 출처가 그 차례의 출처와 같을 때만
   `redirect: "error"` 와 그 차례의 중단 신호를 달아 진짜 `fetch` 로 보낸다. 어기면 요청 전에 거부하고 `error`
   `egress_denied` 로 끝낸다. [설계] `fetch(..., { redirect: "error" })` 는 Bun 1.4.4 와 1.4.5 에서 다른 서버로
   가는 307 과 상대 `Location` 의 302 를 모두 `TypeError`(`UnexpectedRedirect`)로 거부했고, 리디렉트 대상은
   요청을 받지 않았다. [실측: #64] 회귀 시험은 `core/tests/stdio/egress.test.ts` 이고 게이트를 돌리는 Bun 에서
   돈다. 게이트가 `core/package.json` 의 Bun 판을 강제하는 것은 #71(PR #77)이 넣는다. (정정 2026-11-22, #64:
   처음에는 Bun 1.4.4 에서만 재고, 저장소가 고정한 1.4.5 는 구현 때 다시 잰다고 적었다.)
3. 정적 검사(코어 린트 규칙이나 `scripts/checks/` 검사)로 막는다. [설계]
   - `chat/` 밖에서 `ai`·`@ai-sdk/*` 를 가져오지 않는다.
   - 코어 어디서도 `node:net`·`node:tls`·`node:http`·`node:https`·`node:http2`·`node:dgram`,
     `@ai-sdk/gateway`·`@ai-sdk/mcp`·`@ai-sdk/otel` 을 가져오지 않는다.
   - `Bun.connect`·`Bun.listen`·`Bun.serve`·`Bun.udpSocket`·`WebSocket` 을 쓰지 않는다.
   - `fetch` 는 나가는 길 모듈에서만 부른다.
   - 모델은 제공자 객체로만 만들고 문자열 모델 id 를 넘기지 않는다.

   구현(#64)은 이 검사를 `vp check` 가 돌리는 코어 린트 규칙(`core/vite.config.ts`)으로 넣었고, 막는 목록은
   위보다 넓다. 전역 `fetch` 를 바꿔도 따로 묶인 읽기 전용 `Bun.fetch` 와 `Worker` 의 자기 `fetch` 는 막히지
   않고, `ws`·`undici`·`node-fetch` 등 네트워크 모듈은 설치 없이 풀리기 때문이다. [실측: #64] 그래서 Bun 과
   Node 의 다른 네트워크·이름 풀이 API, 자기 `fetch`·`WebSocket` 을 싣는 모듈, `EventSource`, `require()` 도
   막는다. 목록은 그 파일이 정본이다. 린트는 지정자가 문자열 리터럴이 아닌 동적 `import`, 문자열로 넘긴 Worker
   코드, `Bun.spawn` 으로 띄운 다른 실행 파일은 보지 못한다. [추론] 다섯째 항목(문자열 모델 id)은 AI SDK 를
   들이는 단계 4(#66)가 넣는다. (정정 2026-11-22, #64)

### 시험으로 지키기

- 단위 시험은 소켓 없이 지킨 `fetch` 를 본다. 다른 출처, 평문 HTTP, userinfo, 리디렉트, 전역 `fetch` 호출이 모두
  거부되고, 허용 경로는 진짜 `fetch` 자리에 넣은 가짜까지 간다. [설계]
- 빌드한 코어를 stdio 로 띄우는 시험은 허용되지 않은 출처로 차례를 보내 시험이 띄운 로컬 서버에 연결이 하나도
  오지 않음을 보고, 차례 중 코어에 인터넷 소켓과 듣는 Unix 소켓이 없음을 `lsof -n -P -a -p <pid>` 의
  `-i`(TCP·UDP, 모든 상태)와 `-U` 로 본다. 허용 경로는 믿을 수 있는 TLS 가 있어야 하므로 이 층에서는 보지
  않는다. [설계] 차례 메시지가 아직 없어, 단계 2(#64)의 시험 `core/tests/stdio/egress.test.ts` 는 차례 대신
  `hello` 부터 두 MCP 연결과 확인을 기다리는 도구 호출까지 소켓을 본다. `lsof` 는 인터넷 소켓이 없는 프로세스와
  이미 끝난 pid 에 똑같이 아무것도 내지 않고 1 로 끝나므로, 시험 프로세스의 듣는 소켓과 코어의 fd 0–2 를 먼저
  보는 양성 대조를 둔다. [실측: #64] 차례를 보내는 부분은 단계 4(#66)가 더한다. (정정 2026-11-22, #64: 처음에는
  `-iTCP -sTCP:LISTEN` 으로 듣는 TCP 소켓만 본다고 적었다.)
- 게이트는 유료 API 를 부르지 않는다. 실제 제공자 연결은 소유자 실기에서 `lsof -i -a -p <코어 pid>` 로 연결이
  고른 출처 하나뿐인지 본다. [설계]

### OpenAI 호환의 base URL

- 사람이 적는 base URL 은 https 여야 하고 userinfo·query·fragment 가 없어야 한다. 경로(`/v1` 등)는 둔다. 허용
  출처는 그 URL 의 출처다. URL 은 비밀이 아니므로 앱 defaults 에 두고, 키는 없어도 된다(없으면 인증 머리말을
  싣지 않는다). [설계]
- 로컬 서버(`http://localhost`, `http://127.0.0.1` 등)는 받지 않는다. https 만 받는다. [소유자, 2026-11-22,
  "남은 결정" 1] (정정 2026-11-22: 처음에는 소유자 결정 대기로 적었다.)

## 확인 흐름

- 채팅의 `execute` 는 MCP 와 같은 `handle` 을 부르므로, 6개 도구(`imessage_send`, `mail_send`, `event_delete`,
  `reminder_delete`, `event_collection_delete`, `reminder_collection_delete`)는 같은 앱 창 확인을 거친다.
  미리보기 읽기(마감 5초), 채널 0 의 `confirm`, 30초(`CONFIRMATION_TIMEOUT_MS`), 코어의 시계가 권위인 것, 중단
  때의 `withdraw` 가 MCP 와 같다. [계약 §9; 코드: `core/src/mcp/confirmation.ts`]
- 거절과 시간 초과는 MCP 처럼 실패 결과 봉투(`confirmation.declined`, `confirmation.timed_out`)로 모델에 가고,
  채팅 화면에는 `tool` 의 `declined` 나 `failed` 로 보인다. 창은 `client` 의 `sherpa-chat` 으로 앱 채팅에서 온
  요청임을 보일 수 있다. [설계]
- AI SDK 의 도구 승인(`toolApproval`)은 쓰지 않고 모든 도구를 기본(승인 없음)으로 둔다. [설계]
  1. 손으로 승인하려면 호출이 둘이다. 첫 호출은 `tool-approval-request` 를 내고 끝나며([실측] 끝난 까닭
     `tool-calls`, 1단계), 승인을 메시지에 넣어 다시 불러야 한다. 그 사이의 대기와 시간 한도를 채팅 쪽이 따로
     맡게 된다.
  2. 미리보기, 코어 시계, `withdraw`, `operation_id` 가 모두 핸들러 안에 있다. 승인을 핸들러 밖으로 빼면 MCP
     경로와 확인이 둘로 갈라진다.
  3. 승인이 모델 메시지 목록의 일부가 된다. 앱 창의 답은 모델을 거치지 않는다는 계약 §9 의 이유 1 이 흐려진다.
  4. 옛 이름 `needsApproval` 은 폐기 예정이다. [문서: AI SDK 7 이행 안내 "Migrate Deprecated `needsApproval` to
     `toolApproval`"]
- 만들기와 고치기는 MCP 처럼 확인 없이 돈다. 채팅에서는 사람이 아니라 메일·메시지 본문의 지시가 그 호출을 부를
  수 있다("위험" 2). [계약 §9; 추론]

## 개인정보

- 채팅을 쓰면 사람이 고른 제공자에게 사람의 글, 코어의 지시문, 35개 도구 정의, 도구 결과가 간다. 도구 결과에는
  메일·iMessage·KakaoTalk 의 본문과 남이 보낸 메시지, 일정과 미리알림이 들어 있다. [추론]
- **동의:** 제공자와 출처마다 첫 차례 전에 한 번, 짧은 확인을 띄운다("이 대화와 Sherpa 가 읽은 메일·메시지
  내용이 <제공자> 로 갑니다", 계속·취소). 자세한 것(무엇이 가는지, 제공자 쪽 보관, 비용)은 "?" 뒤에 둔다. 동의
  표시는 앱 defaults 에 두고, 출처가 바뀌면 다시 묻는다. 결정 6 대로 설명으로 화면을 덮지 않는다. [설계] 같은
  확인에 대화 기록의 보관 줄을 더한다(정정 2026-11-22, "대화 기록" 의 "동의와 안내").
- **제공자 쪽 보관:** OpenAI 와 Google 에는 `store: false` 를 보낸다. 제공자의 다른 보관(남용 감시 등)은 Sherpa
  가 바꾸지 못하므로 "?" 안내에 그렇게 적는다. [설계]
- **로그:** 계약 §12 의 "남기면 안 되는 값" 에 사람의 글, 모델 답, reasoning, 지시문, 키, 제공자 요청·응답 몸을
  더한다. 남기는 것은 제공자 이름, 출처, 모델 id, 단계 수, 토큰 수, 걸린 시간, 오류 이름과 HTTP 상태, 도구
  이름과 상태다. [설계]
- **지시문:** 지시문은 코어가 정한 고정 문구이고 `instructions` 로 넘긴다. `messages` 안의 system 메시지는 v7
  기본대로 거부되게 두고 허용 설정을 켜지 않는다. [문서: AI SDK 7 이행 안내] 지시문은 도구 결과가 지시가 아니라
  자료라고 적는다(아키텍처 품질 목표 5). [설계]
- **대화 기록:** 앱이 이 Mac 에 암호화해 저장하고, 사람이 지우거나 사람이 고른 보관 기한이 지나면 지운다.
  [소유자, 2026-11-22, "남은 결정" 2] 설계는 "대화 기록" 절이다. (정정 2026-11-22: 처음에는 소유자 결정 대기로
  적고, 결정 전까지 대화가 코어 메모리와 앱 메모리에만 있다고 적었다.)

## 대화 기록

소유자는 2026-11-22 에 대화 기록을 디스크에 저장하기로 했다(맨 위 정정, "남은 결정" 2). [소유자] "남은 결정" 2
가 적은 대로 암호화, 보관 기한, 지우기 화면, 백업 제외를 함께 정한다. 실측은 2026-11-22 저장소 밖 버리는
폴더에서 macOS 27.3, Swift 6.4.2 로 쟀다("실측" 절).

### 무엇을 저장하나

- 대화마다 파일 하나에 둘을 둔다. [설계]
  1. **보이는 대화:** 앱이 그린 사람 글, 모델 답, 도구 줄(이름과 상태), 차례 끝 표시. 앱의 형식이다.
  2. **모델 상태:** 같은 제공자·출처·모델로 이어 쓰기 위한 코어의 상태 `sherpa.chat.state.v1` 이다. 형식은
     코어가 정하고 코어만 읽는다. 앱은 받은 바이트를 해석하지 않고 그대로 둔다.
- 모델 상태의 봉투는 `{format, provider, origin, model, fingerprint, messages}` 다. `messages` 는 AI SDK 의 모델
  메시지(`ModelMessage[]`)이고, part 의 `providerOptions` 에 제공자가 되돌려 받는 값이 실린다: Anthropic
  thinking 의 `signature` 와 `redacted_thinking` 의 데이터, 서버 쪽 대체의 `fallback` 블록(`custom` part),
  OpenAI reasoning 항목의 `reasoningEncryptedContent` 와 메시지의 `phase`, Google `thought` 단계의 `signature`.
  [문서: `@ai-sdk/anthropic` 4.0.107 `src/convert-to-anthropic-prompt.ts`·`src/anthropic-language-model.ts`,
  `@ai-sdk/openai` 4.0.122 `src/responses/convert-to-openai-responses-input.ts`, `@ai-sdk/google` 4.0.124
  `src/interactions/convert-to-google-interactions-input.ts`]
- 지시문과 도구 정의는 상태에 넣지 않는다. 코어가 차례마다 자기 판의 것을 넘긴다. `fingerprint` 는 모델에 보낸
  그 둘의 SHA-256 이다("이어 쓰기"). [설계]
- 상태는 JSON 이다. 이진 값(`Uint8Array`)이 든 part 는 base64 문자열로 담는다. 모델 메시지 스키마가 문자열도
  받는다. [문서: `ai` 7.0.179 `src/prompt/content-part.ts`; 설계]
- API 키는 상태에 없다. 키는 차례마다 `turn` 에 실려 오고 상태에 들어가지 않는다. 시험이 상태에 키가 없음을
  본다. [설계]

### 상태를 넘기는 때

- 코어는 상태가 바뀔 때마다 그 전체를 `state` 로 보낸다. 바뀌는 때는 차례의 사람 글을 더할 때와, 단계가 끝나 그
  단계의 응답 메시지를 더할 때다. `done`·`error` 는 그 차례의 마지막 `state` 뒤에 온다. 앱은 받은 `state` 로
  앞의 것을 바꾸고 파일을 다시 쓴다. 코어나 앱이 차례 중에 끝나도 끝난 단계까지는 남는다. [설계]
- 앱은 `state` 를 받을 때와 차례가 끝날 때(`done`·`error`) 파일을 쓰고, 글 조각(`delta`)마다 쓰지는 않는다.
  파일의 보이는 대화와 모델 상태는 같은 단계에서 끝나고, 보이는 대화에는 차례 끝 표시(거절, 끊김)가 더 있을
  뿐이다. [설계]
- 상태에는 끝난 단계만 넣는다. AI SDK 는 단계가 끝날 때 `onStepEnd` 를 부르고(제공자의 `error` 조각으로 끝난
  단계에도 부른다), 중단이나 시간 초과 때는 `onAbort` 에 그 전에 끝난 단계들을 넘긴다. [문서: `ai` 7.0.179
  `src/generate-text/stream-text.ts`·`generate-text-events.ts`] 끝난 까닭이 `error` 인 단계와 끊긴 단계의 조각은
  넣지 않는다. [설계]
- 거절(`content-filter`)로 끝난 단계는 넣지 않는다. Anthropic 은 거절 앞의 부분 출력을 끝나지 않은 것으로 보고
  버리라고 적는다. [문서: [Refusals and
  fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback), "treat any partial
  output as incomplete and discard it"] 사람의 글은 남기고, 보이는 대화에는 거절을 보인다. [설계]
- 그래서 차례가 중간에 끝난 상태는 사람의 글이나 도구 결과로 끝나고, 다음 사람 글이 그 뒤에 붙는다. Anthropic
  변환은 이어진 사람 메시지와 도구 결과를 user 블록 하나로 묶는다. [문서: `@ai-sdk/anthropic` 4.0.107
  `groupIntoBlocks`] 다른 세 제공자가 이어진 사람 메시지를 받는지는 확인 전이다("아직 확인 전").
- 상태 하나는 `data` 하나(4 MiB, 계약 §7.4)에 들어가야 한다. "메모리와 크기" 의 대화 크기 한도는 이 값 아래로
  두고, 닿기 전에 채팅을 끝내고 새 채팅을 권한다. [설계]

### 이어 쓰기

- 사람이 저장한 대화를 이어 쓰면 앱은 새 채팅 채널을 열고 첫 메시지 `resume` 에 저장한 상태를 싣는다. 코어는
  형식, 모델 메시지 스키마(`modelMessageSchema`), system 메시지가 없음, 크기를 보고, 첫 `turn` 의
  제공자·출처·모델이 상태의 것과 같은지 본다. 어기면 `error` `chat_state_invalid` 나 `chat_state_mismatch` 로
  끝내고, 앱은 그 대화를 읽기 전용으로 둔다. [설계; 문서: `ai` 7.0.179 `src/prompt/message.ts`]
- 이어 쓴 요청은 저장한 메시지를 받은 그대로 보낸다. Anthropic 은 이어 쓴 대화를 보통의 다음 요청으로 보고
  `system`·`tools`·앞 메시지가 그때의 값이어야 한다고 적는다. [문서: [Change tools or
  instructions](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking/change-tools-or-instructions),
  "Save, resume, or fork a conversation"]
- Sherpa 판이 바뀌면 지시문과 도구 정의가 달라질 수 있다. 코어는 상태의 `fingerprint` 를 지금 값과 견주고,
  제공자마다 아래처럼 한다. [설계]

| 제공자 | 되돌려 보내는 것 | 지문이 다를 때 | 제공자가 스스로 빼는 것 |
| --- | --- | --- | --- |
| Anthropic | thinking·`redacted_thinking`·`fallback` 블록을 받은 그대로 | 바뀐 곳 뒤의 thinking 은 앞부분 검사에 걸려 400 이 날 수 있다. 문서는 thinking 을 맨 앞부터, 맨 뒤부터, 또는 모두 빼는 것을 허락한다. 코어는 reasoning 을 모두 빼고(`pruneMessages`, `reasoning: "all"`) 뺀 것을 다시 넣지 않는다. adaptive thinking 은 어느 assistant 차례도 thinking 으로 시작하지 않아도 된다 | 그 모델이 읽지 못하는 다른 모델의 블록과 다른 계정에 묶인 블록을 오류 없이 버린다 |
| OpenAI | reasoning 항목(`encrypted_content`), 메시지의 `phase`, `store: false` 의 전체 항목 | 그대로 보낸다. 앞부분이 바뀌면 API 가 그 뒤 reasoning 을 떨군다. 오류가 아니다 | 모델 계열·조직·사용자를 바꾸면 reasoning 을 뺀다 |
| Google | `thought` 단계와 그 `signature` 를 받은 그대로 | 그대로 보낸다. 문서는 thought 를 빼거나 고치지 말라고 적고, `tools`·`system_instruction` 은 interaction 마다 다시 정하는 값이다 | 확인 전 |
| OpenAI 호환 | reasoning 을 `reasoning_content` 로 | 그대로 보낸다 | 서버마다 다르다 |

[문서: Anthropic [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking) "Preserved thinking"
과 Change tools or instructions 의 "Leave out thinking"; OpenAI [Reasoning
models](https://developers.openai.com/api/docs/guides/reasoning) "Preserve reasoning without stored
responses"·"Reasoning item removal across requests" 와 [Keep the prefix
unchanged](https://developers.openai.com/api/docs/guides/keep-prefix-unchanged); Google [Gemini
thinking](https://aistudio.google.com/docs/thinking) "Stateless mode" 와 [Interactions
API](https://aistudio.google.com/docs/interactions-overview) 의 interaction-scoped 매개변수;
`@ai-sdk/openai-compatible` 3.0.94 소스] [설계]

- 제공자가 이어 쓴 요청을 거절하면(400, 물러난 모델 등) 차례는 `error` 로 끝나고 앱은 그 대화를 읽기 전용으로
  둔다. 코어는 상태를 저절로 고쳐 다시 보내지 않는다. 다른 모델로 옮겨 잇기는 1판에 없고, 사람은 새 채팅을 연다.
  [설계]
- base URL 을 바꿔 출처가 달라진 OpenAI 호환 기록은 옛 출처의 키가 지워지므로("키") 읽기 전용이 된다. [설계]
- OpenAI 는 `store: false` 응답의 reasoning 항목에 `encrypted_content` 를 기본으로 싣고, `include` 의
  `reasoning.encrypted_content` 는 호환으로만 받는 옛 값이라고 적는다. [문서: Reasoning models] AI SDK 는
  `store: false` 이고 카탈로그가 reasoning 모델로 아는 모델에 그 옛 값을 저절로 더한다. [문서: `@ai-sdk/openai`
  4.0.122 `src/responses/openai-responses-language-model.ts`] 결정 7 에 비추어 끌 수 있는지는 #66 이 본다.
  [설계]

### 누가 저장하나

- 앱이 저장한다. 코어는 대화를 디스크에 쓰지 않고 상태를 채널로 넘기기만 한다. [설계]

| 기준 | 앱이 파일로 저장(고른 안) | 코어가 SQLite 에 저장 |
| --- | --- | --- |
| 기록 키 | 앱의 data protection keychain 에만 있다. 코어와 중계는 그 항목을 읽지 못한다고 본다("키") | 코어가 암호화하려면 앱이 기록 키를 프레임에 실어 넘겨야 한다. 키가 지나는 곳이 하나 는다 |
| 유일한 작성자 | 앱이 `chats/` 의 유일한 작성자다 | 코어가 그 데이터베이스의 유일한 작성자다. 둘 다 아키텍처의 "Sherpa is the only writer of Sherpa-owned databases" 를 지킨다 |
| 일관성 | 보이는 대화와 모델 상태가 파일 하나에서 함께 바뀐다(`rename`) | 보이는 대화는 앱이, 모델 상태는 코어가 쥔다. 맞추려면 두 쪽 쓰기를 묶거나 보이는 대화도 코어가 만들어야 한다 |
| 코어가 없을 때 | 앱이 혼자 목록을 보이고, 지우고, 기한을 지킨다 | 코어가 다시 떠야 목록, 지우기, 기한 지우기가 된다 |
| 계약 | `state`·`resume` 둘 | 목록·불러오기·지우기·기한 요청이 더 는다 |

- 앱을 고른 까닭은 기록 키를 앱 밖으로 내지 않고, 화면과 상태가 어긋나지 않으며, 코어가 멈춰도 지울 수 있기
  때문이다. [설계]

### 암호화와 키

- CryptoKit `AES.GCM` 으로 봉한다. 256비트 키(`SymmetricKey(size: .bits256)`) 하나를 처음 저장할 때 만든다. 봉할
  때 nonce 를 주지 않아 CryptoKit 이 쓸 때마다 무작위 12바이트를 만든다. 파일의 평문 머리(형식 표시와 판, 대화
  id, 마지막 차례 시각)는 추가 인증 데이터(AAD)로 묶는다. [설계; 문서:
  [AES.GCM](https://developer.apple.com/documentation/cryptokit/aes/gcm) 의
  `seal(_:using:nonce:authenticating:)` 과 `SealedBox.combined`]
- 평문 1,000바이트가 `combined`(nonce 12 + 암호문 + 태그 16) 1,028바이트가 됐고, 다른 AAD 로 열면
  `authenticationFailure` 였다. [실측]
- 무작위 IV 를 쓰는 GCM 은 키 하나로 봉하는 횟수가 2^32 를 넘으면 안 된다. [문서: NIST SP 800-38D §8.3] 상태가
  바뀔 때마다 한 번 봉하므로 하루 만 번을 봉해도 천 년이 넘게 걸린다. 1판은 키를 바꾸지 않는다. [추론; 설계]
- 머리에는 내용이 없다. 목록의 제목(첫 사람 글의 앞부분)도 암호문 안에 둔다. 목록을 그릴 때 본문을 다 풀지
  않도록 제목·제공자·모델을 담은 작은 앞 상자를 따로 봉한다. 바이트 배치는 #67 이 정한다. [설계]
- 키는 일반 암호 항목이다: `kSecUseDataProtectionKeychain` 참, 서비스 `sherpa.chat-history`, 계정 `key`,
  `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, `kSecAttrSynchronizable` 없음. API 키와 같은 App ID 그룹이므로
  같은 프로필이 있어야 한다("키", #65). CryptoKit 대칭 키는 원시 바이트를 일반 암호로 담는다. [설계; 문서:
  [Storing CryptoKit Keys in the
  Keychain](https://developer.apple.com/documentation/cryptokit/storing-cryptokit-keys-in-the-keychain)]
- `ThisDeviceOnly` 항목은 새 기기로 옮겨지지 않고, 다른 기기의 백업에서 되살린 뒤에는 없다. [문서:
  [kSecAttrAccessibleWhenUnlockedThisDeviceOnly](https://developer.apple.com/documentation/security/ksecattraccessiblewhenunlockedthisdeviceonly)]
  기록 파일이 어떤 길로 이 Mac 을 떠나도 키는 따라가지 않는다. [추론]
- 앱은 키를 처음 쓸 때 읽어 메모리에 두고, 앱이 끝나거나 모두 지우기를 하면 놓는다. 키를 읽지 못하면 그동안
  저장하지 않고 화면의 대화를 메모리에만 둔다. 어떤 경우에도 평문으로 쓰지 않는다. 프로필이 없는 빌드는 채팅
  자체를 쓸 수 없으므로("프로필이 없을 때") 기록도 없다. [설계]

### 위치와 쓰기

- 폴더는 `~/Library/Application Support/Sherpa/chats/` 다. 앱이 0700 으로 만들고, `run/` 처럼 `lstat` 으로
  링크가 아닌 폴더이고 소유자가 자신인지 본다. 모드만 다르면 0700 으로 고치고, 소유자가 다르거나 링크면 저장하지
  않는다. [설계; 계약 §3]
- 파일은 대화마다 `<대화 id>.sherpachat` 하나이고, id 는 무작위 UUID 다. 이름에 내용이 없다. [설계]
- 쓰기는 같은 폴더의 임시 파일을 `open(O_CREAT|O_EXCL|O_WRONLY|O_CLOEXEC, 0600)` 으로 만들어 쓰고,
  `fcntl(F_FULLFSYNC)` 로 장치까지 밀어 넣은 뒤 `rename(2)` 으로 바꾼다. 앱은 시작할 때 남은 임시 파일을 지운다.
  [설계] `rename` 은 도중에 시스템이 멈춰도 새 이름의 파일 하나가 늘 있게 한다. `fsync` 만으로는 장치가 쓰기를
  미루거나 순서를 바꿀 수 있어 `F_FULLFSYNC` 를 따로 둔다. [문서: macOS `rename(2)`, `fsync(2)`]
- Foundation 의 `Data.write(options: .atomic)` 은 쓰지 않는다. 그것은 0644 로 만들었고, 다시 쓰자 파일에 단 백업
  제외 표시가 없어졌다. 위의 POSIX 길로 쓴 파일은 0600 이었다. [실측]
- 쓰기가 실패하면(디스크가 가득 찬 때 등) 채팅은 이어 가고, 화면에 기록을 저장하지 못했다고 보이며, 다음 `state`
  때 다시 쓴다. 실패는 error 로그로 남긴다. [설계]
- 열지 못한 파일(태그 검사 실패, 모르는 판)은 지우지 않고 목록에 "읽을 수 없음" 으로 보여 사람이 지우게 한다.
  보관 기한은 그런 파일에도 쓴다. [설계]

### 백업 제외

- `chats/` 폴더와 각 파일에 `URLResourceValues.isExcludedFromBackup` 을 참으로 단다. 폴더는 만들 때와 앱이
  시작할 때마다, 파일은 쓸 때마다 단다. Apple 은 흔한 파일 작업이 이 값을 거짓으로 되돌리므로 저장할 때마다
  달라고 적는다. [설계; 문서:
  [isExcludedFromBackupKey](https://developer.apple.com/documentation/foundation/urlresourcekey/isexcludedfrombackupkey)]
- 폴더에 이 값을 달자 xattr `com.apple.metadata:com_apple_backup_excludeItem` 이 생겼다. `tmutil addexclusion`
  도 같은 이름에 같은 61바이트 값(`com.apple.backupd` 를 담은 binary plist)을 썼다. 표시한 폴더 안의 새 파일은
  자기 xattr 이 없어도 값이 참이었고, 밖으로 옮기자 거짓이 됐다. [실측] `tmutil addexclusion` 의 기본은 항목을
  따라다니는 sticky 제외다. [문서: `man tmutil`] 둘을 합치면 이 값은 Time Machine 의 sticky 제외다. [추론]
- 버리는 폴더가 시스템이 이미 빼 둔 `/private/tmp` 아래여서, `tmutil isexcluded` 는 표시가 없는 형제 파일까지
  모두 `[Excluded]` 로 답했고 표시의 효과를 가르지 못했다. [실측] 실제 `chats/` 에서의 결과는 확인 전이다("아직
  확인 전").
- **iCloud:** iCloud Drive 의 "데스크탑 및 문서 폴더" 는 그 두 폴더를 iCloud Drive 에 둔다. [문서: [Add your
  Desktop and Documents files to iCloud Drive](https://support.apple.com/en-us/109344)]
  `~/Library/Application Support` 는 그 대상이 아니므로 올라가지 않는다고 본다. [추론] 앱은 iCloud API(CloudKit,
  ubiquity 컨테이너)를 쓰지 않고, 기록 키는 동기화하지 않는다. [설계]
- **로컬 스냅숏:** Time Machine 은 시동 디스크의 스냅숏을 약 한 시간마다 찍어 24시간 둔다. [문서: [About Time
  Machine local snapshots](https://support.apple.com/en-us/102154)] 볼륨 스냅숏이므로 백업 제외와 관계없이 지운
  기록 파일이 24시간까지 남을 수 있다. 그 사본도 암호문이다. [추론]
- 다른 백업 도구가 이 표시를 따르는지는 도구마다 다르다. 그 사본도 암호문이고, 키는 이 기기의 키체인에만 있다.
  [추론]

### 보관 기한

- 기본은 30일이고, 설정에서 1·7·30·90일 중에 고른다. 소유자가 바꿀 수 있는 값이다("소유자가 할 일" 4). [설계]
- 기한은 대화의 마지막 차례 시각부터 센다. 쓰고 있는 대화가 도중에 사라지지 않게 하려는 것이다. [설계]
- 앱은 시작할 때, 켜져 있는 동안 하루 한 번, 사람이 기한을 줄였을 때 기한이 지난 기록을 지운다. 지울 때는 평문
  머리의 시각만 보고 본문을 풀지 않는다. 머리를 읽지 못한 파일은 파일의 수정 시각으로 센다. [설계]
- 머리의 시각이 지금보다 하루 넘게 뒤면(시계가 틀렸던 때 쓴 것) 기한이 지난 것으로 보고 지운다. 그대로 두면
  시계가 그 시각을 지날 때까지 기한이 오지 않는다. [설계]
- 기한을 줄이면 설정 화면은 바꾸기 전에 지워질 대화 수를 보인다. [설계]

### 지우기

- **대화 하나:** 목록에서 지운다. 그 대화가 열려 있으면 채널을 닫고 파일을 지운다. [설계]
- **모두:** 설정의 "모든 대화 기록 지우기" 다. 열린 채팅 채널을 닫고 기록 키를 먼저 지운 뒤 파일을 모두 지운다.
  파일을 지우다 멈춰도 남은 파일은 이미 읽을 수 없다. [설계]
- 시작할 때 키가 없고(`errSecItemNotFound`, -25300) 파일이 있으면 그 파일을 지운다. 읽을 수 없는 파일이기
  때문이다. 키를 읽다 다른 오류(잠김 `errSecInteractionNotAllowed` -25308, 권한 항목 없음
  `errSecMissingEntitlement` -34018 등)가 나면 아무것도 지우지 않는다. [설계]
- API 키를 지워도 기록은 남는다. 그 제공자의 기록은 키를 다시 넣을 때까지 읽기만 된다. [설계]
- 지우기 확인은 되돌릴 수 없다고 적는다. 지운 파일의 블록은 바로 덮이지 않을 수 있고 로컬 스냅숏에 남을 수
  있지만, 둘 다 암호문이다. [설계; 추론]

### 동의와 안내

- "개인정보" 의 첫 차례 전 확인에 한 줄을 더한다: "대화는 이 Mac 에 암호화해 마지막 대화 뒤 N일 보관됩니다"(N 은
  그때의 설정 값). [설계]
- 자세한 것(무엇이 저장되는지, 어디에, 백업 제외와 로컬 스냅숏, 기한과 지우는 법)은 "?" 뒤에 둔다. 설명으로
  화면을 덮지 않는다. [소유자 결정 6; 설계]

### 로그

- 기록의 내용과 제목, 기록 키, 기록 id 와 파일 이름은 로그에 남기지 않는다. 남기는 것은 기록 수, 지운 수, 바이트
  수, 걸린 시간, 오류 이름과 `OSStatus` 다. 예: `info [app:history:prune] deleted=2 kept=5`. [설계]
- 계약 §12 의 "남기면 안 되는 값" 에 기록 내용, 기록 키, 기록 id 를 더한다. 기록 파일의 절대 경로는 홈 경로가 든
  경로라 이미 금지다. [설계; 계약 §12]
- `state`·`resume` 프레임은 다른 채팅 프레임처럼 바이트 수로만 적는다("코어로 넘기기"). [설계]

### Spotlight 와 다른 프로세스

- 암호문 `.sherpachat` 을 `mdimport -t -d3` 에 넣어 보니 동적 형식(`dyn.…`)으로 읽혀 가져오기 플러그인이
  없었고("no plugIn"), 파일 시스템 속성 27개만 나왔으며 `kMDItemTextContent` 가 없었다. 같은 글을 담은 `.txt` 는
  RichText 가져오기가 글을 뽑았다. [실측]
- 내용이 암호문이므로 이 형식을 읽는 가져오기가 생겨도 뽑을 글이 없다. 파일 이름에도 내용이 없다. [추론]
- 같은 사용자의 다른 프로세스는 파일을 복사할 수 있지만 키 없이는 풀지 못한다. 키는 App ID 그룹의 항목이라
  Sherpa.app 만 읽는다("키"). 다른 사용자는 0700 폴더를 지나지 못한다. [추론; 계약 §3]

## 비용과 모델 선택

- 사람이 자기 키를 쓴다. Sherpa 는 중계 서버나 계정을 두지 않고, 비용은 사람의 제공자 계정에 붙는다. [설계]
- 모델 목록은 코어가 같은 출처의 목록 끝점에서 받는다(`list_models`). [설계]
  - Anthropic `GET /v1/models`: `lifecycle` 으로 거를 수 있고 기본은 active 와 deprecated 를 준다. 결정 7 에
    따라 active 만 받는다. [문서: [List Models](https://platform.claude.com/docs/en/api/models/list)]
  - OpenAI `GET /v1/models`. [문서: [List
    models](https://developers.openai.com/api/reference/resources/models/methods/list)] 채팅에 쓸 수 없는 모델도
    섞여 있다. id 로 짐작해 거르지 않고, 고른 모델이 거절되면 그 오류를 보인다. [설계]
  - Google `GET /v1beta/models`. [문서: [Models](https://aistudio.google.com/api-reference/models)] 문서의 예는
    키를 `?key=` 에 싣지만 코어는 `x-goog-api-key` 머리말로만 보낸다. 키가 URL 에 남지 않게 하려는 것이다.
    [설계]
  - OpenAI 호환: `/models` 는 서버마다 있을 수도 없을 수도 있다. [추론] 있으면 쓰고, 없으면 사람이 id 를 적는다.
    [설계]
- 고른 모델 id 는 제공자마다 앱 defaults 에 둔다. Sherpa 는 기본 모델을 박아 두지 않는다. 모델은 바뀌고 물러나기
  때문이다. [설계]
- `done` 의 토큰 수를 차례마다 보인다. 가격은 보이지 않는다. Sherpa 가 사람의 요금제를 알 길이 없다. [설계]
- Anthropic 에는 지시문과 도구 정의에 캐시 제어(`cacheControl`)를 단다. 둘은 차례마다 같다. 모의 서버가 받은
  요청 몸에 캐시 제어가 실렸다. [실측] 한 차례의 비용 상한은 단계 한도 N 이 정한다. [설계]

## 메모리와 크기

저장소 밖 버리는 시험에서 MCP 서버를 띄운 대기 코어를 `bun build --compile`(Bun 1.4.4, arm64, hardened runtime
없음)로 빌드해 잰 값이다. 다섯 번 잰 중앙값이다. [실측]

| 빌드 | 실행 파일 | 대기 RSS | 실제 점유 |
| --- | --- | --- | --- |
| 기준(MCP 서버) | 89.94 MB | 30.3 MB | 14 MB |
| + `ai` 와 Anthropic | +1.06 MB | +6.2 MB | +4 MB |
| + `ai` 와 네 제공자 | +1.96 MB | +11.0 MB | +6 MB |
| + 네 제공자와 `@ai-sdk/mcp` | +2.06 MB | +12.5 MB | +8 MB |
| 네 제공자를 `import()` 로 늦게 싣기, 싣기 전 | +2.03 MB | +4.4 MB | +2 MB |
| 같은 빌드, 실은 뒤 | — | +9.6 MB | +7 MB |

- 코어는 `ai` 와 그 차례의 제공자를 첫 요청 때 `import()` 로 싣는다. 채팅을 쓰지 않는 사람의 대기 예산은 실제
  점유 +2 MB, 실행 파일 +2 MB 다. 실행 파일은 `sherpa` 명령과 같은 파일이므로 명령도 2 MB 커진다. [설계]
- 대화는 채널마다 코어 메모리에 쌓인다. 채팅마다 대화 크기 한도를 두고, 넘으면 그 채팅을 끝내고 새 채팅을
  권한다. 값은 구현 이슈에서 정한다. [설계]
- hardened runtime 은 JIT 를 막아 MCP 탐침의 실제 점유를 22.7 → 16.5 MB 로 낮췄다(ADR-0010 실측). 채팅 빌드의
  hardened runtime 값, Bun 1.4.5 값, 긴 대화의 증가는 재지 않았다. [미확인]

## 실측

2026-11-21~22, 저장소 밖 버리는 시험이다. 모의 제공자는 127.0.0.1 의 평문 HTTP 서버이고 키는 가짜 값이다. 유료
API 는 부르지 않았다. 판은 "맥락" 의 npm 최신 판이다. 대화 기록 줄(정정 2026-11-22)은 2026-11-22 에 macOS 27.3,
Swift 6.4.2 로 버리는 폴더에서 잰 것이고, 키체인과 Time Machine 백업은 쓰지 않았다.

| 확인한 것 | 결과 |
| --- | --- |
| Anthropic 도구 왕복 | 2단계, 끝난 까닭 `stop`(원래 값 `tool_use` → `end_turn`). 요청 몸에 `fallbacks: "default"`, `output_config.effort`, adaptive thinking, 캐시 제어가 실렸고, 2단계 요청이 thinking 서명을 되돌려 보냈다 |
| 거절 | 끝난 까닭 `content-filter`, `stopDetails` 가 있다 |
| 모델 요청 중 중단 | `abort` part. 모의 서버가 연결 닫힘을 봤다 |
| 도구 중 중단 | 도구가 받은 신호가 울렸고 다음 모델 요청이 나가지 않았다 |
| 도구 승인 | `tool-approval-request` part, 끝난 까닭 `tool-calls`, 1단계 |
| OpenAI Responses, OpenAI 호환 | 도구 왕복 성공. OpenAI 도구는 `strict: false` 로 나갔다 |
| Google | 재지 않았다 |
| Bun `redirect: "error"` | Bun 1.4.4·1.4.5 에서 다른 서버로 가는 307 과 상대 302 를 모두 `TypeError`(`UnexpectedRedirect`)로 거부. 리디렉트 대상은 요청을 받지 않았다(정정 2026-11-22, #64: 처음에는 1.4.4 의 거부만 적었다) |
| 도구 스키마 | 35개, 43,871자, `$schema` 35개, 정수 경계 쌍 145개 |
| 크기와 메모리 | "메모리와 크기" 표 |
| 대화 기록: 백업 제외 표시 | 폴더에 `isExcludedFromBackup` 을 달자 xattr `com.apple.metadata:com_apple_backup_excludeItem` 이 생겼고, `tmutil addexclusion` 이 쓴 61바이트 값과 같았다. 표시한 폴더 안 새 파일은 참, 밖으로 옮기면 거짓 |
| 대화 기록: `tmutil isexcluded` | `/private/tmp` 아래는 표시와 관계없이 모두 `[Excluded]`. 표시의 효과를 가르지 못했다 |
| 대화 기록: 파일 쓰기 | `Data.write(.atomic)` 은 0644 이고, 다시 쓰면 파일의 표시가 없어졌다. `O_CREAT`·`O_EXCL` 0600, `fsync`, `rename` 은 0600 |
| 대화 기록: AES-GCM | 평문 1,000바이트가 1,028바이트, 다른 AAD 는 `authenticationFailure` |
| 대화 기록: Spotlight | 암호문 `.sherpachat` 은 가져오기 플러그인 없음, 속성 27개, `kMDItemTextContent` 없음. `.txt` 는 글을 뽑았다 |

## 위험

1. **실패 영역:** 채팅과 MCP 가 한 프로세스에 있다. 채팅 쪽의 처리되지 않은 거부나 메모리 폭주가 코어를 끝내면
   MCP 연결도 끊기고, 대화형 Claude Code 는 사람의 Reconnect 를 부른다(계약 §7.8). 세션 경계에서 모두 잡고 대화
   크기 한도를 둔다. 그래도 문제가 되면 "되돌리기" 2 로 간다.
2. **프롬프트 주입:** 도구 결과(남이 보낸 메일·메시지)에 심은 지시가 모델을 움직여 다른 도구를 부르게 할 수
   있다. 삭제·보내기는 앱 창이 막지만 만들기·고치기는 확인이 없다. 바깥으로 내보내는 길은 보내기 도구(창 확인)와
   사람이 누르는 링크뿐이 되게 한다. [추론]
3. **도구 스키마 호환:** Gemini 가 도구 스키마의 일부(`oneOf`, `const` 등)를 어떻게 받는지 재지 않았다. OpenAI
   는 함수 호출 안내에서 "Aim for fewer than 20 functions" 를 권한다(권고). 1판은 35개를 모두 보내고 정확도는
   실기로 본다. [문서: [Function calling](https://developers.openai.com/api/docs/guides/function-calling), "this
   is just a soft suggestion"; Gemini 쪽은 미확인]
4. **키 노출:** 키는 코어 메모리, 파이프의 프레임, 오류 객체를 지난다. 위 로그 규칙과 시험으로 막는다. JS
   문자열은 지울 수 없으므로 차례가 끝나면 참조만 놓는다.
5. **확인 창과 채팅 입력:** 채팅 창에 글을 치는 중에 확인 창이 뜨면 키 입력이 창으로 간다. 창은
   `makeKeyAndOrderFront` 로 앞에 오고 1초 뒤에야 눌리며, Escape 는 Decline 이고 Allow 에는 단축키가 없다.
   [코드: `apple/sherpa-app/App/ConfirmationWindows.swift` 14·73·152행] 한글 입력 조합 중의 Return 과 키보드
   탐색을 켠 경우의 Space 는 재지 않았다. [미확인]
6. **AI SDK 변화:** `ai` 7.x 는 패치 판이 잦다(7.0.179). 판을 정확히 고정하고 폐기 예정 경고 시험으로 잡는다.
   패키지 안 문서와 실행 소스가 어긋날 수 있으므로 동작은 소스와 시험으로 확인한다.
7. **프로필·공증·권한 이어짐:** 프로필과 `com.apple.application-identifier` 를 더한 빌드가 공증을 통과하는지,
   기존 Calendar·Reminders·Apple Events·전체 디스크 접근 허락이 이어지는지 재지 않았다. ADR-0010 은 같은
   식별자면 허락이 이어진다고 쟀다(프로필 없는 빌드). [미확인]
8. **비용:** 도구 루프는 한 차례에 모델 요청을 여러 번 낸다. 단계 한도와 토큰 수 표시로 드러낸다.
9. **프록시와 TLS:** Bun 의 `fetch` 가 macOS 시스템 프록시와 사람이 더한 루트 인증서를 따르는지 재지 않았다.
   앱은 코어에 `HTTPS_PROXY` 같은 환경을 넘기지 않는다(계약 §7.1). 회사망에서 실패할 수 있다. [미확인]
10. **기록에 남는 남의 내용:** 대화 기록에는 도구가 읽은 메일·메시지 본문이 든다. 이 Mac 의 로그인 세션을 쥔
    사람은 앱 화면으로 그것을 본다. 디스크·백업·로컬 스냅숏의 사본은 암호문이고 키는 이 기기의 Sherpa.app 만
    읽는다. 보관 기한과 지우기로 남는 기간을 줄인다. [추론; 설계]
11. **기록 이어 쓰기 실패:** Sherpa 판이 바뀌어 지시문·도구가 달라지면 Anthropic 은 reasoning 을 빼고 잇고, 다른
    제공자는 그대로 보낸다. 제공자가 거절하면 그 대화는 읽기 전용이 된다. 실제 API 로는 재지 않았다. [미확인]
12. **기록 상태 형식의 변화:** AI SDK 판을 올리면 `providerOptions` 의 이름이나 part 모양이 바뀌어, 옛 상태가
    검사를 통과하지 못하거나 되돌려 보낼 값을 잃을 수 있다. 판을 올릴 때 저장한 상태의 시험 자료로 본다.
    `sherpa.chat.state.v1` 을 바꾸면 옛 기록은 읽기 전용이 된다. [설계]
13. **기록 상태 크기:** 도구 결과가 많은 대화는 4 MiB 에 빨리 닿는다. 채팅의 도구 결과 한도와 대화 크기 한도로
    막고, 닿기 전에 새 채팅을 권한다. [설계]
14. **시계와 보관 기한:** 시계가 크게 틀리면 기한이 일찍 오거나 늦게 온다. 하루 넘게 미래인 기록은 지운다.
    [설계]

## 되돌리기

1. 채팅을 빼려면 `chat/` 와 앱의 채팅 화면을 지우고 정적 검사를 "`fetch` 없음" 으로 좁힌다. 그러면 ADR-0010 결정
   2 가 글자 그대로 돌아온다. mux 2 는 채널 종류가 `mcp` 하나인 채로 남겨도 된다.
2. 실패 영역이 문제가 되면 채팅을 두 번째 코어 프로세스로 옮긴다. 대기 실제 점유가 한 벌(기준 14 MB, hardened
   runtime 이면 더 작다) 더 든다. 채팅 메시지는 그대로 쓴다.
3. 제공자는 하나씩 뺄 수 있다. 패키지 하나와 "제공자 면" 표의 줄 하나다.
4. 대화 기록을 빼려면 앱의 기록 저장소와 화면, `state`·`resume` 를 지우고, 앱이 다음 시작 때 기록 키와 `chats/`
   를 지우게 한다. 코어는 디스크에 쓴 것이 없으므로 지울 것이 없다. 아키텍처의 예외 문장도 함께 지운다.

## 남은 결정

두 결정은 2026-11-22 에 소유자가 정했다(맨 위 정정). 아래 근거는 정하기 전의 권고이고 그대로 둔다(정정
2026-11-22: 두 항목에 처음에는 "소유자 결정 대기" 로 적었다).

1. **OpenAI 호환의 로컬 서버(`http://localhost` 등)를 받을지.** 소유자가 정했다: 받지 않는다(https 만). 권고와
   같다.
   - 결정 3 의 문구가 "HTTPS 뿐" 이다.
   - 루프백 포트는 같은 Mac 의 아무 사용자·프로세스가 먼저 잡을 수 있고, TLS 가 없으면 서버가 누구인지 확인할
     길이 없다. 그 서버로 메일·메시지 내용과 키가 간다. [추론]
   - Ollama 는 VRAM 24 GiB 아래에서 기본 문맥이 4k 토큰이다. [문서: [Ollama Context
     length](https://docs.ollama.com/context-length)] 35개 도구 정의(추정 11~15K 토큰)가 들어가지 않는다. [추론]
   - 나중에 따로 표시한 모드(루프백 한정, 키 없음)로 더할 수 있고, 지금 받았다가 빼는 것보다 쉽다.
2. **대화 기록을 디스크에 저장할지.** 소유자가 정했다: 저장한다. 권고(저장하지 않는다)와 반대이고, 설계는 "대화
   기록" 이다.
   - 아키텍처의 "never retains message or mail bodies in a long-lived content archive" 와 맞다.
   - 대화에는 남이 보낸 메시지와 메일 내용이 들어 있다.
   - 저장하려면 암호화, 보관 기한, 지우기 화면, 백업 제외를 함께 정해야 한다.
   - 나중에 더하기는 쉽고, 이미 저장한 것을 거두기는 어렵다.

## 소유자가 할 일

1. Apple Developer 에서 명시 App ID `dev.xiyo.sherpa` 를 등록하고(있으면 그대로 쓴다), 그 App ID 의 Developer ID
   provisioning profile 을 만들어 빌드하는 Mac 에 둔다. 구현 단계 3 이 이것을 기다린다.
2. "남은 결정" 두 가지를 정한다. 2026-11-22 에 정했다(맨 위 정정).
3. 구현 뒤 유료 실기: 네 제공자마다 실제 키로 차례, 도구 왕복, 중단, 삭제·보내기 확인 창을 보고, Anthropic
   2026-10-21 판, Google Interactions 의 도구 스키마, `lsof` 로 본 연결을 기록한다. 앱을 다시 띄운 뒤 저장한
   대화를 이어 쓰는 것도 본다(정정 2026-11-22).
4. 대화 기록의 기본 보관 기한 30일과 고르는 값 1·7·30·90일을 확인한다. 이 ADR 이 고른 값이다("대화 기록" 의
   "보관 기한").

## 구현 단계

나중에 이슈로 나눌 단위이고, 앞 단계가 뒤 단계의 바탕이다.

1. **계약 다음 판:** mux 2 와 `open` 의 채널 종류, `sherpa.chat.v1` 메시지와 한도, 키 규칙, §7.1 의 소켓 문장,
   §2 의 첫 화면과 권한 항목 표, §7.6·§9 의 MCP 스위치가 중계 채널만 닫는 것, §9 의 `client` `sherpa-chat`, §12
   의 채팅 로그 규칙, §13 의 시험 층.
2. **코어 나가는 길 경계와 정적 검사:** AI SDK 코드보다 먼저 들어간다. 전역 `fetch` 거부, 지킨 `fetch`, 금지한
   가져오기와 API, 빌드한 코어의 듣는 소켓 시험.
3. **앱 키 저장소와 프로필:** data protection keychain 저장소, 프로필 담기와 권한 항목, 게이트의 권한 항목 검사
   고침. 소유자의 프로필을 기다린다.
4. **코어 채팅 경계:** 네 제공자, 도구 어댑터와 호출 수명 모듈 분리, 스트리밍, 중단, 경고 시험, 모델 목록, 늦게
   싣기, Bun 1.4.5·hardened runtime 에서 크기와 메모리 다시 재기. 단계 2 가 남긴 문자열 모델 id 검사("코드로
   지키기" 3)와 차례를 보내는 stdio 시험("시험으로 지키기")도 여기서 넣는다(정정 2026-11-22, #64).
5. **앱 채팅 화면:** 첫 화면의 두 타일, 동의, 제공자·모델 고르기, 원격 자원 없는 마크다운, 한글 입력, 확인
   창과의 포커스.
6. **통합과 실기:** 소유자 유료 실기, 실측 기록, 아키텍처·계약 갱신.

이슈는 단계 1 의 #63 부터 단계 6 의 #68 까지다. 대화 기록이 더하는 것은 아래다. 단계 1(#63)과 2(#64)에는 더하는
것이 없다. 채팅 메시지 `sherpa.chat.v1` 은 단계 4 가 계약에 싣는다(#63 본문).

- **단계 3, #65:** 기록 키 항목의 만들기·읽기·지우기와, `errSecItemNotFound` 와 다른 오류를 가르는 처리. API
  키와 같은 저장소 모듈이고, 시험은 메모리 안 저장소로 돈다.
- **단계 4, #66:** `sherpa.chat.v1` 의 `state`·`resume` 와 `chat_state_invalid`·`chat_state_mismatch`, 상태
  봉투와 지문, 끝난 단계만 넣기와 거절 단계 빼기, Anthropic 의 reasoning 빼기, 상태 크기와 대화 크기 한도,
  상태에 키가 없다는 시험, 계약 §7.4·§12 고침.
- **단계 5, #67:** 앱의 기록 저장소(AES-GCM, 파일 배치, POSIX 쓰기, 폴더 검사, 백업 제외), 목록·이어 쓰기·읽기
  전용, 보관 기한 설정과 기한 지우기, 지우기 화면, 동의의 보관 줄, 실제 `chats/` 에서 `tmutil isexcluded`, 계약
  §3 의 `chats/`.
- **단계 6, #68:** 네 제공자에서 저장한 대화를 이어 쓰는 실기(같은 판, 지시문·도구가 바뀐 판), 앱을 다시 띄운 뒤
  이어 쓰기, Time Machine 백업에서 `chats/` 가 빠지는지.

## 아직 확인 전

- Google Interactions 경로 전체(도구 왕복, 스키마 호환, `store: false`).
- 실제 Anthropic API 가 AI SDK 의 요청을 `anthropic-version: 2026-10-21` 로 받는지. 받지 않으면 SDK 기본
  판(2023-06-01)으로 물러설지 소유자에게 묻고, 답을 이 ADR 에 정정으로 단다.
- 프로필이 없을 때 data protection keychain 이 -34018 로 거부하는지.
- 코어와 중계가 앱의 App ID 그룹 항목을 읽지 못하는지(문서에서 끌어냈고 재현하지 않았다).
- hardened runtime 과 Bun 1.4.5 에서의 크기와 메모리, 긴 대화의 메모리.
- 35개 도구 정의의 실제 토큰 수.
- 시스템 프록시와 사람이 더한 루트 인증서, 이름 풀이가 시스템 해석기를 거치는지. (정정 2026-11-22, #64: 처음에는
  Bun 1.4.5 의 `redirect: "error"` 도 적었다. "코드로 지키기" 2 에서 닫았다.)
- 프로필을 더한 빌드의 공증과 기존 권한 허락의 이어짐.
- 확인 창이 채팅 입력 중에 뜰 때의 키 입력(한글 조합 중 Return, 키보드 탐색의 Space).
- 대화 기록: 실제 `~/Library/Application Support/Sherpa/chats/` 에서 `tmutil isexcluded` 가 `[Excluded]` 를
  내는지, Time Machine 백업에서 실제로 빠지는지.
- 대화 기록: 로컬 스냅숏이 백업 제외 항목도 담는지(추론), 다른 백업 도구가 그 표시를 따르는지.
- 대화 기록: 네 제공자에서 저장한 상태로 이어 쓰기. 지시문·도구가 바뀐 뒤 Anthropic 이 reasoning 을 뺀 요청을
  받는지, OpenAI·Google·OpenAI 호환이 이어진 사람 메시지를 받는지.
- 대화 기록: 화면이 잠긴 동안 `WhenUnlockedThisDeviceOnly` 기록 키를 읽을 수 있는지(앱은 처음 읽은 키를 메모리에
  둔다).
- 대화 기록: AI SDK 가 OpenAI 요청에 더하는 옛 `include` 값을 끌 수 있는지.

## 검토한 대안

- **앱(Swift)이 제공자를 직접 부르기:** 도구 루프와 35개 도구 어댑터를 Swift 로 다시 짜야 한다. 소유자가 코어와
  AI SDK 로 정했다.
- **두 번째 코어 프로세스:** 실패 영역은 나뉘지만 대기 메모리를 한 벌 더 쓰고 감독이 둘이 된다. "되돌리기" 2 로
  둔다.
- **채널 0 에 채팅 요청 종류 더하기:** 채팅마다 닫기와 흐름 제어를 할 단위가 없다.
- **MCP 자기 루프(`@ai-sdk/mcp`):** "MCP 를 자기 자신에게 되돌려 거는 방식은 뺐다" 를 보라.
- **AI SDK 도구 승인:** "확인 흐름" 을 보라.
- **제공자 SDK 를 직접 쓰기(`@anthropic-ai/sdk` 등):** 소유자가 AI SDK 로 정했고, 네 제공자를 한 면으로 다룬다.
- **파일 기반 키체인, 코어가 키체인을 직접 읽기:** "키" 를 보라.
- **대화 기록을 코어 SQLite 에 두기:** "대화 기록" 의 "누가 저장하나" 를 보라.
- **대화마다 키:** 지운 대화의 남은 사본(덮이지 않은 블록, 로컬 스냅숏)까지 못 읽게 한다. 대신 키체인 항목이
  대화 수만큼 늘고, 목록을 그릴 때마다 항목을 읽어야 한다. 남는 사본은 암호문이고 키는 Sherpa.app 만 읽으므로
  1판은 키 하나로 둔다.
- **보이는 대화만 저장하기:** 이어 쓸 수 없다. thinking·reasoning 과 도구 결과를 잃는다.
- **도구 결과를 빼고 저장하기:** 남는 남의 내용은 줄지만 앞부분이 바뀐다. Anthropic 은 그 뒤 thinking 을 모두
  빼야 하고, Google 은 thought 를 고치지 말라고 하며, 모델이 앞서 읽은 내용도 잃는다.
- **옛 지시문·도구를 상태에 담아 그대로 다시 보내기:** 앞부분 검사는 피하지만, 옛 도구 스키마가 지금의 핸들러와
  어긋날 수 있다.
- **저장 끄기 선택지:** 소유자 결정이 저장이므로 1판에 두지 않는다. 사람은 1일을 고르거나 지울 수 있다.
- **`Data.write(.atomic)`:** 0644 로 만들고 백업 제외 표시를 지웠다("대화 기록" 의 "위치와 쓰기").

## Related

- [ADR-0008: Bun + TypeScript 코어](0008-bun-typescript-core.md)
- [ADR-0010: 메뉴 막대 앱과 MCP](0010-menu-bar-app-and-mcp.md)
- [ADR-0011: MCP 는 2026-07-28 만 받는다](0011-mcp-2026-07-28-only.md)
- [앱 연결 계약](../contracts/app-connection-v1.md)
- [아키텍처](../architecture/README.md)
