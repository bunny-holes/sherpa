import AppKit
import SwiftUI

/// The status window: what the menu shows, with room for the permission actions and the
/// MCP configuration an agent needs.
@MainActor
final class StatusWindowController {
    static let shared = StatusWindowController()
    private var window: NSWindow?

    func show() {
        let window = window ?? makeWindow()
        self.window = window
        AppModel.shared.permissions.refresh()
        window.center()
        NSApp.activate()
        window.makeKeyAndOrderFront(nil)
        window.orderFrontRegardless()
    }

    private func makeWindow() -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 460),
            styleMask: [.titled, .closable], backing: .buffered, defer: false
        )
        window.title = "Sherpa"
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(rootView: StatusView(model: AppModel.shared))
        return window
    }
}

struct StatusView: View {
    let model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Image(systemName: "mountain.2.fill").font(.title)
                VStack(alignment: .leading) {
                    Text("Sherpa \(model.version)").font(.title2)
                    Text(model.coreSummary).foregroundStyle(.secondary)
                }
                Spacer()
                if model.canRestartCore {
                    Button("Restart the core") { model.restartCore() }
                }
            }
            Text("Agent sessions: \(model.status.sessions)")

            GroupBox("Permissions") {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(PermissionKind.allCases) { kind in
                        let state = model.permissions.state(kind)
                        HStack {
                            Image(systemName: state.symbol)
                            Text(kind.title)
                            Spacer()
                            Text(state.label).foregroundStyle(.secondary)
                            Button(kind == .fullDiskAccess || state == .denied ? "Open Settings" : "Request") {
                                model.permissions.request(kind)
                            }
                            .disabled(state == .granted)
                        }
                    }
                }
                .padding(6)
            }

            GroupBox("Agent configuration") {
                VStack(alignment: .leading, spacing: 6) {
                    Text("MCP server \"sherpa\", command with no arguments:")
                    Text(model.relayPath).font(.system(.body, design: .monospaced)).textSelection(.enabled)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(6)
            }

            Text("Sherpa keeps running in the menu bar (mountain icon). If the icon is not there, "
                + "check that Sherpa is allowed in System Settings › Menu Bar, and that the menu bar "
                + "has room for it beside the camera housing.")
                .font(.footnote).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(20)
        .frame(width: 520)
    }
}
