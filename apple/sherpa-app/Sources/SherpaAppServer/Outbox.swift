import Darwin
import Foundation
import SherpaAppConnection

/// A queue of whole writes drained by its own thread, so the reader that fills it never
/// waits on the descriptor (§7.7). Each enqueued chunk is written in one piece, in order.
/// The queue lets go of a chunk as soon as the writer takes it, and of everything it holds,
/// its closures included, once the writer stops: what an agent was sent does not outlive
/// its session.
final class Outbox: @unchecked Sendable {
    private let descriptor: Int32
    /// Nil: unbounded. Otherwise a chunk that would pass the limit is refused.
    private let limit: Int?
    private let condition = NSCondition()
    private var chunks: [[Data]] = []
    private var head = 0
    private var queued = 0
    private var finishing = false
    private var stopped = false
    private var afterDrain: (@Sendable () -> Void)?
    private var failed: (@Sendable (Int32) -> Void)?
    private var ended: (@Sendable () -> Void)?

    /// `failed` gets the errno of a write that did not complete. `ended` runs once when the
    /// writer thread stops for any reason. Both are released after that, so a closure that
    /// holds the outbox's owner does not keep it alive.
    init(
        descriptor: Int32, limit: Int?, failed: @escaping @Sendable (Int32) -> Void,
        ended: @escaping @Sendable () -> Void
    ) {
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

    /// The chunks the queue still holds, written or not. For tests.
    var heldChunks: Int {
        condition.lock()
        defer { condition.unlock() }
        return chunks.count - head
    }

    /// False when the outbox has stopped or the chunk would pass the limit.
    @discardableResult
    func enqueue(_ chunk: Data) -> Bool {
        enqueue([chunk])
    }

    /// Writes `parts` back-to-back as one entry without concatenating them first.
    /// False when the outbox has stopped or the combined size would pass the limit.
    @discardableResult
    func enqueue(_ parts: [Data]) -> Bool {
        let size = parts.reduce(0) { $0 + $1.count }
        condition.lock()
        defer { condition.unlock() }
        guard !stopped, !finishing else { return false }
        if let limit, queued + size > limit { return false }
        chunks.append(parts)
        queued += size
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
        dropQueued()
        afterDrain = nil
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

    /// Under the lock.
    private func dropQueued() {
        chunks.removeAll()
        head = 0
        queued = 0
    }

    /// Under the lock: stops and hands back the closures still to run, each once.
    private func stopLocked() -> (
        then: (@Sendable () -> Void)?, failed: (@Sendable (Int32) -> Void)?, ended: (@Sendable () -> Void)?
    ) {
        let closures = (afterDrain, failed, ended)
        stopped = true
        dropQueued()
        afterDrain = nil
        failed = nil
        ended = nil
        condition.broadcast()
        return closures
    }

    private func drain() {
        while true {
            condition.lock()
            while head == chunks.count, !stopped, !finishing {
                condition.wait()
            }
            if stopped || head == chunks.count {
                let cancelled = stopped
                let closures = stopLocked()
                condition.unlock()
                if !cancelled { closures.then?() }
                closures.ended?()
                return
            }
            // The writer's copy is the last reference; each part goes as soon as it is written.
            var parts = chunks[head]
            chunks[head] = []
            head += 1
            if head == chunks.count {
                chunks.removeAll()
                head = 0
            } else if head > 64, head * 2 > chunks.count {
                chunks.removeFirst(head)
                head = 0
            }
            condition.unlock()

            let size = parts.reduce(0) { $0 + $1.count }
            let failure: Int32? = autoreleasepool {
                for index in parts.indices {
                    let result = parts[index].withUnsafeBytes { FileDescriptorIO.writeAll(descriptor, $0) }
                    parts[index] = Data()
                    if let result { return result }
                }
                return nil
            }
            parts = []

            condition.lock()
            // A cancel during the write already set the count to zero.
            if !stopped { queued -= size }
            condition.broadcast()
            if let failure {
                let closures = stopLocked()
                condition.unlock()
                closures.failed?(failure)
                closures.ended?()
                return
            }
            condition.unlock()
        }
    }
}
