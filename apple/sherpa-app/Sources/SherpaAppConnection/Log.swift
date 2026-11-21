import Foundation

public enum LogLevel: Int, Comparable, Sendable {
    case debug = 10
    case info = 20
    case warn = 30
    case error = 40

    public var name: String {
        switch self {
        case .debug: "debug"
        case .info: "info"
        case .warn: "warn"
        case .error: "error"
        }
    }

    public init?(name: String) {
        switch name.lowercased() {
        case "debug": self = .debug
        case "info": self = .info
        case "warn": self = .warn
        case "error": self = .error
        default: return nil
        }
    }

    /// `LOG_LEVEL`, warn when unset or unknown.
    public static func threshold(environment: [String: String]) -> LogLevel {
        environment["LOG_LEVEL"].flatMap(LogLevel.init(name:)) ?? .warn
    }

    public static func < (lhs: LogLevel, rhs: LogLevel) -> Bool { lhs.rawValue < rhs.rawValue }
}

/// Writes `<level> [<layer>:<module>:<action>] key=value …`, the format the core uses
/// (contract §12). Callers pass only values the contract allows in a log: codes, counts,
/// channel numbers, pids, signing identifiers, versions. Never message bodies or paths.
public struct SherpaLogger: Sendable {
    public typealias Sink = @Sendable (LogLevel, String) -> Void

    public let threshold: LogLevel
    private let sink: Sink

    public init(threshold: LogLevel, sink: @escaping Sink) {
        self.threshold = threshold
        self.sink = sink
    }

    public static func standardError(threshold: LogLevel) -> SherpaLogger {
        SherpaLogger(threshold: threshold) { _, line in
            FileHandle.standardError.write(Data((line + "\n").utf8))
        }
    }

    public func enabled(_ level: LogLevel) -> Bool { level >= threshold }

    public func log(_ level: LogLevel, _ scope: String, _ fields: String = "") {
        guard enabled(level) else { return }
        sink(level, fields.isEmpty ? "\(level.name) [\(scope)]" : "\(level.name) [\(scope)] \(fields)")
    }

    public func debug(_ scope: String, _ fields: String = "") { log(.debug, scope, fields) }
    public func info(_ scope: String, _ fields: String = "") { log(.info, scope, fields) }
    public func warn(_ scope: String, _ fields: String = "") { log(.warn, scope, fields) }
    public func error(_ scope: String, _ fields: String = "") { log(.error, scope, fields) }
}

/// A value safe to put in a log field: ASCII letters, digits, `.`, `_`, `-`, at most
/// 128 bytes. Anything else, such as a peer's self-chosen signing identifier, becomes
/// `invalid`.
public func logToken(_ value: String?) -> String {
    guard let value else { return "none" }
    let allowed = !value.isEmpty && value.utf8.count <= 128 && value.utf8.allSatisfy {
        (0x30...0x39).contains($0) || (0x41...0x5a).contains($0) || (0x61...0x7a).contains($0)
            || $0 == 0x2e || $0 == 0x5f || $0 == 0x2d
    }
    return allowed ? value : "invalid"
}
