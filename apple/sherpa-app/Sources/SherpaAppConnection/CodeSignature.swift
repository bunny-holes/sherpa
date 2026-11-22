import Darwin
import Foundation
import Security

/// Who is on the other end of a connected Unix socket, from its audit token. The token, not
/// the pid, names the process, so a reused pid cannot stand in for the checked one.
public struct SocketPeer: Sendable, Equatable {
    public let pid: pid_t
    public let effectiveUID: uid_t
    fileprivate let token: Data

    /// `getsockopt(fd, SOL_LOCAL, LOCAL_PEERTOKEN)`.
    public init(socket: Int32) throws(CodeSignatureError) {
        var auditToken = audit_token_t()
        var length = socklen_t(MemoryLayout<audit_token_t>.size)
        guard getsockopt(socket, SOL_LOCAL, LOCAL_PEERTOKEN, &auditToken, &length) == 0 else {
            throw .peerTokenUnavailable(errno: errno)
        }
        pid = audit_token_to_pid(auditToken)
        effectiveUID = audit_token_to_euid(auditToken)
        token = withUnsafeBytes(of: &auditToken) { Data($0) }
    }

    /// A peer as a test describes it.
    init(pid: pid_t, effectiveUID: uid_t, token: Data) {
        self.pid = pid
        self.effectiveUID = effectiveUID
        self.token = token
    }
}

public enum CodeSignatureError: Error, Equatable, Sendable {
    case peerTokenUnavailable(errno: Int32)
    case requirementInvalid(status: Int32)
}

/// The outcome of checking a peer: the same user first, then the signing requirement.
public enum PeerVerdict: Equatable, Sendable {
    case accepted
    case otherUser
    case signatureRejected(status: Int32)
}

public struct PeerCheck: Equatable, Sendable {
    public let verdict: PeerVerdict
    public let pid: pid_t
    /// The peer's signing identifier as it signed itself, for logs only. Nil when unsigned.
    public let signingIdentifier: String?

    public init(verdict: PeerVerdict, pid: pid_t, signingIdentifier: String?) {
        self.verdict = verdict
        self.pid = pid
        self.signingIdentifier = signingIdentifier
    }

    /// `pid=… identifier=…` with the identifier reduced to a safe token.
    public var logFields: String { "pid=\(pid) identifier=\(logToken(signingIdentifier))" }
}

public enum CodeSignature {
    /// Checks the process behind a connected socket (contract §4): its effective uid must be
    /// this process's, then its dynamic code must meet `requirement`.
    public static func check(socket: Int32, requirement: String) throws(CodeSignatureError) -> PeerCheck {
        try check(peer: SocketPeer(socket: socket), requirement: requirement)
    }

    /// The uid first: another user's process is `otherUser` whatever its code is (§4).
    static func check(peer: SocketPeer, requirement: String) throws(CodeSignatureError) -> PeerCheck {
        guard peer.effectiveUID == geteuid() else {
            return PeerCheck(verdict: .otherUser, pid: peer.pid, signingIdentifier: nil)
        }
        let compiled = try compile(requirement)
        var code: SecCode?
        let attributes = [kSecGuestAttributeAudit: peer.token] as CFDictionary
        let copied = SecCodeCopyGuestWithAttributes(nil, attributes, [], &code)
        guard copied == errSecSuccess, let code else {
            // A peer whose code cannot be located is refused like a wrong signature.
            return PeerCheck(verdict: .signatureRejected(status: copied), pid: peer.pid, signingIdentifier: nil)
        }
        let status = SecCodeCheckValidity(code, [], compiled)
        let verdict: PeerVerdict = status == errSecSuccess ? .accepted : .signatureRejected(status: status)
        return PeerCheck(verdict: verdict, pid: peer.pid, signingIdentifier: signingIdentifier(of: code))
    }

    /// Checks the code a child of this process is running (the core, contract §2): the code
    /// the kernel loaded, which must also be the file now at its path. The caller started it
    /// suspended and has not reaped it, so the pid cannot name another process.
    public static func checkRunning(pid: pid_t, requirement: SecRequirement) -> OSStatus {
        var code: SecCode?
        let attributes = [kSecGuestAttributePid: pid] as CFDictionary
        let copied = SecCodeCopyGuestWithAttributes(nil, attributes, [], &code)
        guard copied == errSecSuccess, let code else { return copied }
        return SecCodeCheckValidity(code, [], requirement)
    }

    public static func compile(_ requirement: String) throws(CodeSignatureError) -> SecRequirement {
        var compiled: SecRequirement?
        let status = SecRequirementCreateWithString(requirement as CFString, [], &compiled)
        guard status == errSecSuccess, let compiled else { throw .requirementInvalid(status: status) }
        return compiled
    }

    private static func signingIdentifier(of code: SecCode) -> String? {
        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { return nil }
        var information: CFDictionary?
        guard
            SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &information)
                == errSecSuccess,
            let information = information as? [String: Any]
        else { return nil }
        return information[kSecCodeInfoIdentifier as String] as? String
    }
}
