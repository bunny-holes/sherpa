import Darwin
import Foundation
import SherpaAppConnection
import SherpaWorkerProtocol

// A stand-in for `sherpa-core app serve` that speaks the frames of contract §7 and §14,
// driven by MCP-shaped test messages from the relay. It receives only the environment the
// app passes (§7.1), so it reads its script from $TMPDIR/fake-core.json and appends what
// it saw to $TMPDIR/fake-core.log for the test to read. Test program; never shipped.

let environment = ProcessInfo.processInfo.environment
let directory = environment["TMPDIR"] ?? "/nonexistent"
let logURL = URL(fileURLWithPath: directory).appendingPathComponent("fake-core.log")
let outputLock = NSLock()
let state = DispatchQueue(label: "fake-core.state")

func record(_ line: String) {
    outputLock.lock()
    defer { outputLock.unlock() }
    let data = Data((line + "\n").utf8)
    if let handle = FileHandle(forWritingAtPath: logURL.path) {
        handle.seekToEndOfFile()
        handle.write(data)
        handle.closeFile()
    } else {
        FileManager.default.createFile(atPath: logURL.path, contents: data)
    }
}

func emit(_ text: String) {
    outputLock.lock()
    defer { outputLock.unlock() }
    _ = Array((text + "\n").utf8).withUnsafeBytes { FileDescriptorIO.writeAll(STDOUT_FILENO, $0) }
}

func emit(channel: UInt64, type: String, json: String? = nil) {
    emit(json.map { "\(channel)\t\(type)\t\($0)" } ?? "\(channel)\t\(type)")
}

func encode(_ value: JSONValue) -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return String(decoding: (try? encoder.encode(value)) ?? Data("null".utf8), as: UTF8.self)
}

let script: JSONObject =
    (try? JSONDecoder().decode(
        JSONObject.self,
        from: Data(contentsOf: URL(fileURLWithPath: directory).appendingPathComponent("fake-core.json"))
    )) ?? [:]
let version = script["version"]?.string ?? "0.0.0"
let mode = script["mode"]?.string ?? "normal"

/// The signals this process inherited as ignored, and its blocked mask (contract §7.1).
func inheritedSignals() -> String {
    let watched: [(Int32, String)] = [(SIGHUP, "HUP"), (SIGINT, "INT"), (SIGPIPE, "PIPE"), (SIGTERM, "TERM")]
    let ignored = watched.filter { number, _ in
        var action = sigaction()
        sigaction(number, nil, &action)
        return unsafeBitCast(action.__sigaction_u.__sa_handler, to: Int.self) == 1  // SIG_IGN
    }.map(\.1)
    var mask = sigset_t()
    sigprocmask(SIG_BLOCK, nil, &mask)
    return
        "ignored=\(ignored.isEmpty ? "none" : ignored.joined(separator: ",")) blocked=\(mask == 0 ? "none" : String(mask))"
}

record(
    "spawn pid=\(getpid()) args=\(CommandLine.arguments.dropFirst().joined(separator: ",")) "
        + "env=\(environment.keys.sorted().joined(separator: ",")) path=\(environment["PATH"] ?? "") \(inheritedSignals())"
)

if mode == "exit-at-start" {
    exit(Int32(script["code"]?.integer ?? 3))
}

// Touched only on the `state` queue.
nonisolated(unsafe) var helloAnswered = false
nonisolated(unsafe) var openChannels: Set<UInt64> = []
nonisolated(unsafe) var nextRequest: UInt64 = 1
nonisolated(unsafe) var waitingResponses: [UInt64: (channel: UInt64, id: JSONValue)] = [:]
nonisolated(unsafe) var waitingConfirmations: [UInt64: (channel: UInt64, id: JSONValue)] = [:]

func result(_ channel: UInt64, _ id: JSONValue, _ value: JSONValue) {
    emit(channel: channel, type: "data", json: encode(["jsonrpc": "2.0", "id": id, "result": value]))
}

func handleMessage(_ channel: UInt64, _ body: Data) {
    guard let message = try? JSONDecoder().decode(JSONObject.self, from: body) else {
        record("data \(channel) not-json")
        emit(
            channel: channel, type: "data",
            json: #"{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}"#)
        return
    }
    let id = message["id"] ?? .null
    let params = message["params"]?.object ?? [:]
    let method = message["method"]?.string ?? ""
    record("data \(channel) method=\(method) bytes=\(body.count)")
    switch method {
    case "echo":
        result(channel, id, ["channel": .integer(Int64(channel)), "pid": .integer(Int64(getpid()))])
    case "worker":
        let requestID = nextRequest
        nextRequest += 1
        waitingResponses[requestID] = (channel, id)
        let worker = params["worker"] ?? "planner"
        let request = params["request"] ?? [:]
        emit(
            channel: 0, type: "request",
            json: #"{"id":\#(requestID),"worker":\#(encode(worker)),"request":\#(encode(request))}"#)
    case "confirm":
        let requestID = nextRequest
        nextRequest += 1
        waitingConfirmations[requestID] = (channel, id)
        let lines = params["lines"] ?? [["label": "Reminder", "value": "test"]]
        let title = params["title"] ?? "Delete a reminder"
        // The channel of the call (contract §9); `channel` names another or no number at all, as a core
        // that got it wrong.
        let asking = params["channel"] ?? .integer(Int64(channel))
        let frame =
            #"{"id":\#(requestID),"tool":"reminder_delete","operation_id":"op-test","channel":\#(encode(asking)),"client":{"name":"fake","version":"0"},"title":\#(encode(title)),"lines":\#(encode(lines)),"timeout_ms":30000}"#
        // `delay_ms`: the request goes out later, as one whose preview read was slow.
        if let delay = params["delay_ms"]?.integer {
            state.asyncAfter(deadline: .now() + .milliseconds(delay)) {
                record("confirm \(requestID) sent")
                emit(channel: 0, type: "confirm", json: frame)
            }
        } else {
            emit(channel: 0, type: "confirm", json: frame)
        }
        if let after = params["withdraw_after_ms"]?.integer {
            state.asyncAfter(deadline: .now() + .milliseconds(after)) {
                guard let waiting = waitingConfirmations.removeValue(forKey: requestID) else { return }
                emit(channel: 0, type: "withdraw", json: #"{"id":\#(requestID)}"#)
                record("withdraw \(requestID)")
                result(waiting.channel, waiting.id, ["decision": "withdrawn"])
            }
        }
    case "flood":
        let frames = params["frames"]?.integer ?? 1
        let bytes = params["bytes"]?.integer ?? 1_024
        let filler = String(repeating: "x", count: bytes)
        for index in 0..<frames {
            emit(
                channel: channel, type: "data",
                json: #"{"jsonrpc":"2.0","method":"flood","params":{"index":\#(index),"fill":"\#(filler)"}}"#)
        }
        record("flood \(channel) done")
    case "close":
        openChannels.remove(channel)
        emit(channel: channel, type: "close", json: #"{"reason":"server_closed"}"#)
    case "exit":
        record("exit \(params["code"]?.integer ?? 1)")
        exit(Int32(params["code"]?.integer ?? 1))
    case "violate":
        emit("1\tDATA\t{}")
    case "fatal":
        emit(channel: 0, type: "fatal", json: #"{"code":"mux.frame_invalid"}"#)
        exit(65)
    default:
        emit(
            channel: channel, type: "data",
            json: encode(["jsonrpc": "2.0", "id": id, "error": ["code": -32601, "message": "Method not found"]]))
    }
}

func violation(_ code: String) -> Never {
    record("violation \(code)")
    emit(channel: 0, type: "fatal", json: #"{"code":"\#(code)"}"#)
    exit(65)
}

func handle(_ frame: MuxFrame) {
    guard helloAnswered || (frame.channel == 0 && frame.type == "hello") else { violation("mux.unexpected_frame") }
    let body = frame.body.flatMap { try? JSONDecoder().decode(JSONObject.self, from: $0) }
    switch (frame.channel, frame.type) {
    case (0, "hello"):
        guard !helloAnswered else { violation("mux.unexpected_frame") }
        guard body?["mux"] == .integer(MuxFrame.muxVersion) else { violation("mux.version_unsupported") }
        helloAnswered = true
        let workers = body?["workers"]?.array?.compactMap(\.string).joined(separator: ",") ?? ""
        record("app-hello mux=\(MuxFrame.muxVersion) version=\(body?["version"]?.string ?? "") workers=\(workers)")
    case (0, "response"):
        guard let body, case let .integer(id)? = body["id"] else { violation("mux.frame_invalid") }
        let kind = body["response"] != nil ? "response" : "report"
        record("response \(id) \(kind)")
        if let waiting = waitingResponses.removeValue(forKey: UInt64(id)) {
            result(waiting.channel, waiting.id, [kind: body[kind] ?? .null])
        }
    case (0, "confirmation"):
        guard let body, case let .integer(id)? = body["id"], let decision = body["decision"]?.string else {
            violation("mux.frame_invalid")
        }
        if let waiting = waitingConfirmations.removeValue(forKey: UInt64(id)) {
            record("confirmation \(id) \(decision)")
            result(waiting.channel, waiting.id, ["decision": .string(decision)])
        } else {
            record("confirmation-late \(id) \(decision)")
        }
    case (let channel, "open"):
        // {"kind":"<word>"} since Mux 2 (contract §7.3). The core serves `mcp` and closes any other kind.
        guard let body, Set(body.keys) == ["kind"], case let .string(kind)? = body["kind"], isKindWord(kind) else {
            violation("mux.frame_invalid")
        }
        guard !openChannels.contains(channel) else { violation("mux.unexpected_frame") }
        guard kind == MuxChannelKind.mcp.rawValue else {
            record("open \(channel) kind=\(kind) refused")
            emit(channel: channel, type: "close", json: #"{"reason":"unsupported_kind"}"#)
            return
        }
        openChannels.insert(channel)
        record("open \(channel) kind=\(kind)")
    case (let channel, "data"):
        guard openChannels.contains(channel), let data = frame.body else {
            record("data \(channel) dropped")
            return
        }
        handleMessage(channel, data)
    case (let channel, "close"):
        openChannels.remove(channel)
        record("close \(channel) reason=\(body?["reason"]?.string ?? "none")")
    default:
        violation("mux.unexpected_frame")
    }
}

/// A channel kind: a word of the frame type grammar (contract §7.2, §7.3).
func isKindWord(_ kind: String) -> Bool {
    (1...16).contains(kind.utf8.count) && kind.utf8.allSatisfy { (0x61...0x7a).contains($0) || $0 == 0x2d }
}

/// `bad-version`: another version. `mux` in the script: this version under that mux, as a core built
/// before the app's mux.
func sendHello() {
    let announced = mode == "bad-version" ? "9.9.9" : version
    let mux = script["mux"]?.integer.map(Int64.init) ?? MuxFrame.muxVersion
    emit(channel: 0, type: "hello", json: #"{"mux":\#(mux),"version":"\#(announced)"}"#)
}

switch mode {
case "no-hello":
    break
case "hello-delay":
    let delay = script["delay_ms"]?.integer ?? 1_000
    state.asyncAfter(deadline: .now() + .milliseconds(delay)) { sendHello() }
default:
    state.sync { sendHello() }
}

Thread.detachNewThread {
    var reader = MuxFrameReader(direction: .appToCore)
    var buffer = [UInt8](repeating: 0, count: 64 * 1_024)
    while true {
        let result = buffer.withUnsafeMutableBytes { FileDescriptorIO.read(STDIN_FILENO, into: $0) }
        guard case let .bytes(count) = result else { break }
        do throws(MuxViolation) {
            let frames = try reader.consume(Data(buffer[0..<count]))
            state.sync { frames.forEach(handle) }
        } catch {
            state.sync { violation(error.code) }
        }
    }
    state.sync {
        record("stdin-eof")
        exit(0)
    }
}
dispatchMain()
