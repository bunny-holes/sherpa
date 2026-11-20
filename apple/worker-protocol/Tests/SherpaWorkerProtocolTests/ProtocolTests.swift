import Foundation
import Testing
@testable import SherpaWorkerProtocol

private let valid = #"{"kind":"request","protocol_version":"2.0.0","application_contract":"sherpa.planner.v2","request_id":"req-1","operation_id":"op-1","capability":"capabilities","payload":{"schema":"sherpa.planner.capabilities.request.v2"},"deadline_ms":1000,"idempotency_key":"idem-1","policy":{"effect":"read","required_evidence":"none","artifact_directory":null}}"#

@Test func decodesStrictV2Envelope() throws {
    let request = try WorkerRequest(data: Data(valid.utf8))
    #expect(request.applicationContract == "sherpa.planner.v2")
    #expect(request.policy.effect == .read)
    #expect(request.policy.requiredEvidence == .none)
}

@Test(arguments: [
    valid.replacingOccurrences(of: "2.0.0", with: "1.0.0"),
    valid.replacingOccurrences(of: #", "artifact_directory":null"#.replacingOccurrences(of: " ", with: ""), with: ""),
    valid.replacingOccurrences(of: #""artifact_directory":null"#, with: #""artifact_directory":null,"extra":true"#),
    valid.replacingOccurrences(of: #""application_contract":"sherpa.planner.v2","#, with: ""),
])
func rejectsLegacyMissingAndUnknownFields(value: String) {
    #expect(throws: (any Error).self) { _ = try WorkerRequest(data: Data(value.utf8)) }
}

@Test func responseEchoesCorrelationAndOutcome() throws {
    let request = try WorkerRequest(data: Data(valid.utf8))
    let response = WorkerResponse.success(request: request, result: ["worker": "eventkit"])
    let decoded = try JSONDecoder().decode(JSONObject.self, from: response.encoded())
    #expect(decoded["request_id"] == "req-1")
    #expect(decoded["operation_id"] == "op-1")
    #expect(decoded["capability"] == "capabilities")
    #expect(decoded["application_contract"] == "sherpa.planner.v2")
}

@Test func boundedReaderRejectsOversizeInput() throws {
    let pipe = Pipe(); try pipe.fileHandleForWriting.write(contentsOf: Data(repeating: 1, count: 17)); try pipe.fileHandleForWriting.close()
    #expect(throws: WorkerProtocolError.requestTooLarge) { _ = try readWorkerRequest(from: pipe.fileHandleForReading, maximumBytes: 16) }
}

private func oversized(_ request: WorkerRequest, status: WorkerStatus, effect: WorkerEffectOutcome) -> WorkerResponse {
    WorkerResponse(
        applicationContract: request.applicationContract, requestID: request.requestID,
        operationID: request.operationID, capability: request.capability, status: status,
        result: .object(["rows": .string(String(repeating: "x", count: 4_096))]), effect: effect,
        evidence: .init(kind: .nativeReadback, state: .matched), error: nil, warnings: []
    )
}

@Test func oversizeResultAfterAnAppliedEffectStaysAppliedAndIsNeverRetried() throws {
    let request = try WorkerRequest(data: Data(valid.utf8))
    let response = oversized(request, status: .succeeded, effect: .init(kind: .nativeMutation, state: .applied))
    let fitted = try response.fitted(maximumBytes: 1_024)
    #expect(fitted.data.count <= 1_024)
    #expect(fitted.response.status == .partial)
    #expect(fitted.response.result == nil)
    #expect(fitted.response.effect.state == .applied)
    #expect(fitted.response.evidence?.state == .matched)
    #expect(fitted.response.error?.code == "protocol.result_too_large")
    #expect(fitted.response.error?.retry == .never)
    let decoded = try JSONDecoder().decode(JSONObject.self, from: fitted.data)
    #expect(decoded["operation_id"] == "op-1")
    #expect(decoded["status"] == "partial")
}

@Test func oversizeResultAfterAPossiblyAppliedEffectStaysUncertain() throws {
    let request = try WorkerRequest(data: Data(valid.utf8))
    let response = oversized(request, status: .uncertain, effect: .init(kind: .nativeMutation, state: .mayHaveApplied))
    let fitted = try response.fitted(maximumBytes: 1_024)
    #expect(fitted.response.status == .uncertain)
    #expect(fitted.response.effect.state == .mayHaveApplied)
    #expect(fitted.response.error?.code == "protocol.result_too_large")
}

@Test func oversizeReadResultFailsWithoutAnEffect() throws {
    let request = try WorkerRequest(data: Data(valid.utf8))
    let response = oversized(request, status: .succeeded, effect: .init(kind: .none, state: .notApplicable))
    let fitted = try response.fitted(maximumBytes: 1_024)
    #expect(fitted.response.status == .failed)
    #expect(fitted.response.effect.state == .notApplicable)
    #expect(fitted.response.evidence == nil)
    #expect(fitted.response.error?.code == "protocol.result_too_large")
}

@Test func fittingResponseIsUnchanged() throws {
    let request = try WorkerRequest(data: Data(valid.utf8))
    let response = WorkerResponse.success(request: request, result: ["worker": "eventkit"])
    let fitted = try response.fitted(maximumBytes: 1_024)
    #expect(fitted.data == (try response.encoded()))
    #expect(fitted.response.status == .succeeded)
}
