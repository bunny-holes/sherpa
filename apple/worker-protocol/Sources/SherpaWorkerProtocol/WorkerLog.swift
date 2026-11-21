import Foundation

public enum WorkerLog {
    private enum Level: Int {
        case debug = 10
        case info = 20
        case warn = 30
        case error = 40

        var name: String {
            switch self {
            case .debug: "debug"
            case .info: "info"
            case .warn: "warn"
            case .error: "error"
            }
        }
    }

    private static let configuredLevel: Level = {
        switch ProcessInfo.processInfo.environment["LOG_LEVEL"]?.lowercased() {
        case "debug": .debug
        case "info": .info
        case "error": .error
        default: .warn
        }
    }()

    public static func debug(_ message: String) { write(.debug, message) }
    public static func info(_ message: String) { write(.info, message) }
    public static func warn(_ message: String) { write(.warn, message) }
    public static func error(_ message: String) { write(.error, message) }

    /// Where a line goes once it passes `LOG_LEVEL`. A command writes to standard error; a host
    /// without a useful standard error (Sherpa.app) routes the same lines to its own log.
    public typealias Sink = @Sendable (_ level: String, _ message: String) -> Void

    private static let sinkLock = NSLock()
    nonisolated(unsafe) private static var sink: Sink?

    /// Sends every later line to `sink` instead of standard error.
    public static func route(to sink: @escaping Sink) {
        sinkLock.lock()
        defer { sinkLock.unlock() }
        self.sink = sink
    }

    private static func write(_ level: Level, _ message: String) {
        guard level.rawValue >= configuredLevel.rawValue else { return }
        sinkLock.lock()
        let routed = sink
        sinkLock.unlock()
        if let routed {
            routed(level.name, message)
        } else {
            FileHandle.standardError.write(Data((message + "\n").utf8))
        }
    }
}
