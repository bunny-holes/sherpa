import AppKit
import Foundation
import SherpaAppConnection
import SherpaAppPlanner
import SherpaAppServer
import SherpaWorkerProtocol

// Sherpa.app: the menu bar app that owns Calendar, Reminders, Full Disk Access and
// Automation for Sherpa, listens for relays and runs the core (ADR-0010, app connection
// contract). The instance lock comes before anything else (§3): a second process ends at
// once with status 0 and asks the running one to show its window.

signal(SIGPIPE, SIG_IGN)
let environment = ProcessInfo.processInfo.environment
let logger = AppLog.logger(environment: environment)
WorkerLog.route(to: AppLog.workerSink)

let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? AppBootstrap.unbundledVersion
let executableDirectory = Bundle.main.executableURL?.deletingLastPathComponent().path
    ?? (CommandLine.arguments[0] as NSString).deletingLastPathComponent

let bootstrap: AppBootstrap
do {
    let configuration = try AppServerConfiguration.resolve(
        executableDirectory: executableDirectory, version: version, environment: environment
    )
    switch InstanceLock.acquire(location: configuration.socket) {
    case let .acquired(lock):
        bootstrap = AppBootstrap(version: version, configuration: configuration, lock: lock, setupFailure: nil)
    case .heldByAnotherProcess:
        logger.info("app:lock:acquire", "status=held_by_another_process")
        DistributedNotificationCenter.default().postNotificationName(
            AppBootstrap.showStatusNotification, object: nil, userInfo: nil, deliverImmediately: true
        )
        exit(0)
    case let .failed(step, code):
        logger.error("app:lock:acquire", "status=failed step=\(step) errno=\(code)")
        bootstrap = AppBootstrap(
            version: version, configuration: configuration, lock: nil, setupFailure: "lock_failed step=\(step) errno=\(code)"
        )
    }
} catch {
    logger.error("app:config:resolve", "status=failed reason=home_unavailable")
    bootstrap = AppBootstrap(version: version, configuration: nil, lock: nil, setupFailure: "home_unavailable")
}
AppBootstrap.shared = bootstrap
AppBootstrap.logger = logger
SherpaMenuApp.main()
