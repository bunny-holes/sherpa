---
uuid: 01a1f7c1-1209-7413-b147-de5060ddbf48
type: adr
audience: "Sherpa 의 서명·배포 구성이나 macOS 권한 동작을 바꾸거나 다시 보는 사람"
goal: "Apple 헬퍼가 왜 Developer ID 로 서명한 앱 번들이고, 그것이 무엇을 실측해 정했는지 확인하게 한다"
tone: "평어체. 소유자 결정, 실측, 추론을 가른다"
manner: "결정 본문은 고치지 않고 바뀐 사실은 정정으로 덧붙인다"
---

# Apple 헬퍼는 Developer ID 로 서명한 앱 번들이다

ADR-0005 와 ADR-0001 의 "Developer ID·유료 멤버십·Team ID 는 영구 제외" 를 이 결정이 대체한다.
Homebrew 로 배포한다는 결정, 공증·App Store·Apple 검증 개발자 표시를 하지 않는다는 결정은 그대로다.

## 맥락

2026-11-20 소유자 실측 중, 0.8.x 헬퍼(ad-hoc 서명, `libexec/sherpa-apple`)에 대해 macOS 가 Calendar·
Reminders 권한을 계속 다시 물었다. 같은 날 이 Mac 에서 확인한 사실:

| 조건 | 결과 |
| --- | --- |
| ad-hoc 헬퍼를 다시 빌드(같은 경로) | 두 권한 모두 `not_determined` 로 돌아감 |
| Developer ID 로 서명, 같은 경로에 다른 바이너리(디버그→릴리스, 코드 해시 다름) | `full_access` 유지, 권한 창 없음 |
| Developer ID 로 서명, 다른 경로 | `not_determined` — 번들 아닌 실행 파일은 경로로 묶인다 |
| 위 실행 파일로 가는 심볼릭 링크 | 원래 경로의 권한을 따른다 — 링크로는 경로를 고정할 수 없다 |
| Developer ID 로 서명한 앱 번들, 다른 폴더·다른 바이너리 | `full_access` 유지, 권한 창 없음 |

Homebrew 는 판마다 `Cellar/sherpa/<version>/` 아래에 설치하므로, 번들이 아닌 헬퍼는 서명과 무관하게
업그레이드마다 권한을 다시 묻는다. 소유자는 같은 날 Apple 개발자 멤버십이 있다고 밝혔다
(소유자 발언: "난 애플개발자 구매했다").

## 결정

1. **헬퍼를 `libexec/SherpaHelper.app` 앱 번들로 배포한다.** 실행 파일은
   `Contents/MacOS/sherpa-apple`, `Contents/Info.plist` 는 헬퍼에 박는 `Resources/Info.plist` 에서
   `scripts/package.sh` 가 만든다(번들 식별자 `dev.xiyo.sherpa`, `LSUIElement`). 코어는
   `../libexec/SherpaHelper.app/Contents/MacOS/sherpa-apple` 만 찾는다.
2. **번들은 소유자의 Developer ID Application 인증서로 서명한다** (소유자 결정, 2026-11-20). 서명 요건은
   `identifier "dev.xiyo.sherpa" and anchor apple generic … subject.OU = <팀>` 이라 코드 해시가 들어가지
   않는다. `package.sh --publish` 는 그 인증서 없이는 멈추고, 검사용 실행만 ad-hoc 으로 떨어지며 경고를
   남긴다. 배포 서명에는 Apple 타임스탬프를 붙인다.
3. **공증하지 않고, hardened runtime 을 켜지 않는다.** Homebrew 의 `url` 다운로드는 격리 속성을 붙이지
   않아 Gatekeeper 가 개입하지 않는다(추론, 같은 날 설치본에서 실행 확인). 공증은 자격 증명과 외부
   서비스를 릴리스에 묶으므로 필요가 실측될 때 다시 본다.
4. **코어 `bin/sherpa` 는 ad-hoc 서명 그대로다.** 권한의 주체는 책임을 놓고 다시 뜬 헬퍼라 코어의
   서명은 권한 동작에 닿지 않는다.

## 검토한 대안

- **자체 서명 인증서.** 유료 멤버십 없이 코드 해시를 뺄 수 있지만, 같은 날 실측으로 경로 문제는
  서명만으로 풀리지 않았다. 멤버십이 있으므로 Apple 이 발급한 인증서를 쓴다.
- **번들 없이 고정 경로로 복사(`post_install` 로 `var/` 에 두기).** 경로는 고정되지만 Homebrew 밖에
  파일이 남고 `SR-DP-002` 의 `post_install` 최소화와 어긋난다.

## 결과

- 소유자는 번들 식별자 `dev.xiyo.sherpa` 에 Calendar·Reminders 권한을 한 번 주고, 이후 업그레이드에서는
  다시 묻지 않는다(같은 인증서·팀으로 서명하는 동안). 0.8.2 → 0.8.3 `brew upgrade` 에서 두 권한이 권한 창
  없이 이어진 것을 같은 날 실측했다.
- 인증서를 바꾸거나 팀이 바뀌면 한 번 다시 묻는다. 인증서가 만료돼도 타임스탬프가 붙은 서명은 유효하다
  (Apple 문서 기준, 실측 안 함).
- 릴리스는 소유자 키체인의 Developer ID 인증서가 있는 Mac 에서만 낼 수 있다.

## Related

- [ADR-0005: Unsigned Homebrew Distribution](0005-unsigned-homebrew-distribution.md)
- [ADR-0008: Bun + TypeScript 코어](0008-bun-typescript-core.md)
- [릴리스 런북](../testing/local-homebrew-release.md)
- [실측 기록](../testing/live-evidence.md)
