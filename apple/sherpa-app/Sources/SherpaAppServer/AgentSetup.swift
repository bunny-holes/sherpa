import Foundation

/// The commands the status window gives a person to register this app's relay with an agent
/// (contract §2 "MCP 켜기와 연결 안내"). Only the agents measured against Sherpa.app are listed.
/// The app shows the commands and copies them; it never edits another app's configuration.
public enum AgentSetup {
    /// The server name of every agent configuration (§2).
    public static let serverName = "sherpa"
    /// Codex opens a stdio server on MCP 2026-07-28 only with this feature on and the variable
    /// below in the server's entry (ADR-0011).
    public static let codexFeature = "mcp_2026_07_28"
    public static let codexProtocolVariable = "CODEX_MCP_PROTOCOL_VERSION=2026-07-28"

    public enum Agent: String, CaseIterable, Sendable {
        case claudeCode
        case codex

        public var title: String {
            switch self {
            case .claudeCode: "Claude Code"
            case .codex: "Codex"
            }
        }

        /// What to do once the commands have run. Claude Code's /mcp Reconnect also brings back a
        /// server it saw fail while MCP was off, whether or not it remembers that failure (§6).
        public var afterRegistering: String {
            switch self {
            case .claudeCode: "Then start Claude Code. If /mcp shows sherpa as failed, choose Reconnect there."
            case .codex: "Then start a new Codex session."
            }
        }
    }

    /// One command to run in a terminal, and what it does.
    public struct Step: Equatable, Sendable {
        public let caption: String
        public let command: String
    }

    /// The steps for `agent`, in order, with `relayPath` quoted for a POSIX shell.
    public static func steps(for agent: Agent, relayPath: String) -> [Step] {
        let relay = shellQuoted(relayPath)
        switch agent {
        case .claudeCode:
            // User scope: every project of this user (~/.claude.json). Everything after `--`
            // is the server's command.
            return [Step(
                caption: "Register Sherpa for all your projects:",
                command: "claude mcp add --scope user \(serverName) -- \(relay)"
            )]
        case .codex:
            return [
                Step(caption: "Turn on MCP 2026-07-28 in Codex:", command: "codex features enable \(codexFeature)"),
                Step(
                    caption: "Register Sherpa:",
                    command: "codex mcp add --env \(codexProtocolVariable) \(serverName) -- \(relay)"
                ),
            ]
        }
    }

    /// `value` as one word for sh, bash and zsh: as it is when every character is one no shell
    /// treats specially, otherwise in single quotes with each `'` written as `'\''`.
    public static func shellQuoted(_ value: String) -> String {
        if !value.isEmpty, value.unicodeScalars.allSatisfy(plainCharacters.contains) { return value }
        return "'" + value.replacingOccurrences(of: "'", with: #"'\''"#) + "'"
    }

    private static let plainCharacters = CharacterSet(
        charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/._-+,:@%"
    )
}
