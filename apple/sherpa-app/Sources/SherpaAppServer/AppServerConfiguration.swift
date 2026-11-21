import Darwin
import Foundation
import SherpaAppConnection

/// Timings of contract §3, §7.5, §7.8 and §7.10. Only the DEBUG test host scales them.
public struct ServerTiming: Sendable {
    public var coreReadyWait: Double = 10
    public var helloTimeout: Double = 10
    public var violationKillGrace: Double = 5
    public var shutdownInputGrace: Double = 5
    public var shutdownTerminateGrace: Double = 5
    /// The longest the app waits for work requests when it ends (§7.10).
    public var shutdownWorkLimit: Double = 35
    /// Multiplies restart delays and the restart window.
    public var restartScale: Double = 1
    /// A pause after a core's exit is recorded and before the rest of its handling: a test
    /// widens that gap to show that shutdown's last status does not depend on it.
    public var exitHandlingDelay: Double = 0

    public init() {}
}

/// Everything that decides where the app listens, what it runs and whom it trusts. A
/// release build takes all of it from fixed values and the bundle layout; a DEBUG build
/// also reads the test variables of contract §13.2.
public struct AppServerConfiguration: Sendable {
    public static let maximumSessions = 16
    public static let listenBacklog: Int32 = 16
    public static let corePath = "/usr/bin:/bin:/usr/sbin:/sbin"

    public var socket: SocketLocation
    public var corePath: String
    public var coreRequirement: String
    public var relayRequirement: String
    /// The app's CLI version. The core's hello must name the same one.
    public var version: String
    public var coreEnvironment: [String: String]
    public var timing: ServerTiming

    public init(
        socket: SocketLocation, corePath: String, coreRequirement: String, relayRequirement: String,
        version: String, coreEnvironment: [String: String], timing: ServerTiming = ServerTiming()
    ) {
        self.socket = socket
        self.corePath = corePath
        self.coreRequirement = coreRequirement
        self.relayRequirement = relayRequirement
        self.version = version
        self.coreEnvironment = coreEnvironment
        self.timing = timing
    }

    /// The configuration of an app whose executables sit in `executableDirectory`
    /// (`Sherpa.app/Contents/MacOS`).
    public static func resolve(
        executableDirectory: String, version: String, environment: [String: String]
    ) throws -> AppServerConfiguration {
        var configuration = AppServerConfiguration(
            socket: try SocketLocation.resolve(environment: environment),
            corePath: executableDirectory + "/sherpa-core",
            coreRequirement: SherpaCodeIdentity.core.requirement,
            relayRequirement: SherpaCodeIdentity.relay.requirement,
            version: version,
            coreEnvironment: coreEnvironment(from: environment)
        )
        #if DEBUG
        if let core = environment["SHERPA_TEST_CORE_BIN"], !core.isEmpty { configuration.corePath = core }
        if let relay = environment["SHERPA_RELAY_REQUIREMENT"], !relay.isEmpty {
            configuration.relayRequirement = relay
        }
        if let core = environment["SHERPA_CORE_REQUIREMENT"], !core.isEmpty {
            configuration.coreRequirement = core
        }
        #endif
        return configuration
    }

    /// No inherited environment: `HOME`, `TMPDIR`, a fixed `PATH` and `LOG_LEVEL` (§7.1).
    public static func coreEnvironment(from environment: [String: String]) -> [String: String] {
        var result = ["PATH": corePath]
        if let home = environment["HOME"], !home.isEmpty {
            result["HOME"] = home
        } else if let home = try? UserHome.directory() {
            result["HOME"] = home
        }
        if let temporary = environment["TMPDIR"], !temporary.isEmpty {
            result["TMPDIR"] = temporary
        } else if let temporary = userTemporaryDirectory() {
            result["TMPDIR"] = temporary
        }
        if let level = environment["LOG_LEVEL"], !level.isEmpty { result["LOG_LEVEL"] = level }
        return result
    }

    private static func userTemporaryDirectory() -> String? {
        let size = confstr(_CS_DARWIN_USER_TEMP_DIR, nil, 0)
        guard size > 0 else { return nil }
        var buffer = [CChar](repeating: 0, count: size)
        guard confstr(_CS_DARWIN_USER_TEMP_DIR, &buffer, size) > 0 else { return nil }
        return String(decoding: buffer.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self)
    }
}
