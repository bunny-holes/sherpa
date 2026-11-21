import Foundation
import SherpaAppConnection
import SherpaWorkerProtocol

public struct ConfirmationLine: Sendable, Equatable, Hashable {
    public let label: String
    public let value: String
}

/// One `0	confirm` request (§9). Its contents are user data: shown in the window only,
/// never logged.
public struct ConfirmationRequest: Sendable, Equatable, Identifiable {
    public static let titleLimit = 100
    public static let lineLimit = 12
    public static let labelLimit = 40
    public static let valueLimit = 2_000

    public let id: UInt64
    public let tool: String
    public let operationID: String
    public let clientName: String
    public let clientVersion: String
    public let title: String
    public let lines: [ConfirmationLine]
    public let timeoutMilliseconds: Int
    /// Monotonic seconds when the app read the frame.
    public let receivedAt: Double

    public var deadline: Double { receivedAt + Double(timeoutMilliseconds) / 1_000 }

    public enum ParseFailure: Error, Equatable {
        /// No usable id: nothing can be answered, so it is a frame violation.
        case noIdentifier
        /// An id but a body outside the limits: answered `unavailable`.
        case invalid(id: UInt64)
    }

    public static func parse(_ body: Data, receivedAt: Double) -> Result<ConfirmationRequest, ParseFailure> {
        guard let object = try? JSONDecoder().decode(JSONObject.self, from: body),
              case let .integer(rawID)? = object["id"], rawID > 0, UInt64(rawID) <= MuxFrame.maximumChannel
        else { return .failure(.noIdentifier) }
        let id = UInt64(rawID)
        guard Set(object.keys) == ["id", "tool", "operation_id", "client", "title", "lines", "timeout_ms"],
              case let .string(tool)? = object["tool"],
              case let .string(operationID)? = object["operation_id"],
              case let .object(client)? = object["client"],
              case let .string(clientName)? = client["name"],
              case let .string(clientVersion)? = client["version"],
              case let .string(title)? = object["title"], title.unicodeScalars.count <= titleLimit,
              case let .array(rawLines)? = object["lines"], rawLines.count <= lineLimit,
              case let .integer(timeout)? = object["timeout_ms"], timeout > 0, timeout <= 600_000
        else { return .failure(.invalid(id: id)) }
        var lines: [ConfirmationLine] = []
        for rawLine in rawLines {
            guard case let .object(line)? = Optional(rawLine), Set(line.keys) == ["label", "value"],
                  case let .string(label)? = line["label"], label.unicodeScalars.count <= labelLimit,
                  case let .string(value)? = line["value"], value.unicodeScalars.count <= valueLimit
            else { return .failure(.invalid(id: id)) }
            lines.append(ConfirmationLine(label: label, value: value))
        }
        return .success(ConfirmationRequest(
            id: id, tool: tool, operationID: operationID, clientName: clientName, clientVersion: clientVersion,
            title: title, lines: lines, timeoutMilliseconds: Int(timeout), receivedAt: receivedAt
        ))
    }
}

public enum ConfirmationDecision: String, Sendable, Equatable {
    case approved, declined, unavailable
}

/// The app-owned port that asks a person (§9). The app binds a front-most window; the test
/// host binds a scripted decider.
public protocol ConfirmationPort: Sendable {
    /// Shows the request; calls `decide` at most once.
    func present(_ request: ConfirmationRequest, decide: @escaping @Sendable (ConfirmationDecision) -> Void)
    /// The core withdrew the request: close it without an answer.
    func withdraw(id: UInt64)
    /// The core that asked is gone: close every request.
    func withdrawAll()
}
