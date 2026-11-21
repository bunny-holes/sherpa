import Darwin

/// Blocking reads and writes on a file descriptor that retry `EINTR` and report `errno`.
public enum FileDescriptorIO {
    public enum ReadResult: Equatable, Sendable {
        case bytes(Int)
        case endOfFile
        case failed(errno: Int32)
    }

    public static func read(_ descriptor: Int32, into buffer: UnsafeMutableRawBufferPointer) -> ReadResult {
        while true {
            let count = Darwin.read(descriptor, buffer.baseAddress, buffer.count)
            if count > 0 { return .bytes(count) }
            if count == 0 { return .endOfFile }
            if errno == EINTR { continue }
            return .failed(errno: errno)
        }
    }

    /// Writes every byte. Returns `errno` of the write that failed, or nil.
    public static func writeAll(_ descriptor: Int32, _ bytes: UnsafeRawBufferPointer) -> Int32? {
        var offset = 0
        while offset < bytes.count {
            let written = Darwin.write(descriptor, bytes.baseAddress! + offset, bytes.count - offset)
            if written > 0 {
                offset += written
            } else if written < 0, errno == EINTR {
                continue
            } else {
                return written < 0 ? errno : EIO
            }
        }
        return nil
    }

    public static func writeAll(_ descriptor: Int32, _ bytes: [UInt8]) -> Int32? {
        bytes.withUnsafeBytes { writeAll(descriptor, $0) }
    }
}

/// A Unix socket address for `path`; nil when it does not fit `sun_path`.
public func unixSocketAddress(_ path: String) -> sockaddr_un? {
    var address = sockaddr_un()
    let bytes = Array(path.utf8)
    let capacity = MemoryLayout.size(ofValue: address.sun_path)
    guard !bytes.isEmpty, bytes.count < capacity else { return nil }
    address.sun_family = sa_family_t(AF_UNIX)
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    withUnsafeMutableBytes(of: &address.sun_path) { storage in
        storage.copyBytes(from: bytes)
        storage[bytes.count] = 0
    }
    return address
}
