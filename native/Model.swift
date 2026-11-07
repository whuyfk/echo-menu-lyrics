import AppKit
import CoreText

struct ScreenOverride: Codable, Equatable {
    var maxWidth: Double?
    var fontSize: Double?
}

struct LyricsConfig: Codable, Equatable {
    var version = 1
    var enabled = true
    var placement = "right"
    var screenMode = "primary"
    var spaceMode = "current"
    var maxWidth = 280.0
    var displayMode = "translation"
    var fontName = "system"
    var fontSize = 13.0
    var fontWeight = "medium"
    var automaticColor = true
    var colorMode = "system"
    var originalColor = "#FFFFFF"
    var translationColor = "#CDE8FF"
    var opacity = 1.0
    var progressiveHighlight = true
    var unplayedOpacity = 0.35
    var longLine = "ellipsis"
    var scrollSpeed = 28.0
    var scrollDelay = 1.5
    var offsetMs = 0.0
    var idleBehavior = "title"
    var pauseBehavior = "keep"
    var pauseDelay = 10.0
    var filterCredits = true
    var customFilters: [String] = []
    var screenOverrides: [String: ScreenOverride] = [:]

    var dictionary: [String: Any] {
        (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(self))) as? [String: Any] ?? [:]
    }
    static func from(_ values: [String: Any], base: LyricsConfig = LyricsConfig()) -> LyricsConfig {
        let merged = base.dictionary.merging(values) { _, new in new }
        guard let data = try? JSONSerialization.data(withJSONObject: merged),
              let config = try? JSONDecoder().decode(LyricsConfig.self, from: data) else { return base }
        return config
    }
    func on(_ screen: NSScreen?) -> LyricsConfig {
        guard let screen, let override = screenOverrides[screen.stableID] else { return self }
        var result = self
        result.maxWidth = override.maxWidth ?? maxWidth
        result.fontSize = override.fontSize ?? fontSize
        return result
    }
}

struct LyricState: Codable, Equatable {
    var trackId = ""
    var title = ""
    var artist = ""
    var hasTrack = false
    var isPlaying = false
    var isFavorite = false
    var playMode = "list"
    var coverColor: String?
    var primary = "正在连接 EchoMusic…"
    var secondary = ""
    var original = ""
    var translation = ""
    var reason = "empty"
    var hidden = false
    var dimmed = false
    var timing: PaintTiming?
}

struct TimedSpan: Codable, Equatable {
    var start: Int
    var end: Int
    var startMs: Double
    var endMs: Double
}

struct PaintTiming: Codable, Equatable {
    var timelineMs: Double
    var sampledAt: Double
    var startMs: Double
    var endMs: Double
    var advancing: Bool
    var rate: Double
    var advanceLimitMs: Double
    var primary: [TimedSpan]
    var secondary: [TimedSpan]
    func now(_ date: Date = Date()) -> Double {
        timelineMs + (advancing ? min(advanceLimitMs, max(0, date.timeIntervalSince1970 * 1000 - sampledAt)) * rate : 0)
    }
    func progress(at time: Double) -> Double { min(1, max(0, (time - startMs) / max(1, endMs - startMs))) }
}

func compactControlFrames(in bounds: NSRect) -> [NSRect] {
    let width = min(180, max(0, bounds.width - 8))
    let x = bounds.midX - width / 2
    return (0..<5).map { NSRect(x: x + CGFloat($0) * width / 5, y: bounds.minY, width: width / 5, height: bounds.height) }
}

let playbackCommands = ["togglePlayMode", "previousTrack", "togglePlayback", "nextTrack", "toggleFavorite"]
func playModeSymbol(_ mode: String) -> String {
    ["sequential": "arrow.right", "list": "repeat", "random": "shuffle", "single": "repeat.1"][mode] ?? "repeat"
}
func playModeTitle(_ mode: String) -> String {
    ["sequential": "顺序播放", "list": "列表循环", "random": "随机播放", "single": "单曲循环"][mode] ?? "列表循环"
}

func contentWidth(textWidth: CGFloat, maximum: CGFloat) -> CGFloat { min(maximum, max(128, ceil(textWidth) + 16)) }
func textBaseline(centerY: CGFloat, ascent: CGFloat, descent: CGFloat) -> CGFloat { centerY - (ascent - descent) / 2 }

func textInkBounds(_ line: CTLine) -> CGRect {
    let ink = CTLineGetBoundsWithOptions(line, .useGlyphPathBounds)
    if !ink.isNull && !ink.isEmpty { return ink }
    return CTLineGetBoundsWithOptions(line, .excludeTypographicLeading)
}
func opticalTextBaseline(centerY: CGFloat, ink: CGRect) -> CGFloat {
    ink.isNull || ink.isEmpty ? centerY : centerY - ink.midY
}

let bilingualLineGap: CGFloat = 0.5
func sharedTextHeight(menuHeight: CGFloat, buttonHeight: CGFloat) -> CGFloat {
    min(menuHeight, buttonHeight)
}

func lyricPanelBehavior(spaceMode: String) -> NSWindow.CollectionBehavior {
    spaceMode == "all" ? [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle] : [.stationary, .ignoresCycle, .fullScreenNone]
}

extension NSScreen {
    var menuRowHeight: CGFloat {
        let reserved = frame.maxY - visibleFrame.maxY
        return reserved >= 20 && reserved <= 64 ? reserved : NSStatusBar.system.thickness
    }
    var stableID: String {
        String((deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0)
    }
    var topLeftRegion: NSRect {
        if #available(macOS 12, *), let region = auxiliaryTopLeftArea { return region }
        return NSRect(x: frame.minX, y: frame.maxY - NSStatusBar.system.thickness,
                      width: frame.width, height: NSStatusBar.system.thickness)
    }
    var topRightRegion: NSRect {
        if #available(macOS 12, *), let region = auxiliaryTopRightArea { return region }
        return topLeftRegion
    }
}

extension NSColor {
    convenience init(hex: String) {
        let value = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0xFFFFFF
        self.init(srgbRed: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255,
                  blue: Double(value & 255) / 255, alpha: 1)
    }
}

// Returns nil instead of drawing into occupied space. Also used by geometry self-tests.
func lyricFrame(region: NSRect, menuEnd: CGFloat, rightBoundary: CGFloat, preferredWidth: CGFloat,
                height: CGFloat, alignRight: Bool, minimumWidth: CGFloat = 128) -> NSRect? {
    let start = max(region.minX + 8, menuEnd + 10)
    let end = min(region.maxX - 8, rightBoundary - 8)
    let width = min(preferredWidth, end - start)
    guard width >= minimumWidth else { return nil }
    return NSRect(x: alignRight ? end - width : start, y: region.maxY - height, width: width, height: height)
}
