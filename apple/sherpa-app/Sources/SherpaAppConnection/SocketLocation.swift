import Darwin
import Foundation

/// Where the app listens and the relay connects (contract §3).
public struct SocketLocation: Sendable, Equatable {
    /// `sockaddr_un.sun_path` holds 104 bytes including the terminating NUL.
    public static let maximumPathBytes = 103
    public static let defaultSuffix = "/Library/Application Support/Sherpa/run/app.sock"

    public let socketPath: String
    /// True only for a DEBUG build's `SHERPA_APP_SOCKET`.
    public let isOverride: Bool

    public init(socketPath: String, isOverride: Bool) {
        self.socketPath = socketPath
        self.isOverride = isOverride
    }

    public var directoryPath: String { (socketPath as NSString).deletingLastPathComponent }
    public var lockPath: String { directoryPath + "/app.lock" }
    /// How a log names the path: never the path itself, which holds the user name.
    public var logValue: String { isOverride ? "override" : "default" }
    public var fitsSocketAddress: Bool { socketPath.utf8.count <= Self.maximumPathBytes }

    public static func defaultLocation(home: String) -> SocketLocation {
        SocketLocation(socketPath: home + defaultSuffix, isOverride: false)
    }

    /// The default location, or in a DEBUG build the `SHERPA_APP_SOCKET` override. A release
    /// build never reads the environment here, so no process can point it elsewhere.
    public static func resolve(environment: [String: String]) throws -> SocketLocation {
        #if DEBUG
        if let override = environment["SHERPA_APP_SOCKET"], !override.isEmpty {
            return SocketLocation(socketPath: override, isOverride: true)
        }
        #endif
        return defaultLocation(home: try UserHome.directory())
    }
}

public enum UserHomeError: Error, Equatable {
    case lookupFailed(errno: Int32)
}

/// The home folder from the user database, not `$HOME`: an agent that starts the relay
/// with another `HOME` still finds the app's socket.
public enum UserHome {
    public static func directory(uid: uid_t = getuid()) throws -> String {
        var record = passwd()
        var result: UnsafeMutablePointer<passwd>?
        var size = Int(sysconf(_SC_GETPW_R_SIZE_MAX))
        if size <= 0 { size = 4_096 }
        while true {
            var buffer = [CChar](repeating: 0, count: size)
            // `pw_dir` points into the buffer, so it is copied while the buffer is pinned.
            let (status, directory) = buffer.withUnsafeMutableBufferPointer { storage in
                let status = getpwuid_r(uid, &record, storage.baseAddress, storage.count, &result)
                guard status == 0, result != nil, let directory = record.pw_dir else {
                    return (status, String?.none)
                }
                return (status, String(cString: directory))
            }
            if status == ERANGE, size < 1 << 20 {
                size *= 2
                continue
            }
            guard let directory else {
                throw UserHomeError.lookupFailed(errno: status == 0 ? ENOENT : status)
            }
            return directory
        }
    }
}
