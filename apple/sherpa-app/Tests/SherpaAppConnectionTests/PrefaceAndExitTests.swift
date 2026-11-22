import Darwin
import Foundation
import Testing
@testable import SherpaAppConnection
@testable import SherpaRelayKit

@Test func writesThePrefaceWithItsFourKeysInOrder() {
    #expect(AppPreface.ready(version: "0.9.0").line()
        == Data("{\"sherpa_app\":1,\"status\":\"ready\",\"reason\":null,\"version\":\"0.9.0\"}\n".utf8))
    #expect(AppPreface.unavailable(.coreStarting, version: "0.9.0").line()
        == Data("{\"sherpa_app\":1,\"status\":\"unavailable\",\"reason\":\"core_starting\",\"version\":\"0.9.0\"}\n".utf8))
    #expect(AppPreface.unavailable(.mcpDisabled, version: "0.9.0").line()
        == Data("{\"sherpa_app\":1,\"status\":\"unavailable\",\"reason\":\"mcp_disabled\",\"version\":\"0.9.0\"}\n".utf8))
    #expect(AppPreface.refused(.peerSignature, version: "0.9.0").line()
        == Data("{\"sherpa_app\":1,\"status\":\"refused\",\"reason\":\"peer_signature\",\"version\":\"0.9.0\"}\n".utf8))
    for reason in AppPreface.Reason.allCases {
        #expect(AppPreface.unavailable(reason, version: "0.9.0").line().count <= AppPreface.maximumBytes)
    }
}

@Test(arguments: [
    (#"{"sherpa_app":1,"status":"ready","reason":null,"version":"0.9.0"}"#, nil as Int32?),
    (#"{"sherpa_app":1,"status":"unavailable","reason":"core_starting","version":"0.9.0"}"#, 75),
    (#"{"sherpa_app":1,"status":"unavailable","reason":"mcp_disabled","version":"0.9.0"}"#, 75),
    // A reason this relay does not know, in the shape of one: the status decides.
    (#"{"sherpa_app":1,"status":"unavailable","reason":"a_later_reason","version":"0.9.0"}"#, 75),
    (#"{"sherpa_app":1,"status":"refused","reason":"a_later_reason","version":"0.9.0"}"#, 77),
    (#"{"sherpa_app":1,"status":"unavailable","reason":"Not A Reason","version":"0.9.0"}"#, 76),
    (#"{"sherpa_app":1,"status":"refused","reason":"peer_signature","version":"0.9.0"}"#, 77),
    (#"{"sherpa_app":2,"status":"ready","reason":null,"version":"9.0.0"}"#, 76),
    ("not json", 76),
    (#"{"sherpa_app":1,"status":"ready","reason":null}"#, 76),
    (#"{"sherpa_app":1,"status":"ready","reason":null,"version":"0.9.0","extra":1}"#, 76),
    (#"{"sherpa_app":1,"status":"ready","reason":"core_starting","version":"0.9.0"}"#, 76),
    (#"{"sherpa_app":1,"status":"unavailable","reason":null,"version":"0.9.0"}"#, 76),
    (#"{"sherpa_app":1,"status":"waiting","reason":null,"version":"0.9.0"}"#, 76),
    (#"{"sherpa_app":true,"status":"ready","reason":null,"version":"0.9.0"}"#, 76),
])
func mapsEachPrefaceVectorToItsExit(line: String, expected: Int32?) {
    #expect(RelayExitTable.preface(AppPreface.read(line: Data(line.utf8)))?.exit.rawValue == expected)
}

@Test func mapsEveryOtherEndToTheContractCodes() {
    let location = SocketLocation(socketPath: "/x/app.sock", isOverride: false)
    #expect(RelayExitTable.connectFailure(errno: ENOENT, socket: location).exit == .unavailable)
    #expect(RelayExitTable.connectFailure(errno: ECONNREFUSED, socket: location).exit == .unavailable)
    #expect(RelayExitTable.connectFailure(errno: EACCES, socket: location).exit == .ioError)
    #expect(RelayExitTable.prefaceMissing.exit == .protocolError)
    #expect(RelayExitTable.prefaceTimedOut.exit == .temporaryFailure)
    #expect(RelayExitTable.appClosedSession.exit == .temporaryFailure)
    let rejected = PeerCheck(verdict: .signatureRejected(status: -67050), pid: 42, signingIdentifier: "evil id")
    #expect(RelayExitTable.signature(rejected).exit == .noPermission)
    #expect(RelayExitTable.signature(rejected).logFields.contains("pid=42 identifier=invalid"))
    #expect(RelayExitTable.signature(PeerCheck(verdict: .otherUser, pid: 1, signingIdentifier: nil)).reason
        == "server_user_rejected")
    #expect(RelayExit.usage.rawValue == 64 && RelayExit.software.rawValue == 70 && RelayExit.configuration.rawValue == 78)
}

@Test func errorLinesNameAReasonAndARemedy() {
    let failure = RelayExitTable.connectFailure(errno: ENOENT, socket: SocketLocation(socketPath: "/x", isOverride: false))
    #expect(failure.logFields == #"reason=app_not_running socket=default remedy="start Sherpa.app""#)
    let disabled = RelayExitTable.preface(.unavailable(reason: "mcp_disabled"))
    #expect(disabled?.logFields
        == #"reason=app_unavailable app_reason=mcp_disabled remedy="turn on MCP in the Sherpa menu or status window, then reconnect""#)
    let unknown = RelayExitTable.preface(.unavailable(reason: "a_later_reason"))
    #expect(unknown?.exit == .temporaryFailure)
    #expect(unknown?.remedy == "restart Sherpa.app, then reconnect")
}

@Test func findsTheHomeInTheUserDatabaseNotInHOME() throws {
    let home = try UserHome.directory()
    #expect(home == FileManager.default.homeDirectory(forUser: NSUserName())?.path)
    let location = try SocketLocation.resolve(environment: ["HOME": "/elsewhere"])
    #expect(location == SocketLocation.defaultLocation(home: home))
    #expect(location.socketPath == home + "/Library/Application Support/Sherpa/run/app.sock")
    #expect(location.lockPath == home + "/Library/Application Support/Sherpa/run/app.lock")
    #expect(location.logValue == "default")
}

@Test func takesTheSocketOverrideOnlyInADebugBuild() throws {
    let location = try SocketLocation.resolve(environment: ["SHERPA_APP_SOCKET": "/tmp/x/app.sock"])
    #if DEBUG
    #expect(location == SocketLocation(socketPath: "/tmp/x/app.sock", isOverride: true))
    #expect(location.logValue == "override")
    #else
    #expect(!location.isOverride)
    #endif
}

@Test func fitsAPathOfAtMost103Bytes() {
    let fits = "/" + String(repeating: "a", count: 102)
    let tooLong = "/" + String(repeating: "a", count: 103)
    #expect(SocketLocation(socketPath: fits, isOverride: true).fitsSocketAddress)
    #expect(unixSocketAddress(fits) != nil)
    #expect(!SocketLocation(socketPath: tooLong, isOverride: true).fitsSocketAddress)
    #expect(unixSocketAddress(tooLong) == nil)
    // A 48-byte user name is the longest the default path fits (§3).
    let longest = SocketLocation.defaultLocation(home: "/Users/" + String(repeating: "u", count: 48))
    #expect(longest.fitsSocketAddress)
    #expect(!SocketLocation.defaultLocation(home: "/Users/" + String(repeating: "u", count: 49)).fitsSocketAddress)
}

@Test func compilesTheTeamIntoEveryRequirement() throws {
    #expect(SherpaTeam.identifier == "FN2KZ2J47B")
    #expect(SherpaCodeIdentity.relay.requirement
        == #"anchor apple generic and certificate leaf[subject.OU] = "FN2KZ2J47B" and identifier "dev.xiyo.sherpa.relay""#)
    for identity in SherpaCodeIdentity.allCases {
        _ = try CodeSignature.compile(identity.requirement)
    }
}

@Test func reducesUntrustedValuesToSafeLogTokens() {
    #expect(logToken("dev.xiyo.sherpa.relay") == "dev.xiyo.sherpa.relay")
    #expect(logToken("a b") == "invalid")
    #expect(logToken(String(repeating: "a", count: 129)) == "invalid")
    #expect(logToken(nil) == "none")
}
