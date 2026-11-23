import Darwin
import Foundation

/// A growable byte buffer for one protocol line. Small lines stay in normal `Data` storage;
/// lines above `mmapThreshold` move into an anonymous `mmap` region so libmalloc's large
/// cache never holds onto freed multi-megabyte buffers after a session ends. When handed
/// off via `takeData(from:)`, the returned `Data` owns the mapping directly and calls
/// `munmap` as soon as the last reference drops.
public struct LineBuffer: Sendable {
    /// Bytes above which the buffer switches from `Data` to an anonymous `mmap` mapping.
    /// Kept below libmalloc's large-allocation threshold so large frame payloads never enter
    /// `Malloc Large`.
    public static let mmapThreshold = 64 * 1_024

    private var small = Data()
    private var mapped: MappedStorage?
    private var mappedCount = 0

    public init() {}

    public var count: Int { mapped != nil ? mappedCount : small.count }
    public var isEmpty: Bool { count == 0 }
    /// Whether the current bytes live in an `mmap` mapping. For tests.
    public var isMapped: Bool { mapped != nil }

    public mutating func append(_ bytes: UnsafeRawBufferPointer) {
        guard !bytes.isEmpty, let source = bytes.baseAddress else { return }
        if mapped != nil {
            let newCount = mappedCount + bytes.count
            let unique = isKnownUniquelyReferenced(&mapped)
            let current = mapped!
            if unique, newCount <= current.mappedLength {
                memcpy(current.base! + mappedCount, source, bytes.count)
                mappedCount = newCount
                return
            }
            let next = MappedStorage(capacity: max(newCount, current.mappedLength * 2))
            if mappedCount > 0 {
                memcpy(next.base!, current.base!, mappedCount)
            }
            memcpy(next.base! + mappedCount, source, bytes.count)
            mapped = next
            mappedCount = newCount
            return
        }
        let newCount = small.count + bytes.count
        if newCount <= Self.mmapThreshold {
            small.append(bytes.bindMemory(to: UInt8.self))
            return
        }
        let next = MappedStorage(capacity: max(newCount, Self.mmapThreshold * 2))
        let existing = small.count
        if existing > 0 {
            small.withUnsafeBytes { raw in
                if let base = raw.baseAddress {
                    memcpy(next.base!, base, existing)
                }
            }
        }
        memcpy(next.base! + existing, source, bytes.count)
        small = Data()
        mapped = next
        mappedCount = newCount
    }

    public func prefixBytes(_ maxLength: Int) -> [UInt8] {
        let length = min(maxLength, count)
        guard length > 0 else { return [] }
        if let storage = mapped {
            let buffer = UnsafeBufferPointer(
                start: storage.base!.assumingMemoryBound(to: UInt8.self), count: length)
            return Array(buffer)
        }
        return Array(small.prefix(length))
    }

    /// Hands off `offset..<count` as a zero-indexed `Data` and resets this buffer to empty.
    /// For mapped storage this transfers ownership without copying; the mapping is unmapped
    /// when the returned `Data` (and any slices of it) are released.
    public mutating func takeData(from offset: Int = 0) -> Data {
        precondition(offset >= 0 && offset <= count, "offset out of range")
        if mapped != nil {
            let length = mappedCount - offset
            guard length > 0 else {
                reset()
                return Data()
            }
            let unique = isKnownUniquelyReferenced(&mapped)
            let storage = mapped!
            if !unique {
                let copy = MappedStorage(capacity: length)
                memcpy(copy.base!, storage.base! + offset, length)
                reset()
                let (pointer, mappedLength) = copy.detach()
                return Data(
                    bytesNoCopy: pointer, count: length,
                    deallocator: .custom { ptr, _ in Darwin.munmap(ptr, mappedLength) })
            }
            let (pointer, mappedLength) = storage.detach()
            mapped = nil
            mappedCount = 0
            return Data(
                bytesNoCopy: pointer + offset, count: length,
                deallocator: .custom { ptr, _ in
                    Darwin.munmap(ptr.advanced(by: -offset), mappedLength)
                })
        }
        let data = small
        small = Data()
        if offset == 0 { return data }
        guard offset < data.count else { return Data() }
        return data.subdata(in: offset..<data.count)
    }

    public mutating func reset() {
        small = Data()
        mapped = nil
        mappedCount = 0
    }
}

private final class MappedStorage: @unchecked Sendable {
    var base: UnsafeMutableRawPointer?
    var mappedLength: Int

    init(capacity: Int) {
        let pageSize = Int(getpagesize())
        let aligned = ((max(capacity, 1) + pageSize - 1) / pageSize) * pageSize
        let pointer = Darwin.mmap(nil, aligned, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0)
        precondition(pointer != MAP_FAILED, "mmap failed with errno \(errno)")
        self.base = pointer
        self.mappedLength = aligned
    }

    func detach() -> (UnsafeMutableRawPointer, Int) {
        guard let pointer = base else {
            preconditionFailure("MappedStorage already detached")
        }
        let length = mappedLength
        base = nil
        mappedLength = 0
        return (pointer, length)
    }

    deinit {
        if let pointer = base {
            Darwin.munmap(pointer, mappedLength)
        }
    }
}
