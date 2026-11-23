import CoreFoundation
import Darwin
import Foundation
import SherpaAppConnection

/// A signed app refused admission because its MCP switch was off. The relay can answer
/// discovery and explain the refusal without opening a core channel (contract §6).
enum MCPDisabledSession {
    static func response(to line: Data, version: String, remedy: String) -> Data? {
        guard let request = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any],
            request["jsonrpc"] as? String == "2.0", let method = request["method"] as? String,
            let id = request["id"], isID(id)
        else { return nil }

        var reply: [String: Any] = ["jsonrpc": "2.0", "id": id]
        if method == "server/discover" {
            reply["result"] = [
                "resultType": "complete",
                "supportedVersions": ["2026-07-28"],
                "capabilities": ["tools": [String: Any]()],
                "ttlMs": 0,
                "cacheScope": "private",
                "_meta": ["io.modelcontextprotocol/serverInfo": ["name": "sherpa", "version": version]],
            ]
        } else {
            reply["error"] = [
                "code": -32000,
                "message": "Sherpa.app has MCP turned off: \(remedy)",
                "data": ["reason": AppPreface.Reason.mcpDisabled.rawValue, "remedy": remedy],
            ]
        }
        return try? JSONSerialization.data(withJSONObject: reply, options: [.withoutEscapingSlashes])
    }

    private static func isID(_ value: Any) -> Bool {
        if let number = value as? NSNumber { return CFGetTypeID(number) != CFBooleanGetTypeID() }
        return value is String || value is NSNull
    }

    static func serve(version: String, failure: RelayFailure, logger: SherpaLogger) -> Never {
        var pending = Data()
        var buffer = [UInt8](repeating: 0, count: Relay.copyBufferBytes)
        while true {
            let read = buffer.withUnsafeMutableBytes { FileDescriptorIO.read(STDIN_FILENO, into: $0) }
            switch read {
            case let .bytes(count):
                autoreleasepool {
                    var start = 0
                    while start < count {
                        let feed = buffer[start..<count].firstIndex(of: 0x0a)
                        let end = feed ?? count
                        guard pending.count + end - start <= MuxLimits.data else {
                            Relay.fail(
                                RelayFailure(
                                    .protocolError, scope: "relay:mcp-disabled:read", reason: "message_too_large",
                                    remedy: failure.remedy), logger: logger)
                        }
                        pending.append(contentsOf: buffer[start..<end])
                        guard feed != nil else { break }
                        writeResponse(to: pending, version: version, remedy: failure.remedy, logger: logger)
                        pending = Data()
                        start = end + 1
                    }
                }
            case .endOfFile:
                Relay.fail(failure, logger: logger)
            case let .failed(code):
                Relay.fail(
                    RelayFailure(
                        .ioError, scope: "relay:mcp-disabled:read", reason: "stdin_read_failed",
                        fields: "errno=\(code)", remedy: "restart the agent"), logger: logger)
            }
        }
    }

    private static func writeResponse(to line: Data, version: String, remedy: String, logger: SherpaLogger) {
        guard var bytes = response(to: line, version: version, remedy: remedy) else { return }
        bytes.append(0x0a)
        guard let code = bytes.withUnsafeBytes({ FileDescriptorIO.writeAll(STDOUT_FILENO, $0) }) else { return }
        if code == EPIPE { exit(RelayExit.success.rawValue) }
        Relay.fail(
            RelayFailure(
                .ioError, scope: "relay:mcp-disabled:write", reason: "stdout_write_failed",
                fields: "errno=\(code)", remedy: "restart the agent"), logger: logger)
    }
}
