import AppKit
import CoreServices
@preconcurrency import EventKit
import Foundation
import Observation
import SherpaAppConnection

/// One macOS permission the app holds for Sherpa.
enum PermissionKind: String, CaseIterable, Identifiable, Sendable {
    case calendar, reminders, fullDiskAccess, mailAutomation, messagesAutomation

    var id: String { rawValue }

    var title: String {
        switch self {
        case .calendar: "Calendar"
        case .reminders: "Reminders"
        case .fullDiskAccess: "Full Disk Access"
        case .mailAutomation: "Automation: Mail"
        case .messagesAutomation: "Automation: Messages"
        }
    }

    /// The Privacy & Security pane for this permission.
    var settingsURL: URL {
        let anchor =
            switch self {
            case .calendar: "Privacy_Calendars"
            case .reminders: "Privacy_Reminders"
            case .fullDiskAccess: "Privacy_AllFiles"
            case .mailAutomation, .messagesAutomation: "Privacy_Automation"
            }
        return URL(string: "x-apple.systempreferences:com.apple.preference.security?\(anchor)")!
    }

    var automationTarget: String? {
        switch self {
        case .mailAutomation: "com.apple.mail"
        case .messagesAutomation: "com.apple.MobileSMS"
        default: nil
        }
    }
}

enum PermissionState: Equatable, Sendable {
    case granted
    case writeOnly
    case notDetermined
    case denied
    case restricted
    /// Automation: the target app is not running, so macOS cannot say.
    case targetNotRunning
    case unknown

    var label: String {
        switch self {
        case .granted: "Allowed"
        case .writeOnly: "Write only"
        case .notDetermined: "Not asked yet"
        case .denied: "Not allowed"
        case .restricted: "Restricted"
        case .targetNotRunning: "Open the app to check"
        case .unknown: "Unknown"
        }
    }

    var symbol: String {
        switch self {
        case .granted: "checkmark.circle.fill"
        case .notDetermined, .targetNotRunning, .unknown: "questionmark.circle"
        case .writeOnly, .denied, .restricted: "xmark.circle"
        }
    }
}

/// Permission status and requests (contract §2, ADR-0010 decision 1). The app is the
/// principal macOS asks about; it never disclaims that responsibility. Full Disk Access has
/// no request API, so its action opens the Settings pane; an attempt to read a protected
/// file already lists the app there, switched off (live evidence 2026-11-21).
@MainActor
@Observable
final class PermissionCenter {
    private(set) var states: [PermissionKind: PermissionState] = [:]

    func state(_ kind: PermissionKind) -> PermissionState { states[kind] ?? .unknown }

    func refresh() {
        states[.calendar] = Self.eventKitState(EKEventStore.authorizationStatus(for: .event))
        states[.reminders] = Self.eventKitState(EKEventStore.authorizationStatus(for: .reminder))
        states[.fullDiskAccess] = Self.fullDiskAccessState()
        for kind in [PermissionKind.mailAutomation, .messagesAutomation] {
            guard let target = kind.automationTarget else { continue }
            Task.detached {
                let state = Self.automationState(target: target, ask: false)
                await MainActor.run { self.states[kind] = state }
            }
        }
    }

    /// Asks macOS where an API exists, otherwise opens the Settings pane.
    func request(_ kind: PermissionKind) {
        let current = state(kind)
        if current == .denied || current == .restricted || current == .writeOnly || kind == .fullDiskAccess {
            NSWorkspace.shared.open(kind.settingsURL)
            return
        }
        switch kind {
        case .calendar, .reminders:
            Task {
                let store = EKEventStore()
                do {
                    _ =
                        kind == .calendar
                        ? try await store.requestFullAccessToEvents()
                        : try await store.requestFullAccessToReminders()
                } catch {
                    AppBootstrap.logger.warn("app:permission:request", "kind=\(kind.rawValue) status=failed")
                }
                refresh()
            }
        case .mailAutomation, .messagesAutomation:
            guard let target = kind.automationTarget else { return }
            Task {
                // macOS answers only for a running target; for one that is not running
                // AEDeterminePermissionToAutomateTarget returns procNotFound and shows no
                // prompt (AppleEvents.h). So the request starts it first, without activating it.
                if NSRunningApplication.runningApplications(withBundleIdentifier: target).isEmpty {
                    await Self.launchInBackground(target)
                }
                let state = await Task.detached { Self.automationState(target: target, ask: true) }.value
                states[kind] = state
                AppBootstrap.logger.info("app:permission:request", "kind=\(kind.rawValue) state=\(state)")
            }
        case .fullDiskAccess:
            break
        }
    }

    /// Starts an app in the background and waits up to 10 s for it to finish launching.
    private static func launchInBackground(_ bundleIdentifier: String) async {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier) else {
            AppBootstrap.logger.warn("app:permission:launch", "target=\(bundleIdentifier) status=not_installed")
            return
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false
        AppBootstrap.logger.info("app:permission:launch", "target=\(bundleIdentifier) status=start")
        do {
            let app = try await NSWorkspace.shared.openApplication(at: url, configuration: configuration)
            let deadline = Date(timeIntervalSinceNow: 10)
            while !app.isFinishedLaunching, Date() < deadline {
                try await Task.sleep(for: .milliseconds(100))
            }
            AppBootstrap.logger.info(
                "app:permission:launch",
                "target=\(bundleIdentifier) status=launched finished=\(app.isFinishedLaunching)")
        } catch {
            AppBootstrap.logger.warn("app:permission:launch", "target=\(bundleIdentifier) status=failed")
        }
    }

    private static func eventKitState(_ status: EKAuthorizationStatus) -> PermissionState {
        switch status {
        case .fullAccess: .granted
        case .writeOnly: .writeOnly
        case .notDetermined: .notDetermined
        case .denied: .denied
        case .restricted: .restricted
        @unknown default: .unknown
        }
    }

    /// Opens what the core reads under Full Disk Access: the Messages database, then the
    /// Mail folder. Nothing is read; only whether macOS allows the open.
    nonisolated static func fullDiskAccessState() -> PermissionState {
        guard let home = try? UserHome.directory() else { return .unknown }
        let messages = open(home + "/Library/Messages/chat.db", O_RDONLY | O_CLOEXEC)
        if messages >= 0 {
            close(messages)
            return .granted
        }
        let messagesError = errno
        let mail = open(home + "/Library/Mail", O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        if mail >= 0 {
            close(mail)
            return .granted
        }
        let mailError = errno
        if messagesError == EPERM || messagesError == EACCES || mailError == EPERM || mailError == EACCES {
            return .denied
        }
        return .unknown
    }

    /// `AEDeterminePermissionToAutomateTarget`; with `ask` it may show the consent prompt and
    /// blocks until it is answered, so it never runs on the main thread.
    nonisolated static func automationState(target bundleIdentifier: String, ask: Bool) -> PermissionState {
        let target = NSAppleEventDescriptor(bundleIdentifier: bundleIdentifier)
        guard let descriptor = target.aeDesc else { return .unknown }
        let status = AEDeterminePermissionToAutomateTarget(descriptor, typeWildCard, typeWildCard, ask)
        switch Int(status) {
        case Int(noErr): return .granted
        case Int(errAEEventNotPermitted): return .denied
        case Int(errAEEventWouldRequireUserConsent): return .notDetermined
        case Int(procNotFound): return .targetNotRunning
        default: return .unknown
        }
    }
}
