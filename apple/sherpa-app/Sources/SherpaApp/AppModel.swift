import AppKit
import Foundation
import Observation
import SherpaAppConnection
import SherpaAppPlanner
import SherpaAppServer

/// The app's state for the menu and the status window, and the composition root that binds
/// the server's ports: the planner to the in-process EventKit code, confirmations to windows.
@MainActor
@Observable
final class AppModel {
    static let shared = AppModel()

    let version: String
    private(set) var status: ServerStatus
    private(set) var setupFailure: String?
    let permissions = PermissionCenter()
    @ObservationIgnored private var server: AppServer?
    @ObservationIgnored private let confirmationWindows = ConfirmationWindows()
    @ObservationIgnored private var refreshTimer: Timer?

    private init() {
        let bootstrap = AppBootstrap.shared!
        version = bootstrap.version
        status = ServerStatus(version: bootstrap.version)
        setupFailure = bootstrap.setupFailure
        if let failure = bootstrap.setupFailure {
            status.listener = .failed(reason: failure)
        }
    }

    /// Starts the server once the app has finished launching.
    func start() {
        let bootstrap = AppBootstrap.shared!
        permissions.refresh()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.permissions.refresh() }
        }
        guard let configuration = bootstrap.configuration, let lock = bootstrap.lock else { return }
        let server = AppServer(
            configuration: configuration, lock: lock,
            planner: InProcessPlanner(environment: ProcessInfo.processInfo.environment),
            confirmations: ConfirmationPresenter(windows: confirmationWindows),
            logger: AppBootstrap.logger,
            coreLogger: { line in AppLog.coreLine(line) },
            observe: { [weak self] status in
                DispatchQueue.main.async { MainActor.assumeIsolated { self?.status = status } }
            }
        )
        self.server = server
        DispatchQueue.global().async { server.start() }
    }

    var canRestartCore: Bool {
        server != nil && (status.core == .failed || status.core == .incompatible)
    }

    func restartCore() {
        guard let server else { return }
        DispatchQueue.global().async { server.restartCore() }
    }

    /// §7.10 on quit. Calls `done` on the main thread when the core and sockets are closed.
    func shutdown(done: @escaping @MainActor () -> Void) {
        refreshTimer?.invalidate()
        guard let server else {
            done()
            return
        }
        DispatchQueue.global().async {
            server.shutdown()
            DispatchQueue.main.async { MainActor.assumeIsolated { done() } }
        }
    }

    var coreSummary: String {
        if status.shuttingDown { return "Shutting down" }
        switch status.listener {
        case let .failed(reason): return "Socket unavailable (\(reason))"
        case .stopped: return "Stopped"
        case .starting, .listening: break
        }
        switch status.core {
        case .starting: return "Starting the core…"
        case .ready: return "Ready"
        case .failed: return "Core stopped after repeated failures"
        case .incompatible: return "Core version does not match the app"
        case .stopped: return "Core stopped"
        }
    }

    /// Where an agent's MCP configuration points (contract §2).
    var relayPath: String {
        Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/sherpa-relay").path
    }
}
