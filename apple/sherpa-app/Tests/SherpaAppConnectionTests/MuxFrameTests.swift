import Foundation
import Testing

@testable import SherpaAppConnection

// Contract §14 vectors and §7.4 limits. The core's tests read the same vectors.

private func frames(_ text: String, _ direction: MuxDirection) throws(MuxViolation) -> [MuxFrame] {
    var reader = MuxFrameReader(direction: direction)
    return try reader.consume(Data(text.utf8))
}

private func violation(_ text: String, _ direction: MuxDirection) -> MuxViolation? {
    do {
        _ = try frames(text, direction)
        return nil
    } catch {
        return error
    }
}

private let fromCore = [
    "0\thello\t{\"mux\":3,\"version\":\"0.9.0\"}\n",
    "0\trequest\t{\"id\":1,\"worker\":\"planner\",\"request\":{\"kind\":\"request\",\"protocol_version\":\"2.0.0\",\"application_contract\":\"sherpa.planner.v2\",\"request_id\":\"op-1\",\"operation_id\":\"op-1\",\"capability\":\"capabilities\",\"payload\":{\"schema\":\"sherpa.planner.capabilities.request.v2\"},\"deadline_ms\":20000,\"idempotency_key\":\"op-1\",\"policy\":{\"effect\":\"read\",\"required_evidence\":\"none\",\"artifact_directory\":null}}}\n",
    "1\tdata\t{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[]}}\n",
    "0\tconfirm\t{\"id\":3,\"tool\":\"reminder_delete\",\"operation_id\":\"op-2\",\"channel\":1,\"client\":{\"name\":\"t\",\"version\":\"0\"},\"title\":\"t\",\"lines\":[],\"timeout_ms\":30000}\n",
    "0\twithdraw\t{\"id\":3}\n",
    "2\tclose\t{\"reason\":\"server_closed\"}\n",
    "1\tclose\t{\"reason\":\"unsupported_kind\"}\n",
    "0\tfatal\t{\"code\":\"mux.frame_invalid\"}\n",
]

private let fromApp = [
    "0\thello\t{\"mux\":3,\"version\":\"0.9.0\",\"workers\":[\"planner\"]}\n",
    "0\tresponse\t{\"id\":1,\"response\":{\"application_contract\":\"sherpa.planner.v2\",\"capability\":\"capabilities\",\"effect\":{\"kind\":\"none\",\"state\":\"not_started\"},\"error\":{\"code\":\"protocol.unsupported_capability\",\"retry\":\"never\"},\"kind\":\"response\",\"operation_id\":\"op-1\",\"protocol_version\":\"2.0.0\",\"request_id\":\"op-1\",\"status\":\"failed\",\"warnings\":[]}}\n",
    "0\tresponse\t{\"id\":2,\"report\":{\"error\":\"sherpa.internal_failure\",\"status\":\"failed\"}}\n",
    "1\topen\t{\"kind\":\"mcp\"}\n",
    "1\tdata\t{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}\n",
    "0\tconfirmation\t{\"id\":3,\"decision\":\"declined\"}\n",
    "1\tclose\n",
]

@Test(arguments: fromCore)
func readsEveryValidCoreFrame(line: String) throws {
    let parsed = try frames(line, .coreToApp)
    #expect(parsed.count == 1)
    #expect(parsed[0].encoded == Data(line.utf8))
}

@Test(arguments: fromApp)
func readsEveryValidAppFrame(line: String) throws {
    let parsed = try frames(line, .appToCore)
    #expect(parsed.count == 1)
    #expect(parsed[0].encoded == Data(line.utf8))
}

@Test func encodesTheAppFramesOfTheVectors() {
    #expect(MuxFrame.open(channel: 1, kind: .mcp).encoded == Data("1\topen\t{\"kind\":\"mcp\"}\n".utf8))
    #expect(MuxFrame(channel: 1, type: "close").encoded == Data("1\tclose\n".utf8))
    #expect(
        MuxFrame(channel: 0, type: "confirmation", json: #"{"id":3,"decision":"declined"}"#).encoded
            == Data("0\tconfirmation\t{\"id\":3,\"decision\":\"declined\"}\n".utf8))
}

@Test(arguments: [
    ("01\tdata\t{}\n", MuxViolation.frameInvalid),
    ("1\tDATA\t{}\n", .frameInvalid),
    ("1 data {}\n", .frameInvalid),
    ("1\tdata\n", .frameInvalid),
    ("1\tdata\t\n", .frameInvalid),
    ("0\topen\t{\"kind\":\"mcp\"}\n", .unexpectedFrame),
    ("1\thello\t{\"mux\":3}\n", .unexpectedFrame),
    ("9007199254740992\topen\t{\"kind\":\"mcp\"}\n", .frameInvalid),
    ("0\tdata\t{}\n", .unexpectedFrame),
    // Mux 1's open: Mux 2 requires the kind (contract §7.3). The kind itself is the reader's owner's.
    ("1\topen\n", .frameInvalid),
])
func rejectsTheViolationVectorsInBothDirections(line: String, expected: MuxViolation) {
    #expect(violation(line, .coreToApp) != nil)
    #expect(violation(line, .appToCore) == expected)
}

@Test func coreOutputMayNotCarryAppOnlyFrames() {
    #expect(violation("1\topen\n", .coreToApp) == .unexpectedFrame)
    #expect(violation("0\tresponse\t{}\n", .coreToApp) == .unexpectedFrame)
    #expect(violation("0\tconfirmation\t{}\n", .coreToApp) == .unexpectedFrame)
    #expect(violation("0\trequest\t{}\n", .appToCore) == .unexpectedFrame)
}

@Test func acceptsTheHighestChannel() throws {
    let parsed = try frames("9007199254740991\tclose\n", .coreToApp)
    #expect(parsed.first?.channel == MuxFrame.maximumChannel)
}

@Test func leavesNonViolationsToTheirOwner() throws {
    // Unknown channel, non-JSON data and a late response are frames; routing decides.
    #expect(try frames("5\tdata\t{\"jsonrpc\":\"2.0\",\"method\":\"x\"}\n", .coreToApp).count == 1)
    #expect(try frames("1\tdata\tnot json\n", .appToCore).first?.body == Data("not json".utf8))
    #expect(
        try frames("0\tresponse\t{\"id\":99,\"report\":{\"error\":\"x\",\"status\":\"failed\"}}\n", .appToCore).count
            == 1)
}

@Test(arguments: [
    ("data", MuxLimits.data, MuxDirection.coreToApp, UInt64(1)),
    ("request", MuxLimits.request, .coreToApp, 0),
    ("confirm", MuxLimits.confirm, .coreToApp, 0),
    ("hello", MuxLimits.other, .coreToApp, 0),
    ("withdraw", MuxLimits.other, .coreToApp, 0),
    ("fatal", MuxLimits.other, .coreToApp, 0),
    ("close", MuxLimits.other, .coreToApp, 1),
    ("open", MuxLimits.other, .appToCore, 1),
    ("response", MuxLimits.response, .appToCore, 0),
    ("confirmation", MuxLimits.other, .appToCore, 0),
])
func enforcesEachTypeLimitAtTheBoundary(type: String, limit: Int, direction: MuxDirection, channel: UInt64) throws {
    let header = Data("\(channel)\t\(type)\t".utf8)
    var atLimit = header + Data(repeating: 0x61, count: limit)
    atLimit.append(0x0a)
    var reader = MuxFrameReader(direction: direction)
    #expect(try reader.consume(atLimit).first?.body?.count == limit)

    var over = header + Data(repeating: 0x61, count: limit + 1)
    over.append(0x0a)
    var overReader = MuxFrameReader(direction: direction)
    #expect(throws: MuxViolation.frameTooLarge) { _ = try overReader.consume(over) }
}

@Test func stopsGrowingTheMomentALineIsTooLarge() throws {
    var reader = MuxFrameReader(direction: .coreToApp)
    _ = try reader.consume(Data("1\tdata\t".utf8))
    let chunk = Data(repeating: 0x61, count: 64 * 1_024)
    var fed = 0
    do {
        while true {
            _ = try reader.consume(chunk)
            fed += chunk.count
            #expect(reader.pendingBytes <= 7 + MuxLimits.data)
        }
    } catch {
        #expect(error == .frameTooLarge)
    }
    #expect(fed <= MuxLimits.data)
}

@Test func rejectsAnEndlessLineWithoutHeader() {
    var reader = MuxFrameReader(direction: .coreToApp)
    #expect(throws: MuxViolation.frameInvalid) {
        _ = try reader.consume(Data(repeating: 0x31, count: 17))
    }
    var noTerminator = MuxFrameReader(direction: .appToCore)
    #expect(throws: MuxViolation.frameTooLarge) {
        _ = try noTerminator.consume(Data("0\tresponse\t".utf8) + Data(repeating: 0x61, count: MuxLimits.line + 1))
    }
}

@Test func splitsFramesAcrossChunkBoundaries() throws {
    let stream = Data(fromApp.joined().utf8)
    var reader = MuxFrameReader(direction: .appToCore)
    var parsed: [MuxFrame] = []
    for start in stride(from: 0, to: stream.count, by: 7) {
        parsed += try reader.consume(stream.subdata(in: start..<min(start + 7, stream.count)))
    }
    #expect(parsed.map(\.encoded).reduce(Data(), +) == stream)
    #expect(reader.pendingBytes == 0)
}

@Test func encodedPartsMatchesEncodedForEveryVector() throws {
    for line in fromCore {
        let frame = try #require(try frames(line, .coreToApp).first)
        #expect(frame.encodedParts.reduce(Data(), +) == frame.encoded)
    }
    for line in fromApp {
        let frame = try #require(try frames(line, .appToCore).first)
        #expect(frame.encodedParts.reduce(Data(), +) == frame.encoded)
    }
}

@Test func lineBufferSwitchesToMappedStorageAboveThresholdAndIsolatesCopies() {
    var buffer = LineBuffer()
    let half = Data(repeating: 0x41, count: LineBuffer.mmapThreshold / 2)
    half.withUnsafeBytes { buffer.append($0) }
    #expect(!buffer.isMapped)
    #expect(buffer.count == half.count)

    let rest = Data(repeating: 0x42, count: LineBuffer.mmapThreshold)
    rest.withUnsafeBytes { buffer.append($0) }
    #expect(buffer.isMapped)
    #expect(buffer.count == half.count + rest.count)
    #expect(buffer.prefixBytes(4) == [0x41, 0x41, 0x41, 0x41])

    // Value copy shares the mapping until mutated or taken; taking from one leaves the copy intact.
    var copy = buffer
    let takenFromOriginal = buffer.takeData(from: 4)
    #expect(buffer.isEmpty && !buffer.isMapped)
    #expect(takenFromOriginal.startIndex == 0)
    #expect(takenFromOriginal.count == half.count + rest.count - 4)
    #expect(takenFromOriginal.first == 0x41 && takenFromOriginal.last == 0x42)

    let suffix = Data([0x43, 0x44])
    suffix.withUnsafeBytes { copy.append($0) }
    let takenFromCopy = copy.takeData(from: half.count)
    #expect(takenFromCopy.startIndex == 0)
    #expect(takenFromCopy.count == rest.count + 2)
    #expect(takenFromCopy.first == 0x42 && takenFromCopy.last == 0x44)
}

@Test func readsMultiMegabyteFramesThroughMappedLineBufferWithZeroIndexedBody() throws {
    let payloadCount = 4 * 1_024 * 1_024
    var payload = Data(repeating: 0x61, count: payloadCount)
    payload[0] = 0x7b
    payload[payloadCount - 1] = 0x7d
    let frame = MuxFrame(channel: 1, type: "data", body: payload)
    let wire = frame.encoded

    var reader = MuxFrameReader(direction: .coreToApp)
    var parsed: [MuxFrame] = []
    let chunkSize = 64 * 1_024
    for start in stride(from: 0, to: wire.count, by: chunkSize) {
        let end = min(start + chunkSize, wire.count)
        let slice = wire.subdata(in: start..<end)
        parsed += try slice.withUnsafeBytes { raw throws(MuxViolation) in
            try reader.consume(raw)
        }
    }
    let received = try #require(parsed.first)
    let body = try #require(received.body)
    #expect(received.channel == 1 && received.type == "data")
    #expect(body.startIndex == 0 && body.count == payloadCount)
    #expect(body.first == 0x7b && body.last == 0x7d)
    #expect(body == payload)
    #expect(reader.pendingBytes == 0)
}
