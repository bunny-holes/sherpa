import Darwin
import Foundation
import SherpaAppConnection

// A stand-in for Sherpa.app on the relay's side of the socket (contract §13.2, §14): it
// listens on the given path, writes the given preface line (or nothing), then echoes every
// line back or closes. Test program; never shipped.
//
//   sherpa-fake-app <socket> <preface-file|-> <echo|close|silent>

signal(SIGPIPE, SIG_IGN)
let arguments = CommandLine.arguments
guard arguments.count == 4, var address = unixSocketAddress(arguments[1]) else {
    FileHandle.standardError.write(Data("usage: sherpa-fake-app <socket> <preface-file|-> <echo|close|silent>\n".utf8))
    exit(64)
}
let preface: Data? = arguments[2] == "-" ? nil : FileManager.default.contents(atPath: arguments[2])
let behaviour = arguments[3]

unlink(arguments[1])
let listener = socket(AF_UNIX, SOCK_STREAM, 0)
let bound = withUnsafePointer(to: &address) {
    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        bind(listener, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
    }
}
guard bound == 0, listen(listener, 16) == 0 else {
    FileHandle.standardError.write(Data("fake-app: listen failed errno=\(errno)\n".utf8))
    exit(70)
}
FileHandle.standardError.write(Data("fake-app: listening\n".utf8))

while true {
    let connection = accept(listener, nil, nil)
    guard connection >= 0 else { continue }
    FileHandle.standardError.write(Data("fake-app: accepted\n".utf8))
    Thread.detachNewThread {
        if let preface {
            _ = preface.withUnsafeBytes { FileDescriptorIO.writeAll(connection, $0) }
        }
        switch behaviour {
        case "close":
            close(connection)
        case "silent":
            var buffer = [UInt8](repeating: 0, count: 4_096)
            while case .bytes = buffer.withUnsafeMutableBytes({ FileDescriptorIO.read(connection, into: $0) }) {}
            close(connection)
        default:
            var buffer = [UInt8](repeating: 0, count: 64 * 1_024)
            while case let .bytes(count) = buffer.withUnsafeMutableBytes({ FileDescriptorIO.read(connection, into: $0) }
            ) {
                _ = buffer.withUnsafeBytes {
                    FileDescriptorIO.writeAll(connection, UnsafeRawBufferPointer(rebasing: $0[0..<count]))
                }
            }
            close(connection)
        }
    }
}
