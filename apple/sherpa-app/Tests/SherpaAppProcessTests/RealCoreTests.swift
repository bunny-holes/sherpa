import Foundation
import Testing

private let environment = ProcessInfo.processInfo.environment
private let coreBinary = environment["SHERPA_INTEGRATION_CORE"]

// The gate invokes this test after building the genuine core.
@Test(.enabled(if: coreBinary != nil))
func servesThreeConcurrentMCPClientsThroughTheBuiltCore() async throws {
    let binary = try #require(coreBinary)
    let version = try #require(environment["SHERPA_INTEGRATION_VERSION"])
    let rig = try Rig()
    defer { rig.tearDown() }
    let core = rig.root + "/sherpa-core"
    try FileManager.default.copyItem(atPath: binary, toPath: core)
    try #require(
        runTool("/usr/bin/codesign", ["--force", "--sign", "-", "--identifier", Program.core.identifier, core]) == 0)
    let host = try await rig.startHost(core: core, version: version)
    let relays = try (0..<3).map { _ in try rig.startRelay() }

    let operations = try await withThrowingTaskGroup(of: String.self, returning: Set<String>.self) { clients in
        for (index, relay) in relays.enumerated() {
            clients.addTask {
                let id = index * 3 + 1
                let discover = try await request(relay, id: id, method: "server/discover")
                #expect((discover["supportedVersions"] as? [String])?.contains("2026-07-28") == true)
                let list = try await request(relay, id: id + 1, method: "tools/list")
                let tools = try #require(list["tools"] as? [[String: Any]])
                #expect(tools.contains { $0["name"] as? String == "reminder_authorization_status" })
                let call = try await request(
                    relay, id: id + 2, method: "tools/call",
                    fields: #","name":"reminder_authorization_status","arguments":{}"#)
                #expect(call["isError"] as? Bool == false)
                let content = try #require(call["structuredContent"] as? [String: Any])
                #expect(content["capability"] as? String == "reminder.authorization.status")
                #expect(content["status"] as? String == "succeeded")
                return try #require(content["operation_id"] as? String)
            }
        }
        var operations: Set<String> = []
        for try await operation in clients { operations.insert(operation) }
        return operations
    }
    #expect(operations.count == relays.count)
    #expect(await host.waitForError("core=ready sessions=3"))
    for relay in relays { try relay.closeInput() }
    for relay in relays { #expect(await relay.exitStatus() == 0) }
}

private func request(_ relay: Child, id: Int, method: String, fields: String = "") async throws -> [String: Any] {
    let envelope =
        #""_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}"#
    try relay.send(MCP.call(id, method, "{\(envelope)\(fields)}"))
    let reply = try #require(MCP.object(await relay.line()))
    #expect(reply["id"] as? Int == id)
    #expect(reply["error"] == nil)
    return try #require(reply["result"] as? [String: Any])
}
