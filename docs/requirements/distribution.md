---
uuid: 01a0f253-1e8d-7354-bb91-5bfbde9f6a59
type: spec
audience: "Maintainers changing how the Sherpa CLI is packaged, published, or installed"
goal: "Check a packaging or install change against the numbered functional and safety requirements"
tone: "Normative English. One requirement per identifier, stated as must or never"
manner: "Requirements only; the release steps live in the runbook and the rationale in ADR-0005"
---

# Homebrew Distribution and Agent Integration Requirements

## Outcome

A macOS user who already has Homebrew must be able to install a complete,
relocatable Sherpa executable without Xcode, an Apple developer
account, or a paid signing identity. Agent integration is a separate explicit
Sherpa operation after the CLI is installed.

## Functional requirements

- `FR-DP-001`: `brew install xiyo/tap/sherpa` is the canonical product install.
  The Formula declares one runtime dependency, `sqlcipher`, whose library the
  core loads to read the KakaoTalk database, and installs no toolchain. The tap
  is the public `XIYO/homebrew-tap` repository, and the Formula's
  checksum-pinned URL names the release asset of the public `bunny-holes/sherpa`
  repository for that version. For development on one machine, the same
  generated Formula may be rendered against a checksum-pinned `file://` archive
  and published into a local tap; that tap is a development convenience, not a
  distribution route.
- `FR-DP-002`: The release archive contains the Sherpa CLI, every required
  executable and nothing else. It contains no agent skills and no worker
  runtime. Every executable and installer
  resource resolves relative to the installed runtime and never depends on a
  source checkout or developer-machine path.
- `FR-DP-003`: The Formula installs the executables directly and needs no
  `post_install` step. The core finds the helper at
  `../libexec/SherpaHelper.app/Contents/MacOS/sherpa-apple` relative to its own
  resolved path, so Homebrew's `bin` symlink works.
- `FR-DP-004`: The archive carries exactly the compiled Bun core `bin/sherpa`
  (ad-hoc signed) and the Swift Apple helper bundle `libexec/SherpaHelper.app`
  (its executable, `Info.plist`, and signature), and the packager refuses to
  build one that carries anything else or whose helper reports another version.
  A published helper bundle is signed with the owner's Developer ID
  Application certificate (ADR-0009). The generated
  Formula pins the archive SHA-256, and the version in the archive name it
  references — the one Homebrew scans, since the Formula carries no `version`
  line — is read back from the built binary rather than written by hand.
- `FR-DP-005`: The CLI does not register, update, or remove agent plugins on
  any host. `bunny-holes/plug-hole` is the only marketplace for this repository's
  `plugins/sherpa/` package, and skills are installed with each host's own
  plugin command. The plugin registers the MCP server of `Sherpa.app` and its
  skills call that server's tools, not the CLI, so no CLI version is paired
  with the plugin; the gate checks every tool a skill names against the core's
  tool registry.
- `FR-DP-006`: Homebrew owns installed program files and worker environments.
  Upgrade and uninstall do not silently purge Sherpa's owner data, browser
  profile, Apple data, or host plugin registrations.

## Safety requirements

- `SR-DP-001`: A release signs the Apple helper bundle with the owner's
  Developer ID Application certificate so macOS privacy grants, keyed to the
  bundle identifier and team, survive Homebrew upgrades (ADR-0009). Releases are
  not notarized and use no hardened runtime; installing never requires the
  user to hold an Apple identity.
- `SR-DP-002`: Formula installation never changes Codex or Claude Code user
  configuration in `post_install`. Agent integration requires a separate,
  visible Sherpa command after the CLI installation succeeds.
- `SR-DP-003`: Packaging and installer boundaries log safe action, state,
  duration, byte-count, and failure-class fields only. They never log command
  arguments, paths, host output, cookies, tokens, user content, or environment
  values.
- `SR-DP-004`: A deterministic packaging test must install from the generated
  archive into a clean temporary prefix, verify it holds the executable and
  nothing else, and invoke it with
  network access disabled, invoke every worker capability, and reject absolute
  source paths or copied virtual-environment launchers.

## Non-goals

- Installing Homebrew itself.
- Installing or managing Codex or Claude Code.
- Automatically registering an agent plugin during `brew install`.
- Notarization, App Store distribution, or a marketing claim that Sherpa is an
  Apple-verified developer product.
- Purging owner data as a side effect of `brew uninstall`.

## Acceptance

The deterministic gate must build one release archive, validate its contents,
render and audit a Formula, install it into a fresh tap, and exercise the
installed core and its helper (`brew test`). The archive must contain
no agent marketplace; the skill side is gated separately by the plugin check.

## Related

- [System architecture](../architecture/README.md)
- [Roadmap](../roadmap/README.md)
- [Unsigned Homebrew decision](../adr/0005-unsigned-homebrew-distribution.md)
- [Test strategy](../testing/README.md)
- [Homebrew release runbook](../testing/local-homebrew-release.md)
- [Requirement verification matrix](../testing/verification-matrix.md)
