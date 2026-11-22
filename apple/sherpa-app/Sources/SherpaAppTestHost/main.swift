import Darwin
import Foundation
import SherpaAppConnection
import SherpaAppPlanner
import SherpaAppServer

// The socket server of Sherpa.app without its menu, for the process tests of contract
// §13.2. It reads the same DEBUG test variables as the app and answers confirmations with a
// scripted decision. A release build only prints the configuration it resolves, so the gate
// can give it every test variable and see that a release build ignores them.
//
// The MCP switch starts as `--mcp on|off` says, off without it as in the app's first launch,
// and a line `mcp on` or `mcp off` on standard input turns it as the app's toggle does.

/// `--print-configuration`: what this build resolves from its environment, one field a line.
func printConfiguration() -> Never {
    let directory = (CommandLine.arguments[0] as NSString).deletingLastPathComponent
    guard
        let configuration = try? AppServerConfiguration.resolve(
            executableDirectory: directory, version: "0.0.0", environment: ProcessInfo.processInfo.environment
        )
    else {
        FileHandle.standardError.write(Data("[testhost:config:resolve] reason=home_unavailable\n".utf8))
        exit(70)
    }
    print("socket=\(configuration.socket.socketPath)")
    print("socket_override=\(configuration.socket.isOverride)")
    print("core=\(configuration.corePath)")
    print("core_requirement=\(configuration.coreRequirement)")
    print("relay_requirement=\(configuration.relayRequirement)")
    exit(0)
}

if CommandLine.arguments.dropFirst().first == "--print-configuration" { printConfiguration() }

#if DEBUG
struct ScriptedConfirmations: ConfirmationPort {
    let decision: ConfirmationDecision?
    let logger: SherpaLogger

    func present(_ request: ConfirmationRequest, decide: @escaping @Sendable (ConfirmationDecision) -> Void) {
        logger.info("testhost:confirm:present", "id=\(request.id) lines=\(request.lines.count)")
        guard let decision else { return }
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.05) { decide(decision) }
    }

    func withdraw(id: UInt64) {
        logger.info("testhost:confirm:withdraw", "id=\(id)")
    }

    func withdrawAll() {
        logger.info("testhost:confirm:withdraw-all")
    }
}

signal(SIGPIPE, SIG_IGN)
let environment = ProcessInfo.processInfo.environment
let logger = SherpaLogger.standardError(threshold: LogLevel.threshold(environment: environment))
var version = "0.0.0"
var decision: ConfirmationDecision? = .approved
var timing = ServerTiming()
var mcpEnabled = false
var arguments = Array(CommandLine.arguments.dropFirst())
while !arguments.isEmpty {
    let name = arguments.removeFirst()
    guard let value = arguments.first else {
        logger.error("testhost:cli:arguments", "reason=missing_value")
        exit(64)
    }
    arguments.removeFirst()
    switch name {
    case "--version": version = value
    case "--confirm": decision = value == "ignore" ? nil : ConfirmationDecision(rawValue: value)
    case "--restart-scale": timing.restartScale = Double(value) ?? 1
    case "--hello-timeout": timing.helloTimeout = Double(value) ?? 10
    case "--exit-handling-delay": timing.exitHandlingDelay = Double(value) ?? 0
    case "--mcp":
        guard value == "on" || value == "off" else {
            logger.error("testhost:cli:arguments", "reason=invalid_mcp_value")
            exit(64)
        }
        mcpEnabled = value == "on"
    default:
        logger.error("testhost:cli:arguments", "reason=unknown_argument")
        exit(64)
    }
}

let executableDirectory = (CommandLine.arguments[0] as NSString).deletingLastPathComponent
var configuration: AppServerConfiguration
do {
    configuration = try AppServerConfiguration.resolve(
        executableDirectory: executableDirectory, version: version, environment: environment
    )
} catch {
    logger.error("testhost:config:resolve", "reason=home_unavailable")
    exit(70)
}
configuration.timing = timing

let lock: InstanceLock
switch InstanceLock.acquire(location: configuration.socket) {
case let .acquired(acquired):
    lock = acquired
case .heldByAnotherProcess:
    logger.info("app:lock:acquire", "status=held_by_another_process")
    exit(0)
case let .failed(step, code):
    logger.error("app:lock:acquire", "status=failed step=\(step) errno=\(code)")
    exit(70)
}

let server = AppServer(
    configuration: configuration, lock: lock, mcpEnabled: mcpEnabled,
    planner: InProcessPlanner(environment: environment),
    confirmations: ScriptedConfirmations(decision: decision, logger: logger), logger: logger,
    coreLogger: { @Sendable line in FileHandle.standardError.write(Data(("core: " + line + "\n").utf8)) },
    observe: { @Sendable status in
        logger.debug("testhost:status", "core=\(status.core.rawValue) sessions=\(status.sessions)")
    }
)
let terminate = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
signal(SIGTERM, SIG_IGN)
terminate.setEventHandler { @Sendable in
    server.shutdown()
    exit(0)
}
terminate.resume()
Thread.detachNewThread {
    while let line = readLine() {
        switch line {
        case "mcp on": server.setMCPEnabled(true)
        case "mcp off": server.setMCPEnabled(false)
        default: logger.warn("testhost:control:read", "reason=unknown_command")
        }
    }
}
server.start()
dispatchMain()
#else
FileHandle.standardError.write(Data("sherpa-app-testhost runs only in a DEBUG build\n".utf8))
exit(70)
#endif
