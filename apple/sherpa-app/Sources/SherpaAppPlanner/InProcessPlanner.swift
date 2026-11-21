import Foundation
import SherpaAppServer
import SherpaPlannerService
import SherpaWorkerProtocol

/// The planner worker served inside Sherpa.app by the helper's own code: the same 64 KiB
/// request bound, V2 validation, journal and response fit as `sherpa-apple planner request`
/// (contract §8). The app is the permission principal, so nothing here disclaims
/// responsibility or starts another process.
public struct InProcessPlanner: PlannerPort {
    private let service: PlannerRequestService

    public init(environment: [String: String]) {
        service = PlannerRequestService(responseLimit: PlannerRequestService.responseLimit(environment: environment))
    }

    public func respond(to request: Data) async -> WorkerOutput {
        do {
            return .response(try await service.respond(to: request))
        } catch {
            let report = CommandReport(failure: error)
            WorkerLog.error("[app:planner:request] \(report.logFields) error_type=\(type(of: error))")
            return .report(report.encoded())
        }
    }
}
