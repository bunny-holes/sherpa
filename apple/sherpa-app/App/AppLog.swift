import Foundation
import SherpaAppConnection
import os

/// The app writes the same lines as the core and the relay to the unified log, subsystem
/// `dev.xiyo.sherpa` (contract §12). Every line is built from values the contract allows
/// in a log, so it is public. Read it with
/// `/usr/bin/log show --predicate 'subsystem == "dev.xiyo.sherpa"'`.
enum AppLog {
    static let subsystem = "dev.xiyo.sherpa"
    private static let app = Logger(subsystem: subsystem, category: "app")
    private static let core = Logger(subsystem: subsystem, category: "core")
    private static let planner = Logger(subsystem: subsystem, category: "planner")

    static func logger(environment: [String: String]) -> SherpaLogger {
        SherpaLogger(threshold: LogLevel.threshold(environment: environment)) { level, line in
            write(app, level, line)
        }
    }

    /// Lines of the core's standard error; the core already applied `LOG_LEVEL`.
    static func coreLine(_ line: String) {
        let level = line.split(separator: " ", maxSplits: 1).first.flatMap { LogLevel(name: String($0)) } ?? .info
        write(core, level, line)
    }

    /// Lines of the shared planner code (`WorkerLog`).
    static let workerSink: @Sendable (String, String) -> Void = { level, line in
        write(planner, LogLevel(name: level) ?? .info, line)
    }

    private static func write(_ logger: Logger, _ level: LogLevel, _ line: String) {
        switch level {
        case .debug: logger.debug("\(line, privacy: .public)")
        case .info: logger.info("\(line, privacy: .public)")
        case .warn: logger.notice("\(line, privacy: .public)")
        case .error: logger.error("\(line, privacy: .public)")
        }
    }
}
