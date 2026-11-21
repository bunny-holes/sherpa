import Foundation

/// When a core that ended on its own is started again (contract §7.8): at once, then after
/// 1, 2, 4, 8, 16 seconds (at most 30) while it keeps ending, and not at all once it has
/// ended five times within 120 seconds. A run that lasted the whole window ends the streak.
/// Times are seconds on a monotonic clock, passed in so a test can supply them.
public struct RestartPolicy: Sendable, Equatable {
    public static let window: Double = 120
    public static let maximumExitsInWindow = 5
    public static let maximumDelay: Double = 30

    public enum Decision: Equatable, Sendable {
        case restart(after: Double)
        case stop
    }

    private let scale: Double
    private var exits: [Double] = []
    private var streak = 0

    public init(scale: Double = 1) {
        self.scale = scale
    }

    public mutating func coreEnded(at now: Double, startedAt: Double) -> Decision {
        let window = Self.window * scale
        exits = exits.filter { now - $0 < window } + [now]
        if exits.count >= Self.maximumExitsInWindow { return .stop }
        if now - startedAt >= window { streak = 0 }
        let delay = streak == 0 ? 0 : min(pow(2, Double(streak - 1)), Self.maximumDelay)
        streak += 1
        return .restart(after: delay * scale)
    }

    /// The menu's restart starts over.
    public mutating func reset() {
        exits = []
        streak = 0
    }
}

/// Seconds since boot, not affected by clock changes.
public func monotonicSeconds() -> Double {
    Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000_000
}
