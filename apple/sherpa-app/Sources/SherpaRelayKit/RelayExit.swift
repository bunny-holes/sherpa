import Darwin
import SherpaAppConnection

/// The relay's exit codes, from `sysexits.h` (contract §6).
public enum RelayExit: Int32, Sendable {
    case success = 0
    case usage = 64
    case unavailable = 69
    case software = 70
    case ioError = 74
    case temporaryFailure = 75
    case protocolError = 76
    case noPermission = 77
    case configuration = 78
}

/// A reason to end with a non-zero code, and the error line that says so.
public struct RelayFailure: Error, Equatable, Sendable {
    public let exit: RelayExit
    public let scope: String
    public let reason: String
    public let fields: String
    public let remedy: String

    public init(_ exit: RelayExit, scope: String, reason: String, fields: String = "", remedy: String) {
        self.exit = exit
        self.scope = scope
        self.reason = reason
        self.fields = fields
        self.remedy = remedy
    }

    /// `reason=… [fields] remedy="…"`
    public var logFields: String {
        let middle = fields.isEmpty ? "" : " \(fields)"
        return "reason=\(reason)\(middle) remedy=\"\(remedy)\""
    }
}

/// The exit-code table, kept apart from the I/O so a unit test can read it.
public enum RelayExitTable {
    /// `connect(2)` failures: no socket file or no listener means the app is not running.
    public static func connectFailure(errno code: Int32, socket: SocketLocation) -> RelayFailure {
        if code == ENOENT || code == ECONNREFUSED {
            return RelayFailure(
                .unavailable, scope: "relay:socket:connect", reason: "app_not_running",
                fields: "socket=\(socket.logValue)", remedy: "start Sherpa.app"
            )
        }
        return RelayFailure(
            .ioError, scope: "relay:socket:connect", reason: "connect_failed",
            fields: "errno=\(code) socket=\(socket.logValue)", remedy: "restart Sherpa.app"
        )
    }

    /// What the relay does with the app's first line. Nil means: copy bytes.
    public static func preface(_ reading: PrefaceReading) -> RelayFailure? {
        switch reading {
        case .ready:
            return nil
        case let .refused(reason):
            return RelayFailure(
                .noPermission, scope: "relay:preface:read", reason: "relay_refused",
                fields: "app_reason=\(reason)", remedy: "reinstall Sherpa.app"
            )
        case let .unavailable(reason):
            return RelayFailure(
                .temporaryFailure, scope: "relay:preface:read", reason: "app_unavailable",
                fields: "app_reason=\(reason)", remedy: unavailableRemedy(reason)
            )
        case let .invalid(defect):
            return RelayFailure(
                .protocolError, scope: "relay:preface:read", reason: defect.rawValue,
                remedy: "reinstall Sherpa.app"
            )
        }
    }

    public static let prefaceMissing = RelayFailure(
        .protocolError, scope: "relay:preface:read", reason: "preface_missing", remedy: "reinstall Sherpa.app"
    )

    public static let prefaceTimedOut = RelayFailure(
        .temporaryFailure, scope: "relay:preface:read", reason: "preface_timeout",
        remedy: "restart Sherpa.app and reconnect"
    )

    /// The socket ended while standard input was still open: the app ended the session, because
    /// the person turned MCP off or the core ended. The relay cannot tell which (§6).
    public static let appClosedSession = RelayFailure(
        .temporaryFailure, scope: "relay:session:copy", reason: "app_closed_session",
        remedy: "if you turned MCP off in Sherpa.app, turn it on first; then \(reconnectAgent)"
    )

    /// How each measured agent starts the server again. It holds whether or not the agent
    /// remembers the failed attempt: Claude Code's /mcp Reconnect, a new Codex session (§6).
    static let reconnectAgent = "reconnect the server (Claude Code: /mcp, then Reconnect; Codex: start a new session)"

    public static func signature(_ check: PeerCheck) -> RelayFailure {
        let reason = check.verdict == .otherUser ? "server_user_rejected" : "server_signature_rejected"
        return RelayFailure(
            .noPermission, scope: "relay:signature:check", reason: reason, fields: check.logFields,
            remedy: "reinstall Sherpa.app"
        )
    }

    /// A reason this relay does not know still ends with 75; only its remedy is generic (§5).
    static func unavailableRemedy(_ reason: String) -> String {
        switch reason {
        case AppPreface.Reason.mcpDisabled.rawValue: "turn on MCP in Sherpa.app, then \(reconnectAgent)"
        case AppPreface.Reason.coreStarting.rawValue: "wait a few seconds and reconnect"
        case AppPreface.Reason.coreFailed.rawValue: "restart the core from the Sherpa menu, then reconnect"
        case AppPreface.Reason.coreIncompatible.rawValue: "reinstall Sherpa.app"
        case AppPreface.Reason.tooManySessions.rawValue: "end another agent session, then reconnect"
        case AppPreface.Reason.shuttingDown.rawValue: "start Sherpa.app, then reconnect"
        default: "restart Sherpa.app, then reconnect"
        }
    }
}
