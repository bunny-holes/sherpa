import Foundation
import SherpaMailShim
import SherpaReminderKitShim
import Testing
@testable import SherpaJournalStore

@Test func mutationStoreAllowsOneTerminalTransitionWithoutContent() throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("sherpa-native-store-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try NativeMutationStore(url: directory.appendingPathComponent("state.sqlite3"))
    let operation = try store.start(capability: "imessage.send")
    try store.finish(operationID: operation, status: .uncertain, stableErrorCode: "uncertain")
    #expect(throws: JournalStoreError.failed) {
        try store.finish(operationID: operation, status: .completed)
    }
    let record = try #require(store.recent(limit: 1).first)
    #expect(record.operationID == operation)
    #expect(record.status == .uncertain)
    #expect(record.capability == "imessage.send")
}

@Test func inProcessMailShimAnswersCapabilitiesWithoutLaunchingAWorker() throws {
    let request = Data(#"{"kind":"request","protocol_version":"2.0.0","application_contract":"sherpa.mail.v2","request_id":"req-test","operation_id":"op-test","capability":"capabilities","payload":{},"deadline_ms":1000,"idempotency_key":"idem-test","policy":{"effect":"read","required_evidence":"none","artifact_directory":null}}"#.utf8)
    let response = SherpaMailHandleRequest(request)
    let text = String(decoding: response, as: UTF8.self)
    #expect(text.contains("mail.messages.list"))
    #expect(text.contains("\"status\":\"succeeded\""))
}

@Test func inProcessReminderKitShimAnswersCapabilitiesWithoutLaunchingAWorker() {
    let request = Data(#"{"kind":"request","protocol_version":"2.0.0","application_contract":"sherpa.reminder-private.v2","request_id":"req-test","operation_id":"op-test","capability":"capabilities","payload":{},"deadline_ms":1000,"idempotency_key":"idem-test","policy":{"effect":"read","required_evidence":"none","artifact_directory":null}}"#.utf8)
    let response = SherpaReminderKitHandleRequest(request)
    let text = String(decoding: response, as: UTF8.self)
    #expect(text.contains("sherpa.worker-capabilities.v2"))
    #expect(text.contains("\"status\":\"succeeded\""))
}
