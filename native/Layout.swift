import AppKit

final class LayoutCoordinator {
    weak var controller: MenuController?
    private var stopped = false

    init(controller: MenuController) { self.controller = controller }
    func start() { update() }
    func invalidateMenus() { update() }

    func update(force: Bool = false) {
        guard let controller, !stopped else { return }
        let config = controller.config, state = controller.state
        controller.statusItem.isVisible = config.enabled && !state.hidden
        controller.layoutNote = ""
        guard controller.statusItem.isVisible else {
            controller.statusView.update(state: state, config: config, compact: true)
            return
        }
        let height = controller.statusItem.button?.bounds.height ?? NSStatusBar.system.thickness
        controller.statusView.textLayoutHeight = height
        var width = controller.statusView.preferredWidth(config: config, state: state, height: height)
        if controller.statusView.hovered { width = max(width, 180) }
        width = max(128, width)
        if abs(controller.statusItem.length - width) > 0.5 { controller.statusItem.length = width }
        if let button = controller.statusItem.button {
            controller.statusView.frame = button.bounds
            controller.statusView.update(state: state, config: config)
        }
    }

    func stop() {
        stopped = true
        controller = nil
    }
}
