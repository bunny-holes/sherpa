import Darwin
import Foundation
import SherpaEventKitAdapter
import SherpaMailShim
import SherpaMutationApplication
import SherpaJournalStore
import SherpaReminderKitShim
import SherpaWorkerProtocol

@main
enum SherpaNativeMain {
    static func main() async {
        do {
            let arguments = Array(CommandLine.arguments.dropFirst())
            if arguments == ["--version"] || arguments == ["version"] {
                FileHandle.standardOutput.write(Data("sherpa-apple 0.8.4\n".utf8))
                return
            }
            if arguments == ["--help"] || arguments == ["help"] || arguments.isEmpty {
                FileHandle.standardOutput.write(Data(nativeHelp.utf8))
                return
            }
            guard arguments.count == 2 else { throw JournalStoreError.invalidRequest }
            PrivacyResponsibility.ensureResponsible()
            let output: Data
            switch (arguments[0], arguments[1]) {
            case ("planner", "request"):
                output = try await plannerRequest()
            case ("mail", "request"):
                output = SherpaMailHandleRequest(
                    try readWorkerRequest(maximumBytes: 2 * 1_024 * 1_024)
                )
            case ("reminder-kit", "request"):
                output = SherpaReminderKitHandleRequest(
                    try readWorkerRequest(maximumBytes: 64 * 1_024)
                )
            default:
                throw JournalStoreError.invalidRequest
            }
            FileHandle.standardOutput.write(output)
            FileHandle.standardOutput.write(Data([0x0a]))
        } catch {
            let report = CommandReport(failure: error)
            WorkerLog.error(
                "[apple:sherpa-apple:command-failure] \(report.logFields) error_type=\(type(of: error))"
            )
            FileHandle.standardOutput.write(encoded(report))
            FileHandle.standardOutput.write(Data([0x0a]))
            exit(EXIT_FAILURE)
        }
    }
}

private let nativeHelp = """
sherpa-apple 0.8.4 — Apple framework helper of the sherpa CLI

The sherpa CLI starts this helper; run sherpa instead. It reads one strict
Worker Protocol V2 request on standard input and writes one response:

  sherpa-apple planner request        EventKit Calendar and Reminders
  sherpa-apple mail request           Mail.app shim
  sherpa-apple reminder-kit request   isolated private ReminderKit capabilities
"""

private func plannerRequest() async throws -> Data {
    let input = try readWorkerRequest(maximumBytes: 64 * 1_024)
    let request = try WorkerRequest(data: input)
    guard request.policy.effect == .mutation else {
        return try await EventKitWorker().handle(request).fitted(maximumBytes: plannerResponseLimit).data
    }
    // The response states what happened to the effect, so it is returned even when
    // the journal could not record it; `journaled` logs that failure. It is fitted
    // inside the attempt, so an oversized result after an applied change is journaled
    // and reported as the same `partial` outcome instead of a `failed` command.
    let result = try await journaled(request.capability, operationID: request.operationID) {
        let (response, data) = try await EventKitWorker().handle(request).fitted(maximumBytes: plannerResponseLimit)
        let status: NativeMutationStatus = switch response.status {
        case .succeeded: .completed
        case .failed: .failed
        case .partial: .partial
        case .uncertain: .uncertain
        }
        return MutationAttempt(output: data, status: status, stableErrorCode: response.stableErrorCode)
    }
    return result.attempt.output
}

private let plannerResponseLimit = 8 * 1_024 * 1_024

/// What stdout carries when a command does not end with its normal output. Every
/// field is a Sherpa-owned code, status, or operation ID; provider text and error
/// descriptions never reach it.
private struct CommandReport: Encodable {
    let status: String
    let error: String?
    let operationID: String?
    let journalError: String?

    enum CodingKeys: String, CodingKey {
        case status, error
        case operationID = "operation_id"
        case journalError = "journal_error"
    }

    init(status: String, error: String?, operationID: String? = nil, journalError: String? = nil) {
        self.status = status
        self.error = error
        self.operationID = operationID
        self.journalError = journalError
    }

    /// Names every failure. An error without a stable code of its own becomes
    /// `sherpa.internal_failure`.
    init(failure: any Error) {
        switch failure {
        case let failure as JournaledMutationError:
            self.init(
                status: failure.status.rawValue,
                error: failure.stableCode,
                operationID: failure.operationID,
                journalError: failure.journalFailure?.rawValue
            )
        case let failure as JournalStoreError:
            self.init(status: "failed", error: failure.stableCode)
        case let failure as WorkerProtocolError:
            self.init(status: "failed", error: failure.stableCode)
        default:
            self.init(status: "failed", error: "sherpa.internal_failure")
        }
    }

    var logFields: String {
        var fields = "status=\(status) code=\(error ?? "none")"
        if let operationID { fields += " operation_id=\(operationID)" }
        if let journalError { fields += " journal_error=\(journalError)" }
        return fields
    }
}

private func encoded(_ report: CommandReport) -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    do {
        return try encoder.encode(report)
    } catch {
        WorkerLog.error("[apple:sherpa-apple:report-failure] status=\(report.status)")
        return Data(#"{"status":"\#(report.status)"}"#.utf8)
    }
}

private func journaled<Output: Sendable>(
    _ capability: String,
    operationID: String? = nil,
    _ attempt: @Sendable () async throws -> MutationAttempt<Output>
) async throws -> JournaledMutationResult<Output> {
    let journal = JournaledMutation(journal: try NativeMutationStore.openDefault())
    WorkerLog.info("[apple:sherpa-apple:mutation-start] capability=\(capability)")
    let result = try await journal.perform(
        capability: capability, operationID: operationID, attempt
    )
    let fields = "capability=\(capability) operation_id=\(result.operationID) "
        + "status=\(result.attempt.status.rawValue)"
    if let journalFailure = result.journalFailure {
        WorkerLog.error("[apple:sherpa-apple:journal-failure] \(fields) code=\(journalFailure.rawValue)")
    } else {
        WorkerLog.info("[apple:sherpa-apple:mutation-finish] \(fields)")
    }
    return result
}
