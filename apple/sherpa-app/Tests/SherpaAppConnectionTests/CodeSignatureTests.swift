import Darwin
import Foundation
import Testing
@testable import SherpaAppConnection

// Contract §4: the uid decides before the code is looked up.

/// An audit token whose pid no process has, so looking up its code fails.
private func missingProcessToken() -> Data {
    var token = audit_token_t()
    token.val.5 = UInt32(Int32.max)
    return withUnsafeBytes(of: &token) { Data($0) }
}

@Test func reportsAnotherUsersPeerAsOtherUserEvenWhenItsCodeCannotBeFound() throws {
    let stranger = SocketPeer(pid: Int32.max, effectiveUID: geteuid() &+ 1, token: missingProcessToken())
    let check = try CodeSignature.check(peer: stranger, requirement: "identifier \"dev.xiyo.sherpa.relay\"")
    #expect(check.verdict == .otherUser)
    #expect(check.signingIdentifier == nil)

    let sameUser = SocketPeer(pid: Int32.max, effectiveUID: geteuid(), token: missingProcessToken())
    let rejected = try CodeSignature.check(peer: sameUser, requirement: "identifier \"dev.xiyo.sherpa.relay\"")
    guard case .signatureRejected = rejected.verdict else {
        Issue.record("expected signatureRejected, got \(rejected.verdict)")
        return
    }
}
