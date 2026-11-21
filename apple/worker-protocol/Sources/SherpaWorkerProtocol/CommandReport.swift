import Foundation

/// What a worker transport carries when a request does not end with a V2 response: the
/// `status`, `error`, `operation_id` and `journal_error` object that
/// `sherpa-apple planner request` writes to standard output and that Sherpa.app sends as the
/// `report` of a control-channel response. Every field is a Sherpa-owned code, status, or
/// operation ID; provider text and error descriptions never reach it.
public struct CommandReport: Encodable, Sendable, Equatable {
    public let status: String
    public let error: String?
    public let operationID: String?
    public let journalError: String?

    enum CodingKeys: String, CodingKey {
        case status, error
        case operationID = "operation_id"
        case journalError = "journal_error"
    }

    public init(status: String, error: String?, operationID: String? = nil, journalError: String? = nil) {
        self.status = status
        self.error = error
        self.operationID = operationID
        self.journalError = journalError
    }

    /// A request the protocol boundary rejected before anything was attempted.
    public init(protocolFailure: WorkerProtocolError) {
        self.init(status: "failed", error: protocolFailure.stableCode)
    }

    public var logFields: String {
        var fields = "status=\(status) code=\(error ?? "none")"
        if let operationID { fields += " operation_id=\(operationID)" }
        if let journalError { fields += " journal_error=\(journalError)" }
        return fields
    }

    /// Compact JSON with sorted keys and absent optional keys, one line without a line feed.
    public func encoded() -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        do {
            return try encoder.encode(self)
        } catch {
            WorkerLog.error("[apple:worker-protocol:report-failure] status=\(status)")
            return Data(#"{"status":"\#(status)"}"#.utf8)
        }
    }
}
