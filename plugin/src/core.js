const INLINE_BILINGUAL_SEPARATOR = '  ';

export const DEFAULTS = Object.freeze({
  enabled: true, maxWidth: 280,
  displayMode: 'translation', fontSize: 13, fontWeight: 'medium',
  colorMode: 'system', originalColor: '#FFFFFF', translationColor: '#CDE8FF', opacity: 1,
  progressiveHighlight: true, unplayedOpacity: .35,
  longLine: 'ellipsis', scrollSpeed: 28, scrollDelay: 1.5, offsetMs: 0,
  idleBehavior: 'title', pauseBehavior: 'keep', pauseDelay: 10,
  filterCredits: true, customFilters: [],
});

// Keep the visible color stable during the host's asynchronous cover extraction.
// A known color for the same artwork stays valid; a previous song's color is only a short bridge.
export class CoverColorState {
  constructor(waitMs = 2000) { this.waitMs = waitMs; this.colors = new Map(); this.key = ''; this.since = null; this.lastColor = null; }
  resolve({ trackId, coverUrl, color, ready }, now = Date.now()) {
    const key = trackId ? String(coverUrl || trackId) : '';
    if (!key) { this.key = ''; this.since = null; return { color: null, pending: false, expiresAt: 0 }; }
    if (key !== this.key) { this.key = key; this.since = now; }
    if (ready && /^#[\da-f]{6}$/i.test(color || '')) {
      this.lastColor = color; this.since = null;
      this.colors.delete(key); this.colors.set(key, color);
      if (this.colors.size > 32) this.colors.delete(this.colors.keys().next().value);
      return { color, pending: false, expiresAt: 0 };
    }
    const cached = this.colors.get(key);
    if (cached) { this.lastColor = cached; return { color: cached, pending: false, expiresAt: 0 }; }
    this.since ??= now;
    const expiresAt = this.since + this.waitMs;
    if (now < expiresAt) return { color: this.lastColor, pending: true, expiresAt };
    return { color: null, pending: false, expiresAt: 0 };
  }
}

export function sanitizeConfig(input = {}) {
  if (!input || typeof input !== 'object') input = {};
  const out = { ...DEFAULTS };
  for (const key of ['enabled', 'filterCredits', 'progressiveHighlight'])
    if (typeof input[key] === 'boolean') out[key] = input[key];
  const enums = {
    colorMode: ['system', 'cover', 'custom'],
    displayMode: ['original', 'translation', 'bilingual', 'bilingualInline'], fontWeight: ['regular', 'medium', 'semibold', 'bold'],
    longLine: ['ellipsis', 'scroll'], idleBehavior: ['title', 'hold', 'hide'], pauseBehavior: ['keep', 'dim', 'hide'],
  };
  for (const [key, values] of Object.entries(enums)) if (values.includes(input[key])) out[key] = input[key];
  const limits = { maxWidth: [128, 800], fontSize: [9, 24], opacity: [.2, 1], scrollSpeed: [8, 100],
    scrollDelay: [0, 8], offsetMs: [-30000, 30000], pauseDelay: [0, 300], unplayedOpacity: [.1, .8] };
  for (const [key, [min, max]] of Object.entries(limits))
    if (typeof input[key] === 'number' && Number.isFinite(input[key])) out[key] = Math.min(max, Math.max(min, input[key]));
  for (const key of ['originalColor', 'translationColor'])
    if (/^#[\da-f]{6}$/i.test(input[key] || '')) out[key] = input[key];
  if (Array.isArray(input.customFilters)) out.customFilters = input.customFilters.filter(x => typeof x === 'string' && x.trim()).slice(0, 40).map(x => x.trim().slice(0, 500));
  return out;
}

export function parseFilter(pattern) {
  const text = pattern.trim();
  if (text.length > 500) throw new Error('单条正则最长 500 字符');
  const match = text.match(/^\/(.*)\/([a-z]*)$/i);
  if (match && /[^imu]/.test(match[2])) throw new Error('正则标志仅支持 i、m、u');
  return new RegExp(match ? match[1] : text, match ? match[2] : 'iu');
}

export function validateFilters(patterns) {
  if (patterns.length > 40) return ['最多支持 40 条正则规则'];
  return patterns.map((pattern, index) => {
    try { parseFilter(pattern); return null; }
    catch (error) { return `第 ${index + 1} 条：${error.message}`; }
  }).filter(Boolean);
}

// Kept independent so the exact same evaluator can run inside a disposable Worker.
export function evaluateFilters(lines, config) {
  const credit = /^\s*(?:[（(【\[]\s*)?(?:作词|作曲|词曲|编曲|制作人|制作|出品人|出品|监制|录音(?:师)?|混音(?:师)?|母带(?:工程师)?|吉他(?:手)?|贝斯(?:手)?|键盘(?:手)?|鼓手|和声(?:编写)?|弦乐|配唱制作人|音乐总监|录音棚|词|曲|Lyrics(?:\s+by)?|Compos(?:er|ed\s+by)|Arrang(?:er|ed\s+by)|Producer|Guitar|Bass|Drums|Mix(?:ing)?|Master(?:ing)?|Recorded\s+by)\s*[:：]/iu;
  const rules = config.customFilters.map(pattern => {
    const match = pattern.match(/^\/(.*)\/([imu]*)$/);
    return new RegExp(match ? match[1] : pattern, match ? match[2] : 'iu');
  });
  return lines.map(line => {
    const values = [line.original, line.translation];
    return (config.filterCredits && values.some(x => credit.test(x))) || rules.some(rule => values.some(x => rule.test(x)));
  });
}

export function normalizeLines(snapshot) {
  const playback = snapshot?.playback;
  const lyric = snapshot?.lyric;
  if (!playback || !lyric || !Array.isArray(lyric.lines)) return [];
  const ids = [playback.trackId, playback.lyricHash].filter(Boolean).map(String);
  if (lyric.trackId != null && !ids.includes(String(lyric.trackId))) return [];
  return lyric.lines.slice(0, 20000).map((line, order) => {
    const characterTime = line.characters?.[0]?.startTime;
    const startMs = Number.isFinite(characterTime) ? characterTime : Number(line.time || 0) * 1000;
    const original = String(line.text ?? '').trim(), translation = String(line.translated ?? '').trim();
    return { startMs: Math.max(0, startMs), original, translation, order,
      originalTiming: normalizeCharacterTiming(original, line.characters),
      translationTiming: normalizeCharacterTiming(translation, line.translatedCharacters) };
  }).filter(line => Number.isFinite(line.startMs)).sort((a, b) => a.startMs - b.startMs || a.order - b.order);
}

export function normalizeCharacterTiming(text, characters) {
  if (!Array.isArray(characters)) return [];
  let cursor = 0;
  const result = [];
  for (const character of characters) {
    const value = String(character.text ?? '');
    const startMs = Number(character.startTime), endMs = Number(character.endTime);
    if (!value.trim()) continue;
    const index = text.indexOf(value.trim(), cursor);
    if (index < 0 || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    const end = index + value.trim().length;
    result.push({ start: index, end, startMs, endMs }); cursor = end;
  }
  return result;
}

const CLOCK_LIMIT_MS = 1800;

export function playbackWithLiveClock(playback, clock) {
  if (!playback || !clock || String(clock.trackId) !== String(playback.trackId) ||
      !Number.isFinite(clock.positionMs) || !Number.isFinite(clock.sampledAt) || clock.sampledAt <= 0 ||
      clock.sampledAt < (playback.clock?.sampledAt ?? playback.updatedAt ?? 0)) return playback;
  return { ...playback, isPlaying: clock.isPlaying ?? playback.isPlaying, clock };
}

function samplePlayback(playback, now) {
  const clock = playback.clock;
  const position = Number(clock?.positionMs ?? Number(playback.currentTime || 0) * 1000);
  const rate = Math.max(.1, Number(clock?.playbackRate ?? playback.playbackRate ?? 1) || 1);
  const advancing = !!(clock?.isPlaying ?? playback.isPlaying) && (clock?.isAdvancing ?? true);
  const duration = Number(clock?.durationMs ?? Number(playback.duration || 0) * 1000);
  const age = Math.max(0, now - Number(clock?.sampledAt ?? playback.updatedAt ?? now));
  // Freeze stale samples instead of running ahead indefinitely after sleep/disconnect.
  const time = Math.max(0, position + (advancing ? Math.min(CLOCK_LIMIT_MS, age) * rate : 0));
  return { time: duration > 0 ? Math.min(time, duration) : time, rate, advancing, duration,
    advanceLimitMs: Math.max(0, CLOCK_LIMIT_MS - age) };
}

const lyricOffset = (snapshot, config) => Number(snapshot.lyric?.timeOffset || 0) + config.offsetMs;

function lineTiming(snapshot, lines, index, config, now, timelineMs, sample) {
  const line = lines[index], p = snapshot.playback;
  const next = lines[index + 1];
  const lastCharacterEnd = Math.max(0, ...line.originalTiming.map(x => x.endMs));
  const endMs = lastCharacterEnd > line.startMs ? lastCharacterEnd : next?.startMs ?? Math.max(line.startMs + 1000, Number(p.duration || 0) * 1000);
  const originalFirst = config.displayMode !== 'translation' || !line.translation;
  const bilingual = ['bilingual', 'bilingualInline'].includes(config.displayMode) && !!line.translation;
  return {
    timelineMs, sampledAt: now, startMs: line.startMs, endMs,
    advancing: sample.advancing, rate: sample.rate, advanceLimitMs: sample.advanceLimitMs,
    primary: originalFirst ? line.originalTiming : line.translationTiming,
    secondary: bilingual ? line.translationTiming : [],
  };
}

export function estimatedPlaybackMs(playback, now = Date.now()) {
  return playback ? samplePlayback(playback, now).time : 0;
}

export function findLineIndex(lines, timeMs) {
  let low = 0, high = lines.length - 1, result = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].startMs <= timeMs) { result = mid; low = mid + 1; } else high = mid - 1;
  }
  return result;
}

export function nextDisplayDelay(snapshot, lines, config, now, pausedAt, filterPending) {
  const playback = snapshot.playback;
  if (!playback) return null;
  if (!playback.isPlaying && pausedAt != null && config.pauseBehavior !== 'keep') {
    const delay = pausedAt + config.pauseDelay * 1000 - now;
    return delay > 0 ? delay : null;
  }
  if (filterPending || !lines.length) return null;
  const sample = samplePlayback(playback, now);
  if (!sample.advancing) return null;
  const offset = lyricOffset(snapshot, config);
  const timeline = sample.time + offset;
  const next = lines[findLineIndex(lines, timeline) + 1];
  if (!next || (sample.duration > 0 && next.startMs - offset > sample.duration)) return null;
  const delay = (next.startMs - timeline) / sample.rate;
  return delay > 0 && delay <= sample.advanceLimitMs ? delay : null;
}

export function displayState(snapshot, lines, hidden, config, now = Date.now(), lastVisible = null, pausedAt = null, filterPending = false) {
  const p = snapshot?.playback;
  const trackId = String(p?.trackId ?? '');
  const base = { trackId, title: String(p?.title ?? ''), artist: String(p?.artist ?? ''),
    hasTrack: !!p?.trackId, isPlaying: !!p?.isPlaying, isFavorite: !!p?.isFavorite,
    playMode: ['sequential', 'list', 'random', 'single'].includes(p?.playMode) ? p.playMode : 'list', appearanceDark: !!snapshot?.appearance?.isDark,
    coverColor: /^#[\da-f]{6}$/i.test(snapshot?.appearance?.coverColor || '') ? snapshot.appearance.coverColor : null,
    coverColorPending: !!snapshot?.appearance?.coverColorPending, filterPending: !!filterPending,
    primary: '', secondary: '', original: '', translation: '', reason: 'empty', hidden: false, dimmed: false };
  if (!p) return { ...base, primary: 'EchoMusic', reason: 'empty' };
  const sample = samplePlayback(p, now), timeline = sample.time + lyricOffset(snapshot, config);
  const index = findLineIndex(lines, timeline);
  const line = index >= 0 ? lines[index] : null;
  if (filterPending) {
    base.reason = 'filtering';
    if (config.idleBehavior === 'hide') base.hidden = true;
    else base.primary = [base.title, base.artist].filter(Boolean).join(' · ');
  } else if (line && !hidden[index] && line.original) {
    base.original = line.original; base.translation = line.translation; base.reason = 'lyric';
    if (config.displayMode === 'translation') base.primary = line.translation || line.original;
    else if (config.displayMode === 'bilingual') { base.primary = line.original; base.secondary = line.translation; }
    else if (config.displayMode === 'bilingualInline') base.primary = [line.original, line.translation].filter(Boolean).join(INLINE_BILINGUAL_SEPARATOR);
    else base.primary = line.original;
    base.timing = lineTiming(snapshot, lines, index, config, now, timeline, sample);
  } else {
    base.reason = snapshot.lyric?.isLoading ? 'loading' : hidden[index] ? 'filtered' : lines.length ? 'interlude' : 'noLyrics';
    if (config.idleBehavior === 'hold' && lastVisible?.trackId === trackId) {
      base.primary = lastVisible.primary; base.secondary = lastVisible.secondary;
      base.original = lastVisible.original; base.translation = lastVisible.translation;
    } else if (config.idleBehavior === 'hide') base.hidden = true;
    else base.primary = [base.title, base.artist].filter(Boolean).join(' · ');
  }
  if (!p.isPlaying && pausedAt != null && now - pausedAt >= config.pauseDelay * 1000) {
    if (config.pauseBehavior === 'hide') base.hidden = true;
    if (config.pauseBehavior === 'dim') base.dimmed = true;
  }
  if (config.colorMode === 'cover' && base.coverColorPending && !base.coverColor) base.hidden = true;
  return base;
}
