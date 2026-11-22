import Foundation

/// One line of the app–core pipe (contract §7.2):
///
///     frame   = channel HTAB type [HTAB body] LF
///     channel = "0" / (%x31-39 *15DIGIT)    ; no leading zero, at most 2^53-1
///     type    = 1*16(%x61-7A / "-")
///     body    = 1*(%x00-09 / %x0B-FF)
public struct MuxFrame: Equatable, Sendable {
    public static let maximumChannel: UInt64 = (1 << 53) - 1

    public let channel: UInt64
    public let type: String
    public let body: Data?

    public init(channel: UInt64, type: String, body: Data? = nil) {
        self.channel = channel
        self.type = type
        self.body = body
    }

    public init(channel: UInt64, type: String, json: String) {
        self.init(channel: channel, type: type, body: Data(json.utf8))
    }

    /// The frame as one write: header, optional body, line feed. A body never holds a line feed;
    /// callers split relay input on line feeds and serialize JSON without one.
    public var encoded: Data {
        var line = Data("\(channel)\t\(type)".utf8)
        if let body {
            precondition(!body.contains(0x0a), "a frame body never holds a line feed")
            line.append(0x09)
            line.append(body)
        }
        line.append(0x0a)
        return line
    }
}

/// Which end wrote the frame. The table of allowed channel and type pairs differs by direction.
public enum MuxDirection: Sendable {
    case coreToApp
    case appToCore
}

/// A protocol violation and the code a core's `fatal` frame names (contract §7.3).
public enum MuxViolation: Error, Equatable, Sendable {
    case frameInvalid
    case frameTooLarge
    case unexpectedFrame

    public var code: String {
        switch self {
        case .frameInvalid: "mux.frame_invalid"
        case .frameTooLarge: "mux.frame_too_large"
        case .unexpectedFrame: "mux.unexpected_frame"
        }
    }
}

/// Body limits by type (contract §7.4).
public enum MuxLimits {
    public static let data = 4 * 1_024 * 1_024
    public static let request = 64 * 1_024 + 1_024
    public static let response = 8 * 1_024 * 1_024 + 1_024
    public static let confirm = 64 * 1_024
    public static let other = 4 * 1_024
    /// Header, body and line feed of the largest frame: 8 MiB + 64 KiB.
    public static let line = 8_454_144

    public static func body(type: String) -> Int {
        switch type {
        case "data": data
        case "request": request
        case "response": response
        case "confirm": confirm
        default: other
        }
    }
}

/// Whether a body is required, forbidden or optional for a pair the table allows.
private enum BodyRule {
    case required, forbidden, optional
}

private func rule(direction: MuxDirection, channel: UInt64, type: String) -> BodyRule? {
    switch (direction, channel == 0, type) {
    case (.coreToApp, true, "hello"), (.coreToApp, true, "request"), (.coreToApp, true, "confirm"),
        (.coreToApp, true, "withdraw"), (.coreToApp, true, "fatal"):
        .required
    case (.appToCore, true, "hello"), (.appToCore, true, "response"), (.appToCore, true, "confirmation"):
        .required
    case (.appToCore, false, "open"):
        .forbidden
    case (_, false, "data"):
        .required
    case (_, false, "close"):
        .optional
    default:
        nil
    }
}

/// Splits a byte stream into frames and enforces each type's limit while reading: once the
/// header names the type, the line stops growing the moment it passes that limit, before
/// an unbounded buffer can form. The pair table and body rules are checked here too;
/// ordering rules (hello first, a second `open`) belong to the reader's owner.
public struct MuxFrameReader: Sendable {
    private static let maximumChannelDigits = 16
    private static let maximumTypeBytes = 16

    public let direction: MuxDirection
    private var line = Data()
    private var header: (channel: UInt64, type: String, bodyStart: Int, bodyLimit: Int)?

    public init(direction: MuxDirection) {
        self.direction = direction
    }

    /// Bytes of an incomplete line held so far.
    public var pendingBytes: Int { line.count }

    public mutating func consume(_ chunk: Data) throws(MuxViolation) -> [MuxFrame] {
        var frames: [MuxFrame] = []
        var start = chunk.startIndex
        while start < chunk.endIndex {
            if let feed = chunk[start...].firstIndex(of: 0x0a) {
                try append(chunk[start..<feed])
                frames.append(try finishLine())
                start = chunk.index(after: feed)
            } else {
                try append(chunk[start...])
                break
            }
        }
        return frames
    }

    private mutating func append(_ bytes: Data.SubSequence) throws(MuxViolation) {
        guard !bytes.isEmpty else { return }
        if let header {
            guard line.count - header.bodyStart + bytes.count <= header.bodyLimit,
                line.count + bytes.count + 1 <= MuxLimits.line
            else { throw .frameTooLarge }
            line.append(contentsOf: bytes)
            return
        }
        line.append(contentsOf: bytes)
        try readHeader()
    }

    /// Parses as much of the header as has arrived and fixes the body limit once the second
    /// tab is in.
    private mutating func readHeader() throws(MuxViolation) {
        let bytes = [UInt8](line.prefix(Self.maximumChannelDigits + Self.maximumTypeBytes + 2))
        guard let firstTab = bytes.firstIndex(of: 0x09) else {
            try checkChannelPrefix(bytes)
            return
        }
        let channel = try parseChannel(bytes[..<firstTab])
        let typeBytes = bytes[(firstTab + 1)...]
        guard let secondTab = typeBytes.firstIndex(of: 0x09) else {
            try checkTypePrefix(typeBytes)
            return
        }
        let type = try parseType(bytes[(firstTab + 1)..<secondTab])
        guard let rule = rule(direction: direction, channel: channel, type: type) else {
            throw .unexpectedFrame
        }
        guard rule != .forbidden else { throw .frameInvalid }
        let limit = MuxLimits.body(type: type)
        let bodyStart = secondTab + 1
        guard line.count - bodyStart <= limit, line.count + 1 <= MuxLimits.line else { throw .frameTooLarge }
        header = (channel, type, bodyStart, limit)
    }

    private mutating func finishLine() throws(MuxViolation) -> MuxFrame {
        defer {
            line = Data()
            header = nil
        }
        if let header {
            let body = line.subdata(in: header.bodyStart..<line.count)
            guard !body.isEmpty else { throw .frameInvalid }
            return MuxFrame(channel: header.channel, type: header.type, body: body)
        }
        // No second tab: a frame without a body, or a malformed line.
        let bytes = [UInt8](line)
        guard let firstTab = bytes.firstIndex(of: 0x09) else { throw .frameInvalid }
        let channel = try parseChannel(bytes[..<firstTab])
        let type = try parseType(bytes[(firstTab + 1)...])
        guard let rule = rule(direction: direction, channel: channel, type: type) else {
            throw .unexpectedFrame
        }
        guard rule != .required else { throw .frameInvalid }
        return MuxFrame(channel: channel, type: type, body: nil)
    }

    private func checkChannelPrefix(_ bytes: [UInt8]) throws(MuxViolation) {
        guard bytes.count <= Self.maximumChannelDigits, bytes.allSatisfy(isDigit),
            !(bytes.count > 1 && bytes.first == 0x30)
        else { throw .frameInvalid }
    }

    private func checkTypePrefix(_ bytes: ArraySlice<UInt8>) throws(MuxViolation) {
        guard bytes.count <= Self.maximumTypeBytes, bytes.allSatisfy(isTypeByte) else { throw .frameInvalid }
    }

    private func parseChannel(_ bytes: ArraySlice<UInt8>) throws(MuxViolation) -> UInt64 {
        guard !bytes.isEmpty, bytes.count <= Self.maximumChannelDigits, bytes.allSatisfy(isDigit),
            !(bytes.count > 1 && bytes.first == 0x30)
        else { throw .frameInvalid }
        let value = bytes.reduce(UInt64(0)) { $0 * 10 + UInt64($1 - 0x30) }
        guard value <= MuxFrame.maximumChannel else { throw .frameInvalid }
        return value
    }

    private func parseType(_ bytes: ArraySlice<UInt8>) throws(MuxViolation) -> String {
        guard !bytes.isEmpty, bytes.count <= Self.maximumTypeBytes, bytes.allSatisfy(isTypeByte) else {
            throw .frameInvalid
        }
        return String(decoding: bytes, as: UTF8.self)
    }
}

private func isDigit(_ byte: UInt8) -> Bool { (0x30...0x39).contains(byte) }
private func isTypeByte(_ byte: UInt8) -> Bool { (0x61...0x7a).contains(byte) || byte == 0x2d }
