import Darwin
import Foundation
import Security
import SherpaAppConnection

public enum CoreLaunchFailure: Error, Equatable, Sendable {
    case pipeFailed(errno: Int32)
    case spawnFailed(errno: Int32)
    case requirementInvalid(status: Int32)
    /// The started core's running code did not meet the requirement; it was killed before
    /// its first instruction.
    case signatureRejected(status: Int32)
}

/// How a core ended, from `waitpid`.
public struct CoreTermination: Equatable, Sendable {
    public let status: Int32

    public var signal: Int32? { status & 0x7f == 0 ? nil : status & 0x7f }
    public var exitCode: Int32? { status & 0x7f == 0 ? (status >> 8) & 0xff : nil }
    public var logFields: String {
        if let signal { return "signal=\(signal)" }
        return "exit=\(exitCode ?? -1)"
    }
}

/// One `sherpa-core app serve` child and its three pipes (§7.1). Standard output is read
/// as frames, standard error as log lines, and standard input is written through an outbox.
final class CoreProcess: @unchecked Sendable {
    static let stderrLineBytes = 4 * 1_024
    static let readBytes = 64 * 1_024

    let pid: pid_t
    let generation: Int
    let input: Outbox
    /// How long the check of the running code took, before the core was resumed.
    let signatureMilliseconds: Int
    private let outputDescriptor: Int32
    private let errorDescriptor: Int32
    private let outputDone = DispatchSemaphore(value: 0)

    private init(pid: pid_t, generation: Int, signatureMilliseconds: Int, input: Int32, output: Int32, error: Int32) {
        self.pid = pid
        self.generation = generation
        self.signatureMilliseconds = signatureMilliseconds
        outputDescriptor = output
        errorDescriptor = error
        self.input = Outbox(descriptor: input, limit: nil, failed: { _ in }, ended: { close(input) })
    }

    /// Starts the core stopped before its first instruction, checks the code that is running
    /// against `requirement`, and only then lets it run (contract §2). A check of the path
    /// before a separate start would leave a window in which another file takes its place.
    static func spawn(
        path: String, environment: [String: String], requirement: String, generation: Int
    ) throws(CoreLaunchFailure) -> CoreProcess {
        let compiled: SecRequirement
        do {
            compiled = try CodeSignature.compile(requirement)
        } catch {
            if case let .requirementInvalid(status) = error { throw .requirementInvalid(status: status) }
            throw .requirementInvalid(status: -1)
        }
        var input: [Int32] = [0, 0]
        var output: [Int32] = [0, 0]
        var error: [Int32] = [0, 0]
        guard pipe(&input) == 0 else { throw .pipeFailed(errno: errno) }
        guard pipe(&output) == 0 else {
            let code = errno
            close(input[0])
            close(input[1])
            throw .pipeFailed(errno: code)
        }
        guard pipe(&error) == 0 else {
            let code = errno
            close(input[0])
            close(input[1])
            close(output[0])
            close(output[1])
            throw .pipeFailed(errno: code)
        }
        for descriptor in input + output + error { _ = fcntl(descriptor, F_SETFD, FD_CLOEXEC) }
        _ = fcntl(input[1], F_SETNOSIGPIPE, 1)

        var actions: posix_spawn_file_actions_t?
        posix_spawn_file_actions_init(&actions)
        defer { posix_spawn_file_actions_destroy(&actions) }
        posix_spawn_file_actions_adddup2(&actions, input[0], STDIN_FILENO)
        posix_spawn_file_actions_adddup2(&actions, output[1], STDOUT_FILENO)
        posix_spawn_file_actions_adddup2(&actions, error[1], STDERR_FILENO)

        var attributes: posix_spawnattr_t?
        posix_spawnattr_init(&attributes)
        defer { posix_spawnattr_destroy(&attributes) }
        // Only the three pipes reach the child, with every signal at its default and none
        // blocked. The app ignores SIGPIPE, and SIGTERM for its dispatch source; exec keeps an
        // ignored signal ignored, and a core that ignores SIGTERM outlives the app's stop.
        posix_spawnattr_setflags(
            &attributes,
            Int16(
                POSIX_SPAWN_CLOEXEC_DEFAULT | POSIX_SPAWN_SETSIGDEF | POSIX_SPAWN_SETSIGMASK
                    | POSIX_SPAWN_START_SUSPENDED)
        )
        var defaults: sigset_t = ~0
        posix_spawnattr_setsigdefault(&attributes, &defaults)
        var mask: sigset_t = 0
        posix_spawnattr_setsigmask(&attributes, &mask)

        let arguments = [path, "app", "serve"].map { strdup($0) } + [nil]
        let variables = environment.sorted { $0.key < $1.key }.map { strdup("\($0.key)=\($0.value)") } + [nil]
        defer {
            arguments.forEach { free($0) }
            variables.forEach { free($0) }
        }
        var pid: pid_t = 0
        let spawned = posix_spawn(&pid, path, &actions, &attributes, arguments, variables)
        close(input[0])
        close(output[1])
        close(error[1])
        guard spawned == 0 else {
            close(input[1])
            close(output[0])
            close(error[0])
            throw .spawnFailed(errno: spawned)
        }

        // The child is not reaped yet, so its pid names it and no other process.
        let checkStart = monotonicSeconds()
        let verdict = CodeSignature.checkRunning(pid: pid, requirement: compiled)
        let checkMilliseconds = Int((monotonicSeconds() - checkStart) * 1_000)
        guard verdict == errSecSuccess else {
            // SIGKILL ends a stopped process without letting it run.
            kill(pid, SIGKILL)
            var status: Int32 = 0
            while waitpid(pid, &status, 0) == -1, errno == EINTR {}
            close(input[1])
            close(output[0])
            close(error[0])
            throw .signatureRejected(status: verdict)
        }
        kill(pid, SIGCONT)
        return CoreProcess(
            pid: pid, generation: generation, signatureMilliseconds: checkMilliseconds,
            input: input[1], output: output[0], error: error[0]
        )
    }

    /// Starts the readers and the exit watcher. `frames` returns false to stop handling
    /// frames (after a violation); the pipe is still drained to its end.
    func start(
        frames: @escaping @Sendable ([MuxFrame]) -> Bool,
        violation: @escaping @Sendable (MuxViolation) -> Void,
        errorLine: @escaping @Sendable (String) -> Void,
        exited: @escaping @Sendable (CoreTermination) -> Void
    ) {
        Thread.detachNewThread { [self] in
            var reader = MuxFrameReader(direction: .coreToApp)
            var handling = true
            var buffer = [UInt8](repeating: 0, count: Self.readBytes)
            while true {
                let result = autoreleasepool {
                    buffer.withUnsafeMutableBytes { FileDescriptorIO.read(outputDescriptor, into: $0) }
                }
                guard case let .bytes(count) = result else { break }
                guard handling else { continue }
                let consumed: Result<[MuxFrame], MuxViolation> = buffer.withUnsafeBytes { raw in
                    do throws(MuxViolation) {
                        return .success(try reader.consume(UnsafeRawBufferPointer(rebasing: raw[0..<count])))
                    } catch {
                        return .failure(error)
                    }
                }
                switch consumed {
                case let .success(parsed):
                    if !parsed.isEmpty { handling = frames(parsed) }
                case let .failure(error):
                    handling = false
                    violation(error)
                }
            }
            close(outputDescriptor)
            outputDone.signal()
        }
        Thread.detachNewThread { [self] in
            var line = Data()
            var buffer = [UInt8](repeating: 0, count: 16 * 1_024)
            while true {
                let result = autoreleasepool {
                    buffer.withUnsafeMutableBytes { FileDescriptorIO.read(errorDescriptor, into: $0) }
                }
                guard case let .bytes(count) = result else { break }
                for byte in buffer[0..<count] {
                    if byte == 0x0a {
                        errorLine(String(decoding: line.prefix(Self.stderrLineBytes), as: UTF8.self))
                        line = Data()
                    } else if line.count < Self.stderrLineBytes {
                        line.append(byte)
                    }
                }
            }
            if !line.isEmpty { errorLine(String(decoding: line, as: UTF8.self)) }
            close(errorDescriptor)
        }
        Thread.detachNewThread { [self] in
            var status: Int32 = 0
            while waitpid(pid, &status, 0) == -1, errno == EINTR {}
            // Frames written just before the exit are handled before the exit is.
            _ = outputDone.wait(timeout: .now() + 1)
            input.cancel()
            exited(CoreTermination(status: status))
        }
    }

    func send(_ frame: MuxFrame) {
        input.enqueue(frame.encodedParts)
    }

    func send(_ parts: [Data]) {
        input.enqueue(parts)
    }

    /// Standard input end of file: the core closes every session and exits (§7.10).
    func closeInput() {
        input.finish {}
    }

    func signal(_ signal: Int32) {
        kill(pid, signal)
    }
}
