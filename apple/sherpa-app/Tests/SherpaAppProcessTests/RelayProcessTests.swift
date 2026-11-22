import Darwin
import Foundation
import Testing

// sherpa-relay against a fake Sherpa.app (contract §6, §13.2): every exit code and the
// preface vectors of §14.

private let ready = #"{"sherpa_app":1,"status":"ready","reason":null,"version":"0.9.0"}"#

struct PrefaceCase: Sendable, CustomTestStringConvertible {
    let preface: String?
    let behaviour: String
    let exit: Int32
    let errorLine: String
    var testDescription: String { "\(preface ?? "no preface") then \(behaviour) → \(exit)" }
}

@Suite struct RelayProcessTests {
    @Test func rejectsArgumentsWith64() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        let relay = try rig.startRelay(["--serve"])
        #expect(await relay.exitStatus() == 64)
        #expect(relay.errorText.contains(#"[relay:cli:arguments] reason=unknown_argument remedy="#))
    }

    @Test func printsItsHelp() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        let relay = try rig.startRelay(["--help"])
        #expect(await relay.exitStatus() == 0)
        #expect(await relay.line()?.hasPrefix("sherpa-relay ") == true)
    }

    @Test func readsItsVersionFromTheAppBundle() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        let contents = rig.root + "/Sherpa.app/Contents"
        try FileManager.default.createDirectory(atPath: contents + "/MacOS", withIntermediateDirectories: true)
        try FileManager.default.copyItem(atPath: try Program.relay.path, toPath: contents + "/MacOS/sherpa-relay")
        let info: [String: Any] = [
            "CFBundleIdentifier": "dev.xiyo.sherpa", "CFBundleExecutable": "Sherpa",
            "CFBundlePackageType": "APPL", "CFBundleShortVersionString": "1.2.3",
        ]
        try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
            .write(to: URL(fileURLWithPath: contents + "/Info.plist"))
        let bundled = try rig.startRelay(["--version"], executable: contents + "/MacOS/sherpa-relay")
        #expect(await bundled.line() == "sherpa-relay 1.2.3")
        #expect(await bundled.exitStatus() == 0)

        let loose = try rig.startRelay(["--version"])
        #expect(await loose.exitStatus() == 70)
        #expect(loose.errorText.contains("reason=version_unavailable"))
    }

    @Test func exits69WhenNoAppListens() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        let missing = try rig.startRelay()
        #expect(await missing.exitStatus() == 69)
        #expect(missing.errorText.contains(#"reason=app_not_running socket=override remedy="start Sherpa.app""#))

        try rig.leaveStaleSocket()
        let stale = try rig.startRelay()
        #expect(await stale.exitStatus() == 69)
        #expect(stale.errorText.contains("reason=app_not_running"))
    }

    @Test func exits78ForASocketPathThatDoesNotFit() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        let tooLong = "/tmp/" + String(repeating: "a", count: 100) + "/app.sock"
        let relay = try rig.startRelay(environment: ["SHERPA_APP_SOCKET": tooLong])
        #expect(await relay.exitStatus() == 78)
        #expect(relay.errorText.contains("reason=socket_path_too_long socket=override bytes=\(tooLong.utf8.count)"))
    }

    @Test func exits77WhenTheAppFailsTheProductionRequirement() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        let app = try await rig.startFakeApp(preface: ready, behaviour: "echo")
        let relay = try rig.startRelay(appRequirement: nil)
        #expect(await relay.exitStatus() == 77)
        #expect(relay.errorText.contains("reason=server_signature_rejected"))
        #expect(relay.errorText.contains("identifier=dev.xiyo.sherpa "))
        // The relay checked before it read or wrote: the app saw a connection and nothing else.
        #expect(await app.waitForError("fake-app: accepted"))
    }

    @Test func copiesBytesAfterAReadyPrefaceAndEndsWith0() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        _ = try await rig.startFakeApp(preface: ready, behaviour: "echo")
        let relay = try rig.startRelay()
        let message = #"{"jsonrpc":"2.0","id":1,"method":"ping","params":{"text":"한글 ✓"}}"#
        try relay.send(message)
        #expect(await relay.line() == message)
        try relay.closeInput()
        #expect(await relay.exitStatus() == 0)
    }

    @Test(arguments: [
        PrefaceCase(
            preface: #"{"sherpa_app":1,"status":"unavailable","reason":"core_starting","version":"0.9.0"}"#,
            behaviour: "silent", exit: 75, errorLine: "reason=app_unavailable app_reason=core_starting"
        ),
        PrefaceCase(
            preface: #"{"sherpa_app":1,"status":"unavailable","reason":"mcp_disabled","version":"0.9.0"}"#,
            behaviour: "silent", exit: 75,
            errorLine: #"reason=app_unavailable app_reason=mcp_disabled remedy="turn on MCP in Sherpa.app, then reconnect the server (Claude Code: /mcp, then Reconnect; Codex: start a new session)""#
        ),
        PrefaceCase(
            preface: #"{"sherpa_app":1,"status":"refused","reason":"peer_signature","version":"0.9.0"}"#,
            behaviour: "silent", exit: 77, errorLine: "reason=relay_refused app_reason=peer_signature"
        ),
        PrefaceCase(
            preface: #"{"sherpa_app":2,"status":"ready","reason":null,"version":"9.0.0"}"#,
            behaviour: "silent", exit: 76, errorLine: "reason=preface_version_unsupported"
        ),
        PrefaceCase(preface: "not json", behaviour: "silent", exit: 76, errorLine: "reason=preface_not_json"),
        PrefaceCase(
            preface: #"{"sherpa_app":1,"status":"ready","reason":null}"#,
            behaviour: "silent", exit: 76, errorLine: "reason=preface_invalid"
        ),
        PrefaceCase(preface: nil, behaviour: "close", exit: 76, errorLine: "reason=preface_missing"),
        PrefaceCase(preface: ready, behaviour: "close", exit: 75, errorLine: "reason=app_closed_session"),
    ])
    func endsAsThePrefaceSays(_ vector: PrefaceCase) async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        _ = try await rig.startFakeApp(preface: vector.preface, behaviour: vector.behaviour)
        let relay = try rig.startRelay()
        #expect(await relay.exitStatus() == vector.exit)
        #expect(relay.errorText.contains(vector.errorLine))
    }

    @Test func exits75WhenThePrefaceNeverComes() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        _ = try await rig.startFakeApp(preface: nil, behaviour: "silent")
        let started = ContinuousClock.now
        let relay = try rig.startRelay()
        #expect(await relay.exitStatus(within: .seconds(25)) == 75)
        #expect(ContinuousClock.now - started >= .seconds(14))
        #expect(relay.errorText.contains("reason=preface_timeout"))
    }

    @Test func endsWith0WhenTheAgentClosesItsOutput() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        _ = try await rig.startFakeApp(preface: ready, behaviour: "echo")
        let relay = try rig.startRelay(output: .closed)
        try relay.send(#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#)
        #expect(await relay.exitStatus() == 0)
    }
}
