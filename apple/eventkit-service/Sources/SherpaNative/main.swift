import Darwin
import Foundation
import SherpaJournalStore
import SherpaMailShim
import SherpaPlannerService
import SherpaReminderKitShim
import SherpaWorkerProtocol

@main
enum SherpaNativeMain {
    static func main() async {
        do {
            let arguments = Array(CommandLine.arguments.dropFirst())
            if arguments == ["--version"] || arguments == ["version"] {
                FileHandle.standardOutput.write(Data("sherpa-apple 0.8.5\n".utf8))
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
            FileHandle.standardOutput.write(report.encoded())
            FileHandle.standardOutput.write(Data([0x0a]))
            exit(EXIT_FAILURE)
        }
    }
}

private let nativeHelp = """
    sherpa-apple 0.8.5 — Apple framework helper of the sherpa CLI

    The sherpa CLI starts this helper; run sherpa instead. It reads one strict
    Worker Protocol V2 request on standard input and writes one response:

      sherpa-apple planner request        EventKit Calendar and Reminders
      sherpa-apple mail request           Mail.app shim
      sherpa-apple reminder-kit request   isolated private ReminderKit capabilities
    """

private func plannerRequest() async throws -> Data {
    let input = try readWorkerRequest(maximumBytes: PlannerRequestService.requestLimit)
    let limit = PlannerRequestService.responseLimit(environment: ProcessInfo.processInfo.environment)
    return try await PlannerRequestService(responseLimit: limit).respond(to: input)
}
