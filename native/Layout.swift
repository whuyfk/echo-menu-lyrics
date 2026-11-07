import AppKit

final class LyricPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
    init(frame: NSRect, view: LyricView, spaceMode: String) {
        super.init(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        isOpaque = false; backgroundColor = .clear; hasShadow = false
        level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.statusWindow)) + 1)
        collectionBehavior = lyricPanelBehavior(spaceMode: spaceMode)
        hidesOnDeactivate = false; isReleasedWhenClosed = false; contentView = view
    }
}

final class LayoutCoordinator {
    weak var controller: MenuController?
    private var panels: [String: LyricPanel] = [:]
    private var timer: Timer?
    private var panelSpaceMode = ""
    private var pendingUpdate: DispatchWorkItem?
    private var cachedStatusFrames: [NSRect] = []
    private var stopped = false

    init(controller: MenuController) { self.controller = controller }

    func start() {
        let timer = Timer(timeInterval: 2, repeats: true) { [weak self] _ in
            guard let self, !self.stopped, self.usesPanels else { return }
            self.refreshStatusFrames(); self.update()
        }
        self.timer = timer
        RunLoop.main.add(timer, forMode: .common)
        invalidateMenus()
    }

    func invalidateMenus() {
        pendingUpdate?.cancel()
        panels.values.forEach { $0.orderOut(nil) }
        refreshStatusFrames()
        update(force: true)
        scheduleUpdate()
    }

    private var usesPanels: Bool {
        guard let controller else { return false }
        let config = controller.config, state = controller.state
        return config.enabled && !state.hidden &&
            (config.screenMode != "primary" || config.spaceMode == "current" || (config.displayMode == "bilingual" && !state.secondary.isEmpty))
    }

    private func targetScreens(config: LyricsConfig) -> [NSScreen] {
        let primary = NSScreen.screens.first
        if config.screenMode == "all" { return NSScreen.screens }
        if config.screenMode == "active" {
            return [NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? primary].compactMap { $0 }
        }
        return [primary].compactMap { $0 }
    }

    private func refreshStatusFrames() {
        guard let controller else { cachedStatusFrames = []; return }
        let ownPID = ProcessInfo.processInfo.processIdentifier
        let referenceTop = NSScreen.screens.first?.frame.maxY ?? 0
        let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        var frames: [NSRect] = []
        for info in windows {
            guard let pid = info[kCGWindowOwnerPID as String] as? NSNumber, pid.int32Value == ownPID,
                  let layer = info[kCGWindowLayer as String] as? Int,
                  layer == Int(CGWindowLevelForKey(.statusWindow)),
                  let dictionary = info[kCGWindowBounds as String] as? [String: Any],
                  let raw = CGRect(dictionaryRepresentation: dictionary as CFDictionary),
                  raw.width > 0, raw.height >= 16, raw.height <= 60 else { continue }
            frames.append(NSRect(x: raw.minX, y: referenceTop - raw.maxY, width: raw.width, height: raw.height))
        }
        if let button = controller.statusItem.button, let window = button.window {
            frames.append(window.convertToScreen(button.convert(button.bounds, to: nil)))
        }
        var seen: Set<String> = []
        cachedStatusFrames = frames.filter { seen.insert(NSStringFromRect($0)).inserted }.sorted { $0.minX < $1.minX }
    }

    private func anchor(on screen: NSScreen, reservedWidth: CGFloat) -> NSRect? {
        if let frame = cachedStatusFrames.first(where: {
            $0.midX >= screen.frame.minX && $0.midX <= screen.frame.maxX && abs($0.maxY - screen.frame.maxY) < 8
        }) { return frame }
        let primary = NSScreen.screens.first ?? screen
        if let primaryFrame = cachedStatusFrames.first(where: {
            $0.midX >= primary.frame.minX && $0.midX <= primary.frame.maxX && abs($0.maxY - primary.frame.maxY) < 8
        }) {
            let rightGap = max(0, primary.frame.maxX - primaryFrame.maxX)
            return NSRect(x: screen.frame.maxX - rightGap - reservedWidth, y: screen.frame.maxY - primaryFrame.height,
                          width: reservedWidth, height: primaryFrame.height)
        }
        return nil
    }

    private func scheduleUpdate() {
        pendingUpdate?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, !self.stopped else { return }
            self.refreshStatusFrames(); self.update()
        }
        pendingUpdate = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05, execute: work)
    }

    func update(force: Bool = false) {
        guard let controller else { return }
        let config = controller.config, state = controller.state
        let usePanels = usesPanels
        if panelSpaceMode != config.spaceMode {
            panels.values.forEach { $0.close() }; panels.removeAll(); panelSpaceMode = config.spaceMode
        }
        let targets = targetScreens(config: config)
        if usePanels {
            let widths = targets.map { screen in
                controller.statusView.preferredWidth(config: config.on(screen), state: state,
                                                     height: screen.menuRowHeight)
            }
            let reservedWidth = max(128, widths.max() ?? 128)
            controller.statusItem.isVisible = config.enabled && !state.hidden
            if abs(controller.statusItem.length - reservedWidth) > 0.5 {
                controller.statusItem.length = reservedWidth
                scheduleUpdate()
            }
            if let button = controller.statusItem.button {
                controller.statusView.frame = button.bounds
                controller.statusView.update(state: state, config: config, compact: true)
            }
            var used: Set<String> = [], note = ""
            for screen in targets {
                let local = config.on(screen)
                guard let anchor = anchor(on: screen, reservedWidth: controller.statusItem.length) else {
                    note = "正在为歌词预留状态栏空间…"; continue
                }
                let height = max(anchor.height, screen.menuRowHeight)
                let frame = NSRect(x: anchor.minX, y: screen.frame.maxY - height,
                                   width: max(128, anchor.width), height: height)
                let key = screen.stableID
                let view = (panels[key]?.contentView as? LyricView) ?? LyricView(frame: .zero)
                view.controller = controller
                view.textLayoutHeight = height
                view.frame = NSRect(origin: .zero, size: frame.size)
                view.update(state: state, config: local)
                let panel: LyricPanel
                if let existing = panels[key] { panel = existing }
                else { panel = LyricPanel(frame: frame, view: view, spaceMode: config.spaceMode); panels[key] = panel }
                if config.spaceMode == "current" && !panel.isOnActiveSpace {
                    note = "歌词固定在另一个桌面；返回该桌面后恢复，重启组件可固定到当前桌面。"; continue
                }
                if panel.frame != frame { panel.setFrame(frame, display: false) }
                panel.orderFrontRegardless(); used.insert(key)
            }
            for (key, panel) in panels where !used.contains(key) { panel.orderOut(nil) }
            controller.layoutNote = note
            return
        }

        panels.values.forEach { $0.orderOut(nil) }
        controller.statusItem.isVisible = config.enabled && !state.hidden
        let screen = controller.statusItem.button?.window?.screen ?? NSScreen.screens.first
        let local = config.on(screen)
        let height = controller.statusItem.button?.bounds.height ?? NSStatusBar.system.thickness
        controller.statusView.textLayoutHeight = height
        var width = controller.statusView.preferredWidth(config: local, state: state, height: height)
        if controller.statusView.hovered { width = max(width, 180) }
        if controller.statusItem.isVisible, width < 128 { width = 128 }
        if abs(controller.statusItem.length - width) > 0.5 {
            controller.statusItem.length = width
            scheduleUpdate()
        }
        if let button = controller.statusItem.button {
            controller.statusView.frame = button.bounds
            controller.statusView.update(state: state, config: local, compact: !controller.statusItem.isVisible)
        }
        controller.layoutNote = ""
    }

    func stop() {
        stopped = true; pendingUpdate?.cancel(); pendingUpdate = nil
        timer?.invalidate(); timer = nil
        panels.values.forEach { $0.close() }; panels.removeAll()
    }
}
