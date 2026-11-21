import EventKit
import Foundation
import SherpaPlannerContract
import SherpaWorkerProtocol
import Testing
@testable import SherpaEventKitAdapter

@Test func mapsUnavailableEventKitAccessToUserAction() throws {
    let response = try #require(
        eventKitFailure(
            requestID: "req-authorization",
            error: NSError(
                domain: EKError.errorDomain,
                code: EKError.eventStoreNotAuthorized.rawValue
            )
        )
    )

    #expect(response.status == .failed)
    #expect(response.stableErrorCode == "eventkit.access_unavailable")
    #expect(response.error?.retry == .never)
}

@Test func everyEventAndReminderOperationRequiresFullAccess() throws {
    #expect(entityRequiringFullAccess(for: "event.source.list") == .event)
    #expect(entityRequiringFullAccess(for: "event.create") == .event)
    #expect(entityRequiringFullAccess(for: "reminder.source.list") == .reminder)
    #expect(entityRequiringFullAccess(for: "reminder.complete") == .reminder)
    #expect(entityRequiringFullAccess(for: "event.authorization.status") == nil)
    #expect(entityRequiringFullAccess(for: "reminder.authorization.status") == nil)
    #expect(entityRequiringFullAccess(for: "capabilities") == nil)
    #expect(entityRequiringFullAccess(for: "reminder.unknown") == nil)

    try requireFullAccess(.fullAccess)
    for status in [
        EKAuthorizationStatus.writeOnly,
        .notDetermined,
        .denied,
        .restricted,
    ] {
        #expect(throws: EventKitWorkerError.self) { try requireFullAccess(status) }
    }
    #expect(authorizationName(.fullAccess) == "full_access")
    #expect(authorizationName(.writeOnly) == "write_only")
    #expect(authorizationName(.notDetermined) == "not_determined")
    #expect(authorizationName(.denied) == "denied")
    #expect(authorizationName(.restricted) == "restricted")
}

@Test func advertisesCurrentCalendarAndReminderCapabilities() async throws {
    let request = try WorkerRequest(data: Data(
        #"{"kind":"request","protocol_version":"2.0.0","application_contract":"sherpa.planner.v2","request_id":"req-capabilities","operation_id":"op-capabilities","capability":"capabilities","payload":{"schema":"sherpa.planner.test.request.v2"},"deadline_ms":1000,"idempotency_key":"idem-capabilities","policy":{"effect":"read","required_evidence":"none","artifact_directory":null}}"#.utf8
    ))

    let response = await EventKitWorker().handle(request)
    let capabilities: [String] = if case let .object(result)? = response.result,
        case let .array(values)? = result["capabilities"] {
        values.compactMap { value in
            guard case let .object(descriptor) = value,
                  case let .string(capability)? = descriptor["capability"] else { return nil }
            return capability
        }
    } else { [] }

    #expect(response.status == .succeeded)
    #expect(capabilities.contains("event.source.list"))
    #expect(capabilities.contains("event.collection.create"))
    #expect(capabilities.contains("event.collection.delete"))
    #expect(capabilities.contains("event.list"))
    #expect(capabilities.contains("event.get"))
    #expect(capabilities.contains("event.create"))
    #expect(capabilities.contains("event.update"))
    #expect(capabilities.contains("event.delete"))
    #expect(capabilities.contains("reminder.source.list"))
    #expect(capabilities.contains("reminder.collection.create"))
    #expect(capabilities.contains("reminder.collection.delete"))
    #expect(capabilities.contains("reminder.list"))
    #expect(capabilities.contains("reminder.get"))
    #expect(capabilities.contains("reminder.create"))
    #expect(capabilities.contains("reminder.update"))
    #expect(capabilities.contains("reminder.complete"))
    #expect(capabilities.contains("reminder.reopen"))
    #expect(capabilities.contains("reminder.delete"))
    #expect(capabilities.allSatisfy {
        !$0.contains("attendee") && !$0.contains("invitation") && !$0.contains("rsvp")
    })
}

@Test func provisionalInvitationCapabilityRemainsUnsupported() async throws {
    let request = try WorkerRequest(data: Data(
        #"{"kind":"request","protocol_version":"2.0.0","application_contract":"sherpa.planner.v2","request_id":"req-invitation","operation_id":"op-invitation","capability":"event.invitation.create","payload":{"schema":"sherpa.planner.test.request.v2"},"deadline_ms":1000,"idempotency_key":"idem-invitation","policy":{"effect":"mutation","required_evidence":"native_readback","artifact_directory":null}}"#.utf8
    ))

    let response = await EventKitWorker().handle(request)

    #expect(response.status == .failed)
    #expect(response.stableErrorCode == "protocol.unsupported_capability")
}

private func reminderListRequest(_ payload: String) throws -> WorkerRequest {
    try WorkerRequest(data: Data(
        #"{"kind":"request","protocol_version":"2.0.0","application_contract":"sherpa.planner.v2","request_id":"req-reminder-list","operation_id":"op-reminder-list","capability":"reminder.list","payload":\#(payload),"deadline_ms":1000,"idempotency_key":"idem-reminder-list","policy":{"effect":"read","required_evidence":"none","artifact_directory":null}}"#.utf8
    ))
}

/// 0.7.1 required every reminder.list key, so `{"schema":…,"limit":…}` failed as
/// `protocol.invalid_payload` while event.list accepted its optional keys omitted.
@Test func reminderListAcceptsOmittedOptionalKeysAndStillRejectsUnknownOnes() async throws {
    let minimal = await EventKitWorker().handle(try reminderListRequest(
        #"{"schema":"sherpa.planner.reminder-list.request.v2","limit":5}"#
    ))
    #expect(minimal.stableErrorCode != WorkerProtocolError.invalidPayload.stableCode)

    let unknown = await EventKitWorker().handle(try reminderListRequest(
        #"{"schema":"sherpa.planner.reminder-list.request.v2","title":"x"}"#
    ))
    #expect(unknown.stableErrorCode == WorkerProtocolError.invalidPayload.stableCode)
}

/// `*.authorization.request` answered `succeeded` with evidence `matched` while the
/// status read back was still `not_determined`: macOS had shown no prompt because the
/// responsible host app had no usage description (2026-11-20). A request that leaves
/// the status undetermined must fail by name; an answer the owner gave, including
/// `denied`, is a real result.
@Test func authorizationRequestFailsWhenTheStatusStaysUndetermined() throws {
    let request = try WorkerRequest(data: Data(#"{"kind":"request","protocol_version":"2.0.0","application_contract":"sherpa.planner.v2","request_id":"req-auth","operation_id":"op-auth","capability":"event.authorization.request","payload":{"schema":"sherpa.planner.event-authorization-request.request.v2"},"deadline_ms":1000,"idempotency_key":"idem-auth","policy":{"effect":"authorization_prompt","required_evidence":"authorization_readback","artifact_directory":null}}"#.utf8))

    let unanswered = try authorizationRequestResponse(request, domain: "event", status: .notDetermined)
    #expect(unanswered.status == .failed)
    #expect(unanswered.stableErrorCode == "eventkit.authorization_prompt_unavailable")
    #expect(unanswered.error?.retry == .afterUserAction)

    for status in [EKAuthorizationStatus.fullAccess, .denied, .writeOnly] {
        let answered = try authorizationRequestResponse(request, domain: "event", status: status)
        #expect(answered.status == .succeeded)
    }
}

private func advertisedDescriptors() async throws -> [[String: JSONValue]] {
    let request = try WorkerRequest(data: Data(
        #"{"kind":"request","protocol_version":"2.0.0","application_contract":"sherpa.planner.v2","request_id":"req-capabilities","operation_id":"op-capabilities","capability":"capabilities","payload":{},"deadline_ms":1000,"idempotency_key":"idem-capabilities","policy":{"effect":"read","required_evidence":"none","artifact_directory":null}}"#.utf8
    ))
    let response = await EventKitWorker().handle(request)
    guard case let .object(result)? = response.result, case let .array(values)? = result["capabilities"] else { return [] }
    return values.compactMap { value in
        guard case let .object(descriptor) = value else { return nil }
        return descriptor
    }
}

// 2026-11-21: descriptors advertised sherpa.planner.event.command.validate.request.v2 while the
// validator accepts only the hyphenated name, so a request built from discovery always failed.
@Test func advertisedSchemasUseTheNamesTheWorkerSpeaks() async throws {
    let descriptors = try await advertisedDescriptors()
    #expect(descriptors.count > 20)
    for descriptor in descriptors {
        guard case let .string(capability)? = descriptor["capability"] else { Issue.record("descriptor without capability"); continue }
        let hyphenated = capability.replacingOccurrences(of: ".", with: "-")
        #expect(descriptor["request_schema"] == .string("sherpa.planner.\(hyphenated).request.v2"))
        if capability.contains(".authorization.") {
            let domain = String(capability.prefix { $0 != "." })
            let actual = AuthorizationResult(domain: domain, authorization: "denied").schema
            #expect(descriptor["success_schema"] == .string(actual))
        } else {
            #expect(descriptor["success_schema"] == .string("sherpa.planner.\(hyphenated).success.v2"))
        }
    }
}

@Test func commandValidationAcceptsTheAdvertisedRequestSchema() async throws {
    let descriptors = try await advertisedDescriptors()
    let commands = [
        "event.command.validate": #"[{"capability":"event.create","payload":{"schema":"sherpa.planner.event-create.request.v2","title":"Synthetic","start":"2026-08-10T00:00:00Z","end":"2026-08-10T01:00:00Z"}}]"#,
        "reminder.command.validate": #"[{"capability":"reminder.create","payload":{"schema":"sherpa.planner.reminder-create.request.v2","title":"Synthetic","due":{"year":2026,"month":8,"day":10}}}]"#,
    ]
    for (capability, list) in commands {
        let descriptor = descriptors.first { $0["capability"] == .string(capability) }
        guard case let .string(requestSchema)? = descriptor?["request_schema"],
              case let .string(successSchema)? = descriptor?["success_schema"]
        else { Issue.record("\(capability) is not advertised"); continue }
        let body = #"{"kind":"request","protocol_version":"2.0.0","application_contract":"sherpa.planner.v2","request_id":"req-v","operation_id":"op-v","capability":""# + capability + #"","payload":{"schema":""# + requestSchema + #"","commands":"# + list + #"},"deadline_ms":1000,"idempotency_key":"idem-v","policy":{"effect":"read","required_evidence":"none","artifact_directory":null}}"#
        let response = await EventKitWorker().handle(try WorkerRequest(data: Data(body.utf8)))
        #expect(response.status == .succeeded, "\(capability) rejected \(requestSchema)")
        guard case let .object(result)? = response.result else { Issue.record("\(capability) has no result"); continue }
        #expect(result["schema"] == .string(successSchema))
    }
}
