import AppKit
import SherpaAppServer
import SwiftUI

// Parts of the status window that take plain values, not the app model.

/// The MCP row of the status window (contract §2 "MCP 켜기와 연결 안내"): the switch and a short
/// state. How to connect an agent sits behind the row's help button, shown while MCP is on; the
/// window itself carries no instructions (owner decision, 2026-11-22).
struct MCPSwitchSection: View {
    @Binding var enabled: Bool
    let sessions: Int
    let relayPath: String
    @State private var showsGuide = false

    var body: some View {
        GroupBox {
            HStack(alignment: .center, spacing: 10) {
                Circle()
                    .fill(enabled ? Color.green : Color.secondary.opacity(0.5))
                    .frame(width: 9, height: 9)
                Text("MCP server").font(.headline)
                Text(enabled ? "On · \(sessions) connected" : "Off").foregroundStyle(.secondary)
                Spacer(minLength: 12)
                if enabled {
                    HelpLink { showsGuide = true }
                        .help("How to connect an agent")
                        .popover(isPresented: $showsGuide, arrowEdge: .bottom) {
                            AgentGuide(relayPath: relayPath)
                        }
                }
                Toggle("MCP server", isOn: $enabled)
                    .toggleStyle(.switch)
                    .labelsHidden()
            }
            .padding(6)
        }
        .help(
            enabled
                ? "Agents that start Sherpa connect to it. Turning MCP off closes every connected session."
                : "Agents that start Sherpa are turned away until you turn MCP on."
        )
        .onChange(of: enabled) { _, isOn in
            if !isOn { showsGuide = false }
        }
    }
}

/// How to register this app's relay with each agent Sherpa was measured with, and the relay
/// itself: the MCP row's help popover. Every command and the path wrap rather than being cut,
/// and each has its own Copy.
struct AgentGuide: View {
    static let width: CGFloat = 520
    let relayPath: String
    @State private var agent: AgentSetup.Agent = .claudeCode

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Connect an agent").font(.headline)
            Picker("Agent", selection: $agent) {
                ForEach(AgentSetup.Agent.allCases, id: \.self) { agent in
                    Text(agent.title).tag(agent)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            let steps = AgentSetup.steps(for: agent, relayPath: relayPath)
            ForEach(steps, id: \.command) { step in
                Text(step.caption)
                CopyableText(step.command)
            }
            Text(
                "Run \(steps.count == 1 ? "it" : "them in order") in Terminal. \(agent.afterRegistering) "
                    + "Using the Sherpa plugin (sherpa@plug-hole)? It registers this server for you."
            )
            .font(.footnote).foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)

            Divider()
            Text("The MCP server \"\(AgentSetup.serverName)\" is this command, with no arguments:")
                .fixedSize(horizontal: false, vertical: true)
            CopyableText(relayPath)
        }
        .padding(16)
        .frame(width: Self.width, alignment: .leading)
    }
}

/// A command or a path shown whole: it wraps instead of being cut with "…"
/// (bunny-holes/sherpa#52), it can be selected, and Copy puts exactly this text on the
/// pasteboard.
struct CopyableText: View {
    let text: String
    @State private var copied = false

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(text)
                .font(.system(.callout, design: .monospaced))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(text, forType: .string)
                copied = true
            } label: {
                Text(copied ? "Copied" : "Copy").frame(minWidth: 50)
            }
            .task(id: copied) {
                guard copied else { return }
                try? await Task.sleep(for: .seconds(1.5))
                copied = false
            }
        }
        .padding(8)
        .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.separator))
    }
}
