import Foundation
import SherpaMailShim
import SherpaReminderKitShim
import SherpaShimResponse
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

private func oversizedShimResponse(status: String, effectState: String, effectKind: String) -> [String: Any] {
    [
        "kind": "response", "protocol_version": "2.0.0", "application_contract": "sherpa.test.v2",
        "request_id": "req-1", "operation_id": "op-1", "capability": "test.capability",
        "status": status, "result": ["rows": String(repeating: "x", count: 4_096)],
        "effect": ["kind": effectKind, "state": effectState],
        "evidence": ["kind": "native_readback", "state": "matched"],
        "error": NSNull(), "warnings": [],
    ]
}

private func decodedShimOutput(_ data: Data?) throws -> [String: Any] {
    let data = try #require(data)
    #expect(data.count <= 1_024)
    return try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
}

@Test func shimsKeepAnAppliedEffectWhenTheResultIsTooLarge() throws {
    let response = oversizedShimResponse(status: "succeeded", effectState: "applied", effectKind: "native_mutation")
    let output = try decodedShimOutput(SherpaFittedResponseData(response, 1_024))
    #expect(output["status"] as? String == "partial")
    #expect(output["operation_id"] as? String == "op-1")
    #expect(output["result"] is NSNull)
    #expect((output["effect"] as? [String: String])?["state"] == "applied")
    #expect((output["evidence"] as? [String: String])?["state"] == "matched")
    #expect((output["error"] as? [String: String]) == ["code": "protocol.result_too_large", "retry": "never"])
}

@Test func shimsKeepAPossiblyAppliedEffectUncertainWhenTheResultIsTooLarge() throws {
    let response = oversizedShimResponse(status: "uncertain", effectState: "may_have_applied", effectKind: "outbound_dispatch")
    let output = try decodedShimOutput(SherpaFittedResponseData(response, 1_024))
    #expect(output["status"] as? String == "uncertain")
    #expect((output["effect"] as? [String: String])?["state"] == "may_have_applied")
}

@Test func shimsFailAReadWhoseResultIsTooLarge() throws {
    let response = oversizedShimResponse(status: "succeeded", effectState: "not_applicable", effectKind: "none")
    let output = try decodedShimOutput(SherpaFittedResponseData(response, 1_024))
    #expect(output["status"] as? String == "failed")
    #expect(output["evidence"] is NSNull)
    #expect((output["effect"] as? [String: String])?["state"] == "not_applicable")
    #expect((output["error"] as? [String: String])?["code"] == "protocol.result_too_large")
}
