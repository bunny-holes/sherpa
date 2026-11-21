/// What the menu shows and what a waiting relay is told (§3, §5).
public struct ServerStatus: Sendable, Equatable {
    public enum Core: String, Sendable {
        case starting, ready, failed, incompatible, stopped
    }

    public enum Listener: Sendable, Equatable {
        case starting
        case listening
        /// `socket_failed` with the reason a log names.
        case failed(reason: String)
        case stopped
    }

    public var core: Core = .stopped
    public var listener: Listener = .starting
    public var sessions = 0
    public var shuttingDown = false
    public let version: String

    public init(version: String) {
        self.version = version
    }
}
