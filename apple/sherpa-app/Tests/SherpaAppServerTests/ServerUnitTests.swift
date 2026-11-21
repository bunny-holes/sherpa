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
        "SHERPA_CORE_BIN": "/t/core", "SHERPA_RELAY_REQUIREMENT": "identifier \"r\"", "SHERPA_APP_SOCKET": "/t/s.sock",
    ])
    #if DEBUG
    #expect(tested.corePath == "/t/core" && tested.relayRequirement == "identifier \"r\"" && tested.socket.isOverride)
    #else
    #expect(tested.corePath == "/x/sherpa-core" && !tested.socket.isOverride)
    #endif
}
