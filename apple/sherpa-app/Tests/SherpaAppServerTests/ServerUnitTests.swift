import Darwin
import Foundation
import SherpaAppConnection
import SherpaWorkerProtocol
import Testing
@testable import SherpaAppServer

// MARK: restart policy (contract §7.8), time injected

@Test func restartsAtOnceThenBacksOffAndStopsAtTheFifthExitInTwoMinutes() {
    var policy = RestartPolicy()
    #expect(policy.coreEnded(at: 100, startedAt: 99) == .restart(after: 0))
    #expect(policy.coreEnded(at: 101, startedAt: 100) == .restart(after: 1))
    #expect(policy.coreEnded(at: 103, startedAt: 102) == .restart(after: 2))
    #expect(policy.coreEnded(at: 108, startedAt: 107) == .restart(after: 4))
    #expect(policy.coreEnded(at: 113, startedAt: 112) == .stop)
}

@Test func keepsDoublingUpToThirtySecondsWhileExitsFallOutOfTheWindow() {
    var policy = RestartPolicy()
    var delays: [Double] = []
    var now = 0.0
    for _ in 0..<8 {
        // Each run lasts 40 seconds: never five exits within 120 seconds.
        guard case let .restart(delay) = policy.coreEnded(at: now + 40, startedAt: now) else {
            Issue.record("stopped")
            return
        }
        delays.append(delay)
        now += 40 + delay
    }
    #expect(delays == [0, 1, 2, 4, 8, 16, 30, 30])
}

@Test func aRunThatOutlastsTheWindowEndsTheStreak() {
    var policy = RestartPolicy()
    _ = policy.coreEnded(at: 10, startedAt: 0)
    _ = policy.coreEnded(at: 20, startedAt: 10)
    #expect(policy.coreEnded(at: 400, startedAt: 20) == .restart(after: 0))
}

@Test func theMenuRestartStartsOver() {
    var policy = RestartPolicy()
    for second in 0..<5 { _ = policy.coreEnded(at: Double(second), startedAt: Double(second)) }
    policy.reset()
    #expect(policy.coreEnded(at: 6, startedAt: 5) == .restart(after: 0))
}

@Test func scalesDelaysAndTheWindowTogether() {
    var policy = RestartPolicy(scale: 0.01)
    #expect(policy.coreEnded(at: 0, startedAt: 0) == .restart(after: 0))
    #expect(policy.coreEnded(at: 0.1, startedAt: 0.05) == .restart(after: 0.01))
}

// MARK: work requests (contract §8)

private func request(capability: String = "capabilities", deadline: Int = 20_000, effect: String = "read") -> Data {
    Data(#"{"kind":"request","protocol_version":"2.0.0","application_contract":"sherpa.planner.v2","request_id":"op-1","operation_id":"op-1","capability":"\#(capability)","payload":{"schema":"sherpa.planner.capabilities.request.v2"},"deadline_ms":\#(deadline),"idempotency_key":"op-1","policy":{"effect":"\#(effect)","required_evidence":"none","artifact_directory":null}}"#.utf8)
}

private actor Calls {
    var order: [String] = []
    func append(_ value: String) { order.append(value) }
}

private struct FakePlanner: PlannerPort {
    let calls: Calls
    let delay: Double

    func respond(to request: Data) async -> WorkerOutput {
        let capability = (try? WorkerRequest(data: request))?.capability ?? "?"
        await calls.append(capability)
        try? await Task.sleep(for: .seconds(delay))
        return .response(Data(#"{"fake":true}"#.utf8))
    }
}

private final class Replies: @unchecked Sendable {
    private let condition = NSCondition()
    private var values: [(UInt64, WorkerOutput)] = []

    func add(_ job: WorkerJob, _ output: WorkerOutput) {
        condition.lock()
        values.append((job.id, output))
        condition.broadcast()
        condition.unlock()
    }

    func wait(count: Int) -> [(UInt64, WorkerOutput)] {
        condition.lock()
        defer { condition.unlock() }
        let deadline = Date(timeIntervalSinceNow: 10)
        while values.count < count, condition.wait(until: deadline) {}
        return values
    }
}

private let quiet = SherpaLogger(threshold: .error) { _, _ in }

private func decode(_ output: WorkerOutput) throws -> JSONObject {
    switch output {
    case let .response(data), let .report(data): try JSONDecoder().decode(JSONObject.self, from: data)
    }
}

@Test func runsRequestsOneAtATimeInArrivalOrderAndSkipsThoseWhoseDeadlinePassed() throws {
    let calls = Calls()
    let replies = Replies()
    let queue = WorkerQueue(planner: FakePlanner(calls: calls, delay: 0.3), logger: quiet) { replies.add($0, $1) }
    let now = monotonicSeconds()
    queue.enqueue(WorkerJob(id: 1, worker: "planner", request: request(capability: "event.list"), receivedAt: now, generation: 1))
    queue.enqueue(WorkerJob(id: 2, worker: "planner", request: request(capability: "event.get", deadline: 100), receivedAt: now, generation: 1))
    queue.enqueue(WorkerJob(id: 3, worker: "planner", request: request(capability: "reminder.list"), receivedAt: now, generation: 1))
    let answered = replies.wait(count: 3)
    #expect(answered.map(\.0) == [1, 2, 3])
    let skipped = try decode(answered[1].1)
    #expect(skipped["status"] == "failed")
    #expect(skipped["error"] == ["code": "app.deadline_exceeded", "retry": "after_backoff"])
    #expect(skipped["effect"] == ["kind": "none", "state": "not_started"])
    #expect(skipped["operation_id"] == "op-1")
    #expect(answered[2].1 == .response(Data(#"{"fake":true}"#.utf8)))
}

@Test func answersOtherWorkersAndBrokenEnvelopesWithoutThePlanner() throws {
    let calls = Calls()
    let replies = Replies()
    let queue = WorkerQueue(planner: FakePlanner(calls: calls, delay: 0), logger: quiet) { replies.add($0, $1) }
    let now = monotonicSeconds()
    queue.enqueue(WorkerJob(id: 1, worker: "mail", request: request(), receivedAt: now, generation: 1))
    queue.enqueue(WorkerJob(id: 2, worker: "planner", request: Data("{}".utf8), receivedAt: now, generation: 1))
    queue.enqueue(WorkerJob(id: 3, worker: "planner", request: Data(repeating: 0x20, count: 64 * 1_024 + 1), receivedAt: now, generation: 1))
    let answered = replies.wait(count: 3)
    let unsupported = try decode(answered[0].1)
    #expect(unsupported["error"] == ["code": "app.unsupported_worker", "retry": "never"])
    guard case let .report(invalid) = answered[1].1, case let .report(tooLarge) = answered[2].1 else {
        Issue.record("expected reports")
        return
    }
    #expect(String(decoding: invalid, as: UTF8.self) == #"{"error":"protocol.invalid_envelope","status":"failed"}"#)
    #expect(String(decoding: tooLarge, as: UTF8.self) == #"{"error":"protocol.request_too_large","status":"failed"}"#)
}

private final class Received: @unchecked Sendable {
    private let lock = NSLock()
    private var requests: [Data] = []
    func add(_ request: Data) { lock.withLock { requests.append(request) } }
    var all: [Data] { lock.withLock { requests } }
}

private struct RecordingPlanner: PlannerPort {
    let received: Received

    func respond(to request: Data) async -> WorkerOutput {
        received.add(request)
        return .response(Data(#"{"fake":true}"#.utf8))
    }
}

@Test func measuresTheRequestAsTheCoreSentItAndPassesThoseBytesOn() throws {
    // 40 000 slashes: 40 KB as sent, over 64 KiB once an encoder writes each one as \/.
    let slashes = String(repeating: "/", count: 40_000)
    let sent = String(decoding: request(), as: UTF8.self)
        .replacingOccurrences(of: #""payload":{"#, with: #""payload": {"note":"\#(slashes)", "#)
    #expect(sent.utf8.count < WorkerQueue.requestLimit)
    let reencoded = try JSONEncoder().encode(try JSONDecoder().decode(JSONValue.self, from: Data(sent.utf8)))
    #expect(reencoded.count > WorkerQueue.requestLimit)

    let body = Data(#"{"id":4, "worker" : "planner","request":  \#(sent) }"#.utf8)
    let job = try #require(WorkerJob.parse(body, receivedAt: monotonicSeconds(), generation: 1))
    #expect(job.request == Data(sent.utf8))

    let received = Received()
    let replies = Replies()
    let queue = WorkerQueue(planner: RecordingPlanner(received: received), logger: quiet) { replies.add($0, $1) }
    queue.enqueue(job)
    #expect(replies.wait(count: 1).first?.1 == .response(Data(#"{"fake":true}"#.utf8)))
    #expect(received.all == [Data(sent.utf8)])
}

@Test func findsTheRawRequestOnlyWhenItIsThereOnce() {
    #expect(RawJSONMember.value(of: "request", in: Data(#"{"request":{"a":"}\"{"},"x":[1,{"b":2}]}"#.utf8))
        == Data(#"{"a":"}\"{"}"#.utf8))
    #expect(RawJSONMember.value(of: "request", in: Data(#"{"\u0072equest":{"a":1}}"#.utf8)) == Data(#"{"a":1}"#.utf8))
    #expect(RawJSONMember.value(of: "request", in: Data(#"{"request":{},"request":{}}"#.utf8)) == nil)
    #expect(RawJSONMember.value(of: "request", in: Data(#"{"other":{}}"#.utf8)) == nil)
    #expect(RawJSONMember.value(of: "request", in: Data("{}".utf8)) == nil)
}

@Test func waitsForTheRequestsAtShutdownNoLongerThanTheLimit() async throws {
    let calls = Calls()
    let replies = Replies()
    let queue = WorkerQueue(planner: FakePlanner(calls: calls, delay: 2), logger: quiet) { replies.add($0, $1) }
    queue.enqueue(WorkerJob(id: 1, worker: "planner", request: request(), receivedAt: monotonicSeconds(), generation: 1))
    let started = monotonicSeconds()
    queue.waitUntilIdle(limit: 0.3)
    let waited = monotonicSeconds() - started
    #expect(waited >= 0.25 && waited < 1.5)
}

@Test func doesNotWaitForARequestThatArrivedDuringTheWait() async throws {
    let calls = Calls()
    let replies = Replies()
    let queue = WorkerQueue(planner: FakePlanner(calls: calls, delay: 0.3), logger: quiet) { replies.add($0, $1) }
    queue.enqueue(WorkerJob(id: 1, worker: "planner", request: request(), receivedAt: monotonicSeconds(), generation: 1))
    let waiting = Task.detached {
        let started = monotonicSeconds()
        queue.waitUntilIdle(limit: 35)
        return monotonicSeconds() - started
    }
    try await Task.sleep(for: .milliseconds(100))
    queue.enqueue(WorkerJob(id: 2, worker: "planner", request: request(), receivedAt: monotonicSeconds(), generation: 1))
    let waited = await waiting.value
    // The first request ends at about 0.3 s; the second would end at about 0.6 s.
    #expect(waited >= 0.2 && waited < 0.55)
}

@Test func refusesARequestThatArrivesWhileTheAppEnds() async throws {
    let calls = Calls()
    let queue = WorkerQueue(planner: FakePlanner(calls: calls, delay: 0), logger: quiet) { _, _ in }
    let refused = queue.refuse(WorkerJob(id: 5, worker: "planner", request: request(), receivedAt: monotonicSeconds(), generation: 1))
    let failure = try decode(refused)
    #expect(failure["status"] == "failed")
    #expect(failure["error"] == ["code": "app.shutting_down", "retry": "after_backoff"])
    #expect(failure["effect"] == ["kind": "none", "state": "not_started"])
    #expect(failure["operation_id"] == "op-1")
    #expect(await calls.order.isEmpty)
    let broken = queue.refuse(WorkerJob(id: 6, worker: "planner", request: Data("{}".utf8), receivedAt: 0, generation: 1))
    #expect(broken == .report(Data(#"{"error":"protocol.invalid_envelope","status":"failed"}"#.utf8)))
}

@Test func wrapsTheOutputInTheResponseFrameBody() {
    let report = WorkerOutput.report(CommandReport(status: "failed", error: "sherpa.internal_failure").encoded())
    #expect(String(decoding: report.frameBody(id: 2), as: UTF8.self)
        == #"{"id":2,"report":{"error":"sherpa.internal_failure","status":"failed"}}"#)
    #expect(String(decoding: WorkerOutput.response(Data("{}".utf8)).frameBody(id: 7), as: UTF8.self)
        == #"{"id":7,"response":{}}"#)
}

@Test func parsesTheRequestFrameBody() throws {
    let body = Data(#"{"id":7,"worker":"planner","request":{"a":1}}"#.utf8)
    let job = try #require(WorkerJob.parse(body, receivedAt: 0, generation: 1))
    #expect(job.id == 7 && job.worker == "planner")
    #expect(try JSONDecoder().decode(JSONObject.self, from: job.request) == ["a": 1])
    #expect(WorkerJob.parse(Data(#"{"id":0,"worker":"planner","request":{}}"#.utf8), receivedAt: 0, generation: 1) == nil)
    #expect(WorkerJob.parse(Data(#"{"id":1,"worker":"planner"}"#.utf8), receivedAt: 0, generation: 1) == nil)
    #expect(WorkerJob.parse(Data(#"{"id":1,"worker":"planner","request":[]}"#.utf8), receivedAt: 0, generation: 1) == nil)
}

// MARK: confirmation requests (contract §9)

@Test func parsesTheConfirmVectorAndRejectsBodiesOutsideTheLimits() throws {
    let vector = #"{"id":3,"tool":"reminder_delete","operation_id":"op-2","client":{"name":"t","version":"0"},"title":"t","lines":[],"timeout_ms":30000}"#
    let request = try ConfirmationRequest.parse(Data(vector.utf8), receivedAt: 10).get()
    #expect(request.id == 3 && request.tool == "reminder_delete" && request.deadline == 40)
    let longTitle = vector.replacingOccurrences(of: #""title":"t""#, with: #""title":"\#(String(repeating: "가", count: 101))""#)
    #expect(ConfirmationRequest.parse(Data(longTitle.utf8), receivedAt: 0) == .failure(.invalid(id: 3)))
    let lines = (0..<13).map { _ in #"{"label":"l","value":"v"}"# }.joined(separator: ",")
    let tooMany = vector.replacingOccurrences(of: #""lines":[]"#, with: #""lines":[\#(lines)]"#)
    #expect(ConfirmationRequest.parse(Data(tooMany.utf8), receivedAt: 0) == .failure(.invalid(id: 3)))
    #expect(ConfirmationRequest.parse(Data(#"{"tool":"x"}"#.utf8), receivedAt: 0) == .failure(.noIdentifier))
}

// MARK: socket folder, lock, environment (contract §3, §7.1)

private func temporaryFolder() throws -> String {
    var template = Array("/tmp/sau.XXXXXX".utf8CString)
    guard let created = mkdtemp(&template) else { throw POSIXError(.EIO) }
    return String(cString: created)
}

@Test func refusesALinkedOrForeignFolderAndFixesAWrongMode() throws {
    let root = try temporaryFolder()
    defer { try? FileManager.default.removeItem(atPath: root) }
    let real = root + "/real", link = root + "/link"
    try FileManager.default.createDirectory(atPath: real, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o755])
    try FileManager.default.createSymbolicLink(atPath: link, withDestinationPath: real)
    #expect(SocketDirectory.validate(path: link) == .directoryIsLink)
    #expect(SocketDirectory.validate(path: real, owner: getuid() + 1) == .directoryForeignOwner)
    #expect(SocketDirectory.validate(path: real) == nil)
    let mode = try FileManager.default.attributesOfItem(atPath: real)[.posixPermissions] as? Int
    #expect(mode == 0o700)
}

@Test func takesTheLockOnceAndCreatesTheFolderPrivate() throws {
    let root = try temporaryFolder()
    defer { try? FileManager.default.removeItem(atPath: root) }
    let location = SocketLocation(socketPath: root + "/Sherpa/run/app.sock", isOverride: true)
    guard case let .acquired(lock) = InstanceLock.acquire(location: location) else {
        Issue.record("lock not acquired")
        return
    }
    guard case .heldByAnotherProcess = InstanceLock.acquire(location: location) else {
        Issue.record("second lock acquired")
        return
    }
    let mode = try FileManager.default.attributesOfItem(atPath: root + "/Sherpa/run")[.posixPermissions] as? Int
    #expect(mode == 0o700)
    let lockMode = try FileManager.default.attributesOfItem(atPath: location.lockPath)[.posixPermissions] as? Int
    #expect(lockMode == 0o600)
    lock.release()
    guard case let .acquired(again) = InstanceLock.acquire(location: location) else {
        Issue.record("lock not released")
        return
    }
    again.release()
}

@Test func bindsAPrivateSocketAndRemovesAStaleOne() throws {
    let root = try temporaryFolder()
    defer { try? FileManager.default.removeItem(atPath: root) }
    let location = SocketLocation(socketPath: root + "/app.sock", isOverride: true)
    chmod(root, 0o700)
    FileManager.default.createFile(atPath: location.socketPath, contents: Data("stale".utf8))
    let listener = try makeListeningSocket(location: location)
    defer { close(listener) }
    var status = stat()
    #expect(lstat(location.socketPath, &status) == 0)
    #expect(status.st_mode & S_IFMT == S_IFSOCK)
    #expect(status.st_mode & 0o777 == 0o600)
    #expect(throws: SocketSetupFailure.pathTooLong) {
        _ = try makeListeningSocket(location: SocketLocation(socketPath: "/" + String(repeating: "a", count: 103), isOverride: true))
    }
}

@Test func passesOnlyTheFourVariablesToTheCore() {
    let environment = AppServerConfiguration.coreEnvironment(from: [
        "HOME": "/Users/x", "TMPDIR": "/var/t/", "LOG_LEVEL": "debug", "PATH": "/opt/evil:/usr/bin",
        "DYLD_INSERT_LIBRARIES": "/tmp/x.dylib", "SHERPA_APP_SOCKET": "/tmp/s",
    ])
    #expect(environment == ["HOME": "/Users/x", "TMPDIR": "/var/t/", "LOG_LEVEL": "debug", "PATH": "/usr/bin:/bin:/usr/sbin:/sbin"])
    #expect(AppServerConfiguration.coreEnvironment(from: ["HOME": "/h", "TMPDIR": "/t"])["LOG_LEVEL"] == nil)
}

@Test func usesTheBundleLayoutAndProductionRequirementsWithoutTestVariables() throws {
    let configuration = try AppServerConfiguration.resolve(executableDirectory: "/Applications/Sherpa.app/Contents/MacOS", version: "1.0.0", environment: [:])
    #expect(configuration.corePath == "/Applications/Sherpa.app/Contents/MacOS/sherpa-core")
    #expect(configuration.coreRequirement == SherpaCodeIdentity.core.requirement)
    #expect(configuration.relayRequirement == SherpaCodeIdentity.relay.requirement)
    #expect(!configuration.socket.isOverride)
    let tested = try AppServerConfiguration.resolve(executableDirectory: "/x", version: "1.0.0", environment: [
        "SHERPA_TEST_CORE_BIN": "/t/core", "SHERPA_RELAY_REQUIREMENT": "identifier \"r\"", "SHERPA_APP_SOCKET": "/t/s.sock",
    ])
    #if DEBUG
    #expect(tested.corePath == "/t/core" && tested.relayRequirement == "identifier \"r\"" && tested.socket.isOverride)
    #else
    #expect(tested.corePath == "/x/sherpa-core" && !tested.socket.isOverride)
    #endif
}

// MARK: queues let go of what they wrote (contract §7.7)

private final class Flag: @unchecked Sendable {
    private let lock = NSLock()
    private var value = false
    func set() { lock.withLock { value = true } }
    var isSet: Bool { lock.withLock { value } }
}

private final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var total = 0
    func add(_ count: Int) { lock.withLock { total += count } }
    var value: Int { lock.withLock { total } }
}

private final class Weak: @unchecked Sendable {
    weak var value: AnyObject?
    init(_ value: AnyObject) { self.value = value }
}

/// A chunk whose storage reports when the last reference to it goes.
private func trackedChunk(_ count: Int, released: Flag) -> Data {
    let pointer = UnsafeMutableRawPointer.allocate(byteCount: count, alignment: 1)
    pointer.initializeMemory(as: UInt8.self, repeating: 0x61, count: count)
    return Data(bytesNoCopy: pointer, count: count, deallocator: .custom { pointer, _ in
        pointer.deallocate()
        released.set()
    })
}

private func socketPair() throws -> (Int32, Int32) {
    var pair: [Int32] = [0, 0]
    guard socketpair(AF_UNIX, SOCK_STREAM, 0, &pair) == 0 else { throw POSIXError(.EIO) }
    for descriptor in pair {
        var on: Int32 = 1
        setsockopt(descriptor, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
    }
    return (pair[0], pair[1])
}

/// Reads from `descriptor` on its own thread until end of file and closes it.
private func readToEnd(_ descriptor: Int32, into counter: Counter) {
    Thread.detachNewThread {
        var buffer = [UInt8](repeating: 0, count: 64 * 1_024)
        while true {
            let count = read(descriptor, &buffer, buffer.count)
            if count <= 0 { break }
            counter.add(count)
        }
        close(descriptor)
    }
}

private func eventually(_ condition: () -> Bool) async -> Bool {
    for _ in 0..<250 {
        if condition() { return true }
        try? await Task.sleep(for: .milliseconds(20))
    }
    return condition()
}

@Test func letsGoOfAWrittenChunkWhileItKeepsRunning() async throws {
    let (writer, reader) = try socketPair()
    let received = Counter()
    readToEnd(reader, into: received)
    let outbox = Outbox(descriptor: writer, limit: nil, failed: { _ in }, ended: { close(writer) })
    let released = Flag()
    let size = 8 * 1_024 * 1_024
    #expect(outbox.enqueue(trackedChunk(size, released: released)))
    // An 8 MiB response, written, with the outbox still open: none of it is kept.
    #expect(await eventually { received.value == size })
    #expect(await eventually { released.isSet })
    #expect(outbox.queuedBytes == 0 && outbox.heldChunks == 0)
    outbox.finish {}
}

@Test func keepsNothingOnceItHasStopped() async throws {
    let (writer, reader) = try socketPair()
    let received = Counter()
    readToEnd(reader, into: received)
    let ended = Flag()
    let outbox = Outbox(descriptor: writer, limit: nil, failed: { _ in }, ended: {
        close(writer)
        ended.set()
    })
    let released = (0..<3).map { _ in Flag() }
    for flag in released { #expect(outbox.enqueue(trackedChunk(256 * 1_024, released: flag))) }
    outbox.finish {}
    #expect(await eventually { ended.isSet })
    #expect(await eventually { released.allSatisfy(\.isSet) })
    #expect(received.value == 3 * 256 * 1_024)
    #expect(outbox.heldChunks == 0)
}

@Test func freesTheConnectionAndOutboxOfEachClosedSession() async throws {
    var held: [Weak] = []
    for index in 0..<20 {
        let (local, remote) = try socketPair()
        do {
            let connection = RelayConnection(
                id: index, descriptor: local, peer: PeerCheck(verdict: .accepted, pid: 0, signingIdentifier: nil)
            )
            connection.openOutbox { _ in }
            #expect(connection.send(Data("ready\n".utf8)))
            // As the server does: the relay's end of file closes the session once its queue is written.
            connection.readLines(
                waitForCapacity: {}, line: { _ in }, tooLarge: {},
                ended: { [weak connection] _ in connection?.closeAfterFlush() }
            )
            held.append(Weak(connection))
            held.append(Weak(try #require(connection.outbox)))
        }
        var buffer = [UInt8](repeating: 0, count: 16)
        _ = read(remote, &buffer, buffer.count)
        close(remote)
    }
    #expect(await eventually { held.allSatisfy { $0.value == nil } })
}

// MARK: the MCP switch and the agent commands (contract §2)

@Test func startsWithMCPOffWhenTheDefaultsHoldNoValue() throws {
    let suite = "dev.xiyo.sherpa.tests.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    #expect(defaults.object(forKey: MCPSetting.key) == nil)
    #expect(!MCPSetting.isEnabled(in: defaults))
    MCPSetting.set(true, in: defaults)
    #expect(MCPSetting.isEnabled(in: defaults))
    MCPSetting.set(false, in: defaults)
    #expect(!MCPSetting.isEnabled(in: defaults))
    #expect(MCPSetting.key == "mcpEnabled")
}

@Test func givesEachMeasuredAgentItsRegistrationCommands() {
    let relay = "/Applications/Sherpa.app/Contents/MacOS/sherpa-relay"
    #expect(AgentSetup.Agent.allCases == [.claudeCode, .codex])
    #expect(AgentSetup.steps(for: .claudeCode, relayPath: relay).map(\.command) == [
        "claude mcp add --scope user sherpa -- /Applications/Sherpa.app/Contents/MacOS/sherpa-relay",
    ])
    #expect(AgentSetup.steps(for: .codex, relayPath: relay).map(\.command) == [
        "codex features enable mcp_2026_07_28",
        "codex mcp add --env CODEX_MCP_PROTOCOL_VERSION=2026-07-28 sherpa -- /Applications/Sherpa.app/Contents/MacOS/sherpa-relay",
    ])
}

@Test func quotesARelayPathOnlyWhenAShellWouldReadItAsMoreThanAWord() {
    #expect(AgentSetup.shellQuoted("/Applications/Sherpa.app/Contents/MacOS/sherpa-relay")
        == "/Applications/Sherpa.app/Contents/MacOS/sherpa-relay")
    #expect(AgentSetup.shellQuoted("/Users/a/My Apps/Sherpa.app") == "'/Users/a/My Apps/Sherpa.app'")
    #expect(AgentSetup.shellQuoted("/Volumes/Kim's/Sherpa.app") == #"'/Volumes/Kim'\''s/Sherpa.app'"#)
    #expect(AgentSetup.shellQuoted("") == "''")
    #expect(AgentSetup.steps(for: .claudeCode, relayPath: "/Users/a/My Apps/Sherpa.app/Contents/MacOS/sherpa-relay")
        .map(\.command) == ["claude mcp add --scope user sherpa -- '/Users/a/My Apps/Sherpa.app/Contents/MacOS/sherpa-relay'"])
}

/// What `shell -c 'printf %s <word>'` prints: the one argument a shell makes of `word`.
private func printedByShell(_ shell: String, _ word: String) -> String? {
    var pipe: [Int32] = [0, 0]
    guard Darwin.pipe(&pipe) == 0 else { return nil }
    var actions: posix_spawn_file_actions_t?
    posix_spawn_file_actions_init(&actions)
    defer { posix_spawn_file_actions_destroy(&actions) }
    posix_spawn_file_actions_adddup2(&actions, pipe[1], STDOUT_FILENO)
    posix_spawn_file_actions_addclose(&actions, pipe[0])
    let argv = [shell, "-c", "printf %s " + word].map { strdup($0) } + [nil]
    let variables: [String] = ["PATH=/usr/bin:/bin", "HOME=/nonexistent"]
    let environment = variables.map { strdup($0) } + [nil]
    defer { (argv + environment).forEach { free($0) } }
    var pid: pid_t = 0
    let spawned = posix_spawn(&pid, shell, &actions, nil, argv, environment)
    close(pipe[1])
    defer { close(pipe[0]) }
    guard spawned == 0 else { return nil }
    var output = Data()
    var buffer = [UInt8](repeating: 0, count: 4_096)
    while true {
        let count = read(pipe[0], &buffer, buffer.count)
        if count > 0 { output.append(contentsOf: buffer[0..<count]) } else if count == 0 || errno != EINTR { break }
    }
    var status: Int32 = 0
    while waitpid(pid, &status, 0) == -1, errno == EINTR {}
    return status == 0 ? String(decoding: output, as: UTF8.self) : nil
}

@Test(arguments: ["/bin/sh", "/bin/zsh", "/bin/bash"])
func quotedPathsReachTheShellAsOneUnchangedWord(_ shell: String) {
    let paths = [
        "/Applications/Sherpa.app/Contents/MacOS/sherpa-relay",
        "/Users/a/My Apps/Sherpa.app/Contents/MacOS/sherpa-relay",
        "/Volumes/Kim's \"Disk\"/$HOME/`id`/a\\b/!x/*?/~/Sherpa.app",
        "/Users/a/응용 프로그램/Sherpa.app",
    ]
    for path in paths {
        #expect(printedByShell(shell, AgentSetup.shellQuoted(path)) == path)
    }
}
