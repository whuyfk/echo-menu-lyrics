import AppKit
import ApplicationServices

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

struct MenuGeometry {
    var menuFrames: [NSRect] = []
    var extraFrames: [NSRect] = []
    var trusted = false
    var ownerPID: pid_t = 0
    var signature: String { "\(ownerPID)|" + (menuFrames + extraFrames).map(NSStringFromRect).joined(separator: "|") }
    static func read(includeExtras: Bool = true, previousExtras: [NSRect] = []) -> MenuGeometry {
        var result = MenuGeometry(); result.trusted = AXIsProcessTrusted()
        guard result.trusted, let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier else { return result }
        result.ownerPID = pid
        result.extraFrames = previousExtras
        let referenceTop = NSScreen.screens.first?.frame.maxY ?? 0
        func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
            var value: CFTypeRef?; return AXUIElementCopyAttributeValue(element, name, &value) == .success ? value : nil
        }
        func frame(_ element: AXUIElement) -> NSRect? {
            guard let p = attribute(element, kAXPositionAttribute as CFString), let s = attribute(element, kAXSizeAttribute as CFString),
                  CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
            var point = CGPoint.zero, size = CGSize.zero
            guard AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size), size.width > 0 else { return nil }
            return NSRect(x: point.x, y: referenceTop - point.y - size.height, width: size.width, height: size.height)
        }
        let app = AXUIElementCreateApplication(pid); AXUIElementSetMessagingTimeout(app, 0.035)
        if let value = attribute(app, kAXMenuBarAttribute as CFString), CFGetTypeID(value) == AXUIElementGetTypeID(),
           let children = attribute(value as! AXUIElement, kAXChildrenAttribute as CFString) as? [AXUIElement] {
            result.menuFrames = children.compactMap(frame)
        }
        if includeExtras {
            result.extraFrames = []
            // macOS 27 hosts menu extras in MenuBarAgent rather than separate status windows.
            // Read only the public AXExtrasMenuBar positions, including third-party status items.
            for running in NSWorkspace.shared.runningApplications {
                let element = AXUIElementCreateApplication(running.processIdentifier)
                AXUIElementSetMessagingTimeout(element, 0.04)
                if let bar = attribute(element, "AXExtrasMenuBar" as CFString), CFGetTypeID(bar) == AXUIElementGetTypeID(),
                   let children = attribute(bar as! AXUIElement, kAXChildrenAttribute as CFString) as? [AXUIElement] {
                    result.extraFrames += children.compactMap(frame).filter { rect in
                        rect.height >= 16 && rect.width > 0 && NSScreen.screens.contains { screen in
                            abs(rect.maxY - screen.frame.maxY) < 6 && screen.frame.contains(NSPoint(x: rect.midX, y: rect.midY))
                        }
                    }
                }
            }
        }
        // Public window geometry provides status-item bounds even when AXExtrasMenuBar is unavailable.
        // No window titles or pixels are read. Full-width menu backgrounds are excluded.
        let windows = includeExtras ? (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []) : []
        for info in windows where includeExtras {
            guard let layer = info[kCGWindowLayer as String] as? Int, layer == Int(CGWindowLevelForKey(.statusWindow)),
                  let dictionary = info[kCGWindowBounds as String] as? [String: Any],
                  let raw = CGRect(dictionaryRepresentation: dictionary as CFDictionary), raw.width > 0, raw.height >= 16, raw.height <= 60 else { continue }
            let rect = NSRect(x: raw.minX, y: referenceTop - raw.maxY, width: raw.width, height: raw.height)
            if NSScreen.screens.contains(where: { abs(rect.maxY - $0.frame.maxY) < 6 && rect.width < $0.frame.width / 2 && $0.frame.contains(NSPoint(x: rect.midX, y: rect.midY)) }) {
                result.extraFrames.append(rect)
            }
        }
        var seen: Set<String> = []
        result.extraFrames = result.extraFrames.filter { seen.insert(NSStringFromRect($0)).inserted }.sorted { $0.minX < $1.minX }
        if NSWorkspace.shared.frontmostApplication?.processIdentifier != pid { result.menuFrames = []; result.ownerPID = 0 }
        return result
    }
    func menuBand(on screen: NSScreen) -> NSRect? {
        let values = menuFrames.filter { $0.midX >= screen.frame.minX && $0.midX <= screen.frame.maxX && abs($0.maxY - screen.frame.maxY) < 6 }
        guard let first = values.first else { return nil }; return values.dropFirst().reduce(first) { $0.union($1) }
    }
    func menuEnd(on screen: NSScreen) -> CGFloat? { menuBand(on: screen)?.maxX }
    func extrasStart(on screen: NSScreen) -> CGFloat? {
        extraFrames.filter { $0.midX >= screen.frame.minX && $0.midX <= screen.frame.maxX && abs($0.maxY - screen.frame.maxY) < 6 }.map(\.minX).min()
    }
}

// A geometry sample must be confirmed twice for the same foreground app before a panel is shown.
struct MenuStability {
    var signature = ""
    var firstSeen = Date.distantPast
    mutating func reset() { signature = ""; firstSeen = .distantPast }
    mutating func accepts(_ sample: String, at now: Date) -> Bool {
        if signature != sample { signature = sample; firstSeen = now; return false }
        return now.timeIntervalSince(firstSeen) >= 0.035
    }
}

final class LayoutCoordinator {
    weak var controller: MenuController?
    private var panels: [String: LyricPanel] = [:]
    private var timer: Timer?
    private var cachedGeometry = MenuGeometry()
    private var stability = MenuStability()
    private var observer: AXObserver?
    private var observedPID: pid_t = 0
    private var deferred: [DispatchWorkItem] = []
    private var lastExtras = Date.distantPast
    private var extraFrames: [NSRect] = []
    private let geometryQueue = DispatchQueue(label: "cc.echo.menu-lyrics.geometry", qos: .userInitiated)
    private var extraReadInFlight = false
    private var stopped = false
    private var panelSpaceMode = ""
    init(controller: MenuController) { self.controller = controller }
    func start() {
        let timer = Timer(timeInterval: 0.12, repeats: true) { [weak self] _ in self?.refreshMenus() }
        self.timer = timer; RunLoop.main.add(timer, forMode: .common)
        invalidateMenus()
    }
    private func observeForeground() {
        let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
        guard pid != observedPID else { return }
        if let observer { CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes) }
        observer = nil; observedPID = pid
        guard pid != 0, AXIsProcessTrusted() else { return }
        var created: AXObserver?
        let callback: AXObserverCallback = { _, _, _, context in
            guard let context else { return }
            Unmanaged<LayoutCoordinator>.fromOpaque(context).takeUnretainedValue().invalidateMenus()
        }
        guard AXObserverCreate(pid, callback, &created) == .success, let created else { return }
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.035)
        let context = Unmanaged.passUnretained(self).toOpaque()
        for name in [kAXFocusedWindowChangedNotification, kAXMainWindowChangedNotification] {
            _ = AXObserverAddNotification(created, app, name as CFString, context)
        }
        var menu: CFTypeRef?
        if AXUIElementCopyAttributeValue(app, kAXMenuBarAttribute as CFString, &menu) == .success,
           let menu, CFGetTypeID(menu) == AXUIElementGetTypeID() {
            for name in ["AXLayoutChanged", "AXChildrenChanged", "AXValueChanged"] { _ = AXObserverAddNotification(created, menu as! AXUIElement, name as CFString, context) }
        }
        observer = created; CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(created), .commonModes)
    }
    func invalidateMenus() {
        panels.values.forEach { $0.orderOut(nil) }
        cachedGeometry = MenuGeometry(); stability.reset()
        deferred.forEach { $0.cancel() }; deferred.removeAll()
        observeForeground(); update()
        for delay in [0.02, 0.075, 0.15, 0.3, 0.6] {
            let work = DispatchWorkItem { [weak self] in self?.refreshMenus() }
            deferred.append(work); DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
        }
    }
    private func refreshMenus() {
        guard let controller else { return }
        guard controller.config.placement == "left" || controller.config.screenMode != "primary" || controller.config.spaceMode == "current" || !controller.state.secondary.isEmpty else { update(); return }
        if observedPID != (NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0) { invalidateMenus(); return }
        if !extraReadInFlight && Date().timeIntervalSince(lastExtras) > 2 {
            extraReadInFlight = true
            geometryQueue.async { [weak self] in
                let extras = MenuGeometry.read().extraFrames
                DispatchQueue.main.async {
                    guard let self, !self.stopped else { return }
                    self.extraReadInFlight = false; self.lastExtras = Date()
                    self.extraFrames = extras; self.refreshMenus()
                }
            }
        }
        let sample = MenuGeometry.read(includeExtras: false, previousExtras: extraFrames)
        if stability.accepts(sample.signature, at: Date()) { cachedGeometry = sample }
        else { cachedGeometry = MenuGeometry(); panels.values.forEach { $0.orderOut(nil) } }
        update()
    }
    func update(force: Bool = false) {
        guard let controller else { return }
        let config = controller.config, state = controller.state
        let usePanels = config.placement == "left" || config.screenMode != "primary" || config.spaceMode == "current" || !state.secondary.isEmpty
        if panelSpaceMode != config.spaceMode {
            panels.values.forEach { $0.close() }; panels.removeAll(); panelSpaceMode = config.spaceMode
        }
        let primary = NSScreen.screens.first
        var targets = [primary].compactMap { $0 }
        if config.screenMode == "all" { targets = NSScreen.screens }
        else if config.screenMode == "active" { targets = [NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? primary].compactMap { $0 } }
        var used: Set<String> = [], note = ""
        let trusted = AXIsProcessTrusted()
        if usePanels && !trusted { note = "左侧停靠、指定桌面或显示器需要辅助功能权限，请从 EchoMusic 插件管理打开设置。" }
        if cachedGeometry.ownerPID != (NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0) { panels.values.forEach { $0.orderOut(nil) } }
        else if usePanels && trusted && config.enabled && !state.hidden {
            for screen in targets {
                let local = config.on(screen), isLeft = config.placement == "left"
                guard let band = cachedGeometry.menuBand(on: screen) else { note = "菜单边界正在重新确认，歌词暂时收起。"; continue }
                var region = isLeft ? screen.topLeftRegion : screen.topRightRegion
                region.origin.y = band.minY; region.size.height = band.height
                let extras = cachedGeometry.extrasStart(on: screen)
                // On an unnotched display no overlay is drawn unless the status-item boundary is known.
                guard let boundary = extras ?? (screen.safeAreaInsets.top > 0 && isLeft ? region.maxX : nil) else {
                    note = "暂时无法确认状态图标边界，歌词已收起。"; continue
                }
                let key = screen.stableID
                let view = (panels[key]?.contentView as? LyricView) ?? LyricView(frame: .zero)
                view.controller = controller
                // Bilingual lyrics use the full menu row on either side, so
                // the smaller status-button content rect cannot shrink them.
                view.textLayoutHeight = band.height
                let preferred = view.hovered && view.bounds.width >= 128 ? view.bounds.width : view.preferredWidth(config: local, state: state, height: band.height)
                guard let frame = lyricFrame(region: region, menuEnd: band.maxX, rightBoundary: boundary, preferredWidth: preferred, height: band.height, alignRight: !isLeft) else {
                    note = "菜单栏可用空间不足，歌词已收起。"; continue
                }
                let panel: LyricPanel
                if let existing = panels[key] { panel = existing }
                else { panel = LyricPanel(frame: frame, view: view, spaceMode: config.spaceMode); panels[key] = panel }
                // Do not order a desktop-bound window into another Space when
                // foreground-app notifications arrive after a desktop switch.
                if config.spaceMode == "current" && !panel.isOnActiveSpace {
                    note = "歌词固定在另一个桌面；返回该桌面后恢复，重启组件可固定到当前桌面。"; continue
                }
                if panel.frame != frame { panel.setFrame(frame, display: false) }
                view.frame = NSRect(origin: .zero, size: frame.size)
                view.update(state: state, config: local)
                panel.orderFrontRegardless(); used.insert(key)
            }
        }
        for (key, panel) in panels where !used.contains(key) { panel.orderOut(nil) }
        controller.layoutNote = note
        let compact = usePanels || !config.enabled || state.hidden
        controller.statusItem.isVisible = !compact
        let screen = controller.statusItem.button?.window?.screen ?? primary
        let local = config.on(screen)
        let barHeight = controller.statusItem.button?.bounds.height ?? NSStatusBar.system.thickness
        controller.statusView.textLayoutHeight = sharedTextHeight(menuHeight: screen?.menuRowHeight ?? barHeight, buttonHeight: barHeight)
        var width: CGFloat = compact ? 24 : controller.statusView.preferredWidth(config: local, state: state, height: barHeight)
        if !compact && controller.statusView.hovered { width = controller.statusItem.length }
        if !compact, let screen, let button = controller.statusItem.button, let window = button.window {
            let frame = window.convertToScreen(button.convert(button.bounds, to: nil))
            width = min(width, max(24, frame.maxX - screen.topRightRegion.minX - 8))
            if width < 128 { width = 0 }
        }
        if !compact { controller.statusItem.isVisible = width >= 128 }
        if abs(controller.statusItem.length - width) > 0.5 { controller.statusItem.length = width }
        if let button = controller.statusItem.button { controller.statusView.frame = button.bounds }
        controller.statusView.update(state: state, config: local, compact: compact || width < 128)
    }
    func stop() {
        stopped = true
        timer?.invalidate(); timer = nil; deferred.forEach { $0.cancel() }; deferred.removeAll()
        if let observer { CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes) }
        observer = nil; panels.values.forEach { $0.close() }; panels.removeAll()
    }
}
