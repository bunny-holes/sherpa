import AppKit
import Foundation
import SherpaAppServer
import SwiftUI

/// Shows each delete or send request in a front-most window with the time left, one at a
/// time; the others wait their turn while their own 30 seconds run (contract §9). The
/// window's content is user data and is never logged.
@MainActor
final class ConfirmationWindows {
    private struct Pending {
        let request: ConfirmationRequest
        let decide: @Sendable (ConfirmationDecision) -> Void
    }

    private var queue: [Pending] = []
    private var current: Pending?
    private var panel: NSPanel?
    private var timer: Timer?
    private let model = ConfirmationViewModel()

    func present(_ request: ConfirmationRequest, decide: @escaping @Sendable (ConfirmationDecision) -> Void) {
        guard !NSScreen.screens.isEmpty else {
            decide(.unavailable)
            return
        }
        queue.append(Pending(request: request, decide: decide))
        showNext()
    }

    func withdraw(id: UInt64) {
        queue.removeAll { $0.request.id == id }
        if current?.request.id == id { closeCurrent() }
    }

    func withdrawAll() {
        queue.removeAll()
        closeCurrent()
    }

    private func showNext() {
        guard current == nil else { return }
        let now = monotonicSeconds()
        // A request whose time ran out while it waited is not shown; the core withdraws it.
        queue.removeAll { $0.request.deadline <= now }
        guard !queue.isEmpty else { return }
        let next = queue.removeFirst()
        current = next
        model.request = next.request
        model.remaining = max(0, Int((next.request.deadline - now).rounded(.up)))
        model.answer = { [weak self] decision in self?.answer(decision) }

        let panel = panel ?? makePanel()
        self.panel = panel
        panel.center()
        NSApp.activate()
        panel.makeKeyAndOrderFront(nil)
        panel.orderFrontRegardless()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
    }

    private func tick() {
        guard let current else { return }
        let left = current.request.deadline - monotonicSeconds()
        model.remaining = max(0, Int(left.rounded(.up)))
        if left <= 0 { closeCurrent() }
    }

    private func answer(_ decision: ConfirmationDecision) {
        guard let current else { return }
        current.decide(decision)
        closeCurrent()
    }

    private func closeCurrent() {
        timer?.invalidate()
        timer = nil
        current = nil
        model.request = nil
        panel?.orderOut(nil)
        showNext()
    }

    private func makePanel() -> NSPanel {
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 460, height: 320),
            styleMask: [.titled, .fullSizeContentView], backing: .buffered, defer: false
        )
        panel.title = "Sherpa"
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false
        panel.contentView = NSHostingView(rootView: ConfirmationView(model: model))
        return panel
    }
}

@MainActor
@Observable
final class ConfirmationViewModel {
    var request: ConfirmationRequest?
    var remaining = 0
    var answer: (ConfirmationDecision) -> Void = { _ in }
}

struct ConfirmationView: View {
    let model: ConfirmationViewModel

    var body: some View {
        if let request = model.request {
            VStack(alignment: .leading, spacing: 12) {
                Text(request.title).font(.headline)
                Text("\(request.clientName) \(request.clientVersion) asks to run \(request.tool).")
                    .font(.subheadline).foregroundStyle(.secondary)
                ScrollView {
                    Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 10, verticalSpacing: 6) {
                        ForEach(Array(request.lines.enumerated()), id: \.offset) { _, line in
                            GridRow {
                                Text(line.label).foregroundStyle(.secondary)
                                Text(line.value).textSelection(.enabled)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 180)
                HStack {
                    Text("Answer within \(model.remaining) s").monospacedDigit().foregroundStyle(.secondary)
                    Spacer()
                    Button("Decline") { model.answer(.declined) }.keyboardShortcut(.cancelAction)
                    Button("Allow") { model.answer(.approved) }
                }
            }
            .padding(20)
            .frame(width: 460)
        } else {
            EmptyView()
        }
    }
}

/// The server's confirmation port, carried to the main thread in arrival order.
final class ConfirmationPresenter: ConfirmationPort, @unchecked Sendable {
    private let windows: ConfirmationWindows

    @MainActor
    init(windows: ConfirmationWindows) {
        self.windows = windows
    }

    func present(_ request: ConfirmationRequest, decide: @escaping @Sendable (ConfirmationDecision) -> Void) {
        DispatchQueue.main.async { [windows] in
            MainActor.assumeIsolated { windows.present(request, decide: decide) }
        }
    }

    func withdraw(id: UInt64) {
        DispatchQueue.main.async { [windows] in
            MainActor.assumeIsolated { windows.withdraw(id: id) }
        }
    }

    func withdrawAll() {
        DispatchQueue.main.async { [windows] in
            MainActor.assumeIsolated { windows.withdrawAll() }
        }
    }
}
