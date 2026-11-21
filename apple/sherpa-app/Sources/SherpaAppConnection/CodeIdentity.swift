/// The owner's Developer ID team: the OU of the signing certificate's leaf. It is public
/// (every signed executable shows it) and compiled into the app and the relay, so nothing
/// at run time can change which team they trust (app connection contract §4).
public enum SherpaTeam {
    public static let identifier = "FN2KZ2J47B"
}

/// The three signed executables of Sherpa.app and the requirement each side checks.
public enum SherpaCodeIdentity: String, Sendable, CaseIterable {
    case app = "dev.xiyo.sherpa"
    case core = "dev.xiyo.sherpa.core"
    case relay = "dev.xiyo.sherpa.relay"

    /// An Apple-anchored certificate of the owner's team and this identifier. No code hash:
    /// an upgraded binary must meet the same requirement.
    public var requirement: String {
        "anchor apple generic and certificate leaf[subject.OU] = \"\(SherpaTeam.identifier)\" "
            + "and identifier \"\(rawValue)\""
    }
}
