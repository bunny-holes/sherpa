import Darwin
import Foundation
import SherpaAppConnection

/// One accepted relay socket. Its reader turns lines into `data` frames; its outbox holds
/// what the core sent for it, up to 16 MiB (§7.7). The descriptor closes once both threads
/// are done with it.
final class RelayConnection: @unchecked Sendable {
    static let outboxLimit = 16 * 1_024 * 1_024
    static let readBytes = 64 * 1_024

    let id: Int
    let descriptor: Int32
    let peer: PeerCheck
    /// Set by the server under its lock once the preface `ready` is queued.
    var channel: UInt64?
    var generation = 0

    private let lock = NSLock()
    private var users = 2
    private var outboxStorage: Outbox?

    init(id: Int, descriptor: Int32, peer: PeerCheck) {
        self.id = id
        self.descriptor = descriptor
        self.peer = peer
    }

    /// Starts the writer. `failed` runs when a write to the relay fails. The writer holds
    /// this connection until it stops, so the descriptor closes even when nothing else holds
    /// it; the outbox lets go of that closure then, so a closed connection is freed.
    func openOutbox(failed: @escaping @Sendable (Int32) -> Void) {
        let outbox = Outbox(descriptor: descriptor, limit: Self.outboxLimit, failed: failed) { [self] in
            release()
        }
        lock.lock()
        outboxStorage = outbox
        lock.unlock()
    }

    var outbox: Outbox? {
        lock.lock()
        defer { lock.unlock() }
        return outboxStorage
    }

    /// False when the bytes would pass the 16 MiB limit or the connection is closing.
    func send(_ bytes: Data) -> Bool {
        outbox?.enqueue(bytes) ?? false
    }

    /// Writes `parts` back-to-back without concatenating them into a new buffer.
    func send(_ parts: [Data]) -> Bool {
        outbox?.enqueue(parts) ?? false
    }

    /// Writes what is queued, then ends both directions; the relay reads end of file.
    func closeAfterFlush() {
        guard let outbox else {
            shutdown(descriptor, SHUT_RDWR)
            return
        }
        let descriptor = descriptor
        outbox.finish { shutdown(descriptor, SHUT_RDWR) }
    }

    /// Drops what is queued and ends both directions.
    func closeNow() {
        outbox?.cancel()
        shutdown(descriptor, SHUT_RDWR)
    }

    /// Writes a refusal or unavailable preface directly and closes. Used before any outbox.
    func reject(with preface: AppPreface) {
        _ = preface.line().withUnsafeBytes { FileDescriptorIO.writeAll(descriptor, $0) }
        shutdown(descriptor, SHUT_RDWR)
        release()
        release()
    }

    /// Reads lines until the relay ends. `waitForCapacity` runs before every read so a full
    /// core input stops reading and the socket buffer pushes back on the agent.
    func readLines(
        waitForCapacity: @escaping @Sendable () -> Void,
        line: @escaping @Sendable (Data) -> Void,
        tooLarge: @escaping @Sendable () -> Void,
        ended: @escaping @Sendable (_ errno: Int32?) -> Void
    ) {
        Thread.detachNewThread { [self] in
            var pending = LineBuffer()
            var buffer = [UInt8](repeating: 0, count: Self.readBytes)
            readLoop: while true {
                waitForCapacity()
                let result = autoreleasepool {
                    buffer.withUnsafeMutableBytes { FileDescriptorIO.read(descriptor, into: $0) }
                }
                switch result {
                case let .bytes(count):
                    var start = 0
                    while start < count {
                        if let feed = buffer[start..<count].firstIndex(of: 0x0a) {
                            let pieceCount = feed - start
                            if pending.count + pieceCount > MuxLimits.data {
                                pending.reset()
                                tooLarge()
                                break readLoop
                            }
                            if pieceCount > 0 {
                                buffer.withUnsafeBytes { raw in
                                    pending.append(UnsafeRawBufferPointer(rebasing: raw[start..<feed]))
                                }
                            }
                            if !pending.isEmpty {
                                line(pending.takeData())
                            } else {
                                pending.reset()
                            }
                            start = feed + 1
                        } else {
                            let pieceCount = count - start
                            if pending.count + pieceCount > MuxLimits.data {
                                pending.reset()
                                tooLarge()
                                break readLoop
                            }
                            buffer.withUnsafeBytes { raw in
                                pending.append(UnsafeRawBufferPointer(rebasing: raw[start..<count]))
                            }
                            start = count
                        }
                    }
                case .endOfFile:
                    ended(nil)
                    break readLoop
                case let .failed(code):
                    ended(code)
                    break readLoop
                }
            }
            pending.reset()
            release()
        }
    }

    private func release() {
        lock.lock()
        users -= 1
        let last = users == 0
        lock.unlock()
        if last { close(descriptor) }
    }
}
