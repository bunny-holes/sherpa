import Darwin
import Foundation
import SherpaAppConnection

public enum SocketSetupFailure: Error, Equatable, Sendable {
    case pathTooLong
    case directoryIsLink
    case directoryForeignOwner
    case directoryNotFolder
    case directoryUnreadable(errno: Int32)
    case directoryModeUnfixable(errno: Int32)
    case staleSocketUnremovable(errno: Int32)
    case socketCreateFailed(errno: Int32)
    case bindFailed(errno: Int32)
    case chmodFailed(errno: Int32)
    case listenFailed(errno: Int32)

    /// The reason a log names. Never a path.
    public var reason: String {
        switch self {
        case .pathTooLong: "socket_path_too_long"
        case .directoryIsLink: "directory_is_link"
        case .directoryForeignOwner: "directory_foreign_owner"
        case .directoryNotFolder: "directory_not_folder"
        case let .directoryUnreadable(code): "directory_unreadable errno=\(code)"
        case let .directoryModeUnfixable(code): "directory_mode_unfixable errno=\(code)"
        case let .staleSocketUnremovable(code): "stale_socket_unremovable errno=\(code)"
        case let .socketCreateFailed(code): "socket_create_failed errno=\(code)"
        case let .bindFailed(code): "bind_failed errno=\(code)"
        case let .chmodFailed(code): "chmod_failed errno=\(code)"
        case let .listenFailed(code): "listen_failed errno=\(code)"
        }
    }
}

public enum SocketDirectory {
    /// The run folder must be a real folder owned by `owner`. A wrong mode is fixed to
    /// 0700; a link or another owner is refused (§3).
    public static func validate(path: String, owner: uid_t = getuid()) -> SocketSetupFailure? {
        var status = stat()
        guard lstat(path, &status) == 0 else { return .directoryUnreadable(errno: errno) }
        let type = status.st_mode & S_IFMT
        if type == S_IFLNK { return .directoryIsLink }
        guard type == S_IFDIR else { return .directoryNotFolder }
        guard status.st_uid == owner else { return .directoryForeignOwner }
        if status.st_mode & 0o777 != 0o700, chmod(path, 0o700) != 0 {
            return .directoryModeUnfixable(errno: errno)
        }
        return nil
    }
}

/// The listening socket: stale file removed, bound, 0600, backlog 16. Only the process that
/// holds the instance lock calls this, so a socket file left behind is stale.
public func makeListeningSocket(location: SocketLocation) throws(SocketSetupFailure) -> Int32 {
    guard location.fitsSocketAddress, var address = unixSocketAddress(location.socketPath) else {
        throw .pathTooLong
    }
    if let failure = SocketDirectory.validate(path: location.directoryPath) { throw failure }
    if unlink(location.socketPath) != 0, errno != ENOENT {
        throw .staleSocketUnremovable(errno: errno)
    }
    let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
    guard descriptor >= 0 else { throw .socketCreateFailed(errno: errno) }
    _ = fcntl(descriptor, F_SETFD, FD_CLOEXEC)
    let bound = withUnsafePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
    guard bound == 0 else {
        let code = errno
        close(descriptor)
        throw .bindFailed(errno: code)
    }
    guard chmod(location.socketPath, 0o600) == 0 else {
        let code = errno
        close(descriptor)
        unlink(location.socketPath)
        throw .chmodFailed(errno: code)
    }
    guard listen(descriptor, AppServerConfiguration.listenBacklog) == 0 else {
        let code = errno
        close(descriptor)
        unlink(location.socketPath)
        throw .listenFailed(errno: code)
    }
    return descriptor
}
