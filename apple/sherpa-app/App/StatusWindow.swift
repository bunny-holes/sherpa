import AppKit
import SwiftUI

/// The status window: the app's state, the MCP switch, and the permissions. How to connect an
/// agent opens from the MCP row's help button (contract §2 "MCP 켜기와 연결 안내").
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
            contentRect: NSRect(x: 0, y: 0, width: StatusView.width, height: 320),
            styleMask: [.titled, .closable], backing: .buffered, defer: false
        )
        window.title = "Sherpa"
        window.isReleasedWhenClosed = false
        // Shown on the Space the person is on, over a full-screen app too. Without this the
        // first-run window opened on another Space (offscreen, 2026-11-21).
        window.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
        // The window keeps to the view's size, also when a text changes it, so nothing is squeezed
        // to fit (bunny-holes/sherpa#52).
        let host = NSHostingView(rootView: StatusView(model: AppModel.shared))
        host.sizingOptions = [.minSize, .intrinsicContentSize, .maxSize]
        window.contentView = host
        window.setContentSize(host.fittingSize)
        return window
    }
}

struct StatusView: View {
    static let width: CGFloat = 500
    let model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                HStack {
                    Image(systemName: "mountain.2.fill").font(.title)
                    VStack(alignment: .leading) {
                        Text("Sherpa \(model.version)").font(.title2)
                        Text(model.coreSummary).foregroundStyle(.secondary)
                    }
                }
                .help("Sherpa keeps running in the menu bar (mountain icon). If the icon is not there, "
                    + "check that Sherpa is allowed in System Settings › Menu Bar, and that the menu bar "
                    + "has room for it beside the camera housing.")
                Spacer()
                if model.canRestartCore {
                    Button("Restart the core") { model.restartCore() }
                }
            }

            MCPSwitchSection(
                enabled: Binding(get: { model.mcpEnabled }, set: { model.setMCPEnabled($0) }),
                sessions: model.status.sessions,
                relayPath: model.relayPath
            )

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
        }
        .padding(20)
        .frame(width: Self.width)
    }
}
