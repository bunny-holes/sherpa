import Darwin
import Foundation
import SherpaAppConnection
import Testing

// Helpers for the process tests of contract §13.2: the DEBUG programs `swift build` wrote,
// copies of them signed ad hoc with the production identifiers, short temporary folders,
// and child processes whose output a test can wait for.

struct ProcessTestError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

/// The programs a process test starts.
enum Program: String, CaseIterable, Sendable {
    case host = "sherpa-app-testhost"
    case relay = "sherpa-relay"
    case core = "sherpa-fake-core"
    case fakeApp = "sherpa-fake-app"

    /// The identifier the signed copy carries: the one the production requirement names.
    var identifier: String {
        switch self {
        case .host, .fakeApp: "dev.xiyo.sherpa"
        case .relay: "dev.xiyo.sherpa.relay"
        case .core: "dev.xiyo.sherpa.core"
        }
    }

    /// The test requirement of §13.2: the identifier alone, no certificate.
    var testRequirement: String { "identifier \"\(identifier)\"" }

    /// The program as the linker signed it: its identifier is the file name and a hash.
    var linkerSignedPath: String { Products.directory + "/" + rawValue }

    /// A copy signed ad hoc with `identifier`.
    var path: String {
        get throws { try SignedPrograms.directory.get() + "/" + rawValue }
    }
}

enum Products {
    /// The folder of this test bundle, where `swift build` also writes the executables.
    static let directory: String = {
        var info = Dl_info()
        guard dladdr(#dsohandle, &info) != 0, let name = info.dli_fname else { return "/nonexistent" }
        var url = URL(fileURLWithPath: String(cString: name))
        while url.pathExtension != "xctest", url.pathComponents.count > 1 {
            url.deleteLastPathComponent()
        }
        return url.deletingLastPathComponent().path
    }()
}

/// The folder of this test process's signed copies, removed when it exits.
nonisolated(unsafe) private var signedProgramsFolder: String?

enum SignedPrograms {
    /// A new folder for each test process: runs that overlap never replace or remove each
    /// other's programs.
    static let directory: Result<String, ProcessTestError> = {
        // SIGPIPE would end the test process when a child closes a pipe first.
        signal(SIGPIPE, SIG_IGN)
        let files = FileManager.default
        do {
            let directory = try makeTemporaryDirectory(prefix: "sap")
            signedProgramsFolder = directory
            atexit {
                if let folder = signedProgramsFolder { try? FileManager.default.removeItem(atPath: folder) }
            }
            for program in Program.allCases {
                guard files.isExecutableFile(atPath: program.linkerSignedPath) else {
                    return .failure(ProcessTestError("missing \(program.rawValue); run swift build first"))
                }
                let copy = directory + "/" + program.rawValue
                try files.copyItem(atPath: program.linkerSignedPath, toPath: copy)
                let status = runTool(
                    "/usr/bin/codesign", ["--force", "--sign", "-", "--identifier", program.identifier, copy])
                guard status == 0 else {
                    return .failure(ProcessTestError("codesign \(program.rawValue) exited \(status)"))
                }
            }
            return .success(directory)
        } catch {
            return .failure(ProcessTestError("preparing signed programs failed: \(error)"))
        }
    }()
}

/// Runs a tool to its end with its output discarded. posix_spawn and waitpid, because
/// Process.waitUntilExit spins the calling thread's run loop, and on a Swift concurrency
/// thread it was seen to wait forever for a child that had already ended.
@discardableResult
func runTool(_ path: String, _ arguments: [String]) -> Int32 {
    let argv = ([path] + arguments).map { strdup($0) } + [nil]
    defer { argv.forEach { free($0) } }
    var actions: posix_spawn_file_actions_t?
    posix_spawn_file_actions_init(&actions)
    defer { posix_spawn_file_actions_destroy(&actions) }
    posix_spawn_file_actions_addopen(&actions, STDOUT_FILENO, "/dev/null", O_WRONLY, 0)
    posix_spawn_file_actions_addopen(&actions, STDERR_FILENO, "/dev/null", O_WRONLY, 0)
    var pid: pid_t = 0
    guard posix_spawn(&pid, path, &actions, nil, argv, environ) == 0 else { return -1 }
    var status: Int32 = 0
    while waitpid(pid, &status, 0) == -1, errno == EINTR {}
    let signal = status & 0x7f
    return signal == 0 ? (status >> 8) & 0xff : 128 + signal
}

/// A folder under the user's temporary directory, short enough for a socket path.
func makeTemporaryDirectory(prefix: String) throws -> String {
    var template = Array((NSTemporaryDirectory() + prefix + ".XXXXXX").utf8CString)
    guard mkdtemp(&template) != nil else { throw ProcessTestError("mkdtemp failed errno=\(errno)") }
    return String(decoding: template.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self)
}

/// Calls `probe` until it returns a value or `timeout` passes.
func poll<T>(_ timeout: Duration, _ probe: () -> T?) async -> T? {
    let clock = ContinuousClock()
    let deadline = clock.now + timeout
    while true {
        if let value = probe() { return value }
        if clock.now >= deadline { return nil }
        do {
            try await Task.sleep(for: .milliseconds(20))
        } catch {
            return probe()
        }
    }
}

/// A child process with piped standard streams.
final class Child: @unchecked Sendable {
    enum Output {
        /// Collected as it arrives.
        case read
        /// Left in the pipe until `readOutput()`, so the child blocks once the pipe is full.
        case held
        /// The read end closed: the child's next write fails with EPIPE.
        case closed
    }

    private let process = Process()
    private let input = Pipe()
    private let output = Pipe()
    private let errors = Pipe()
    private let lock = NSLock()
    private var outputData = Data()
    private var errorData = Data()
    private var readingOutput = false
    private var outputEnded = false
    private var errorEnded = false

    init(_ path: String, arguments: [String], environment: [String: String], output mode: Output) throws {
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = arguments
        process.environment = environment
        process.standardInput = input
        process.standardOutput = output
        process.standardError = errors
        errors.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else {
                handle.readabilityHandler = nil
                self?.lock.withLock { self?.errorEnded = true }
                return
            }
            self?.lock.withLock { self?.errorData.append(data) }
        }
        try process.run()
        switch mode {
        case .read: readOutput()
        case .held: break
        case .closed: try output.fileHandleForReading.close()
        }
    }

    var pid: pid_t { process.processIdentifier }

    func readOutput() {
        lock.withLock { readingOutput = true }
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else {
                handle.readabilityHandler = nil
                self?.lock.withLock { self?.outputEnded = true }
                return
            }
            self?.lock.withLock { self?.outputData.append(data) }
        }
    }

    func send(_ line: String) throws {
        try write(Data((line + "\n").utf8))
    }

    func write(_ data: Data) throws {
        try input.fileHandleForWriting.write(contentsOf: data)
    }

    func closeInput() throws {
        try input.fileHandleForWriting.close()
    }

    /// The next line on standard output, or nil when none arrives in time.
    func line(within timeout: Duration = .seconds(10)) async -> String? {
        await poll(timeout) {
            lock.withLock { () -> String? in
                guard let end = outputData.firstIndex(of: 0x0a) else { return nil }
                let line = String(decoding: outputData[outputData.startIndex..<end], as: UTF8.self)
                outputData.removeSubrange(outputData.startIndex...end)
                return line
            }
        }
    }

    var errorText: String { lock.withLock { String(decoding: errorData, as: UTF8.self) } }

    /// The stderr lines that contain `text`.
    func errorLines(containing text: String) -> [String] {
        errorText.split(separator: "\n").map(String.init).filter { $0.contains(text) }
    }

    func waitForError(_ text: String, within timeout: Duration = .seconds(10)) async -> Bool {
        await poll(timeout) { errorText.contains(text) ? true : nil } ?? false
    }

    /// The exit status, 128 + the signal for a signal, or nil while it still runs. It waits
    /// for the end of the pipes being read too: the exit and the last output line reach this
    /// process through different sources, in either order.
    func exitStatus(within timeout: Duration = .seconds(10)) async -> Int32? {
        await poll(timeout) { () -> Int32? in
            guard !process.isRunning else { return nil }
            guard lock.withLock({ errorEnded && (!readingOutput || outputEnded) }) else { return nil }
            return process.terminationReason == .exit ? process.terminationStatus : 128 + process.terminationStatus
        }
    }

    func signal(_ number: Int32) {
        kill(process.processIdentifier, number)
    }

    /// Kills the child and waits up to 5 s for its end. Not Process.waitUntilExit: it spins
    /// the calling thread's run loop, and from a test's thread it was seen to wait forever for
    /// a child that SIGKILL had already ended.
    func stop() {
        guard process.isRunning else { return }
        kill(process.processIdentifier, SIGKILL)
        let deadline = Date(timeIntervalSinceNow: 5)
        while process.isRunning, Date() < deadline {
            usleep(10_000)
        }
    }
}

/// One test's folder, socket, scripted fake core and the processes it started.
final class Rig: @unchecked Sendable {
    static let appVersion = "0.9.0"

    let root: String
    private let lock = NSLock()
    private var children: [Child] = []

    var socket: String { root + "/run/app.sock" }
    var runDirectory: String { root + "/run" }
    /// The `TMPDIR` of the host and so of the core, where the fake core reads its script.
    var coreDirectory: String { root + "/core" }

    init(core script: String = #"{"version":"0.9.0"}"#) throws {
        root = try makeTemporaryDirectory(prefix: "sat")
        let files = FileManager.default
        try files.createDirectory(atPath: coreDirectory, withIntermediateDirectories: false)
        try files.createDirectory(atPath: root + "/home", withIntermediateDirectories: false)
        try Data(script.utf8).write(to: URL(fileURLWithPath: coreDirectory + "/fake-core.json"))
    }

    deinit { tearDown() }

    func tearDown() {
        let started = lock.withLock { () -> [Child] in
            defer { children = [] }
            return children
        }
        for child in started { child.stop() }
        // A leftover temporary folder is harmless; the next run uses a new one.
        try? FileManager.default.removeItem(atPath: root)
    }

    private var environment: [String: String] {
        ["PATH": "/usr/bin:/bin", "HOME": root + "/home", "LOG_LEVEL": "debug", "SHERPA_APP_SOCKET": socket]
    }

    func launch(_ path: String, _ arguments: [String], _ environment: [String: String], output: Child.Output = .read)
        throws -> Child
    {
        let child = try Child(path, arguments: arguments, environment: environment, output: output)
        lock.withLock { children.append(child) }
        return child
    }

    /// The DEBUG test host: Sherpa.app's server with a scripted confirmation decider. `mcp` is
    /// the MCP switch it starts with; nil leaves it to the host, which starts off as the app's
    /// first launch does. A line `mcp on` or `mcp off` on its input turns it later.
    func startHost(
        _ arguments: [String] = [],
        mcp: Bool? = true,
        core: String? = nil,
        relayRequirement: String? = Program.relay.testRequirement,
        coreRequirement: String? = Program.core.testRequirement,
        listening: Bool = true
    ) async throws -> Child {
        var environment = environment
        environment["TMPDIR"] = coreDirectory + "/"
        environment["SHERPA_TEST_CORE_BIN"] = try core ?? Program.core.path
        if let relayRequirement { environment["SHERPA_RELAY_REQUIREMENT"] = relayRequirement }
        if let coreRequirement { environment["SHERPA_CORE_REQUIREMENT"] = coreRequirement }
        let switchArguments = mcp.map { ["--mcp", $0 ? "on" : "off"] } ?? []
        let host = try launch(
            try Program.host.path, ["--version", Self.appVersion] + switchArguments + arguments, environment)
        if listening, !(await host.waitForError("[app:socket:listen] status=listening")) {
            throw ProcessTestError("the host did not listen: \(host.errorText)")
        }
        return host
    }

    func startRelay(
        _ arguments: [String] = [],
        executable: String? = nil,
        appRequirement: String? = Program.host.testRequirement,
        environment extra: [String: String] = [:],
        output: Child.Output = .read
    ) throws -> Child {
        var environment = environment
        if let appRequirement { environment["SHERPA_APP_REQUIREMENT"] = appRequirement }
        environment.merge(extra) { $1 }
        return try launch(try executable ?? Program.relay.path, arguments, environment, output: output)
    }

    /// A fake Sherpa.app on the socket that writes `preface` (nil: nothing) and then echoes,
    /// closes or stays silent.
    func startFakeApp(preface: String?, behaviour: String) async throws -> Child {
        try makeRunDirectory()
        var prefaceArgument = "-"
        if let preface {
            prefaceArgument = root + "/preface"
            try Data((preface + "\n").utf8).write(to: URL(fileURLWithPath: prefaceArgument))
        }
        let app = try launch(try Program.fakeApp.path, [socket, prefaceArgument, behaviour], environment)
        guard await app.waitForError("fake-app: listening") else {
            throw ProcessTestError("the fake app did not listen: \(app.errorText)")
        }
        return app
    }

    func makeRunDirectory() throws {
        try FileManager.default.createDirectory(
            atPath: runDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]
        )
    }

    /// A socket file nobody listens on, as a crashed app leaves it.
    func leaveStaleSocket() throws {
        try makeRunDirectory()
        guard var address = unixSocketAddress(socket) else { throw ProcessTestError("socket path too long") }
        let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        defer { close(descriptor) }
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bound == 0 else { throw ProcessTestError("bind failed errno=\(errno)") }
    }

    /// Connects from this test process, which is not the relay, and reads the first line.
    func directPreface() throws -> String {
        guard var address = unixSocketAddress(socket) else { throw ProcessTestError("socket path too long") }
        let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        defer { close(descriptor) }
        var timeout = timeval(tv_sec: 10, tv_usec: 0)
        setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        let connected = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard connected == 0 else { throw ProcessTestError("connect failed errno=\(errno)") }
        var line = Data()
        var byte: UInt8 = 0
        while read(descriptor, &byte, 1) == 1, byte != 0x0a {
            line.append(byte)
        }
        return String(decoding: line, as: UTF8.self)
    }

    /// What the fake core recorded, one event per line.
    var coreLog: [String] {
        guard let text = try? String(contentsOfFile: coreDirectory + "/fake-core.log", encoding: .utf8) else {
            return []
        }
        return text.split(separator: "\n").map(String.init)
    }

    var coreSpawns: Int { coreLog.filter { $0.hasPrefix("spawn ") }.count }

    func waitForCoreLog(within timeout: Duration = .seconds(10), _ predicate: ([String]) -> Bool) async -> Bool {
        await poll(timeout) { predicate(coreLog) ? true : nil } ?? false
    }
}

enum MCP {
    static func call(_ id: Int, _ method: String, _ params: String = "{}") -> String {
        #"{"jsonrpc":"2.0","id":\#(id),"method":"\#(method)","params":\#(params)}"#
    }

    static func object(_ line: String?) -> [String: Any]? {
        guard let line, let value = try? JSONSerialization.jsonObject(with: Data(line.utf8)) else { return nil }
        return value as? [String: Any]
    }

    static func result(_ line: String?) -> [String: Any]? {
        object(line)?["result"] as? [String: Any]
    }
}

extension Child {
    /// Sends the fake core's `echo` and returns the channel and core process it answered on.
    func echo(_ id: Int = 1) async throws -> (channel: Int, pid: Int)? {
        try send(MCP.call(id, "echo"))
        guard let result = MCP.result(await line()),
            let channel = result["channel"] as? Int, let pid = result["pid"] as? Int
        else { return nil }
        return (channel, pid)
    }
}

/// The value of `name=value` in a log line.
func field(_ name: String, in line: String) -> String? {
    line.split(separator: " ").first { $0.hasPrefix(name + "=") }.map { String($0.dropFirst(name.count + 1)) }
}
