import Darwin
import Foundation
import SherpaAppConnection

/// sherpa-relay: one agent's stdio MCP session, copied byte for byte to Sherpa.app's socket
/// after both sides have checked each other's signature (contract §6).
public enum Relay {
    public static let prefaceTimeoutMilliseconds: Int32 = 15_000
    static let copyBufferBytes = 64 * 1_024

    public static func main(arguments: [String], environment: [String: String]) -> Never {
        signal(SIGPIPE, SIG_IGN)
        let logger = SherpaLogger.standardError(threshold: LogLevel.threshold(environment: environment))
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
        switch arguments {
        case []:
            break
        case ["--version"]:
            guard let version else {
                fail(
                    RelayFailure(
                        .software, scope: "relay:cli:version", reason: "version_unavailable",
                        remedy: "run the relay inside Sherpa.app"), logger: logger)
            }
            print("sherpa-relay \(version)")
            exit(RelayExit.success.rawValue)
        case ["--help"]:
            print(help(version: version))
            exit(RelayExit.success.rawValue)
        default:
            fail(
                RelayFailure(
                    .usage, scope: "relay:cli:arguments", reason: "unknown_argument",
                    remedy: "run sherpa-relay with no arguments"), logger: logger)
        }
        do {
            switch try connect(environment: environment, logger: logger) {
            case let .ready(session):
                session.copy()
            case let .mcpDisabled(appVersion, failure):
                MCPDisabledSession.serve(version: appVersion, failure: failure, logger: logger)
            }
        } catch let failure as RelayFailure {
            fail(failure, logger: logger)
        } catch {
            fail(
                RelayFailure(
                    .software, scope: "relay:session:open", reason: "internal_failure",
                    remedy: "restart Sherpa.app"), logger: logger)
        }
    }

    static func fail(_ failure: RelayFailure, logger: SherpaLogger) -> Never {
        logger.error(failure.scope, failure.logFields)
        exit(failure.exit.rawValue)
    }

    private enum Connection {
        case ready(CopySession)
        case mcpDisabled(version: String, failure: RelayFailure)
    }

    /// Path, connect, signature, preface. Only a verified app can report that MCP is off.
    private static func connect(environment: [String: String], logger: SherpaLogger) throws -> Connection {
        let location: SocketLocation
        do {
            location = try SocketLocation.resolve(environment: environment)
        } catch {
            throw RelayFailure(
                .software, scope: "relay:socket:path", reason: "home_unavailable",
                remedy: "check the user account")
        }
        guard location.fitsSocketAddress, let address = unixSocketAddress(location.socketPath) else {
            throw RelayFailure(
                .configuration, scope: "relay:socket:path", reason: "socket_path_too_long",
                fields: "socket=\(location.logValue) bytes=\(location.socketPath.utf8.count)",
                remedy: "use a home folder path of at most 48 bytes")
        }
        let requirement = appRequirement(environment: environment)

        logger.debug("relay:socket:connect", "socket=\(location.logValue)")
        let socket = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard socket >= 0 else {
            throw RelayFailure(
                .software, scope: "relay:socket:create", reason: "socket_create_failed",
                fields: "errno=\(errno)", remedy: "restart the agent")
        }
        var connectAddress = address
        let connected = withUnsafePointer(to: &connectAddress) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(socket, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard connected == 0 else {
            let code = errno
            close(socket)
            throw RelayExitTable.connectFailure(errno: code, socket: location)
        }

        // Nothing is read or written before the app's signature passes.
        let check: PeerCheck
        do {
            check = try CodeSignature.check(socket: socket, requirement: requirement)
        } catch {
            close(socket)
            throw RelayFailure(
                .software, scope: "relay:signature:check", reason: "check_unavailable",
                fields: "error=\(error)", remedy: "restart Sherpa.app")
        }
        guard check.verdict == .accepted else {
            logger.warn("relay:signature:check", "status=rejected \(check.logFields)")
            close(socket)
            throw RelayExitTable.signature(check)
        }
        logger.debug("relay:signature:check", "status=accepted \(check.logFields)")

        let (reading, leftover): (PrefaceReading, Data)
        do {
            (reading, leftover) = try readPreface(socket: socket)
        } catch {
            close(socket)
            throw error
        }
        if let failure = RelayExitTable.preface(reading) {
            close(socket)
            if case let .unavailable(reason, appVersion) = reading, reason == AppPreface.Reason.mcpDisabled.rawValue {
                return .mcpDisabled(version: appVersion, failure: failure)
            }
            throw failure
        }
        if case let .ready(appVersion) = reading {
            logger.info("relay:session:open", "socket=\(location.logValue) app_version=\(logToken(appVersion))")
        }
        return .ready(CopySession(socket: socket, leftover: leftover, logger: logger))
    }

    /// The app's requirement: the production one, or a DEBUG build's `SHERPA_APP_REQUIREMENT`.
    static func appRequirement(environment: [String: String]) -> String {
        #if DEBUG
        if let override = environment["SHERPA_APP_REQUIREMENT"], !override.isEmpty { return override }
        #endif
        return SherpaCodeIdentity.app.requirement
    }

    /// Reads the preface line within 15 seconds. Bytes after its line feed are MCP bytes and
    /// are returned for standard output.
    static func readPreface(socket: Int32) throws -> (PrefaceReading, Data) {
        var received = Data()
        var buffer = [UInt8](repeating: 0, count: 4_096)
        let deadline = DispatchTime.now().uptimeNanoseconds + UInt64(prefaceTimeoutMilliseconds) * 1_000_000
        while true {
            if let feed = received.firstIndex(of: 0x0a) {
                guard feed - received.startIndex <= AppPreface.maximumBytes - 1 else {
                    return (.invalid(.wrongShape), Data())
                }
                let line = received[received.startIndex..<feed]
                let leftover = received[received.index(after: feed)...]
                return (AppPreface.read(line: Data(line)), Data(leftover))
            }
            guard received.count < AppPreface.maximumBytes else { return (.invalid(.wrongShape), Data()) }
            let now = DispatchTime.now().uptimeNanoseconds
            guard now < deadline else { throw RelayExitTable.prefaceTimedOut }
            var descriptor = pollfd(fd: socket, events: Int16(POLLIN), revents: 0)
            let remaining = Int32(min(UInt64(Int32.max), (deadline - now + 999_999) / 1_000_000))
            let ready = poll(&descriptor, 1, remaining)
            if ready < 0 {
                if errno == EINTR { continue }
                throw RelayFailure(
                    .ioError, scope: "relay:preface:read", reason: "socket_poll_failed",
                    fields: "errno=\(errno)", remedy: "restart Sherpa.app")
            }
            if ready == 0 { continue }
            let result = buffer.withUnsafeMutableBytes { FileDescriptorIO.read(socket, into: $0) }
            switch result {
            case let .bytes(count):
                received.append(contentsOf: buffer[0..<count])
            case .endOfFile:
                throw RelayExitTable.prefaceMissing
            case let .failed(code):
                throw RelayFailure(
                    .ioError, scope: "relay:preface:read", reason: "socket_read_failed",
                    fields: "errno=\(code)", remedy: "restart Sherpa.app")
            }
        }
    }

    static func help(version: String?) -> String {
        """
        sherpa-relay \(version ?? "") — the MCP stdio server "sherpa" for agents

        An agent starts this relay with no arguments. It connects to Sherpa.app's socket,
        checks the app's code signature, and copies MCP messages between its standard input
        and output and the app. Sherpa.app must be running; the relay does not start it.

          sherpa-relay            serve one MCP session
          sherpa-relay --version  print the version
          sherpa-relay --help     print this help

        Exit codes: 0 session ended, 64 unknown argument, 69 Sherpa.app not running,
        70 internal error, 74 I/O error, 75 app unavailable (MCP turned off in Sherpa.app,
        core not ready, too many sessions) or session ended by the app, 76 app protocol
        error, 77 signature rejected, 78 socket path too long.
        """
    }
}

/// Copies both directions on their own threads so neither waits for the other (contract
/// §7.7). The first thread to reach an end decides the exit code.
final class CopySession: @unchecked Sendable {
    private let socket: Int32
    private let leftover: Data
    private let logger: SherpaLogger
    private let lock = NSLock()
    private var inputClosed = false

    init(socket: Int32, leftover: Data, logger: SherpaLogger) {
        self.socket = socket
        self.leftover = leftover
        self.logger = logger
    }

    func copy() -> Never {
        Thread.detachNewThread { [self] in copyInput() }
        Thread.detachNewThread { [self] in copyOutput() }
        while true { pause() }
    }

    /// Ends the process once. A second caller waits here until the process is gone.
    private func finish(_ failure: RelayFailure?) -> Never {
        lock.lock()
        if let failure {
            logger.error(failure.scope, failure.logFields)
            exit(failure.exit.rawValue)
        }
        logger.info("relay:session:close", "status=ended")
        exit(RelayExit.success.rawValue)
    }

    private var isInputClosed: Bool {
        lock.lock()
        defer { lock.unlock() }
        return inputClosed
    }

    /// Standard input to the socket. At end of input the write side closes and the other
    /// thread finishes reading what the app still sends.
    private func copyInput() {
        var buffer = [UInt8](repeating: 0, count: Relay.copyBufferBytes)
        while true {
            let step: RelayFailure?? = autoreleasepool {
                let result = buffer.withUnsafeMutableBytes { FileDescriptorIO.read(STDIN_FILENO, into: $0) }
                switch result {
                case let .bytes(count):
                    let failed = buffer.withUnsafeBytes {
                        FileDescriptorIO.writeAll(socket, UnsafeRawBufferPointer(rebasing: $0[0..<count]))
                    }
                    guard let failed else { return .none }
                    if failed == EPIPE { return .some(RelayExitTable.appClosedSession) }
                    return .some(
                        RelayFailure(
                            .ioError, scope: "relay:session:copy", reason: "socket_write_failed",
                            fields: "errno=\(failed)", remedy: "restart Sherpa.app"))
                case .endOfFile:
                    return .some(nil)
                case let .failed(code):
                    return .some(
                        RelayFailure(
                            .ioError, scope: "relay:session:copy", reason: "stdin_read_failed",
                            fields: "errno=\(code)", remedy: "restart the agent"))
                }
            }
            switch step {
            case .none:
                continue
            case .some(.none):
                lock.lock()
                inputClosed = true
                lock.unlock()
                logger.debug("relay:session:copy", "stdin=eof")
                shutdown(socket, SHUT_WR)
                return
            case let .some(.some(failure)):
                finish(failure)
            }
        }
    }

    /// The socket to standard output, starting with bytes that arrived with the preface.
    private func copyOutput() {
        if !leftover.isEmpty {
            let failed = leftover.withUnsafeBytes { FileDescriptorIO.writeAll(STDOUT_FILENO, $0) }
            if let failed { outputFailed(failed) }
        }
        var buffer = [UInt8](repeating: 0, count: Relay.copyBufferBytes)
        while true {
            let ended: Bool = autoreleasepool {
                let result = buffer.withUnsafeMutableBytes { FileDescriptorIO.read(socket, into: $0) }
                switch result {
                case let .bytes(count):
                    let failed = buffer.withUnsafeBytes {
                        FileDescriptorIO.writeAll(STDOUT_FILENO, UnsafeRawBufferPointer(rebasing: $0[0..<count]))
                    }
                    if let failed { outputFailed(failed) }
                    return false
                case .endOfFile:
                    return true
                case let .failed(code):
                    finish(
                        RelayFailure(
                            .ioError, scope: "relay:session:copy", reason: "socket_read_failed",
                            fields: "errno=\(code)", remedy: "restart Sherpa.app"))
                }
            }
            if ended {
                finish(isInputClosed ? nil : RelayExitTable.appClosedSession)
            }
        }
    }

    /// `EPIPE` on standard output: the agent left. Close the socket and end normally.
    private func outputFailed(_ code: Int32) -> Never {
        if code == EPIPE {
            close(socket)
            logger.debug("relay:session:copy", "stdout=closed")
            finish(nil)
        }
        finish(
            RelayFailure(
                .ioError, scope: "relay:session:copy", reason: "stdout_write_failed",
                fields: "errno=\(code)", remedy: "restart the agent"))
    }
}
