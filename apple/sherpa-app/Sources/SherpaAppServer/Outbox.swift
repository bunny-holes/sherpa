import Darwin
import Foundation
import SherpaAppConnection

/// A queue of whole writes drained by its own thread, so the reader that fills it never
/// waits on the descriptor (§7.7). Each enqueued chunk is written in one piece, in order.
final class Outbox: @unchecked Sendable {
    private let descriptor: Int32
    /// Nil: unbounded. Otherwise a chunk that would pass the limit is refused.
    private let limit: Int?
    private let condition = NSCondition()
    private var chunks: [Data] = []
    private var head = 0
    private var queued = 0
    private var finishing = false
    private var stopped = false
    private var afterDrain: (@Sendable () -> Void)?
    private let failed: @Sendable (Int32) -> Void
    private let ended: @Sendable () -> Void

    /// `failed` gets the errno of a write that did not complete. `ended` runs once when the
    /// writer thread stops for any reason.
    init(descriptor: Int32, limit: Int?, failed: @escaping @Sendable (Int32) -> Void,
         ended: @escaping @Sendable () -> Void) {
        self.descriptor = descriptor
        self.limit = limit
        self.failed = failed
        self.ended = ended
        Thread.detachNewThread { [self] in drain() }
    }

    var queuedBytes: Int {
        condition.lock()
        defer { condition.unlock() }
        return queued
    }

    /// False when the outbox has stopped or the chunk would pass the limit.
    @discardableResult
    func enqueue(_ chunk: Data) -> Bool {
        condition.lock()
        defer { condition.unlock() }
        guard !stopped, !finishing else { return false }
        if let limit, queued + chunk.count > limit { return false }
        chunks.append(chunk)
        queued += chunk.count
        condition.broadcast()
        return true
    }

    /// Writes what is queued, then runs `then` on the writer thread and stops.
    func finish(then: @escaping @Sendable () -> Void) {
        condition.lock()
        defer { condition.unlock() }
        guard !stopped, !finishing else { return }
        finishing = true
        afterDrain = then
        condition.broadcast()
    }

    /// Drops what is queued and stops.
    func cancel() {
        condition.lock()
        defer { condition.unlock() }
        stopped = true
        chunks.removeAll()
        head = 0
        queued = 0
        condition.broadcast()
    }

    /// Blocks while more than `bytes` wait to be written. Returns at once when stopped.
    func waitUntilBelow(_ bytes: Int) {
        condition.lock()
        defer { condition.unlock() }
        while queued > bytes, !stopped {
            condition.wait()
        }
    }

    private func drain() {
        while true {
            condition.lock()
            while head == chunks.count, !stopped, !finishing {
                condition.wait()
            }
            if stopped || head == chunks.count {
                let then = stopped ? nil : afterDrain
                stopped = true
                condition.broadcast()
                condition.unlock()
                then?()
                ended()
                return
            }
            let chunk = chunks[head]
            head += 1
            if head > 64, head * 2 > chunks.count {
                chunks.removeFirst(head)
                head = 0
            }
            condition.unlock()

            let failure: Int32? = autoreleasepool {
                chunk.withUnsafeBytes { FileDescriptorIO.writeAll(descriptor, $0) }
            }

            condition.lock()
            queued -= chunk.count
            condition.broadcast()
            if let failure {
                stopped = true
                chunks.removeAll()
                head = 0
                queued = 0
                condition.unlock()
                failed(failure)
                ended()
                return
            }
            condition.unlock()
        }
    }
}
