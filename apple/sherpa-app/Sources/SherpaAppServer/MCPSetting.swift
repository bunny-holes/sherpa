import Foundation

/// Where the app keeps its MCP switch (contract §2 "MCP 켜기와 연결 안내"): the Bool `mcpEnabled`
/// in its defaults. No value means off, so a first launch starts with MCP off.
///
/// The value records the person's consent within one user account; it is not a security
/// boundary. Any process of the same user can set it with `defaults write`, or for one run
/// with the launch argument `-mcpEnabled YES` (the argument domain), as it can start the
/// relay itself (§4 "믿는 범위", bunny-holes/sherpa#39).
public enum MCPSetting {
    public static let key = "mcpEnabled"

    public static func isEnabled(in defaults: UserDefaults) -> Bool {
        defaults.bool(forKey: key)
    }

    public static func set(_ enabled: Bool, in defaults: UserDefaults) {
        defaults.set(enabled, forKey: key)
    }
}
