import Foundation
import SherpaAppConnection
import SherpaWorkerProtocol

/// What one work request produced: a V2 response or a command report (§8). Both are the
/// JSON that `sherpa-apple planner request` writes for the same input.
public enum WorkerOutput: Sendable, Equatable {
    case response(Data)
    case report(Data)
}

/// The app-owned port for the `planner` worker. The composition root binds it to the
/// in-process EventKit handling; tests bind a fake.
public protocol PlannerPort: Sendable {
    func respond(to request: Data) async -> WorkerOutput
}

/// One `0	request` frame.
public struct WorkerJob: Sendable {
    public let id: UInt64
    public let worker: String
    /// The request envelope as the bytes the core sent, so the 64 KiB limit and the planner
    /// see what the helper's standard input would hold.
    public let request: Data
    /// Monotonic seconds when the app read the frame; the deadline counts from here.
    public let receivedAt: Double
    public let generation: Int

    public init(id: UInt64, worker: String, request: Data, receivedAt: Double, generation: Int) {
        self.id = id
        self.worker = worker
        self.request = request
        self.receivedAt = receivedAt
        self.generation = generation
    }

    /// `{"id":N,"worker":"…","request":{…}}`; nil when the body does not have that shape.
    public static func parse(_ body: Data, receivedAt: Double, generation: Int) -> WorkerJob? {
        guard let object = try? JSONDecoder().decode(JSONObject.self, from: body),
            Set(object.keys) == ["id", "worker", "request"],
            case let .integer(id)? = object["id"], id > 0, UInt64(id) <= MuxFrame.maximumChannel,
            case let .string(worker)? = object["worker"],
            case .object? = object["request"],
            let request = RawJSONMember.value(of: "request", in: body)
        else { return nil }
        return WorkerJob(
            id: UInt64(id), worker: worker, request: request, receivedAt: receivedAt, generation: generation)
    }
}

/// The bytes of one member's value in a JSON object, exactly as they arrived. Encoding the
/// decoded value again would change them (`/` becomes `\/`, spacing and number forms change).
/// The body has already decoded as an object; this only finds where each value ends.
enum RawJSONMember {
    /// Nil when the member is missing, appears more than once, or the text is not an object.
    static func value(of name: String, in body: Data) -> Data? {
        let bytes = [UInt8](body)
        var index = 0

        func skipSpace() {
            while index < bytes.count,
                bytes[index] == 0x20 || bytes[index] == 0x09 || bytes[index] == 0x0a || bytes[index] == 0x0d
            {
                index += 1
            }
        }
        // At a quote; ends after the closing quote.
        func skipString() -> Bool {
            index += 1
            while index < bytes.count {
                switch bytes[index] {
                case 0x5c: index += 2
                case 0x22:
                    index += 1
                    return true
                default: index += 1
                }
            }
            return false
        }
        func skipValue() -> Bool {
            guard index < bytes.count else { return false }
            switch bytes[index] {
            case 0x22:
                return skipString()
            case 0x7b, 0x5b:
                var depth = 0
                while index < bytes.count {
                    switch bytes[index] {
                    case 0x22:
                        guard skipString() else { return false }
                        continue
                    case 0x7b, 0x5b:
                        depth += 1
                    case 0x7d, 0x5d:
                        depth -= 1
                        if depth == 0 {
                            index += 1
                            return true
                        }
                    default:
                        break
                    }
                    index += 1
                }
                return false
            default:
                let start = index
                while index < bytes.count, ![0x2c, 0x7d, 0x5d, 0x20, 0x09, 0x0a, 0x0d].contains(bytes[index]) {
                    index += 1
                }
                return index > start
            }
        }

        skipSpace()
        guard index < bytes.count, bytes[index] == 0x7b else { return nil }
        index += 1
        var found: Range<Int>?
        skipSpace()
        if index < bytes.count, bytes[index] == 0x7d { return nil }
        while true {
            skipSpace()
            guard index < bytes.count, bytes[index] == 0x22 else { return nil }
            let keyStart = index
            guard skipString() else { return nil }
            let key = try? JSONDecoder().decode(String.self, from: Data(bytes[keyStart..<index]))
            skipSpace()
            guard index < bytes.count, bytes[index] == 0x3a else { return nil }
            index += 1
            skipSpace()
            let valueStart = index
            guard skipValue() else { return nil }
            if key == name {
                guard found == nil else { return nil }
                found = valueStart..<index
            }
            skipSpace()
            guard index < bytes.count else { return nil }
            if bytes[index] == 0x2c {
                index += 1
                continue
            }
            guard bytes[index] == 0x7d else { return nil }
            break
        }
        return found.map { Data(bytes[$0]) }
    }
}

/// Runs work requests one at a time in the order they arrived (§8). A request whose deadline
/// passed before it started is answered `app.deadline_exceeded` without running; a worker
/// other than `planner` is answered `app.unsupported_worker`.
public final class WorkerQueue: @unchecked Sendable {
    public static let supportedWorkers: Set<String> = ["planner"]
    public static let requestLimit = 64 * 1_024

    private let planner: PlannerPort
    private let logger: SherpaLogger
    private let now: @Sendable () -> Double
    private let reply: @Sendable (WorkerJob, WorkerOutput) -> Void
    private let continuation: AsyncStream<WorkerJob>.Continuation
    private let condition = NSCondition()
    /// Deadlines (monotonic seconds) of requests queued or running.
    private var outstanding: [UInt64: Double] = [:]
    private var sequence: UInt64 = 0

    public init(
        planner: PlannerPort, logger: SherpaLogger, now: @escaping @Sendable () -> Double = monotonicSeconds,
        reply: @escaping @Sendable (WorkerJob, WorkerOutput) -> Void
    ) {
        self.planner = planner
        self.logger = logger
        self.now = now
        self.reply = reply
        let (stream, continuation) = AsyncStream.makeStream(of: WorkerJob.self)
        self.continuation = continuation
        Task.detached { [self] in
            for await job in stream {
                let output = await process(job)
                reply(job, output)
                finished(job)
            }
        }
    }

    public func enqueue(_ job: WorkerJob) {
        let deadline = Self.deadlineMilliseconds(of: job.request).map { job.receivedAt + Double($0) / 1_000 }
        condition.lock()
        sequence += 1
        outstanding[key(job)] = deadline ?? job.receivedAt
        condition.unlock()
        continuation.yield(job)
    }

    /// Waits until every request queued or running at the call has answered, but not past
    /// the latest of their deadlines nor `limit` seconds (§7.10). A request that arrives
    /// meanwhile does not extend the wait.
    public func waitUntilIdle(limit: Double) {
        condition.lock()
        defer { condition.unlock() }
        let waiting = Set(outstanding.keys)
        guard let latest = outstanding.values.max() else { return }
        let start = now()
        let end = start + min(max(0, latest - start), limit)
        while outstanding.keys.contains(where: waiting.contains) {
            let remaining = end - now()
            if remaining <= 0 { return }
            _ = condition.wait(until: Date(timeIntervalSinceNow: remaining))
        }
    }

    /// The answer to a request that arrived after the app began to end: V2 failure
    /// `app.shutting_down`, not started (§7.10). The planner does not see it.
    public func refuse(_ job: WorkerJob) -> WorkerOutput {
        guard job.request.count <= Self.requestLimit else {
            return report(job, CommandReport(protocolFailure: .requestTooLarge))
        }
        let request: WorkerRequest
        do {
            request = try WorkerRequest(data: job.request)
        } catch let failure as WorkerProtocolError {
            return report(job, CommandReport(protocolFailure: failure))
        } catch {
            return report(job, CommandReport(status: "failed", error: "sherpa.internal_failure"))
        }
        logger.warn(
            "app:worker:request",
            "id=\(job.id) worker=\(logToken(job.worker)) capability=\(logToken(request.capability)) "
                + "operation_id=\(logToken(request.operationID)) code=app.shutting_down")
        return failure(request, code: "app.shutting_down", retry: .afterBackoff, job: job)
    }

    public var outstandingCount: Int {
        condition.lock()
        defer { condition.unlock() }
        return outstanding.count
    }

    private func key(_ job: WorkerJob) -> UInt64 {
        UInt64(truncatingIfNeeded: job.generation) << 40 ^ job.id
    }

    private func finished(_ job: WorkerJob) {
        condition.lock()
        outstanding[key(job)] = nil
        condition.broadcast()
        condition.unlock()
    }

    func process(_ job: WorkerJob) async -> WorkerOutput {
        let started = now()
        guard job.request.count <= Self.requestLimit else {
            return report(job, CommandReport(protocolFailure: .requestTooLarge))
        }
        let request: WorkerRequest
        do {
            request = try WorkerRequest(data: job.request)
        } catch let failure as WorkerProtocolError {
            return report(job, CommandReport(protocolFailure: failure))
        } catch {
            return report(job, CommandReport(status: "failed", error: "sherpa.internal_failure"))
        }
        let fields =
            "id=\(job.id) worker=\(logToken(job.worker)) capability=\(logToken(request.capability)) "
            + "operation_id=\(logToken(request.operationID))"
        guard Self.supportedWorkers.contains(job.worker) else {
            logger.warn("app:worker:request", "\(fields) code=app.unsupported_worker")
            return failure(request, code: "app.unsupported_worker", retry: .never, job: job)
        }
        if started - job.receivedAt >= Double(request.deadlineMilliseconds) / 1_000 {
            logger.warn("app:worker:request", "\(fields) code=app.deadline_exceeded")
            return failure(request, code: "app.deadline_exceeded", retry: .afterBackoff, job: job)
        }
        logger.info("app:worker:start", fields)
        let output = await planner.respond(to: job.request)
        let elapsed = Int((now() - started) * 1_000)
        switch output {
        case let .response(data):
            logger.info("app:worker:finish", "\(fields) output=response bytes=\(data.count) duration_ms=\(elapsed)")
        case let .report(data):
            logger.error("app:worker:finish", "\(fields) output=report bytes=\(data.count) duration_ms=\(elapsed)")
        }
        return output
    }

    private func failure(_ request: WorkerRequest, code: String, retry: RetryDisposition, job: WorkerJob)
        -> WorkerOutput
    {
        do {
            return .response(try WorkerResponse.failure(request: request, code: code, retry: retry).encoded())
        } catch {
            return report(job, CommandReport(status: "failed", error: "sherpa.internal_failure"))
        }
    }

    private func report(_ job: WorkerJob, _ report: CommandReport) -> WorkerOutput {
        logger.warn("app:worker:request", "id=\(job.id) \(report.logFields)")
        return .report(report.encoded())
    }

    static func deadlineMilliseconds(of request: Data) -> Int? {
        guard let object = try? JSONDecoder().decode(JSONObject.self, from: request) else { return nil }
        return object["deadline_ms"]?.integer
    }
}

public extension WorkerOutput {
    /// The `0	response` body: `{"id":N,"response":…}` or `{"id":N,"report":…}`.
    func frameBody(id: UInt64) -> Data {
        var body = Data("{\"id\":\(id),".utf8)
        switch self {
        case let .response(data):
            body.append(Data("\"response\":".utf8))
            body.append(data)
        case let .report(data):
            body.append(Data("\"report\":".utf8))
            body.append(data)
        }
        body.append(0x7d)
        return body
    }
}
