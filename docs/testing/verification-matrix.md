---
uuid: 0b02f9a4-1122-4ce1-917c-15c4a58cace6
type: spec
audience: "요구사항별 결정적·실기 검증 상태를 대조하는 유지보수자와 에이전트"
goal: "현재 Bun 코어·Swift 헬퍼·Sherpa.app·MCP 구조에 맞춰 각 요구사항의 실제 검증 근거를 추적한다"
tone: "규범적 영문 표에 한국어 재검증 메모를 얹는다"
manner: "실재하는 구현·시험·실기 근거만 적고 비어 있는 증명은 숨기지 않는다"
---

# Sherpa Requirement Verification Matrix

> **재검증 결과 (2026-11-23, bunny-holes/sherpa#33).** 아키텍처가 Bun + TypeScript 코어(`core/`),
> Swift Apple 헬퍼(`apple/eventkit-service`), Developer ID 서명 메뉴 막대 앱과 중계
> (`apple/sherpa-app`, ADR-0008·0009·0010), MCP 2026-07-28 전용(`core/src/mcp/`, ADR-0011),
> 앱 안 채팅 코어 경계(`core/src/chat/`, ADR-0012)로 자리 잡은 상태에 맞춰 옛 `.rs`·`probes.rs`
> 근거와 배포 행을 고쳤다.
>
> - 코어 단위·stdio 시험은 `core/tests/` 와 `core/tests/stdio/`(`bun run test`, `bun run test:stdio`),
>   앱·중계·다중화·서명 확인 시험은 `apple/sherpa-app/Tests/`, 헬퍼·프로토콜 시험은
>   `apple/worker-protocol/Tests/`·`apple/eventkit-service/Tests/`, 플러그인 검사는
>   `plugins/sherpa/scripts/check.sh`, 번들 서명과 Homebrew 스모크 설치는
>   `scripts/check-all.sh` 와 `scripts/check-release.sh` 가 돌린다.
> - 앱 연결 계약([app-connection-v1.md](../contracts/app-connection-v1.md))의 세부 결정적·실기
>   증거는 계약 §13·§16 과 [live-evidence.md](live-evidence.md) 에 둔다.
> - 옛 Rust 제어 평면 시절에 사라진 기능·증거(`FR-PA-006`, `FR-CX-004` 등)는 새로 증명되기 전까지
>   `D stale` 또는 `D pending` 으로 유지한다.

> **이전 재검증 (2026-08-27 / 2026-09-21).** Rust 제어 평면에서 Swift 로 옮겨가며 사라진
> `probes.rs` 기반 근거 25 개를 `D stale` 로 낮췄고, `apple/foundation-models-service` 를
> 가리키던 3 행(`FR-CX-009`·`FR-CX-016`·`SR-CX-010`)은 CLI 진입점이 없어 `product path pending`
> 으로 유지했다(패키지는 승인된 계약 둘의 유일한 구현이라 보존, `docs/roadmap/README.md` Phase 2).

## Meaning of status

- `D`: deterministic implementation and synthetic evidence required by `scripts/check-all.sh`.
- `L`: owner-operated evidence from a real local build, following
  [live validation](live-validation.md) and recorded in [live evidence](live-evidence.md).
- `ready` means the implementation and deterministic test exist. `pending`
  means Sherpa deliberately waits for the owner to grant access, select data,
  invoke a model, or open a marketplace profile. `stale` means the row still
  needs new deterministic evidence after the runtime migrations.

The live column is not a second implementation backlog. It is evidence about
TCC state, the current macOS/private framework, personal source availability,
or current marketplace behavior that cannot be manufactured by a deterministic
test.

## Planner Authority

| Requirement | Implementation evidence | Deterministic evidence | Status |
| --- | --- | --- | --- |
| `FR-PA-001` | Planner port in [port.ts](../../core/src/planner/port.ts) and [helper-process.ts](../../core/src/planner/helper-process.ts); in-process app dispatch in [InProcessPlanner.swift](../../apple/sherpa-app/Sources/SherpaAppPlanner/InProcessPlanner.swift); EventKit dispatch in [EventKitWorker.swift](../../apple/eventkit-service/Sources/SherpaEventKitAdapter/EventKitWorker.swift) | [planner-schemas.test.ts](../../core/tests/planner-schemas.test.ts), `apple/worker-protocol` and `apple/eventkit-service` Swift tests, and `core/tests/stdio/` | D ready |

| `FR-PA-002` | Occurrence-aware event locator and full snapshot mapping in [EventLocator.swift](../../apple/eventkit-service/Sources/SherpaEventKitAdapter/EventLocator.swift) and [Snapshot.swift](../../apple/eventkit-service/Sources/SherpaEventKitAdapter/Snapshot.swift) | Event locator round-trip tests plus application detail-preservation test in `apple/eventkit-service/Tests/` | D ready; [L verified](live-evidence.md) |

| `FR-PA-003` | Calendar create/update/move/delete, alarm, and recurrence use cases and EventKit adapter; source-owned verification can create and remove its own disposable Calendar; read-back recognizes Foundation's `UTC`→`GMT` canonicalization without weakening non-UTC zone identity | Domain combination and UTC-alias tests, Swift parser tests, application read-back tests, safe-reference destination lifecycle tests, and owner-gated schedule-aware CRUD verifier | D ready; [L verified v4](live-evidence.md) |

| `FR-PA-004` | Explicit `EventSpan` validation and wire mapping in `apple/eventkit-service` and [port.ts](../../core/src/planner/port.ts) | Occurrence locator and command validation tests | D ready; [L verified with future span](live-evidence.md) |

| `FR-PA-005` | Reminder list/detail/create/update/move/complete/reopen/delete plus alarm and recurrence use cases and EventKit adapter; source-owned verification can create and remove its own disposable Reminder list; ReminderDate read-back shares the strict UTC-link canonicalization rule | Filter, duplicate/limit/malformed output, schedule and date-component validation/read-back, UTC-alias, safe-reference destination lifecycle, protocol, and owner-gated schedule-aware CRUD verifier tests | D ready; [L verified v4](live-evidence.md) |

| `FR-PA-006` | Isolated private helper (`SherpaReminderKitShim`) and private Reminder application service; section assignment resolves only an existing section and cannot create list structure | Swift unit tests in `apple/eventkit-service/Tests/`; release-process probe suite from the retired Rust control plane has not been rebuilt end-to-end | D stale — private write-disabled process probes need re-verification on the current helper |

| `FR-PA-007` | Per-capability state and verification in `SherpaPlannerApplication` and `SherpaPlannerContract`, keyed by macOS plus helper implementation revision, with classified provider failures and separate write/read evidence types | Exact-environment/revision, no-probe-on-invalid-environment, stale-helper rejection, persisted timestamp, report normalization, and evidence-store failure tests in `apple/eventkit-service/Tests/` | D ready; [L all six verified for v8 environment](live-evidence.md) |

| `FR-PA-008` | Planning types and read-only proposal boundary in `SherpaPlannerApplication` | Context suggestion and workflow tests prove proposals do not mutate | D ready; L not required |

| `FR-PA-009` | Exact-kind destination validation, pre-claim execution validation, expiring single-use candidate storage, and candidate-level operation/outcome recovery metadata in `SherpaPlannerApplication` | Missing, short, wrong-kind, and legacy-unbound destination rejection plus exact confirmation, expiry, idempotency, single-use, partial-create, and post-mutation finalization-failure tests | D ready; L pending end-to-end |

| `FR-PA-010` | Journaled application mutations in [journal.ts](../../core/src/journal/journal.ts) and `SherpaMutationApplication`/`SherpaJournalStore`, native read-back, and safe affected-reference retention across Calendar, Reminder, private Reminder, and PlanningCandidate partial-create paths | [journal.test.ts](../../core/tests/journal.test.ts) plus journal transition, history-query validation, partial-create recovery, read-back mismatch, and Planning workflow tests in `apple/eventkit-service/Tests/` | D ready; [L public and all private capabilities verified](live-evidence.md) |

| `FR-PA-011` | `MutationOutcome` partial state, separately reported capability-evidence persistence, and no cross-store rollback | Timeout/read-back/private evidence-store failure tests | D ready; [L partial native failures observed and recovered](live-evidence.md) |

| `FR-PA-012` | Versioned JSON projections in `core/src/cli/`, `core/src/mcp/`, and `SherpaPlannerContract` | [planner-schemas.test.ts](../../core/tests/planner-schemas.test.ts), [mcp-tools.test.ts](../../core/tests/mcp-tools.test.ts), and `core/tests/stdio/cli.test.ts`; generic-serialization architecture gate from the retired Rust tree is not present | D stale — no automated ban on generic serialization across all renderers |

| `FR-PA-013` | Reference decorator and store in `SherpaPlannerApplication` | Exact, unique-prefix, zero-match, wrong-kind, and ambiguity tests | D ready; L not required |

| `FR-PA-014` | Public authorization status depends only on EventKit; private state belongs to non-prompting `capabilities` and degradable Planner diagnostics | `apple/eventkit-service/Tests/` and [apple-helper.test.ts](../../core/tests/apple-helper.test.ts); missing-worker degraded CLI doctor matrix needs re-verification on the Bun CLI | D stale — missing-worker degraded doctor matrix needs re-verification |

| `SR-PA-001` | Permission prompts are separated from read-only status checks in `apple/eventkit-service`, `apple/sherpa-app/App/Permissions.swift`, and `core/src/mcp/` | `apple/eventkit-service/Tests/`, `apple/sherpa-app/Tests/`, and bundle Info.plist / signing checks in `scripts/check-all.sh`; explicit aggregate-target CLI rejection probe needs re-verification | D stale — aggregate-target CLI probe needs re-verification |

| `SR-PA-002` | Destructive commands require explicit preview and confirmation (CLI confirmation tokens and `Sherpa.app` channel-bound confirmation windows in [app-connection-v1.md](../contracts/app-connection-v1.md) §9); disposable destination verification for recurring Calendar updates/deletes | `apple/eventkit-service/Tests/`, `core/tests/stdio/serve.test.ts`, `core/tests/stdio/waits.test.ts`, and `apple/sherpa-app/Tests/` | D ready; [L public v4 and private tags verified](live-evidence.md) |

| `SR-PA-003` | Core, `Sherpa.app`, and `sherpa-apple` helper run as bounded process boundaries; `SherpaReminderKitShim` is dynamically isolated; `CoreProcess` and `runner.ts` enforce bounded streams and timeouts | [runner.test.ts](../../core/tests/runner.test.ts), [apple-helper.test.ts](../../core/tests/apple-helper.test.ts), and `apple/sherpa-app/Tests/SherpaAppProcessTests/`; SIGINT descendant-group cleanup probe from the retired Rust CLI needs re-verification | D stale — SIGINT descendant cleanup probe needs re-verification on Bun core |

| `SR-PA-004` | Private write environment gate, selector/scalar-ABI probes, OS-and-helper-revision-scoped evidence, read-back, and explicit `not_recorded` evidence state in `apple/eventkit-service` | Swift unit tests in `apple/eventkit-service/Tests/`; all-six disabled-write process probes need re-verification | D stale — process-level disabled-write probes need re-verification |

| `SR-PA-005` | Safe structured logging (`core/src/log.ts`, `SherpaAppConnection/Log.swift`) omits payloads and native identifiers; `SherpaError` renders only fixed stable codes and remedies | `apple/sherpa-app/Tests/` safe log-token tests and `core/tests/tools-outcome.test.ts`; end-to-end CLI debug-log PII sentinel probe needs re-verification | D stale — end-to-end CLI PII sentinel probe needs re-verification |

| `SR-PA-006` | Application validates titles, notes, URLs, locations, dates, zones, and attachment artifacts | Invalid optional field and artifact tests in `apple/eventkit-service/Tests/` and [mcp-registry.test.ts](../../core/tests/mcp-registry.test.ts) | D ready; L not required |

| `SR-PA-007` | Adapters receive protocol DTOs; canonical SQLite journal (`core/src/journal/journal.ts`, `SherpaJournalStore`) enforces owner-only permissions | [journal.test.ts](../../core/tests/journal.test.ts) and `apple/eventkit-service/Tests/`; symlink/sidecar permission gate from the retired Rust tree needs re-verification | D stale — symlink and sidecar permission tests need re-verification |

| `SR-PA-008` | Partial outcomes are retained; no automatic cross-provider compensation exists | Partial mutation tests and journal assertions in `apple/eventkit-service/Tests/` and [journal.test.ts](../../core/tests/journal.test.ts) | D ready; [L private partial outcomes retained](live-evidence.md) |

## Context Intelligence

| Requirement | Implementation evidence | Deterministic evidence | Status |
| --- | --- | --- | --- |
| `FR-CX-001` | Source-neutral collection and outbound modules under `core/src/imessage/`, `core/src/mail/`, and `core/src/kakaotalk/` | [imessage.test.ts](../../core/tests/imessage.test.ts), [mail.test.ts](../../core/tests/mail.test.ts), [kakaotalk-account.test.ts](../../core/tests/kakaotalk-account.test.ts), [kakaotalk-commands.test.ts](../../core/tests/kakaotalk-commands.test.ts) | D ready |

| `FR-CX-002` | Collection limits and half-open ranges in `core/src/imessage/`, `core/src/mail/`, and `core/src/kakaotalk/` | Bounds, range, keyset cursor, malformed, and oversized tests in `core/tests/` | D ready; L pending |

| `FR-CX-003` | Normalized messages/mail retain text and attachment metadata without exposing raw binary blobs | Domain bounds and source mapping tests in `core/tests/` | D ready; L pending inspection |

| `FR-CX-004` | Core reads native stores read-only without a long-lived content archive (in-app chat history exception in [ADR-0012](../adr/0012-in-app-chat.md)) | Unit tests in `core/tests/imessage.test.ts`, `core/tests/mail.test.ts`, `core/tests/kakaotalk-commands.test.ts`; full fresh-read consumer migration under [RFC-0001](../rfc/0001-context-archive-to-fresh-read.md) remains pending | D pending — fresh-read migration incomplete |

| `FR-CX-005` | In-memory fresh pages and explicit inventory/compact/detail/exact projection; encrypted TTL spill is not yet implemented | Level content-omission and native-identifier privacy tests | D memory path ready; spill pending |

| `FR-CX-006` | Explicit AI/text/TSV/JSON fresh projections include typed coverage and a declared compact UTC time schema | Compact/detail/inventory projection tests; broader golden set pending | D shadow ready |

| `FR-CX-007` | `o200k_base` measurement in Context benchmark service | No tokenizer parity test exists in the current test suites | D stale — no tokenizer parity test exists |

| `FR-CX-008` | Fresh pages assign `E...` run references and project `T...`/`P...` aliases without native IDs; durable candidate-scoped locator replacement remains pending | Application and presentation native-ID sentinel tests | D run scope ready; candidate scope pending |

| `FR-CX-009` | Exact invocation evidence allowlist at the Foundation Models boundary (`apple/foundation-models-service`); model-visible CCT/MCT uses only one-based ephemeral handles; no unbound raw-suggestion CLI ingress | Opaque-ID removal, ordinal restoration, duplicate/out-of-range rejection, CCT/MCT escaping tests in `apple/foundation-models-service/Tests/` | D worker unit tests ready; product path pending — no CLI entry point reaches sherpa-foundation-models; [L legacy KakaoTalk verified](live-evidence.md) |

| `FR-CX-010` | Context handoff service binds user-selected exact destinations outside the model boundary, produces only PlanningCandidates, and returns their references even when later usage persistence fails | Model-selected destination rejection, exact destination injection, atomic handoff, explicit partial-report, and Planning workflow tests | D ready; L pending |

| `FR-CX-011` | Legacy pending indexes remain for rollback; page/range receipts and TTL overlap digests are specified by [RFC-0001](../rfc/0001-context-archive-to-fresh-read.md) | Existing coverage tests ready; no-permanent-irrelevant-receipt tests pending | D migration pending |

| `FR-CX-012` | Readiness and doctor diagnostics separate reader health from source access in `core/src/` | Unit tests in `core/tests/`; full degraded `context doctor` process probe needs re-verification on Bun CLI | D stale — degraded doctor process probe needs re-verification |

| `FR-CX-013` | `context analyze` requires and previews exact destinations and confirmation | No `context analyze` CLI entry point exists in the Bun core yet | D stale — command not yet wired in Bun core |

| `FR-CX-014` | Empty guided-generation proposal array is accepted | No zero-proposal test exists in the current test suites | D stale — no zero-proposal test exists |

| `FR-CX-015` | Evidence-set digest and pre-mutation keyed-fingerprint replacement are specified by the [Fresh Context contract](../contracts/fresh-context-v1.md) | Changed/deleted exact revalidation tests pending | D migration pending |

| `FR-CX-016` | Foundation Models deterministic mapper in `apple/foundation-models-service` resolves all-day/timed dates from selected content, verifies both timed clocks, uses local-calendar half-open all-day ranges, and filters invalid generated siblings with safe rule warnings | Unique-date correction, ambiguous/missing date, missing clock, zero duration, DST, and valid-sibling retention tests in `apple/foundation-models-service/Tests/` | D worker unit tests ready; product path pending — no CLI entry point reaches sherpa-foundation-models; [L legacy date-only KakaoTalk Event verified](live-evidence.md) |

| `FR-CX-017` | Outbound send validation, confirmation, and journaling in `core/src/imessage/send.ts`, `core/src/mail/send.ts`, `core/src/tools/call.ts`, and `core/src/mcp/` | [imessage.test.ts](../../core/tests/imessage.test.ts), [mail.test.ts](../../core/tests/mail.test.ts), [tools-call.test.ts](../../core/tests/tools-call.test.ts), and [serve.test.ts](../../core/tests/stdio/serve.test.ts) | D ready |

| `FR-CX-018` | Mail read/send in `core/src/mail/` and `SherpaMailShim` (`apple/eventkit-service/Sources/SherpaMailShim/`); direct IMAP/SMTP remains a future adapter milestone | [mail.test.ts](../../core/tests/mail.test.ts); Mail shim Objective-C policy release probes need re-verification | D stale — Mail shim policy release probes need re-verification |

| `FR-CX-019` | Outbound sends distinguish `application_accepted` vs `uncertain` and never auto-retry once input reached the sender | [imessage.test.ts](../../core/tests/imessage.test.ts), [mail.test.ts](../../core/tests/mail.test.ts), [tools-outcome.test.ts](../../core/tests/tools-outcome.test.ts), [journal.test.ts](../../core/tests/journal.test.ts) | D ready |

| `FR-CX-020` | Trigger/checkpoint ordering is specified by [ADR-0004](../adr/0004-native-fresh-read-context.md) and [RFC-0001](../rfc/0001-context-archive-to-fresh-read.md) | Duplicate, downtime, epoch-reset, overlap, and receipt-before-checkpoint tests pending | D pending |

| `FR-CX-021` | Fresh-read domain coverage and conservative application inference prevent below-proof and at-limit completeness claims | Count invariant, source-proof, equality-limit, JSON inventory, and live at-limit tests | D shadow ready; wider partial failures pending |

| `FR-CX-022` | Minimal durable state and retention boundary are specified by [ADR-0004](../adr/0004-native-fresh-read-context.md) | Ledger schema, privacy sentinel, TTL, and purge-separation tests pending | D pending |

| `FR-CX-023` | Sherpa-managed staged specialist routing is specified by the [fresh-read design](../design/native-fresh-read-context.md) | No-candidate fan-out, scoped-read, prompt-injection, and budget tests pending | D pending |

| `FR-CX-024` | Reconciliation outcomes and preconditions are specified by the [Fresh Context contract](../contracts/fresh-context-v1.md) | Completed resurrection, recurrence, detached occurrence, duplicate, and stale-mutation tests pending | D pending |

| `FR-CX-025` | Mail header-first measurement and IMAP decision gate are specified by [RFC-0001](../rfc/0001-context-archive-to-fresh-read.md) | Mail batch fixture and p50/p95 benchmark gate pending | D pending |

| `SR-CX-001` | Core commands and MCP tools route iMessage, Mail, and KakaoTalk through their dedicated adapters in `core/src/`; egress lint rules in `core/oxlint.json` keep network access confined to `core/src/chat/egress.ts` | [egress-lint.test.ts](../../core/tests/egress-lint.test.ts), [dependency-network.test.ts](../../core/tests/dependency-network.test.ts), and `core/tests/stdio/egress.test.ts` | D ready |

| `SR-CX-002` | Fixed iMessage/Kakao read, exact-target validation, and text-send adapters in `core/src/`; bounded wake-up watcher path is not yet enabled | Existing command allowlist and sender tests ready; watcher no-model/no-mutation tests pending | D migration pending |

| `SR-CX-003` | Mail status is read-only; Automation prompt requires explicit authorization request (`apple/sherpa-app/App/Permissions.swift` and `SherpaMailShim`) | Read-only status separation needs a dedicated deterministic contract test across Mail shim | D stale — Mail authorization contract test needs re-verification |

| `SR-CX-004` | Content and LLM output remain data-only DTOs with no arbitrary shell port; in-app chat tools go exclusively through the validated MCP tool registry (`core/src/tools/call.ts`) | [chat-tools.test.ts](../../core/tests/chat-tools.test.ts) and [mcp-registry.test.ts](../../core/tests/mcp-registry.test.ts) | D ready; L not required |

| `SR-CX-005` | Bounded streams, timeouts, and failure classification in `core/src/process/runner.ts` and `apple/sherpa-app/Sources/SherpaAppServer/CoreProcess.swift` | [runner.test.ts](../../core/tests/runner.test.ts), `apple/sherpa-app/Tests/`; cross-language minimal-policy release probe needs re-verification | D stale — cross-language policy probe needs re-verification |

| `SR-CX-006` | Boundary logs (`core/src/log.ts`, `SherpaAppConnection/Log.swift`) emit only safe IDs, counts, states, and error kinds | Safe log-token tests in `apple/sherpa-app/Tests/`; end-to-end source-PII stderr sentinel across iMessage/KakaoTalk/Mail needs re-verification | D stale — end-to-end PII stderr sentinel needs re-verification |

| `SR-CX-007` | Owner-only Sherpa data directory (`0700`); encrypted in-app chat history exception in [ADR-0012](../adr/0012-in-app-chat.md) | [journal.test.ts](../../core/tests/journal.test.ts) and `apple/sherpa-app/Tests/`; ephemeral spill expiry/privacy tests pending | D migration pending; [L legacy path verified](live-evidence.md) |

| `SR-CX-008` | Display-name map is separated from default message/mail list responses | Explicit identity-map omission tests | D ready; L pending |

| `SR-CX-009` | Collection paths are read-only; outbound sends require explicit confirmation (`core/src/mcp/`, `core/src/tools/call.ts`) | [mcp-tools.test.ts](../../core/tests/mcp-tools.test.ts), [tools-call.test.ts](../../core/tests/tools-call.test.ts), [serve.test.ts](../../core/tests/stdio/serve.test.ts) | D ready |

| `SR-CX-010` | Tool-free bounded Foundation Models path in `apple/foundation-models-service`; scoped specialist read grants are specified by the [Fresh Context contract](../contracts/fresh-context-v1.md) | Existing evidence allowlist tests ready in `apple/foundation-models-service/Tests/`; scoped-tool and untrusted-content tests pending | D worker unit tests ready; migration and product path pending — no CLI entry point reaches sherpa-foundation-models; [L legacy KakaoTalk verified](live-evidence.md) |

| `SR-CX-011` | Live target directory and final revalidation replacement are specified by [ADR-0004](../adr/0004-native-fresh-read-context.md) | Expiry/change/revalidation tests pending | D migration pending |

| `SR-CX-012` | Public CLI and MCP inputs enforce strict schemas and bounded payload limits (`core/src/cli/`, `core/src/mcp/registry.ts`, `core/src/app/frame.ts`, `apple/sherpa-app/Sources/SherpaAppConnection/MuxFrame.swift`) | [mcp-registry.test.ts](../../core/tests/mcp-registry.test.ts), [app-frame.test.ts](../../core/tests/app-frame.test.ts), `apple/sherpa-app/Tests/` | D ready |

| `SR-CX-013` | Single-use confirmation, safe journal metadata, redacted diagnostics, typed `uncertain` failure, and no automatic retry | [imessage.test.ts](../../core/tests/imessage.test.ts), [mail.test.ts](../../core/tests/mail.test.ts), [tools-call.test.ts](../../core/tests/tools-call.test.ts), [serve.test.ts](../../core/tests/stdio/serve.test.ts) | D ready |

## Distribution and Agent Integration

| Requirement | Implementation evidence | Deterministic evidence | Status |
| --- | --- | --- | --- |
| `FR-DP-001` | Formula renderer in [scripts/package.sh](../../scripts/package.sh) (CLI) and planned notarized cask for `Sherpa.app` (`bunny-holes/sherpa#31`) | [scripts/check-release.sh](../../scripts/check-release.sh) installs the rendered CLI Formula and passes `brew test` | D ready (CLI); cask pending (#31); L owner-operated |

| `FR-DP-002` | Staged archive assertion in [scripts/package.sh](../../scripts/package.sh) (`sherpa` + Developer ID signed `SherpaHelper.app` per [ADR-0009](../adr/0009-developer-id-signed-helper-bundle.md)) | Packager asserts the exact staged tree and refuses unexpected files | D ready |

| `FR-DP-003` | Formula installs the staged binaries directly; no `post_install` | Formula declares no runtime dependency | D ready |

| `FR-DP-004` | Version read back from the built CLI, helper, and app bundle; archive SHA-256 pinned in the Formula | `scripts/package.sh` and `scripts/check-all.sh` verify exact version parity and Bun runtime pin (`scripts/lib/bun-pin.sh`) | D ready |

| `FR-DP-005` | No agent-host installer exists; skills ship from `bunny-holes/plug-hole` (`plugins/sherpa/`) and point agents to `Sherpa.app`'s bundled `sherpa-relay` ([app-connection-v1.md](../contracts/app-connection-v1.md) §2) | [plugins/sherpa/scripts/check.sh](../../plugins/sherpa/scripts/check.sh): `.mcp.json` matches contract §2, and every tool named in skills exists in the core tool registry (`verify_tools.py`) | D ready; [L verified on Claude Code and Codex](live-evidence.md) |

| `FR-DP-006` | Homebrew owns the installed binary; Sherpa owner state lives outside the keg (`~/Library/Application Support/Sherpa/`) | Upgrade and uninstall leave owner state untouched | D pending; L observe only |

| `SR-DP-001` | Developer ID signing for `SherpaHelper.app` ([ADR-0009](../adr/0009-developer-id-signed-helper-bundle.md)) and `Sherpa.app` + `sherpa-relay` + `sherpa-core` ([ADR-0010](../adr/0010-menu-bar-app-and-mcp.md)), superseding the ad-hoc-only policy of [ADR-0005](../adr/0005-unsigned-homebrew-distribution.md); notarized cask release tracked in `#31` | `scripts/check-all.sh` builds and verifies Developer ID `Sherpa.app` bundle signatures and designated requirements | D ready (Developer ID bundle); notarization pending (#31) |

| `SR-DP-002` | Formula contains no agent-host mutation hook and no `post_install`; `Sherpa.app` only displays/copies setup commands (`AgentSetup.swift`) and never edits agent config files | Rendered Formula structure and `AgentSetup` unit tests in `apple/sherpa-app/Tests/` | D ready |

| `SR-DP-003` | Packaging logs carry version, archive path, and checksum only | `[release:package:*]` log fields in [scripts/package.sh](../../scripts/package.sh) | D ready |

| `SR-DP-004` | Staged-tree assertion in [scripts/package.sh](../../scripts/package.sh); plugin absolute-path scan in [plugins/sherpa/scripts/check.sh](../../plugins/sherpa/scripts/check.sh); compiled core ignores `.env`/`bunfig.toml` in CWD | Both refuse to pass on a violation; [build.test.ts](../../core/tests/build.test.ts) and [cli.test.ts](../../core/tests/stdio/cli.test.ts) | D ready |

## Gate commands

The deterministic proof is one command:

```bash
bash scripts/check-all.sh
```

The live proof is intentionally split by phase and must be run from
[the owner-operated runbook](live-validation.md). No row may be changed from
`L pending` based only on a synthetic test or a non-prompting status command.

## Related

- [Roadmap](../roadmap/README.md)
- [Planner requirements](../requirements/planner-authority.md)
- [Context requirements](../requirements/context-intelligence.md)
- [Distribution requirements](../requirements/distribution.md)
- [App connection contract](../contracts/app-connection-v1.md)
- [Test strategy](README.md)
