import Darwin
import Foundation
import SherpaAppConnection

/// One app per user: `flock` on `run/app.lock`, held until the process ends (§3).
/// Launch Services alone does not prevent a second process (`open -n`, a direct exec).
public final class InstanceLock: Sendable {
    public enum Outcome: Sendable {
        case acquired(InstanceLock)
        case heldByAnotherProcess
        case failed(step: String, errno: Int32)
    }

    public let descriptor: Int32

    private init(descriptor: Int32) {
        self.descriptor = descriptor
    }

    /// Creates the run folder (0700) if it is missing, then takes the lock. The folder's
    /// owner, type and mode are checked after the lock (contract order: lock, folder, bind).
    public static func acquire(location: SocketLocation) -> Outcome {
        do {
            try FileManager.default.createDirectory(
                atPath: location.directoryPath, withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
        } catch {
            let code = ((error as NSError).userInfo[NSUnderlyingErrorKey] as? NSError)?.code
            return .failed(step: "directory", errno: Int32(code ?? Int(EIO)))
        }
        let descriptor = open(location.lockPath, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0o600)
        guard descriptor >= 0 else { return .failed(step: "open", errno: errno) }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            let code = errno
            close(descriptor)
            return code == EWOULDBLOCK ? .heldByAnotherProcess : .failed(step: "flock", errno: code)
        }
        return .acquired(InstanceLock(descriptor: descriptor))
    }

    public func release() {
        close(descriptor)
    }
}
