import Darwin
import Foundation
import SherpaWorkerProtocol

/// macOS asks for Calendar, Reminders, and Automation access on behalf of the
/// "responsible" process: the app that started the terminal or agent host, not
/// this helper. A host without the matching usage description (the Claude
/// desktop app has none for Calendar) cannot show the prompt, and the request
/// returns `not_determined` without asking. Relaunching once with responsibility
/// disclaimed makes this helper — with its embedded Info.plist and the bundle
/// identifier `dev.xiyo.sherpa` — the process macOS asks about, whatever the host.
///
/// The child inherits standard input, output, and error and stays in this
/// process group, so the core's timeout still ends both.
enum PrivacyResponsibility {
    static let relaunchedVariable = "SHERPA_APPLE_RESPONSIBLE"

    private typealias SetDisclaim = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32

    /// Returns only when this process already owns its privacy responsibility or
    /// the relaunch is unavailable; otherwise it exits with the child's status.
    static func ensureResponsible() {
        let environment = ProcessInfo.processInfo.environment
        if environment[relaunchedVariable] == "1" { return }
        guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_spawnattrs_setdisclaim"),
            let executable = Bundle.main.executablePath
        else {
            WorkerLog.warn("[apple:sherpa-apple:responsibility] relaunch unavailable; host app stays responsible")
            return
        }
        let setDisclaim = unsafeBitCast(symbol, to: SetDisclaim.self)

        var attributes: posix_spawnattr_t?
        guard posix_spawnattr_init(&attributes) == 0 else {
            WorkerLog.warn(
                "[apple:sherpa-apple:responsibility] spawn attributes unavailable; host app stays responsible")
            return
        }
        defer { posix_spawnattr_destroy(&attributes) }
        guard setDisclaim(&attributes, 1) == 0 else {
            WorkerLog.warn("[apple:sherpa-apple:responsibility] disclaim rejected; host app stays responsible")
            return
        }

        let arguments = CommandLine.arguments
        var childEnvironment = environment
        childEnvironment[relaunchedVariable] = "1"
        let argv = ([executable] + arguments.dropFirst()).map { strdup($0) } + [nil]
        let envp = childEnvironment.map { strdup("\($0.key)=\($0.value)") } + [nil]
        defer {
            argv.forEach { free($0) }
            envp.forEach { free($0) }
        }

        var child: pid_t = 0
        let spawned = posix_spawn(&child, executable, nil, &attributes, argv, envp)
        guard spawned == 0 else {
            WorkerLog.warn(
                "[apple:sherpa-apple:responsibility] relaunch failed errno=\(spawned); host app stays responsible")
            return
        }
        WorkerLog.debug("[apple:sherpa-apple:responsibility] relaunched with responsibility disclaimed")

        var status: Int32 = 0
        while waitpid(child, &status, 0) == -1 {
            guard errno == EINTR else { exit(EXIT_FAILURE) }
        }
        let signal = status & 0x7f
        if signal == 0 { exit((status >> 8) & 0xff) }
        exit(128 + signal)
    }
}
