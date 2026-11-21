import Darwin
import Foundation
import SherpaAppConnection
import SherpaWorkerProtocol

/// Sherpa.app's socket server: it accepts and checks relays, writes their preface, runs one
/// core, multiplexes every relay session onto it, and serves the core's work and
/// confirmation requests (contract §3–§9). All mutable state sits behind one condition.
public final class AppServer: @unchecked Sendable {
    public typealias StatusObserver = @Sendable (ServerStatus) -> Void

    private let configuration: AppServerConfiguration
    private let lock: InstanceLock
    private let confirmations: ConfirmationPort
    private let logger: SherpaLogger
    private let coreLogger: @Sendable (String) -> Void
    private let observe: StatusObserver
    /// One serial queue for every status the observer receives.
    private let statusDelivery = DispatchQueue(label: "dev.xiyo.sherpa.app-server.status")
    private var workers: WorkerQueue!

    private let state = NSCondition()
    private var status: ServerStatus
    private var listener: Int32 = -1
    private var core: CoreProcess?
    private var generation = 0
    private var coreStartedAt = 0.0
    private var helloReceived = false
    private var nextChannel: UInt64 = 1
    private var channels: [UInt64: RelayConnection] = [:]
    private var connections: [Int: RelayConnection] = [:]
    private var nextConnectionID = 0
    private var pendingConfirmations: Set<UInt64> = []
    private var policy: RestartPolicy
    private var shuttingDown = false
    private var coreGone = NSCondition()

    /// `coreLogger` receives each line of the core's standard error, cut at 4 KiB.
    public init(
        configuration: AppServerConfiguration, lock: InstanceLock, planner: PlannerPort,
        confirmations: ConfirmationPort, logger: SherpaLogger,
        coreLogger: @escaping @Sendable (String) -> Void, observe: @escaping StatusObserver
    ) {
        self.configuration = configuration
        self.lock = lock
        self.confirmations = confirmations
        self.logger = logger
        self.coreLogger = coreLogger
        self.observe = observe
        status = ServerStatus(version: configuration.version)
        policy = RestartPolicy(scale: configuration.timing.restartScale)
        workers = WorkerQueue(planner: planner, logger: logger) { [weak self] job, output in
            self?.answer(job, output)
        }
    }

    public var currentStatus: ServerStatus {
        state.lock()
        defer { state.unlock() }
        return status
    }

    // MARK: start, restart, shutdown

    /// Folder check, bind and listen, then the core (§3). A socket that cannot be set up
    /// leaves the app running with the listener `failed` and no core.
    public func start() {
        logger.info("app:socket:listen", "status=start socket=\(configuration.socket.logValue)")
        let descriptor: Int32
        do {
            descriptor = try makeListeningSocket(location: configuration.socket)
        } catch {
            logger.error("app:socket:listen", "status=socket_failed reason=\(error.reason) socket=\(configuration.socket.logValue)")
            update { $0.listener = .failed(reason: error.reason) }
            return
        }
        state.lock()
        listener = descriptor
        status.listener = .listening
        publishLocked()
        state.unlock()
        logger.info("app:socket:listen", "status=listening socket=\(configuration.socket.logValue)")
        Thread.detachNewThread { [self] in acceptLoop(descriptor) }
        launchCore()
    }

    /// The menu's restart after `core_failed` or `core_incompatible`.
    public func restartCore() {
        state.lock()
        let stopped = core == nil && !shuttingDown && (status.core == .failed || status.core == .incompatible)
        if stopped { policy.reset() }
        state.unlock()
        guard stopped else { return }
        logger.info("app:core:restart", "trigger=menu")
        launchCore()
    }

    /// The orderly end of §7.10. Blocks; call it off the main thread.
    public func shutdown() {
        state.lock()
        guard !shuttingDown else {
            state.unlock()
            return
        }
        shuttingDown = true
        status.shuttingDown = true
        state.broadcast()
        publishLocked()
        state.unlock()
        logger.info("app:server:shutdown", "status=start outstanding_requests=\(workers.outstandingCount)")

        // Requests that arrive from now on are refused, so this wait does not grow.
        workers.waitUntilIdle(limit: configuration.timing.shutdownWorkLimit)

        state.lock()
        let running = core
        state.unlock()
        if let running {
            running.closeInput()
            if !waitForCoreExit(seconds: configuration.timing.shutdownInputGrace) {
                logger.warn("app:core:stop", "pid=\(running.pid) signal=TERM")
                running.signal(SIGTERM)
                if !waitForCoreExit(seconds: configuration.timing.shutdownTerminateGrace) {
                    logger.warn("app:core:stop", "pid=\(running.pid) signal=KILL")
                    running.signal(SIGKILL)
                    _ = waitForCoreExit(seconds: 5)
                }
            }
        }

        state.lock()
        let open = Array(connections.values)
        connections.removeAll()
        channels.removeAll()
        let descriptor = listener
        listener = -1
        status.sessions = 0
        status.listener = .stopped
        // Also when no core ran, or one outlived SIGKILL: the server has stopped it.
        status.core = .stopped
        publishLocked()
        state.unlock()
        open.forEach { $0.closeNow() }
        if descriptor >= 0 {
            Darwin.shutdown(descriptor, SHUT_RDWR)
            close(descriptor)
            unlink(configuration.socket.socketPath)
        }
        lock.release()
        // The observer has the final status before the caller goes on, perhaps to exit.
        statusDelivery.sync {}
        logger.info("app:server:shutdown", "status=done")
    }

    private func waitForCoreExit(seconds: Double) -> Bool {
        let deadline = Date(timeIntervalSinceNow: seconds)
        coreGone.lock()
        defer { coreGone.unlock() }
        while true {
            state.lock()
            let running = core != nil
            state.unlock()
            if !running { return true }
            if !coreGone.wait(until: deadline) {
                state.lock()
                defer { state.unlock() }
                return core == nil
            }
        }
    }

    // MARK: core

    private func launchCore() {
        state.lock()
        guard !shuttingDown, core == nil else {
            state.unlock()
            return
        }
        generation += 1
        let launching = generation
        nextChannel = 1
        helloReceived = false
        status.core = .starting
        publishLocked()
        state.unlock()

        // The core runs only after the code it is running passes the core requirement (§2).
        let process: CoreProcess
        do {
            process = try CoreProcess.spawn(
                path: configuration.corePath, environment: configuration.coreEnvironment,
                requirement: configuration.coreRequirement, generation: launching
            )
        } catch .signatureRejected(let status) {
            logger.error("app:core:signature", "status=rejected os_status=\(status)")
            coreCannotRun(generation: launching)
            return
        } catch .requirementInvalid(let status) {
            logger.error("app:core:signature", "status=unavailable reason=requirement_invalid os_status=\(status)")
            coreCannotRun(generation: launching)
            return
        } catch {
            logger.error("app:core:launch", "status=failed error=\(error)")
            state.lock()
            let current = generation == launching
            state.unlock()
            if current { scheduleRestart(after: monotonicSeconds(), generation: launching) }
            return
        }
        state.lock()
        guard generation == launching, !shuttingDown else {
            state.unlock()
            process.signal(SIGKILL)
            return
        }
        core = process
        coreStartedAt = monotonicSeconds()
        state.unlock()
        logger.info("app:core:signature", "status=accepted pid=\(process.pid) duration_ms=\(process.signatureMilliseconds)")
        logger.info("app:core:launch", "status=started pid=\(process.pid) generation=\(launching)")

        process.start(
            frames: { [weak self] frames in self?.coreFrames(frames, from: process) ?? false },
            violation: { [weak self] violation in self?.coreViolated(violation, process: process) },
            errorLine: { [coreLogger] line in coreLogger(line) },
            exited: { [weak self] termination in self?.coreExited(termination, process: process) }
        )
        let timeout = configuration.timing.helloTimeout
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout) { [weak self] in
            self?.helloDeadline(process)
        }
    }

    /// A core whose signature fails is not started again automatically.
    private func coreCannotRun(generation launching: Int) {
        update { status in
            guard self.generation == launching else { return }
            status.core = .failed
        }
        state.lock()
        state.broadcast()
        state.unlock()
    }

    private func helloDeadline(_ process: CoreProcess) {
        state.lock()
        let late = core === process && !helloReceived
        state.unlock()
        guard late else { return }
        logger.error("app:core:hello", "status=timeout pid=\(process.pid)")
        stop(process, reason: "hello_timeout")
    }

    /// Ends a core after a violation or a missing hello; its exit follows the restart rule.
    private func stop(_ process: CoreProcess, reason: String) {
        process.signal(SIGTERM)
        DispatchQueue.global().asyncAfter(deadline: .now() + configuration.timing.violationKillGrace) { [weak self] in
            guard let self else { return }
            state.lock()
            let alive = core === process
            state.unlock()
            if alive {
                logger.warn("app:core:stop", "pid=\(process.pid) signal=KILL reason=\(reason)")
                process.signal(SIGKILL)
            }
        }
    }

    private func coreViolated(_ violation: MuxViolation, process: CoreProcess) {
        logger.error("app:core:frame", "status=violation code=\(violation.code) pid=\(process.pid)")
        stop(process, reason: violation.code)
    }

    private func coreExited(_ termination: CoreTermination, process: CoreProcess) {
        state.lock()
        guard core === process else {
            state.unlock()
            return
        }
        core = nil
        helloReceived = false
        let closing = Array(channels.values)
        for connection in closing { connections[connection.id] = nil }
        channels.removeAll()
        pendingConfirmations.removeAll()
        status.sessions = connections.count
        let endedAt = monotonicSeconds()
        let startedAt = coreStartedAt
        let incompatible = status.core == .incompatible
        let planned = shuttingDown
        // In the same step that clears the core: shutdown() waits for that and then publishes
        // its last status, which must already say stopped.
        if planned {
            status.core = .stopped
            publishLocked()
        }
        state.unlock()
        coreGone.lock()
        coreGone.broadcast()
        coreGone.unlock()
        if configuration.timing.exitHandlingDelay > 0 {
            Thread.sleep(forTimeInterval: configuration.timing.exitHandlingDelay)
        }

        if planned {
            logger.info("app:core:exit", "pid=\(process.pid) \(termination.logFields) sessions_closed=\(closing.count)")
        } else {
            logger.error("app:core:exit", "pid=\(process.pid) \(termination.logFields) sessions_closed=\(closing.count)")
        }
        // A session lives in the core, so every relay ends with 75 and reconnects (§7.8).
        closing.forEach { $0.closeAfterFlush() }
        confirmations.withdrawAll()
        guard !planned, !incompatible else { return }
        scheduleRestart(after: endedAt, startedAt: startedAt, generation: process.generation)
    }

    private func scheduleRestart(after endedAt: Double, startedAt: Double? = nil, generation ended: Int) {
        state.lock()
        let decision = policy.coreEnded(at: endedAt, startedAt: startedAt ?? endedAt)
        if case .stop = decision {
            status.core = .failed
            state.broadcast()
        } else {
            status.core = .starting
        }
        publishLocked()
        state.unlock()
        switch decision {
        case .stop:
            logger.error("app:core:restart", "status=stopped reason=core_failed exits_in_window=\(RestartPolicy.maximumExitsInWindow)")
        case let .restart(delay):
            logger.info("app:core:restart", "status=scheduled delay_ms=\(Int(delay * 1_000))")
            DispatchQueue.global().asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let self else { return }
                state.lock()
                let due = generation == ended && core == nil && !shuttingDown && status.core == .starting
                state.unlock()
                if due { launchCore() }
            }
        }
    }

    /// Frames from one core, in order. Returns false once that core is no longer handled.
    private func coreFrames(_ frames: [MuxFrame], from process: CoreProcess) -> Bool {
        for frame in frames {
            if let violation = handle(frame, from: process) {
                coreViolated(violation, process: process)
                return false
            }
        }
        return true
    }

    private func handle(_ frame: MuxFrame, from process: CoreProcess) -> MuxViolation? {
        state.lock()
        guard core === process else {
            state.unlock()
            return nil
        }
        guard helloReceived else {
            state.unlock()
            guard frame.channel == 0, frame.type == "hello", let body = frame.body else { return .unexpectedFrame }
            return coreHello(body, from: process)
        }
        defer { state.unlock() }
        if frame.channel != 0 {
            let connection = channels[frame.channel]
            switch frame.type {
            case "data":
                guard let connection, let body = frame.body else {
                    logger.debug("app:mux:route", "channel=\(frame.channel) type=data status=dropped")
                    return nil
                }
                logger.debug("app:mux:route", "channel=\(frame.channel) type=data bytes=\(body.count)")
                var line = body
                line.append(0x0a)
                if !connection.send(line) {
                    channels[frame.channel] = nil
                    connections[connection.id] = nil
                    status.sessions = connections.count
                    process.send(MuxFrame(channel: frame.channel, type: "close", json: #"{"reason":"slow_consumer"}"#))
                    logger.warn("app:mux:route", "channel=\(frame.channel) status=closed reason=slow_consumer")
                    connection.closeNow()
                    publishLocked()
                }
            case "close":
                guard let connection else {
                    logger.debug("app:mux:route", "channel=\(frame.channel) type=close status=dropped")
                    return nil
                }
                channels[frame.channel] = nil
                connections[connection.id] = nil
                status.sessions = connections.count
                logger.info("app:session:close", "channel=\(frame.channel) by=core")
                connection.closeAfterFlush()
                publishLocked()
            default:
                return .unexpectedFrame
            }
            return nil
        }
        guard let body = frame.body else { return .frameInvalid }
        switch frame.type {
        case "request":
            guard let job = WorkerJob.parse(body, receivedAt: monotonicSeconds(), generation: process.generation) else {
                return .frameInvalid
            }
            if shuttingDown {
                // Not started: the app is ending (§7.10).
                process.send(MuxFrame(channel: 0, type: "response", body: workers.refuse(job).frameBody(id: job.id)))
            } else {
                workers.enqueue(job)
            }
        case "confirm":
            switch ConfirmationRequest.parse(body, receivedAt: monotonicSeconds()) {
            case .failure(.noIdentifier):
                return .frameInvalid
            case let .failure(.invalid(id)):
                logger.warn("app:confirm:request", "id=\(id) status=invalid decision=unavailable")
                process.send(MuxFrame(channel: 0, type: "confirmation",
                                      json: #"{"id":\#(id),"decision":"unavailable"}"#))
            case let .success(request):
                pendingConfirmations.insert(request.id)
                logger.info("app:confirm:request", "id=\(request.id) tool=\(logToken(request.tool)) "
                    + "operation_id=\(logToken(request.operationID)) client=\(logToken(request.clientName)) "
                    + "client_version=\(logToken(request.clientVersion))")
                let generation = process.generation
                confirmations.present(request) { [weak self] decision in
                    self?.decided(request.id, decision, generation: generation)
                }
            }
        case "withdraw":
            guard let object = try? JSONDecoder().decode(JSONObject.self, from: body),
                  case let .integer(rawID)? = object["id"], rawID > 0
            else { return .frameInvalid }
            let id = UInt64(rawID)
            if pendingConfirmations.remove(id) != nil {
                logger.info("app:confirm:withdraw", "id=\(id)")
                confirmations.withdraw(id: id)
            } else {
                logger.debug("app:confirm:withdraw", "id=\(id) status=unknown")
            }
        case "fatal":
            let code = (try? JSONDecoder().decode(JSONObject.self, from: body))?["code"]?.string
            logger.error("app:core:fatal", "pid=\(process.pid) code=\(logToken(code))")
        default:
            return .unexpectedFrame
        }
        return nil
    }

    /// The core's first frame (§7.5). Same `mux` and version: answer and become ready.
    /// Anything else: an installation whose parts disagree, not restarted.
    private func coreHello(_ body: Data, from process: CoreProcess) -> MuxViolation? {
        let object = try? JSONDecoder().decode(JSONObject.self, from: body)
        guard let object else { return .frameInvalid }
        let coreVersion = object["version"]?.string
        state.lock()
        guard core === process else {
            state.unlock()
            return nil
        }
        guard object["mux"] == .integer(1), coreVersion == configuration.version else {
            status.core = .incompatible
            state.broadcast()
            publishLocked()
            state.unlock()
            logger.error("app:core:hello", "status=incompatible pid=\(process.pid) core_version=\(logToken(coreVersion)) "
                + "app_version=\(logToken(configuration.version)) mux=\(object["mux"]?.integer ?? -1)")
            stop(process, reason: "core_incompatible")
            return nil
        }
        helloReceived = true
        process.send(MuxFrame(
            channel: 0, type: "hello",
            json: #"{"mux":1,"version":\#(jsonLiteral(configuration.version)),"workers":["planner"]}"#
        ))
        status.core = .ready
        policyReadyLog(process)
        state.broadcast()
        publishLocked()
        state.unlock()
        return nil
    }

    private func policyReadyLog(_ process: CoreProcess) {
        logger.info("app:core:hello", "status=ready pid=\(process.pid) version=\(logToken(configuration.version))")
    }

    private func decided(_ id: UInt64, _ decision: ConfirmationDecision, generation: Int) {
        state.lock()
        defer { state.unlock() }
        guard let core, core.generation == generation, pendingConfirmations.remove(id) != nil else {
            logger.debug("app:confirm:decision", "id=\(id) decision=\(decision.rawValue) status=dropped")
            return
        }
        logger.info("app:confirm:decision", "id=\(id) decision=\(decision.rawValue)")
        core.send(MuxFrame(channel: 0, type: "confirmation", json: #"{"id":\#(id),"decision":"\#(decision.rawValue)"}"#))
    }

    private func answer(_ job: WorkerJob, _ output: WorkerOutput) {
        state.lock()
        defer { state.unlock() }
        guard let core, core.generation == job.generation else {
            // The core that asked is gone; the work ran and is journaled (§7.8).
            logger.warn("app:worker:response", "id=\(job.id) status=dropped reason=core_gone")
            return
        }
        core.send(MuxFrame(channel: 0, type: "response", body: output.frameBody(id: job.id)))
    }

    // MARK: relays

    private func acceptLoop(_ descriptor: Int32) {
        while true {
            let accepted = accept(descriptor, nil, nil)
            if accepted < 0 {
                if errno == EINTR || errno == ECONNABORTED { continue }
                state.lock()
                let closing = listener != descriptor
                state.unlock()
                if closing { return }
                logger.error("app:socket:accept", "status=failed errno=\(errno)")
                Thread.sleep(forTimeInterval: 0.1)
                continue
            }
            _ = fcntl(accepted, F_SETFD, FD_CLOEXEC)
            var on: Int32 = 1
            setsockopt(accepted, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
            Thread.detachNewThread { [self] in admit(accepted) }
        }
    }

    /// Signature, preface, channel (§4, §5, §7.6). Nothing reaches the core before the
    /// relay's signature passes and the preface `ready` is queued.
    private func admit(_ descriptor: Int32) {
        let check: PeerCheck
        do {
            check = try CodeSignature.check(socket: descriptor, requirement: configuration.relayRequirement)
        } catch {
            logger.error("app:signature:check", "status=unavailable error=\(error)")
            let refused = RelayConnection(id: -1, descriptor: descriptor, peer: PeerCheck(verdict: .signatureRejected(status: -1), pid: -1, signingIdentifier: nil))
            refused.reject(with: .refused(.peerSignature, version: configuration.version))
            return
        }
        let connection = makeConnection(descriptor: descriptor, check: check)
        guard check.verdict == .accepted else {
            let reason: AppPreface.Reason = check.verdict == .otherUser ? .peerUser : .peerSignature
            logger.warn("app:signature:check", "status=rejected reason=\(reason.rawValue) \(check.logFields)")
            connection.reject(with: .refused(reason, version: configuration.version))
            return
        }
        logger.debug("app:signature:check", "status=accepted \(check.logFields)")

        state.lock()
        if shuttingDown {
            state.unlock()
            connection.reject(with: .unavailable(.shuttingDown, version: configuration.version))
            return
        }
        guard connections.count < AppServerConfiguration.maximumSessions else {
            state.unlock()
            logger.warn("app:session:open", "status=refused reason=too_many_sessions pid=\(check.pid)")
            connection.reject(with: .unavailable(.tooManySessions, version: configuration.version))
            return
        }
        connections[connection.id] = connection
        status.sessions = connections.count
        publishLocked()

        // A relay that arrives before the core is ready waits up to 10 seconds (§3).
        let deadline = Date(timeIntervalSinceNow: configuration.timing.coreReadyWait)
        while !shuttingDown, status.core == .starting || (status.core == .ready && !helloReceived) {
            if !state.wait(until: deadline) { break }
        }
        let refusal: AppPreface.Reason? = if shuttingDown {
            .shuttingDown
        } else if let core, helloReceived, status.core == .ready {
            admitReady(connection, core: core)
        } else {
            switch status.core {
            case .failed, .stopped: .coreFailed
            case .incompatible: .coreIncompatible
            case .starting, .ready: .coreStarting
            }
        }
        if let refusal {
            connections[connection.id] = nil
            status.sessions = connections.count
            publishLocked()
            state.unlock()
            logger.warn("app:session:open", "status=unavailable reason=\(refusal.rawValue) pid=\(check.pid)")
            connection.reject(with: .unavailable(refusal, version: configuration.version))
            return
        }
        state.unlock()
    }

    /// Under the lock: preface, channel number, `open`, reader. Returns nil on success.
    private func admitReady(_ connection: RelayConnection, core: CoreProcess) -> AppPreface.Reason? {
        let channel = nextChannel
        nextChannel += 1
        connection.channel = channel
        connection.generation = core.generation
        channels[channel] = connection
        connection.openOutbox { [weak self, weak connection] _ in
            guard let self, let connection else { return }
            relayEnded(connection, reason: "write_failed")
        }
        _ = connection.send(AppPreface.ready(version: configuration.version).line())
        core.send(MuxFrame(channel: channel, type: "open"))
        logger.info("app:session:open", "channel=\(channel) \(connection.peer.logFields)")
        connection.readLines(
            waitForCapacity: { [weak self] in self?.waitForCoreCapacity() },
            line: { [weak self, weak connection] line in
                guard let self, let connection else { return }
                relayLine(line, from: connection)
            },
            tooLarge: { [weak self, weak connection] in
                guard let self, let connection else { return }
                relayEnded(connection, reason: "message_too_large")
            },
            ended: { [weak self, weak connection] code in
                guard let self, let connection else { return }
                relayEnded(connection, reason: code.map { "read_failed errno=\($0)" } ?? "eof")
            }
        )
        return nil
    }

    private func makeConnection(descriptor: Int32, check: PeerCheck) -> RelayConnection {
        state.lock()
        nextConnectionID += 1
        let id = nextConnectionID
        state.unlock()
        return RelayConnection(id: id, descriptor: descriptor, peer: check)
    }

    private func waitForCoreCapacity() {
        state.lock()
        let input = core?.input
        state.unlock()
        input?.waitUntilBelow(RelayConnection.outboxLimit)
    }

    private func relayLine(_ line: Data, from connection: RelayConnection) {
        state.lock()
        defer { state.unlock() }
        guard let channel = connection.channel, channels[channel] === connection, let core,
              core.generation == connection.generation
        else { return }
        logger.debug("app:mux:route", "channel=\(channel) type=data bytes=\(line.count) from=relay")
        core.send(MuxFrame(channel: channel, type: "data", body: line))
    }

    /// The relay's socket ended, failed, or sent a line over 4 MiB (§7.4, §7.6).
    private func relayEnded(_ connection: RelayConnection, reason: String) {
        state.lock()
        var notify = false
        if let channel = connection.channel, channels[channel] === connection {
            channels[channel] = nil
            notify = true
            if let core, core.generation == connection.generation {
                let close = reason == "message_too_large"
                    ? MuxFrame(channel: channel, type: "close", json: #"{"reason":"message_too_large"}"#)
                    : MuxFrame(channel: channel, type: "close")
                core.send(close)
            }
        }
        if connections.removeValue(forKey: connection.id) != nil { notify = true }
        status.sessions = connections.count
        if notify { publishLocked() }
        state.unlock()
        if reason == "message_too_large" {
            logger.warn("app:session:close", "channel=\(connection.channel ?? 0) by=app reason=message_too_large")
        } else if notify {
            logger.info("app:session:close", "channel=\(connection.channel ?? 0) by=relay reason=\(reason)")
        }
        connection.closeAfterFlush()
    }

    // MARK: status

    private func update(_ change: (inout ServerStatus) -> Void) {
        state.lock()
        change(&status)
        publishLocked()
        state.unlock()
    }

    /// Called with the lock held, so the observer sees every change in the order it happened.
    private func publishLocked() {
        let snapshot = status
        statusDelivery.async { [observe] in observe(snapshot) }
    }
}

/// A JSON string literal (the version is a Sherpa-built value, but it is escaped anyway).
func jsonLiteral(_ value: String) -> String {
    String(decoding: (try? JSONEncoder().encode(value)) ?? Data("\"\"".utf8), as: UTF8.self)
}
