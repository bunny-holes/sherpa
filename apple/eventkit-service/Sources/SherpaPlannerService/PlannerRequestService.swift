import Foundation
import SherpaEventKitAdapter
import SherpaJournalStore
import SherpaMutationApplication
import SherpaWorkerProtocol

/// Handles one Worker Protocol V2 planner request the same way wherever it arrives: on the
/// helper's standard input (`sherpa-apple planner request`) or on Sherpa.app's control
/// channel (app connection contract §8). The request bound, the envelope validation, the
/// journal of a mutation and the response fit inside that attempt are one rule, so both
/// transports answer the same input with the same bytes.
public struct PlannerRequestService: Sendable {
    public static let requestLimit = 64 * 1_024
    public static let maximumResponseBytes = 8 * 1_024 * 1_024

    public let responseLimit: Int

    public init(responseLimit: Int) {
        self.responseLimit = responseLimit
    }

    /// 8 MiB unless `SHERPA_APPLE_RESPONSE_LIMIT_BYTES` lowers it for a command-level test.
    public static func responseLimit(environment: [String: String]) -> Int {
        let override = environment["SHERPA_APPLE_RESPONSE_LIMIT_BYTES"]
        let limit = WorkerResponse.limit(override: override, maximumBytes: maximumResponseBytes)
        if override != nil {
            if limit == maximumResponseBytes, override != String(maximumResponseBytes) {
                WorkerLog.warn("[apple:sherpa-apple:response-limit] override rejected; limit=\(limit)")
            } else {
                WorkerLog.info("[apple:sherpa-apple:response-limit] override limit=\(limit)")
            }
        }
        return limit
    }

    /// The response for `input`. A failure that ends before a response exists throws, and
    /// `CommandReport(failure:)` names it.
    public func respond(to input: Data) async throws -> Data {
        guard input.count <= Self.requestLimit else { throw WorkerProtocolError.requestTooLarge }
        let request = try WorkerRequest(data: input)
        let responseLimit = responseLimit
        guard request.policy.effect == .mutation else {
            return try await EventKitWorker().handle(request).fitted(maximumBytes: responseLimit).data
        }
        // The response states what happened to the effect, so it is returned even when
        // the journal could not record it; `journaled` logs that failure. It is fitted
        // inside the attempt, so an oversized result after an applied change is journaled
        // and reported as the same `partial` outcome instead of a `failed` command.
        let result = try await journaled(request.capability, operationID: request.operationID) {
            let (response, data) = try await EventKitWorker().handle(request).fitted(maximumBytes: responseLimit)
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
}

public extension CommandReport {
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
            self.init(protocolFailure: failure)
        default:
            self.init(status: "failed", error: "sherpa.internal_failure")
        }
    }
}
