import AppKit
import ApplicationServices
import CoreText

func diagnostics() {
    let screens = NSScreen.screens.map { screen -> [String: Any] in
        ["id": screen.stableID, "name": screen.localizedName, "frame": NSStringFromRect(screen.frame),
         "visibleFrame": NSStringFromRect(screen.visibleFrame), "topLeft": NSStringFromRect(screen.topLeftRegion),
         "topRight": NSStringFromRect(screen.topRightRegion), "scale": screen.backingScaleFactor,
         "safeTop": screen.safeAreaInsets.top]
    }
    let geometry = MenuGeometry.read()
    let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
    let topWindows = windows.compactMap { value -> [String: Any]? in
        guard let bounds = value[kCGWindowBounds as String] as? [String: Any], let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary), rect.minY < 80, rect.height < 100 else { return nil }
        return ["layer": value[kCGWindowLayer as String] ?? -1, "bounds": NSStringFromRect(rect)]
    }
    let data: [String: Any] = ["os": ProcessInfo.processInfo.operatingSystemVersionString, "accessibilityTrusted": AXIsProcessTrusted(),
                               "screens": screens, "menuFrames": geometry.menuFrames.map(NSStringFromRect), "extraFrames": geometry.extraFrames.map(NSStringFromRect), "topWindows": topWindows]
    if let json = try? JSONSerialization.data(withJSONObject: data, options: [.prettyPrinted, .sortedKeys]) { print(String(decoding: json, as: UTF8.self)) }
}
func selfTest() {
    _ = NSApplication.shared
    let region = NSRect(x: 0, y: 850, width: 700, height: 32)
    let left = lyricFrame(region: region, menuEnd: 400, rightBoundary: 700, preferredWidth: 280, height: 32, alignRight: false)
    precondition(left?.minX == 410 && left?.maxX == 690)
    precondition(lyricFrame(region: region, menuEnd: 600, rightBoundary: 700, preferredWidth: 280, height: 32, alignRight: false) == nil)
    let right = lyricFrame(region: NSRect(x: 850, y: 850, width: 700, height: 32), menuEnd: 400,
                           rightBoundary: 1200, preferredWidth: 280, height: 32, alignRight: true)
    precondition(right?.maxX == 1192 && right!.minX >= 858)
    let config = LyricsConfig.from(["displayMode": "bilingual", "maxWidth": 320.0])
    precondition(config.displayMode == "bilingual" && config.maxWidth == 320 && config.enabled)
    let cells = compactControlFrames(in: NSRect(x: 0, y: 0, width: 500, height: 30))
    precondition(cells.count == 5 && cells[0].minX == 160 && cells[4].maxX == 340)
    let narrow = compactControlFrames(in: NSRect(x: 0, y: 0, width: 128, height: 24))
    precondition(narrow.allSatisfy { $0.width == 24 } && narrow[4].maxX == 124)
    precondition(playbackCommands.count == cells.count && playbackCommands.first == "togglePlayMode")
    precondition(contentWidth(textWidth: 35, maximum: 500) == 128)
    precondition(contentWidth(textWidth: 180, maximum: 500) == 196)
    precondition(textBaseline(centerY: 15, ascent: 11, descent: 3) == 11)
    for text in ["改变自己 · 王力宏", "Can't stop you can't hold you", "Agjp", "天空の城"] {
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: [.font: NSFont.systemFont(ofSize: 14)]))
        let ink = textInkBounds(line)
        precondition(abs(opticalTextBaseline(centerY: 15, ink: ink) + ink.midY - 15) < 0.001)
    }
    let bilingualView = LyricView(frame: NSRect(x: 0, y: 0, width: 280, height: 30))
    var bilingualState = LyricState(); bilingualState.primary = "Moonlight falls by your window"; bilingualState.secondary = "月光落在你经过的窗前"
    var bilingualConfig = LyricsConfig(); bilingualConfig.fontSize = 14
    bilingualView.update(state: bilingualState, config: bilingualConfig)
    bilingualView.textLayoutHeight = sharedTextHeight(menuHeight: 30, buttonHeight: 22)
    let leftSizes = bilingualView.sizes(for: 30), rightSizes = bilingualView.sizes(for: 22)
    precondition(leftSizes.0 == rightSizes.0 && leftSizes.1 == rightSizes.1)
    precondition(bilingualView.preferredWidth(config: bilingualConfig, state: bilingualState, height: 30) == bilingualView.preferredWidth(config: bilingualConfig, state: bilingualState, height: 22))
    print("PASS: bilingual 30pt / 22pt containers share \(leftSizes.0)pt fonts and matching measured widths")
    bilingualView.textLayoutHeight = sharedTextHeight(menuHeight: 30, buttonHeight: 30)
    let largeSizes = bilingualView.sizes(for: 30)
    precondition(largeSizes.0 > 12 && largeSizes.0 <= bilingualConfig.fontSize)
    let reference = CTLineCreateWithAttributedString(NSAttributedString(string: "国Agjp", attributes: [.font: NSFont.systemFont(ofSize: largeSizes.0)]))
    precondition(2 * textInkBounds(reference).height + bilingualLineGap <= 28)
    let currentBehavior = lyricPanelBehavior(spaceMode: "current"), allBehavior = lyricPanelBehavior(spaceMode: "all")
    precondition(!currentBehavior.contains(.canJoinAllSpaces) && !currentBehavior.contains(.moveToActiveSpace) && !currentBehavior.contains(.fullScreenAuxiliary))
    precondition(allBehavior.contains(.canJoinAllSpaces) && allBehavior.contains(.fullScreenAuxiliary))
    print("PASS: 30pt menus allow \(largeSizes.0)pt bilingual fonts; desktop-bound panels do not join other Spaces")
    var stability = MenuStability(); let now = Date()
    precondition(!stability.accepts("app1:500", at: now))
    precondition(stability.accepts("app1:500", at: now.addingTimeInterval(0.04)))
    precondition(!stability.accepts("app2:700", at: now.addingTimeInterval(0.05)))
    stability.reset(); precondition(!stability.accepts("app2:700", at: now.addingTimeInterval(0.1)))
    let timing = PaintTiming(timelineMs: 1500, sampledAt: 1000, startMs: 1000, endMs: 3000, advancing: false, rate: 1, advanceLimitMs: 1800, primary: [], secondary: [])
    precondition(timing.progress(at: 1000) == 0 && timing.progress(at: 2000) == 0.5 && timing.progress(at: 3000) == 1)
    precondition(timing.now(Date(timeIntervalSince1970: 10)) == 1500)
    print("PASS: safe geometry, compact control width, content fitting, baseline, menu transition invalidation, progressive timing, config defaults")
}

func renderChecks(_ directory: String) {
    _ = NSApplication.shared
    try? FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
    var config = LyricsConfig(); config.automaticColor = false; config.originalColor = "#EF85B9"; config.translationColor = "#699ED4"
    let cases: [(String, String, String, Double, Bool, CGFloat)] = [
        ("single-unplayed", "月光落在你经过的窗前", "", 0, false, 180),
        ("single-half", "月光落在你经过的窗前", "", 2000, false, 180),
        ("single-played", "月光落在你经过的窗前", "", 4000, false, 180),
        ("bilingual-half", "Moonlight falls by your window", "月光落在你经过的窗前", 2000, false, 230),
        ("hover-wide", "月光落在你经过的窗前", "", 2000, true, 500),
        ("hover-128", "为你写诗", "", 0, true, 128),
        ("hover-mode-sequential", "为你写诗", "", 0, true, 180),
        ("hover-mode-list", "为你写诗", "", 0, true, 180),
        ("hover-mode-random", "为你写诗", "", 0, true, 180),
        ("hover-mode-single", "为你写诗", "", 0, true, 180),
        ("cover-color", "歌词跟随歌曲封面", "", 4000, false, 180),
        ("cover-fallback", "未取色时使用系统文字颜色", "", 4000, false, 230),
        ("alignment-cjk", "改变自己 · 王力宏", "", 4000, false, 180),
        ("alignment-latin", "Can't stop you can't hold you", "", 4000, false, 230),
        ("alignment-bilingual", "Moonlight falls by your window", "月光落在你经过的窗前", 4000, false, 230),
        ("bilingual-left-30", "Moonlight falls by your window", "月光落在你经过的窗前", 4000, false, 230),
        ("bilingual-right-22", "Moonlight falls by your window", "月光落在你经过的窗前", 4000, false, 230),
        ("bilingual-large-left-30", "Moonlight falls by your window", "月光落在你经过的窗前", 4000, false, 230),
        ("bilingual-large-right-30", "Moonlight falls by your window", "月光落在你经过的窗前", 4000, false, 230),
    ]
    for (name, primary, secondary, progress, hover, width) in cases {
        let height: CGFloat = name == "bilingual-right-22" ? 22 : 30
        let view = LyricView(frame: NSRect(x: 0, y: 0, width: width, height: height))
        if name == "bilingual-left-30" || name == "bilingual-right-22" { view.textLayoutHeight = 22 }
        if name.hasPrefix("bilingual-large-") { view.textLayoutHeight = 30 }
        var state = LyricState(); state.primary = primary; state.secondary = secondary; state.reason = "lyric"; state.hasTrack = true; state.isPlaying = true
        if name.hasPrefix("hover-mode-") { state.playMode = String(name.dropFirst("hover-mode-".count)); state.isFavorite = true }
        state.timing = PaintTiming(timelineMs: progress, sampledAt: 0, startMs: 0, endMs: 4000, advancing: false, rate: 1, advanceLimitMs: 0, primary: [], secondary: [])
        var localConfig = config
        if name.hasPrefix("alignment-") || name.hasPrefix("bilingual-left") || name.hasPrefix("bilingual-right") || name.hasPrefix("bilingual-large-") { localConfig.fontSize = 14 }
        if name.hasPrefix("cover-") { localConfig.colorMode = "cover" }
        if name == "cover-color" { state.coverColor = "#4C8DB2" }
        view.update(state: state, config: localConfig); view.hovered = hover
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(width * 2), pixelsHigh: Int(height * 2), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        bitmap.size = NSSize(width: width, height: height)
        NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        NSColor.white.setFill(); view.bounds.fill(); view.draw(view.bounds)
        NSGraphicsContext.restoreGraphicsState()
        if let png = bitmap.representation(using: .png, properties: [:]) { try? png.write(to: URL(fileURLWithPath: directory).appendingPathComponent(name + ".png")) }
    }
    print("Rendered native views: \(directory)")
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var controller: MenuController?
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        controller = MenuController(demo: CommandLine.arguments.contains("--demo"))
        if CommandLine.arguments.contains("--settings") { controller?.showSettings() }
    }
    func applicationWillTerminate(_ notification: Notification) { controller?.stop() }
}

if CommandLine.arguments.contains("--diagnose") { diagnostics() }
else if CommandLine.arguments.contains("--self-test") { selfTest() }
else if let index = CommandLine.arguments.firstIndex(of: "--render-checks"), CommandLine.arguments.count > index + 1 { renderChecks(CommandLine.arguments[index + 1]) }
else {
    let application = NSApplication.shared
    let delegate = AppDelegate(); application.delegate = delegate; application.run()
}
