import AppKit
import CoreText

struct TextPaintSection {
    var range: NSRange
    var color: NSColor
    var spans: [TimedSpan]
    var followsProgress = true
}

private final class PlaybackButton: NSButton {
    override func draw(_ dirtyRect: NSRect) {} // Symbols are drawn by LyricView using these same frames.
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    // The status-item window can end a child button's tracking cycle before mouseUp.
    // Route physical clicks through LyricView, while keeping these buttons in the AX tree.
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

final class LyricView: NSView {
    weak var controller: MenuController?
    var config = LyricsConfig()
    var state = LyricState()
    var compact = false
    private(set) var hovered = false
    private(set) var contextMenuOpen = false
    var textLayoutHeight: CGFloat?
    private var tracking: NSTrackingArea?
    private var animation: Timer?
    private var hoverCheck: Timer?
    private var lineStarted = ProcessInfo.processInfo.systemUptime
    private var textKey = ""
    private var controlsWereVisible = false
    private lazy var controls: [NSButton] = playbackCommands.enumerated().map { index, command in
        let button = PlaybackButton(title: "", target: self, action: #selector(activateControl(_:)))
        button.tag = index; button.isBordered = false; button.isHidden = true
        addSubview(button); return button
    }
    var showsPlaybackControls: Bool { hovered && !contextMenuOpen && !compact && state.hasTrack }
    var visiblePlaybackCommands: [String] { showsPlaybackControls ? playbackCommands : [] }
    override var acceptsFirstResponder: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override var isOpaque: Bool { false }

    func update(state: LyricState, config: LyricsConfig, compact: Bool = false) {
        let key = state.trackId + "|" + state.primary + "|" + state.secondary
        if key != textKey { textKey = key; lineStarted = ProcessInfo.processInfo.systemUptime }
        self.state = state; self.config = config; self.compact = compact
        if compact || !state.hasTrack || !config.enabled || state.hidden { setHovered(false) }
        setAccessibilityElement(true); setAccessibilityRole(.group)
        updateControls(); needsDisplay = true; updateAnimation()
    }
    private func updateControls() {
        let titles = ["播放模式：\(playModeTitle(state.playMode))（点击切换）", "上一首", state.isPlaying ? "暂停" : "播放", "下一首", state.isFavorite ? "取消收藏" : "收藏"]
        let frames = compactControlFrames(in: bounds)
        let visible = showsPlaybackControls
        let visibilityChanged = visible != controlsWereVisible
        controlsWereVisible = visible
        for (index, button) in controls.enumerated() {
            button.frame = frames[index]; button.isEnabled = state.hasTrack
            button.isHidden = !visible
            button.setAccessibilityLabel(titles[index]); button.toolTip = titles[index]
            button.setAccessibilityEnabled(state.hasTrack)
        }
        setAccessibilityChildren(visible ? controls : [])
        setAccessibilityRole(compact || visible ? .group : .button)
        let lyric = [state.primary, state.secondary].filter { !$0.isEmpty }.joined(separator: "，")
        let label: String
        if compact {
            label = "EchoMusic 菜单栏歌词设置"
        } else if visible {
            label = "播放控制"
        } else if state.hasTrack {
            label = "歌词：\(lyric)；显示播放控制"
        } else {
            label = lyric.isEmpty ? "EchoMusic 菜单栏歌词" : "歌词：\(lyric)"
        }
        setAccessibilityLabel(label)
        setAccessibilityHelp(visible ? "播放模式、上一首、播放或暂停、下一首和收藏。" : (state.hasTrack && !compact ? "按下以显示播放控制。" : nil))
        setAccessibilityEnabled(state.hasTrack && !compact)
        toolTip = visible ? "播放模式：\(playModeTitle(state.playMode))；上一首；播放／暂停；下一首；收藏" : nil
        if visibilityChanged && window != nil { NSAccessibility.post(element: self, notification: .layoutChanged) }
    }
    @objc private func activateControl(_ sender: NSButton) { controller?.command(playbackCommands[sender.tag]) }
    override func layout() { super.layout(); updateControls() }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self, userInfo: nil)
        addTrackingArea(area); tracking = area
        if hovered { refreshHoverFromPointer() }
    }
    func setHovered(_ value: Bool) {
        let next = value && !contextMenuOpen && !compact && state.hasTrack && config.enabled && !state.hidden
        guard hovered != next else { return }
        hovered = next; updateControls(); needsDisplay = true; updateAnimation(); updateHoverMonitoring()
        if !hovered { controller?.layout.update() }
    }
    func beginContextMenu() {
        contextMenuOpen = true
        setHovered(false)
    }
    func endContextMenu() {
        guard contextMenuOpen else { return }
        contextMenuOpen = false
        controller?.layout.update()
        refreshHoverFromPointer()
    }
    private func refreshHoverFromPointer() {
        guard let window, window.isVisible, !contextMenuOpen else { setHovered(false); return }
        let point = convert(window.convertPoint(fromScreen: NSEvent.mouseLocation), from: nil)
        setHovered(bounds.contains(point))
    }
    private func updateHoverMonitoring() {
        if hovered && window != nil && hoverCheck == nil {
            // Status-item movement and modal menu tracking can lose a mouseExited event.
            let timer = Timer(timeInterval: 0.12, repeats: true) { [weak self] _ in self?.refreshHoverFromPointer() }
            timer.tolerance = 0.04
            hoverCheck = timer; RunLoop.main.add(timer, forMode: .common)
        } else if !hovered || window == nil { hoverCheck?.invalidate(); hoverCheck = nil }
    }
    override func mouseEntered(with event: NSEvent) { setHovered(true) }
    override func mouseExited(with event: NSEvent) { setHovered(false) }
    override func mouseDown(with event: NSEvent) {
        guard !contextMenuOpen else { return }
        if event.modifierFlags.contains(.control) { rightMouseDown(with: event); return }
        if compact { controller?.showContextMenu(event: event, view: self); return }
        guard state.hasTrack else { return }
        guard showsPlaybackControls else { setHovered(true); return }
        // NSStatusBarButton may reuse a centered event location during its tracking
        // loop. Resolve the current pointer in screen coordinates instead so each
        // visual button keeps its own hit target.
        guard let window else { return }
        guard let index = compactControlIndex(in: bounds, window: window, view: self, screenPoint: NSEvent.mouseLocation) else { return }
        controller?.command(playbackCommands[index])
    }
    override func rightMouseDown(with event: NSEvent) { controller?.showContextMenu(event: event, view: self) }
    override func accessibilityPerformPress() -> Bool {
        guard state.hasTrack, !compact, !contextMenuOpen else { return false }
        setHovered(!hovered)
        return true
    }

    private func font(_ size: CGFloat) -> NSFont {
        let weight: NSFont.Weight = ["regular": .regular, "medium": .medium, "semibold": .semibold, "bold": .bold][config.fontWeight] ?? .medium
        return NSFont.systemFont(ofSize: size, weight: weight)
    }
    private func makeLine(_ text: String, size: CGFloat) -> CTLine {
        CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: [
            .font: font(size), NSAttributedString.Key(kCTForegroundColorFromContextAttributeName as String): true,
        ]))
    }
    private func width(_ line: CTLine) -> CGFloat { CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil)) }
    func sizes(for height: CGFloat) -> (CGFloat, CGFloat) {
        if state.secondary.isEmpty { return (min(config.fontSize, height - 6), 0) }
        // Both status-item and panel layouts receive the same measured text height.
        let textHeight = min(height, textLayoutHeight ?? height)
        var size = config.fontSize
        // A fixed mixed-script sample includes CJK fallback glyphs and Latin
        // descenders, without changing font size from one lyric line to another.
        while size > 8 && 2 * textInkBounds(makeLine("国Agjp", size: size)).height + bilingualLineGap > textHeight - 2 { size -= 0.25 }
        return (size, size)
    }
    func preferredWidth(config: LyricsConfig, state: LyricState, height: CGFloat) -> CGFloat {
        let previousConfig = self.config, previousState = self.state
        self.config = config; self.state = state
        let size = sizes(for: height)
        let measured = max(width(makeLine(state.primary, size: size.0)), state.secondary.isEmpty ? 0 : width(makeLine(state.secondary, size: size.1)))
        self.config = previousConfig; self.state = previousState
        return contentWidth(textWidth: measured, maximum: config.maxWidth)
    }
    private var canScroll: Bool {
        guard !compact, !hovered, config.longLine == "scroll", !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { return false }
        let size = sizes(for: bounds.height)
        return width(makeLine(state.primary, size: size.0)) > bounds.width - 12 || (!state.secondary.isEmpty && width(makeLine(state.secondary, size: size.1)) > bounds.width - 12)
    }
    private func updateAnimation() {
        let needsAnimation = window != nil && !compact && !hovered &&
            (canScroll || (config.progressiveHighlight && state.reason == "lyric" && state.timing?.advancing == true))
        if needsAnimation && animation == nil {
            let timer = Timer(timeInterval: 1 / 30, repeats: true) { [weak self] _ in self?.needsDisplay = true }
            animation = timer; RunLoop.main.add(timer, forMode: .common)
        } else if !needsAnimation { animation?.invalidate(); animation = nil }
    }
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window == nil { setHovered(false) }
        updateAnimation(); updateHoverMonitoring()
    }
    deinit { animation?.invalidate(); hoverCheck?.invalidate() }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let alpha = config.opacity * (state.dimmed ? 0.45 : 1)
        let coverColor = state.coverColor.map { NSColor(hex: $0) }
        let originalColor: NSColor = config.colorMode == "cover" ? (coverColor ?? .labelColor) : config.colorMode == "custom" ? NSColor(hex: config.originalColor) : .labelColor
        let translationColor: NSColor = config.colorMode == "cover" ? (coverColor ?? .labelColor) : config.colorMode == "custom" ? NSColor(hex: config.translationColor) : .labelColor
        if compact { return }
        if showsPlaybackControls {
            let frames = compactControlFrames(in: bounds)
            if let first = frames.first, let last = frames.last {
                NSColor.labelColor.withAlphaComponent(0.08).setFill()
                NSBezierPath(roundedRect: first.union(last).insetBy(dx: 0, dy: 2), xRadius: 6, yRadius: 6).fill()
            }
            let symbols = [playModeSymbol(state.playMode), "backward.end.fill", state.isPlaying ? "pause.fill" : "play.fill", "forward.end.fill", state.isFavorite ? "heart.fill" : "heart"]
            for (index, cell) in frames.enumerated() {
                drawSymbol(symbols[index], in: cell.insetBy(dx: 4, dy: max(2, (bounds.height - 14) / 2)), color: originalColor, alpha: state.hasTrack ? alpha : 0.35, weight: index == 0 ? .heavy : .medium)
            }
            return
        }
        let size = sizes(for: bounds.height)
        if !state.secondary.isEmpty {
            let firstInk = textInkBounds(visibleLine(makeLine(state.primary, size: size.0), size: size.0))
            let secondInk = textInkBounds(visibleLine(makeLine(state.secondary, size: size.1), size: size.1))
            let groupHeight = firstInk.height + bilingualLineGap + secondInk.height
            let bottom = bounds.midY - groupHeight / 2
            drawText(state.primary, baseline: bottom + secondInk.height + bilingualLineGap - firstInk.minY, size: size.0, color: originalColor, alpha: alpha, spans: state.timing?.primary ?? [], center: true)
            drawText(state.secondary, baseline: bottom - secondInk.minY, size: size.1, color: translationColor, alpha: alpha, spans: state.timing?.secondary ?? [], center: true)
        } else {
            let color = config.displayMode == "translation" && !state.translation.isEmpty ? translationColor : originalColor
            drawText(state.primary, baseline: bounds.midY, size: size.0, color: color, alpha: alpha, spans: state.timing?.primary ?? [], center: false, opticalCenter: true,
                     inlineTranslationColor: config.displayMode == "bilingualInline" ? translationColor : nil)
        }
    }
    private func drawSymbol(_ name: String, in rect: NSRect, color: NSColor, alpha: CGFloat, weight: NSFont.Weight = .medium) {
        guard let image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(.init(pointSize: 13, weight: weight)) else { return }
        let scale = min(1, rect.width / image.size.width, rect.height / image.size.height)
        let size = NSSize(width: image.size.width * scale, height: image.size.height * scale)
        let target = NSRect(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2, width: size.width, height: size.height)
        let tinted = NSImage(size: image.size, flipped: false) { bounds in image.draw(in: bounds); color.set(); bounds.fill(using: .sourceIn); return true }
        tinted.draw(in: target, from: .zero, operation: .sourceOver, fraction: alpha)
    }
    func textPaintSections(_ text: String, color: NSColor, spans: [TimedSpan], inlineTranslationColor: NSColor? = nil) -> [TextPaintSection] {
        let separator = inlineBilingualSeparator
        guard let inlineTranslationColor, !state.original.isEmpty, !state.translation.isEmpty,
              text == state.original + separator + state.translation else {
            return [TextPaintSection(range: NSRange(location: 0, length: (text as NSString).length), color: color, spans: spans)]
        }
        let originalLength = (state.original as NSString).length, separatorLength = (separator as NSString).length
        return [
            TextPaintSection(range: NSRange(location: 0, length: originalLength), color: color, spans: spans),
            TextPaintSection(range: NSRange(location: originalLength, length: separatorLength), color: color, spans: [], followsProgress: false),
            TextPaintSection(range: NSRange(location: originalLength + separatorLength, length: (state.translation as NSString).length),
                             color: inlineTranslationColor, spans: state.timing?.secondary ?? []),
        ]
    }
    private func visibleLine(_ line: CTLine, size: CGFloat) -> CTLine {
        let available = max(0, bounds.width - 12)
        if !canScroll && width(line) > available {
            return CTLineCreateTruncatedLine(line, Double(available), .end, makeLine("…", size: size)) ?? line
        }
        return line
    }
    private func drawText(_ text: String, baseline: CGFloat, size: CGFloat, color: NSColor, alpha: CGFloat, spans: [TimedSpan], center: Bool, opticalCenter: Bool = false, inlineTranslationColor: NSColor? = nil) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        let full = makeLine(text, size: size), fullWidth = width(full), rect = bounds.insetBy(dx: 6, dy: 0)
        let visible = visibleLine(full, size: size)
        let scroll = canScroll && fullWidth > rect.width
        let visibleWidth = min(rect.width, width(visible))
        var x = rect.minX + (center && !scroll ? max(0, (rect.width - visibleWidth) / 2) : 0)
        if scroll {
            let elapsed = max(0, ProcessInfo.processInfo.systemUptime - lineStarted - config.scrollDelay)
            x -= CGFloat(elapsed * config.scrollSpeed).truncatingRemainder(dividingBy: fullWidth + 30)
        }
        let progressive = config.progressiveHighlight && state.reason == "lyric" && state.timing != nil
        let sections = textPaintSections(text, color: color, spans: spans, inlineTranslationColor: inlineTranslationColor)
        let time = state.timing?.now() ?? 0
        context.saveGState(); context.clip(to: rect); context.textMatrix = .identity
        let scale = window?.backingScaleFactor ?? 2
        let alignedBaseline = opticalCenter ? opticalTextBaseline(centerY: baseline, ink: textInkBounds(visible)) : baseline
        let y = (alignedBaseline * scale).rounded() / scale
        for origin in scroll ? [x, x + fullWidth + 30] : [x] {
            for section in sections {
                let start = CTLineGetOffsetForStringIndex(full, section.range.location, nil)
                let end = CTLineGetOffsetForStringIndex(full, NSMaxRange(section.range), nil)
                let animated = progressive && section.followsProgress
                context.saveGState()
                if sections.count > 1 {
                    context.clip(to: CGRect(x: origin + min(start, end), y: rect.minY, width: abs(end - start), height: rect.height))
                }
                context.setFillColor(section.color.withAlphaComponent(alpha * (animated ? config.unplayedOpacity : 1)).cgColor)
                context.textPosition = CGPoint(x: origin, y: y); CTLineDraw(visible, context)
                if animated, let timing = state.timing {
                    let painted = textHighlightEnd(full, range: section.range, spans: section.spans, timing: timing, at: time)
                    context.clip(to: CGRect(x: origin + min(start, painted), y: rect.minY, width: abs(painted - start), height: rect.height))
                    context.setFillColor(section.color.withAlphaComponent(alpha).cgColor)
                    context.textPosition = CGPoint(x: origin, y: y); CTLineDraw(visible, context)
                }
                context.restoreGState()
            }
        }
        context.restoreGState()
    }
}
