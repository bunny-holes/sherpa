import AppKit
import SwiftUI

/// The SwiftUI app: a menu bar item and no Dock icon (`LSUIElement`).
struct SherpaMenuApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        MenuBarExtra("Sherpa", systemImage: "mountain.2.fill") {
            MenuContent(model: AppModel.shared)
        }
        .menuBarExtraStyle(.menu)
    }
}

struct MenuContent: View {
    let model: AppModel

    var body: some View {
        Text("Sherpa \(model.version)")
        Text(model.coreSummary)
        if model.canRestartCore {
            Button("Restart the Sherpa core") { model.restartCore() }
        }
        Divider()
        // A checkmark item: agents connect only while it is on (contract §2).
        Toggle("MCP Server", isOn: Binding(get: { model.mcpEnabled }, set: { model.setMCPEnabled($0) }))
        Text(model.mcpEnabled ? "Agent sessions: \(model.status.sessions)" : "Agents are turned away")
        Divider()
        ForEach(PermissionKind.allCases) { kind in
            let state = model.permissions.state(kind)
            Button("\(kind.title): \(state.label)") { model.permissions.request(kind) }
                .disabled(state == .granted)
        }
        Divider()
        Button("Show Sherpa Status…") { StatusWindowController.shared.show() }
        Button("Quit Sherpa") { NSApp.terminate(nil) }.keyboardShortcut("q")
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    static let statusWindowShownKey = "statusWindowShown"
    private var terminateSource: DispatchSourceSignal?
    private var terminating = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        AppModel.shared.start()
        // A second launch asks this one to show its window (main.swift).
        DistributedNotificationCenter.default().addObserver(
            forName: AppBootstrap.showStatusNotification, object: nil, queue: .main
        ) { _ in
            MainActor.assumeIsolated { StatusWindowController.shared.show() }
        }
        signal(SIGTERM, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        source.setEventHandler { NSApp.terminate(nil) }
        source.resume()
        terminateSource = source
        // The first launch shows the window: the menu bar item may be hidden (see the
        // window's note), and an LSUIElement app has no other way in. So does every launch with
        // MCP off, the first one included: agents are turned away until the person turns it on
        // there, and an app upgraded from before the switch starts with it off (contract §2).
        let defaults = UserDefaults.standard
        if !defaults.bool(forKey: Self.statusWindowShownKey) || !AppModel.shared.mcpEnabled {
            defaults.set(true, forKey: Self.statusWindowShownKey)
            StatusWindowController.shared.show()
        }
    }

    /// Opening the app again while it runs (Finder, `open`) shows the window.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        StatusWindowController.shared.show()
        return false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !terminating else { return .terminateLater }
        terminating = true
        AppModel.shared.shutdown { NSApp.reply(toApplicationShouldTerminate: true) }
        return .terminateLater
    }
}
