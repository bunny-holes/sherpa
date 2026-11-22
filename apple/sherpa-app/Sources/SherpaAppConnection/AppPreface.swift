import Foundation
import SherpaWorkerProtocol

/// The one JSON line the app writes after it has checked the relay and before any MCP byte,
/// so the relay can tell a refusal, a missing core and a normal end apart (contract §5).
public struct AppPreface: Equatable, Sendable {
    public static let maximumBytes = 1_024

    public enum Status: String, Sendable {
        case ready, refused, unavailable
    }

    public enum Reason: String, Sendable, CaseIterable {
        case peerSignature = "peer_signature"
        case peerUser = "peer_user"
        /// The person has MCP turned off in the app (contract §2 "MCP 켜기와 연결 안내").
        case mcpDisabled = "mcp_disabled"
        case coreStarting = "core_starting"
        case coreFailed = "core_failed"
        case coreIncompatible = "core_incompatible"
        case tooManySessions = "too_many_sessions"
        case shuttingDown = "shutting_down"
    }

    public let status: Status
    public let reason: Reason?
    public let version: String

    public static func ready(version: String) -> AppPreface {
        AppPreface(status: .ready, reason: nil, version: version)
    }

    public static func refused(_ reason: Reason, version: String) -> AppPreface {
        AppPreface(status: .refused, reason: reason, version: version)
    }

    public static func unavailable(_ reason: Reason, version: String) -> AppPreface {
        AppPreface(status: .unavailable, reason: reason, version: version)
    }

    /// `{"sherpa_app":1,"status":…,"reason":…,"version":…}` and a line feed, keys in that order.
    public func line() -> Data {
        let reasonJSON = reason.map { "\"\($0.rawValue)\"" } ?? "null"
        let text = #"{"sherpa_app":1,"status":"\#(status.rawValue)","reason":\#(reasonJSON),"version":\#(jsonString(version))}"#
        return Data((text + "\n").utf8)
    }
}

/// What the relay makes of the line the app wrote first.
public enum PrefaceReading: Equatable, Sendable {
    case ready(version: String)
    case refused(reason: String)
    case unavailable(reason: String)
    /// Not JSON, not the four keys, or `sherpa_app` is not 1.
    case invalid(PrefaceDefect)
}

public enum PrefaceDefect: String, Equatable, Sendable {
    case notJSON = "preface_not_json"
    case wrongShape = "preface_invalid"
    case unsupportedVersion = "preface_version_unsupported"
}

public extension AppPreface {
    /// Reads one preface line without its line feed.
    static func read(line: Data) -> PrefaceReading {
        let object: JSONObject
        do {
            object = try JSONDecoder().decode(JSONObject.self, from: line)
        } catch {
            return .invalid(.notJSON)
        }
        guard Set(object.keys) == ["sherpa_app", "status", "reason", "version"] else {
            return .invalid(.wrongShape)
        }
        guard object["sherpa_app"] == .integer(1) else { return .invalid(.unsupportedVersion) }
        guard case let .string(status)? = object["status"], case let .string(version)? = object["version"] else {
            return .invalid(.wrongShape)
        }
        switch (status, object["reason"]) {
        case ("ready", .null?):
            return .ready(version: version)
        case let ("refused", .string(reason)?) where isReasonCode(reason):
            return .refused(reason: reason)
        case let ("unavailable", .string(reason)?) where isReasonCode(reason):
            return .unavailable(reason: reason)
        default:
            return .invalid(.wrongShape)
        }
    }
}

private func isReasonCode(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count <= 64 && value.utf8.allSatisfy { (0x61...0x7a).contains($0) || $0 == 0x5f }
}

/// A JSON string literal for `value`.
func jsonString(_ value: String) -> String {
    var literal = "\""
    for scalar in value.unicodeScalars {
        switch scalar {
        case "\"": literal += "\\\""
        case "\\": literal += "\\\\"
        case "\n": literal += "\\n"
        case "\r": literal += "\\r"
        case "\t": literal += "\\t"
        case _ where scalar.value < 0x20: literal += String(format: "\\u%04x", scalar.value)
        default: literal.unicodeScalars.append(scalar)
        }
    }
    return literal + "\""
}
