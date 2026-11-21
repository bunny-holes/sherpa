import Foundation
import SherpaAppConnection
import SherpaAppServer

/// What `main.swift` settled before SwiftUI starts: the configuration, the held lock, or why
/// the socket cannot be served.
final class AppBootstrap: Sendable {
    static let showStatusNotification = Notification.Name("dev.xiyo.sherpa.show-status")
    /// A DEBUG build run outside a bundle has no Info.plist version.
    #if DEBUG
    static let unbundledVersion = "0.0.0-debug"
    #else
    static let unbundledVersion = "unknown"
    #endif

    nonisolated(unsafe) static var shared: AppBootstrap!
    nonisolated(unsafe) static var logger: SherpaLogger!

    let version: String
    let configuration: AppServerConfiguration?
    let lock: InstanceLock?
    let setupFailure: String?

    init(version: String, configuration: AppServerConfiguration?, lock: InstanceLock?, setupFailure: String?) {
        self.version = version
        self.configuration = configuration
        self.lock = lock
        self.setupFailure = setupFailure
    }
}
