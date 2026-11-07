import AppKit
import WebKit

final class MenuController: NSObject {
    var config = LyricsConfig()
    var state = LyricState()
    var connectionText = "正在连接 EchoMusic…"
    var layoutNote = "" { didSet {
        if layoutNote != oldValue { bridge?.send(["type": "nativeStatus", "text": layoutNote]) }
    } }
    let statusItem = NSStatusBar.system.statusItem(withLength: 280)
    let statusView = LyricView(frame: NSRect(x: 0, y: 0, width: 280, height: NSStatusBar.system.thickness))
    var layout: LayoutCoordinator!
    private var bridge: BridgeConnection?
    private var settingsWindow: NSWindow?
    private var settingsView: WKWebView?
    private var settingsURL: URL?
    private var observers: [NSObjectProtocol] = []
    private var demo = false
    private var connected = false

    init(demo: Bool) {
        self.demo = demo; super.init()
        statusItem.autosaveName = "EchoMenuLyrics"
        if let button = statusItem.button {
            button.title = ""; button.addSubview(statusView)
            statusView.autoresizingMask = [.width, .height]
        }
        statusView.controller = self
        layout = LayoutCoordinator(controller: self)
        observers.append(NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in self?.layout.invalidateMenus() })
        observers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] _ in self?.layout.invalidateMenus() })
        observers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in self?.layout.invalidateMenus() })
        observers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { [weak self] _ in self?.layout.invalidateMenus() })
        layout.start()
        if demo { startDemo() } else { connect() }
    }
    private func connect() {
        let environment = ProcessInfo.processInfo.environment
        guard let raw = environment["ECHO_LYRICS_ENDPOINT"], let url = URL(string: raw),
              url.scheme == "ws", url.host == "127.0.0.1", url.port != nil, url.path == "/live",
              let protocolName = environment["ECHO_LYRICS_PROTOCOL"], protocolName.hasPrefix("echo-lyrics.") else {
            connectionText = "请从 EchoMusic 插件管理启动；也可用 --demo 预览。"
            state.primary = "EchoMusic · 未连接"; layout.update(); return
        }
        var settingsComponents = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        settingsComponents.scheme = "http"; settingsComponents.path = "/settings/"; settingsComponents.fragment = protocolName
        settingsURL = settingsComponents.url
        let connection = BridgeConnection(endpoint: url, protocolName: protocolName)
        connection.onStatus = { [weak self] online, text in
            guard let self else { return }
            self.connected = online; self.connectionText = text
            if online {
                self.bridge?.send(["type": "hello", "role": "native"])
                self.bridge?.send(["type": "metadata", "metadata": ["fonts": NSFontManager.shared.availableFontFamilies.sorted(), "screens": NSScreen.screens.map { ["id": $0.stableID, "name": $0.localizedName, "menuRowHeight": $0.menuRowHeight] }, "statusButtonHeight": self.statusItem.button?.bounds.height ?? NSStatusBar.system.thickness]])
            }
            if !online { self.state = LyricState(); self.state.primary = "EchoMusic · 已断开"; self.layout.update() }
            if text.contains("插件已停用") { DispatchQueue.main.asyncAfter(deadline: .now() + 1) { NSApp.terminate(nil) } }
        }
        connection.onMessage = { [weak self] message in self?.receive(message) }
        bridge = connection; connection.start()
    }
    private func receive(_ message: [String: Any]) {
        guard let type = message["type"] as? String else { return }
        if type == "nativeAction" {
            if message["action"] as? String == "showSettings" { showSettings() }
        } else if type == "config", let values = message["config"] as? [String: Any] {
            config = LyricsConfig.from(values); layout.update(force: true)
            bridge?.send(["type": "nativeStatus", "text": "菜单栏组件已连接；歌词使用状态栏自身预留空间。"])
        } else if type == "state", let values = message["state"] as? [String: Any],
                  let data = try? JSONSerialization.data(withJSONObject: values), let value = try? JSONDecoder().decode(LyricState.self, from: data) {
            state = value; layout.update()
        } else if type == "ack", message["ok"] as? Bool == false {
            connectionText = message["error"] as? String ?? "操作未完成，请重试。"
        }
    }
    func patch(_ values: [String: Any]) {
        if demo {
            config = LyricsConfig.from(values, base: config)
            if config.displayMode == "original" { state.primary = state.original; state.secondary = "" }
            else if config.displayMode == "bilingual" || config.displayMode == "bilingualCompact" { state.primary = state.original; state.secondary = state.translation }
            else if config.displayMode == "bilingualInline" { state.primary = [state.original, state.translation].filter { !$0.isEmpty }.joined(separator: "  ·  "); state.secondary = "" }
            else { state.primary = state.translation; state.secondary = "" }
            layout.update(force: true)
        } else {
            guard connected else { connectionText = "尚未连接，设置未保存；连接后请重试。"; return }
            bridge?.send(["type": "configure", "patch": values, "id": UUID().uuidString])
        }
    }
    func command(_ name: String) {
        if demo {
            if name == "togglePlayback" { state.isPlaying.toggle() }
            else if name == "toggleFavorite" { state.isFavorite.toggle() }
            else if name == "togglePlayMode" {
                let modes = ["sequential", "list", "random", "single"]
                state.playMode = modes[((modes.firstIndex(of: state.playMode) ?? 0) + 1) % modes.count]
            }
            else {
                state.original = name == "nextTrack" ? "Evening light is falling softly" : "Moonlight falls by your window"
                state.translation = name == "nextTrack" ? "晚霞轻轻落在你身旁" : "月光落在你经过的窗前"
                patch([:])
            }
            layout.update(); return
        }
        guard connected, state.hasTrack else { return }
        bridge?.send(["type": "command", "command": name, "trackId": state.trackId, "id": UUID().uuidString])
    }
    func showContextMenu(event: NSEvent, view: NSView) {
        let menu = NSMenu()
        for text in [state.original, state.translation].filter({ !$0.isEmpty }) {
            let item = NSMenuItem(title: text, action: nil, keyEquivalent: ""); item.isEnabled = false; menu.addItem(item)
        }
        if !state.original.isEmpty { menu.addItem(.separator()) }
        for (mode, title) in [("original", "显示原文"), ("translation", "译文优先"), ("bilingualInline", "双语单行"), ("bilingualCompact", "原生紧凑双行"), ("bilingual", "大字号双行")] {
            let item = NSMenuItem(title: title, action: #selector(setMode(_:)), keyEquivalent: "")
            item.target = self; item.representedObject = mode; item.state = config.displayMode == mode ? .on : .off; menu.addItem(item)
        }
        menu.addItem(.separator())
        let settings = NSMenuItem(title: "歌词设置…", action: #selector(openSettingsAction), keyEquivalent: ","); settings.target = self; menu.addItem(settings)
        let visibility = NSMenuItem(title: config.enabled ? "隐藏歌词" : "显示歌词", action: #selector(toggleVisibility), keyEquivalent: ""); visibility.target = self; menu.addItem(visibility)
        NSMenu.popUpContextMenu(menu, with: event, for: view)
    }
    @objc private func setMode(_ sender: NSMenuItem) { if let mode = sender.representedObject as? String { patch(["displayMode": mode]) } }
    @objc private func openSettingsAction() { showSettings() }
    @objc private func toggleVisibility() { patch(["enabled": !config.enabled]) }
    func showSettings() {
        if settingsWindow == nil {
            let webView = WKWebView(frame: .zero)
            settingsView = webView
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 620, height: 740), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            window.contentView = webView
            if let settingsURL { webView.load(URLRequest(url: settingsURL)) }
            else { webView.loadHTMLString("<p style='font:14px -apple-system;padding:24px'>请从 EchoMusic 插件管理启动，以打开统一设置页面。</p>", baseURL: nil) }
            window.title = "EchoMusic 菜单栏歌词"
            window.styleMask = [.titled, .closable, .miniaturizable, .resizable]
            window.setContentSize(NSSize(width: 620, height: 740)); window.minSize = NSSize(width: 440, height: 500)
            window.isReleasedWhenClosed = false; window.center(); settingsWindow = window
        }
        NSApp.activate(ignoringOtherApps: true); settingsWindow?.makeKeyAndOrderFront(nil)
    }
    private func startDemo() {
        connectionText = "演示模式 · 使用示例歌词，不控制实际播放器"
        state = LyricState(trackId: "demo", title: "Windowlight", artist: "EchoMusic Demo", hasTrack: true, isPlaying: true,
                           isFavorite: false, primary: "月光落在你经过的窗前", secondary: "", original: "Moonlight falls by your window",
                           translation: "月光落在你经过的窗前", reason: "lyric", hidden: false, dimmed: false)
        layout.update()
    }
    func stop() {
        bridge?.stop(); layout.stop()
        NSStatusBar.system.removeStatusItem(statusItem)
        for observer in observers { NotificationCenter.default.removeObserver(observer); NSWorkspace.shared.notificationCenter.removeObserver(observer) }
        settingsWindow?.close()
    }
}
