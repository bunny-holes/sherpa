import Darwin
import Foundation
import Testing

// The DEBUG test host (Sherpa.app's server without its menu) with signed relays and the fake
// core (contract §3–§9, §13.2). Every test has its own socket and core.

private let capabilities = #"{"kind":"request","protocol_version":"2.0.0","application_contract":"sherpa.planner.v2","request_id":"app-1","operation_id":"app-1","capability":"capabilities","payload":{"schema":"sherpa.planner.capabilities.request.v2"},"deadline_ms":30000,"idempotency_key":"app-1","policy":{"effect":"read","required_evidence":"none","artifact_directory":null}}"#

@Suite struct HostProcessTests {
    @Test func servesEachRelayOnItsOwnChannelOfOneCore() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        _ = try await rig.startHost()
        let relays = try (0..<3).map { _ in try rig.startRelay() }
        var channels: Set<Int> = []
        var pids: Set<Int> = []
        for relay in relays {
            let reply = try await relay.echo()
            channels.insert(reply?.channel ?? 0)
            pids.insert(reply?.pid ?? 0)
        }
        #expect(channels == [1, 2, 3])
        #expect(pids.count == 1)

        // One core, started as sherpa-core app serve with only the variables of §7.1. The
        // fake core's own CoreFoundation adds __CF_USER_TEXT_ENCODING at its start.
        #expect(rig.coreSpawns == 1)
        let spawn = try #require(rig.coreLog.first { $0.hasPrefix("spawn ") })
        #expect(field("args", in: spawn) == "app,serve")
        let names = Set((field("env", in: spawn) ?? "").split(separator: ",").map(String.init))
        #expect(names.subtracting(["__CF_USER_TEXT_ENCODING"]) == ["HOME", "LOG_LEVEL", "PATH", "TMPDIR"])
        #expect(field("path", in: spawn) == "/usr/bin:/bin:/usr/sbin:/sbin")
        // The app ignores SIGPIPE and SIGTERM for itself; the core must not inherit that.
        #expect(field("ignored", in: spawn) == "none")
        #expect(field("blocked", in: spawn) == "none")
        #expect(rig.coreLog.contains("app-hello version=0.9.0 workers=planner"))
        #expect((1...3).allSatisfy { rig.coreLog.contains("open \($0)") })

        for relay in relays { try relay.closeInput() }
        for relay in relays { #expect(await relay.exitStatus() == 0) }
        #expect(await rig.waitForCoreLog { lines in (1...3).allSatisfy { lines.contains("close \($0) reason=none") } })
    }

    @Test func refusesADirectConnectionAndARelayWithoutItsIdentifier() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        let host = try await rig.startHost()
        // This test process is not the relay.
        #expect(try rig.directPreface() == #"{"sherpa_app":1,"status":"refused","reason":"peer_signature","version":"0.9.0"}"#)
        // The relay as the linker signed it: not the relay's identifier.
        let unsigned = try rig.startRelay(executable: Program.relay.linkerSignedPath)
        #expect(await unsigned.exitStatus() == 77)
        #expect(unsigned.errorText.contains("reason=relay_refused app_reason=peer_signature"))
        #expect(await host.waitForError("[app:signature:check] status=rejected reason=peer_signature"))
        #expect(rig.coreLog.allSatisfy { !$0.hasPrefix("open ") })
    }

    @Test func holdsAdHocCodeToTheProductionRequirements() async throws {
        // The relay under the app's production requirement.
        let strictHost = try Rig()
        defer { strictHost.tearDown() }
        _ = try await strictHost.startHost(relayRequirement: nil)
        let refused = try strictHost.startRelay()
        #expect(await refused.exitStatus() == 77)
        #expect(refused.errorText.contains("app_reason=peer_signature"))

        // The app under the relay's production requirement.
        let strictRelay = try Rig()
        defer { strictRelay.tearDown() }
        _ = try await strictRelay.startHost()
        let rejecting = try strictRelay.startRelay(appRequirement: nil)
        #expect(await rejecting.exitStatus() == 77)
        #expect(rejecting.errorText.contains("reason=server_signature_rejected"))

        // The core under the production core requirement: never started.
        let strictCore = try Rig()
        defer { strictCore.tearDown() }
        let host = try await strictCore.startHost(coreRequirement: nil)
        #expect(await host.waitForError("[app:core:signature] status=rejected"))
        let relay = try strictCore.startRelay()
        #expect(await relay.exitStatus() == 75)
        #expect(relay.errorText.contains("app_reason=core_failed"))
        #expect(strictCore.coreSpawns == 0)
    }

    @Test func neverLetsACoreRunWhoseRunningCodeFailsTheRequirement() async throws {
        // An unsigned script in the core's place: the code it runs is /bin/sh. Were it let go,
        // it would leave a file behind.
        let script = try Rig()
        defer { script.tearDown() }
        let marker = script.root + "/core-ran"
        let path = script.root + "/sherpa-core"
        try Data("#!/bin/sh\ntouch '\(marker)'\n".utf8).write(to: URL(fileURLWithPath: path))
        chmod(path, 0o755)
        let host = try await script.startHost(core: path)
        #expect(await host.waitForError("[app:core:signature] status=rejected"))
        let relay = try script.startRelay()
        #expect(await relay.exitStatus() == 75)
        #expect(relay.errorText.contains("app_reason=core_failed"))
        try await Task.sleep(for: .milliseconds(300))
        #expect(!FileManager.default.fileExists(atPath: marker))
        #expect(host.errorLines(containing: "[app:core:restart]").isEmpty)

        // The fake core signed as another program: killed before it writes its first line.
        let other = try Rig()
        defer { other.tearDown() }
        let copy = other.root + "/sherpa-core"
        try FileManager.default.copyItem(atPath: Program.core.linkerSignedPath, toPath: copy)
        #expect(runTool("/usr/bin/codesign", ["--force", "--sign", "-", "--identifier", "dev.xiyo.sherpa.other", copy]) == 0)
        let otherHost = try await other.startHost(core: copy)
        #expect(await otherHost.waitForError("[app:core:signature] status=rejected"))
        try await Task.sleep(for: .milliseconds(300))
        #expect(other.coreSpawns == 0)
        #expect(otherHost.errorLines(containing: "[app:core:launch] status=started").isEmpty)
    }

    @Test func letsOneInstanceHoldTheSocket() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        _ = try await rig.startHost()
        let second = try await rig.startHost(listening: false)
        #expect(await second.exitStatus() == 0)
        #expect(second.errorText.contains("[app:lock:acquire] status=held_by_another_process"))
        let relay = try rig.startRelay()
        #expect(try await relay.echo()?.channel == 1)
    }

    @Test func replacesAStaleSocketAndKeepsTheModes() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        try rig.leaveStaleSocket()
        _ = try await rig.startHost()
        let relay = try rig.startRelay()
        #expect(try await relay.echo()?.channel == 1)
        let files = FileManager.default
        #expect(try files.attributesOfItem(atPath: rig.socket)[.posixPermissions] as? Int == 0o600)
        #expect(try files.attributesOfItem(atPath: rig.runDirectory)[.posixPermissions] as? Int == 0o700)
    }

    @Test func doesNotListenInALinkedRunFolder() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        let target = rig.root + "/elsewhere"
        try FileManager.default.createDirectory(atPath: target, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        try FileManager.default.createSymbolicLink(atPath: rig.runDirectory, withDestinationPath: target)
        let host = try await rig.startHost(listening: false)
        #expect(await host.waitForError("[app:socket:listen] status=socket_failed reason=directory_is_link"))
        #expect(!FileManager.default.fileExists(atPath: target + "/app.sock"))
        let relay = try rig.startRelay()
        #expect(await relay.exitStatus() == 69)
    }

    @Test func stopsACoreOfAnotherVersionWithoutRestart() async throws {
        let rig = try Rig(core: #"{"version":"0.9.0","mode":"bad-version"}"#)
        defer { rig.tearDown() }
        let host = try await rig.startHost()
        #expect(await host.waitForError("[app:core:hello] status=incompatible"))
        let relay = try rig.startRelay()
        #expect(await relay.exitStatus() == 75)
        #expect(relay.errorText.contains("app_reason=core_incompatible"))
        try await Task.sleep(for: .seconds(1.5))
        #expect(rig.coreSpawns == 1)
        #expect(host.errorLines(containing: "[app:core:restart]").isEmpty)
    }

    @Test func endsEveryRelayWhenTheCoreExitsAndRestartsIt() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        let host = try await rig.startHost()
        let first = try rig.startRelay()
        let second = try rig.startRelay()
        let before = try #require(try await first.echo())
        _ = try #require(try await second.echo())

        try first.send(MCP.call(2, "exit", #"{"code":3}"#))
        #expect(await first.exitStatus() == 75)
        #expect(await second.exitStatus() == 75)
        #expect(first.errorText.contains("reason=app_closed_session"))
        #expect(await host.waitForError("[app:core:restart] status=scheduled delay_ms=0"))

        let third = try rig.startRelay()
        let after = try #require(try await third.echo())
        #expect(after.channel == 1)
        #expect(after.pid != before.pid)
        #expect(rig.coreSpawns == 2)
    }

    @Test func stopsRestartingAfterFiveExitsInTheWindow() async throws {
        let rig = try Rig(core: #"{"version":"0.9.0","mode":"exit-at-start","code":3}"#)
        defer { rig.tearDown() }
        // Delays and window scaled by 0.05: 0, 50, 100, 200 ms in a 6 s window, wide enough
        // for five spawns on a loaded machine.
        let host = try await rig.startHost(["--restart-scale", "0.05"])
        #expect(await host.waitForError("[app:core:restart] status=stopped reason=core_failed exits_in_window=5"))
        let delays = host.errorLines(containing: "[app:core:restart] status=scheduled").compactMap { field("delay_ms", in: $0) }
        #expect(delays == ["0", "50", "100", "200"])
        #expect(rig.coreSpawns == 5)

        let relay = try rig.startRelay()
        #expect(await relay.exitStatus() == 75)
        #expect(relay.errorText.contains("app_reason=core_failed"))
        try await Task.sleep(for: .milliseconds(500))
        #expect(rig.coreSpawns == 5)
    }

    @Test func holdsARelayUntilTheCoreSaysHello() async throws {
        let rig = try Rig(core: #"{"version":"0.9.0","mode":"hello-delay","delay_ms":1500}"#)
        defer { rig.tearDown() }
        _ = try await rig.startHost()
        let started = ContinuousClock.now
        let relay = try rig.startRelay()
        #expect(try await relay.echo()?.channel == 1)
        #expect(ContinuousClock.now - started >= .seconds(1))
    }

    @Test func answersCoreStartingAfterTenSecondsWithoutHello() async throws {
        let rig = try Rig(core: #"{"version":"0.9.0","mode":"no-hello"}"#)
        defer { rig.tearDown() }
        _ = try await rig.startHost(["--hello-timeout", "60"])
        let started = ContinuousClock.now
        let relay = try rig.startRelay()
        #expect(await relay.exitStatus(within: .seconds(20)) == 75)
        let waited = ContinuousClock.now - started
        #expect(waited >= .seconds(9.5) && waited < .seconds(14))
        #expect(relay.errorText.contains("app_reason=core_starting"))
    }

    @Test func closesASlowConsumerWithoutStallingTheOthers() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        let host = try await rig.startHost()
        let other = try rig.startRelay()
        #expect(try await other.echo(1) != nil)
        // This relay's agent never reads, so its pipe and socket fill and the app's queue grows.
        let slow = try rig.startRelay(output: .held)
        #expect(await rig.waitForCoreLog { $0.contains("open 2") })
        try slow.send(MCP.call(1, "flood", #"{"frames":800,"bytes":32768}"#))
        #expect(await host.waitForError("[app:mux:route] channel=2 status=closed reason=slow_consumer", within: .seconds(20)))
        #expect(try await other.echo(2)?.channel == 1)
        #expect(await rig.waitForCoreLog { $0.contains("close 2 reason=slow_consumer") })
        slow.readOutput()
        #expect(await slow.exitStatus() == 75)
    }

    @Test func refusesTheSeventeenthSession() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        _ = try await rig.startHost()
        var relays: [Child] = []
        for _ in 0..<16 {
            let relay = try rig.startRelay()
            #expect(try await relay.echo() != nil)
            relays.append(relay)
        }
        let extra = try rig.startRelay()
        #expect(await extra.exitStatus() == 75)
        #expect(extra.errorText.contains("app_reason=too_many_sessions"))

        try relays[0].closeInput()
        #expect(await relays[0].exitStatus() == 0)
        let next = try rig.startRelay()
        #expect(try await next.echo()?.channel == 17)
    }

    @Test(arguments: ["approved", "declined", "unavailable"])
    func answersAConfirmationWithTheDecider(_ decision: String) async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        let host = try await rig.startHost(["--confirm", decision])
        let relay = try rig.startRelay()
        try relay.send(MCP.call(1, "confirm"))
        #expect(MCP.result(await relay.line())?["decision"] as? String == decision)
        #expect(await host.waitForError("[testhost:confirm:present] id=1 lines=1"))
        #expect(rig.coreLog.contains("confirmation 1 \(decision)"))
    }

    @Test func dropsAConfirmationTheCoreWithdraws() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        let host = try await rig.startHost(["--confirm", "ignore"])
        let relay = try rig.startRelay()
        try relay.send(MCP.call(1, "confirm", #"{"withdraw_after_ms":300}"#))
        #expect(MCP.result(await relay.line())?["decision"] as? String == "withdrawn")
        #expect(await host.waitForError("[testhost:confirm:withdraw] id=1"))
    }

    @Test func answersAnInvalidConfirmationUnavailableWithoutAsking() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        let host = try await rig.startHost(["--confirm", "approved"])
        let relay = try rig.startRelay()
        let title = String(repeating: "t", count: 101)
        try relay.send(MCP.call(1, "confirm", #"{"title":"\#(title)"}"#))
        #expect(MCP.result(await relay.line())?["decision"] as? String == "unavailable")
        #expect(host.errorLines(containing: "[testhost:confirm:present]").isEmpty)
    }

    @Test func servesPlannerRequestsInProcess() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        _ = try await rig.startHost()
        let relay = try rig.startRelay()

        try relay.send(MCP.call(1, "worker", #"{"request":\#(capabilities)}"#))
        let response = try #require(MCP.result(await relay.line(within: .seconds(30)))?["response"] as? [String: Any])
        #expect(response["status"] as? String == "succeeded")
        #expect(response["capability"] as? String == "capabilities")
        #expect(response["operation_id"] as? String == "app-1")

        try relay.send(MCP.call(2, "worker", #"{"worker":"mail","request":\#(capabilities)}"#))
        let unsupported = try #require(MCP.result(await relay.line())?["response"] as? [String: Any])
        #expect(unsupported["status"] as? String == "failed")
        #expect((unsupported["error"] as? [String: Any])?["code"] as? String == "app.unsupported_worker")

        try relay.send(MCP.call(3, "worker", #"{"request":{}}"#))
        let report = try #require(MCP.result(await relay.line())?["report"] as? [String: Any])
        #expect(report["status"] as? String == "failed")
        #expect(report["error"] as? String == "protocol.invalid_envelope")
        #expect(rig.coreLog.filter { $0.hasPrefix("response ") } == ["response 1 response", "response 2 response", "response 3 report"])
    }

    @Test func closesASessionWhoseMessageIsTooLarge() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        let host = try await rig.startHost()
        let relay = try rig.startRelay()
        #expect(try await relay.echo() != nil)
        let line = Data(repeating: 0x61, count: 4 * 1_024 * 1_024 + 1) + Data([0x0a])
        // The write ends with EPIPE once the relay has gone; that is the expected end.
        let writer = Task.detached { try? relay.write(line) }
        #expect(await relay.exitStatus() == 75)
        _ = await writer.value
        #expect(await rig.waitForCoreLog { $0.contains("close 1 reason=message_too_large") })
        #expect(host.errorText.contains("[app:session:close] channel=1 by=app reason=message_too_large"))
    }

    @Test func replacesACoreThatBreaksTheFrameGrammar() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        let host = try await rig.startHost(["--restart-scale", "0.01"])
        let first = try rig.startRelay()
        #expect(try await first.echo() != nil)
        try first.send(MCP.call(2, "violate"))
        #expect(await host.waitForError("[app:core:frame] status=violation code=mux.frame_invalid"))
        #expect(await first.exitStatus() == 75)
        // SIGTERM ends it; the KILL after the grace period is not needed.
        #expect(await host.waitForError("[app:core:exit] pid="))
        #expect(host.errorLines(containing: "[app:core:exit]").first?.contains("signal=15") == true)
        #expect(host.errorLines(containing: "signal=KILL").isEmpty)

        let second = try rig.startRelay()
        #expect(try await second.echo() != nil)
        #expect(rig.coreSpawns == 2)
        try second.send(MCP.call(2, "fatal"))
        #expect(await host.waitForError("[app:core:fatal]"))
        #expect(await second.exitStatus() == 75)
        #expect(await rig.waitForCoreLog { $0.filter { $0.hasPrefix("spawn ") }.count == 3 })
    }

    @Test func shutsDownOnSIGTERM() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        // A pause in the handling of the core's exit must not let an older status come last.
        let host = try await rig.startHost(["--exit-handling-delay", "0.05"])
        let relay = try rig.startRelay()
        #expect(try await relay.echo() != nil)
        host.signal(SIGTERM)
        #expect(await host.exitStatus(within: .seconds(20)) == 0)
        #expect(await relay.exitStatus() == 75)
        #expect(rig.coreLog.contains("stdin-eof"))
        #expect(!FileManager.default.fileExists(atPath: rig.socket))
        #expect(host.errorText.contains("[app:server:shutdown] status=done"))
        // Statuses reach the observer in order, so the last one is the stopped core.
        #expect(host.errorLines(containing: "[testhost:status]").last == "debug [testhost:status] core=stopped sessions=0")
    }

    // MARK: the MCP switch (contract §2, §5, §7.6, §9)

    @Test func turnsEveryRelayAwayWhileMCPIsOffAsAtTheFirstLaunch() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        let host = try await rig.startHost(mcp: nil)
        // The signature comes first: a connection that is not the relay is refused for that.
        #expect(try rig.directPreface() == #"{"sherpa_app":1,"status":"refused","reason":"peer_signature","version":"0.9.0"}"#)
        let relay = try rig.startRelay()
        #expect(await relay.exitStatus() == 75)
        #expect(relay.errorText.contains(#"reason=app_unavailable app_reason=mcp_disabled remedy="turn on MCP"#))
        #expect(await host.waitForError("[app:session:open] status=unavailable reason=mcp_disabled"))
        #expect(rig.coreLog.allSatisfy { !$0.hasPrefix("open ") })
    }

    @Test func servesRelaysOnceMCPIsTurnedOn() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        let host = try await rig.startHost(mcp: false)
        let refused = try rig.startRelay()
        #expect(await refused.exitStatus() == 75)
        #expect(refused.errorText.contains("app_reason=mcp_disabled"))

        try host.send("mcp on")
        #expect(await host.waitForError("[app:mcp:switch] enabled=true sessions_closed=0 confirmations_withdrawn=0"))
        let relay = try rig.startRelay()
        #expect(try await relay.echo()?.channel == 1)
        #expect(await relay.waitForError("[relay:session:open]"))
    }

    @Test func closesEveryOpenSessionWhenMCPIsTurnedOff() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        let host = try await rig.startHost(["--confirm", "ignore"])
        let first = try rig.startRelay()
        let second = try rig.startRelay()
        let before = try #require(try await first.echo())
        _ = try #require(try await second.echo())
        // A confirmation the person has not answered yet.
        try first.send(MCP.call(2, "confirm"))
        #expect(await host.waitForError("[testhost:confirm:present] id=1"))

        try host.send("mcp off")
        #expect(await first.exitStatus() == 75)
        #expect(await second.exitStatus() == 75)
        #expect(first.errorText.contains("reason=app_closed_session"))
        #expect(await host.waitForError("[app:mcp:switch] enabled=false sessions_closed=2 confirmations_withdrawn=1"))
        #expect(await host.waitForError("[testhost:confirm:withdraw-all]"))
        #expect(await rig.waitForCoreLog { lines in
            lines.contains("close 1 reason=mcp_disabled") && lines.contains("close 2 reason=mcp_disabled")
        })
        let late = try rig.startRelay()
        #expect(await late.exitStatus() == 75)
        #expect(late.errorText.contains("app_reason=mcp_disabled"))

        // On again: the same core serves the next relay on a new channel.
        try host.send("mcp on")
        #expect(await host.waitForError("[app:mcp:switch] enabled=true"))
        let again = try rig.startRelay()
        let after = try #require(try await again.echo())
        #expect(after.pid == before.pid)
        #expect(after.channel == 3)
    }

    @Test func answersAConfirmationThatComesAfterMCPIsOffUnavailable() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        let host = try await rig.startHost(["--confirm", "approved"])
        let relay = try rig.startRelay()
        #expect(try await relay.echo() != nil)
        // The core asks only after a slow preview read, by then for a closed channel.
        try relay.send(MCP.call(2, "confirm", #"{"delay_ms":1500}"#))
        #expect(await rig.waitForCoreLog { $0.contains { $0.hasPrefix("data 1 method=confirm") } })
        try host.send("mcp off")
        #expect(await host.waitForError("[app:mcp:switch] enabled=false sessions_closed=1"))
        #expect(await rig.waitForCoreLog { $0.contains("confirmation 1 unavailable") })
        #expect(await host.waitForError("[app:confirm:request] id=1 status=refused reason=mcp_disabled decision=unavailable"))
        #expect(host.errorLines(containing: "[testhost:confirm:present]").isEmpty)
    }

    @Test func passesLinesThroughUnparsedAndDropsEmptyOnes() async throws {
        let rig = try Rig()
        defer { rig.tearDown() }
        _ = try await rig.startHost()
        let relay = try rig.startRelay()
        try relay.write(Data("not json\n\n\n".utf8))
        let parseError = try #require(MCP.object(await relay.line()))
        #expect((parseError["error"] as? [String: Any])?["code"] as? Int == -32700)
        #expect(try await relay.echo(2)?.channel == 1)
        let data = rig.coreLog.filter { $0.hasPrefix("data ") }
        #expect(data.count == 2)
        #expect(data.first == "data 1 not-json")
    }
}
