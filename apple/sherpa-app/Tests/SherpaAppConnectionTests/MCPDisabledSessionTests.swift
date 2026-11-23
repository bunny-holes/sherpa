import Foundation
import Testing

@testable import SherpaRelayKit

@Test(arguments: ["tools/list", "tools/call", "initialize", "ping"])
func disabledMCPTellsEveryRequestExceptDiscoveryHowToReconnect(method: String) throws {
    let remedy = try #require(RelayExitTable.preface(.unavailable(reason: "mcp_disabled", version: "0.8.6"))?.remedy)
    let input = Data(#"{"jsonrpc":"2.0","id":"agent/request-1","method":"\#(method)"}"#.utf8)
    let output = try #require(MCPDisabledSession.response(to: input, version: "0.8.6", remedy: remedy))
    let reply = try #require(try JSONSerialization.jsonObject(with: output) as? [String: Any])
    let error = try #require(reply["error"] as? [String: Any])
    #expect(reply["id"] as? String == "agent/request-1")
    #expect(reply["jsonrpc"] as? String == "2.0")
    #expect(error["code"] as? Int == -32000)
    #expect(error["message"] as? String == "Sherpa.app has MCP turned off: \(remedy)")
    #expect(error["data"] as? [String: String] == ["reason": "mcp_disabled", "remedy": remedy])
    #expect(!remedy.contains(";"))
}

@Test(arguments: [
    "{",
    #"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
    #"{"jsonrpc":"2.0","id":false,"method":"server/discover"}"#,
    #"{"jsonrpc":"2.0","id":1,"result":{}}"#,
])
func disabledMCPOnlyAnswersRequestsWithValidIDs(line: String) {
    #expect(MCPDisabledSession.response(to: Data(line.utf8), version: "0.8.6", remedy: "Turn on MCP") == nil)
}
