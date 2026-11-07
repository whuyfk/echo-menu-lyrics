import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoverColorState, sanitizeConfig, validateFilters, evaluateFilters, normalizeLines, normalizeCharacterTiming, estimatedPlaybackMs, findLineIndex, displayState } from '../plugin/src/core.js';

const config = sanitizeConfig();
const snapshot = {
  playback: { trackId: 'one', lyricHash: 'hash-one', title: 'Song', artist: 'Artist', currentTime: 0, updatedAt: 1000, isPlaying: true, playbackRate: 1, duration: 10 },
  lyric: { trackId: 'hash-one', timeOffset: 0, lines: [
    { time: 0, text: '吉他：Someone', translated: 'Guitar: Someone' },
    { time: 2, text: 'Time: to sing', translated: '是时候唱歌了' },
    { time: 5, text: 'A real lyric', translated: '真正的歌词' },
  ] },
};

test('invalid persisted configuration is normalized, not blindly trusted', () => {
  assert.equal(sanitizeConfig(null).displayMode, 'translation');
  const value = sanitizeConfig({ maxWidth: 9999, fontSize: NaN, placement: 'center', opacity: 0, originalColor: 'red', customFilters: [null, '', '^Bass:'] });
  assert.equal(value.maxWidth, 800); assert.equal(value.fontSize, 13); assert.equal(value.placement, 'right');
  assert.equal(value.opacity, .2); assert.equal(value.originalColor, '#FFFFFF'); assert.deepEqual(value.customFilters, ['^Bass:']);
});
test('display selection and desktop selection remain independent', () => {
  const value = sanitizeConfig({ screenMode: 'primary', spaceMode: 'all' });
  assert.equal(value.screenMode, 'primary'); assert.equal(value.spaceMode, 'all');
  assert.equal(sanitizeConfig({ screenMode: 'all', spaceMode: 'current' }).spaceMode, 'current');
  assert.equal(sanitizeConfig({ spaceMode: 'invalid' }).spaceMode, 'current');
});
test('color mode migrates old settings without losing custom colors', () => {
  assert.equal(sanitizeConfig({ automaticColor: false, originalColor: '#123456' }).colorMode, 'custom');
  const value = sanitizeConfig({ colorMode: 'cover', automaticColor: true, originalColor: '#123456' });
  assert.equal(value.colorMode, 'cover'); assert.equal(value.automaticColor, false); assert.equal(value.originalColor, '#123456');
  assert.equal(sanitizeConfig({ colorMode: 'invalid' }).colorMode, 'system');
  assert.equal(sanitizeConfig({ colorMode: 'system', automaticColor: false }).automaticColor, true);
});
test('cover color comes from cover data and is cleared when unavailable', () => {
  const withAppearance = appearance => displayState({ ...snapshot, appearance }, [], [], config);
  assert.equal(withAppearance({ coverColor: '#12ABef', accentColor: '#ff0000' }).coverColor, '#12ABef');
  assert.equal(withAppearance({ accentColor: '#ff0000' }).coverColor, null);
  assert.equal(withAppearance({ coverColor: 'invalid' }).coverColor, null);
  assert.equal(withAppearance({ coverColor: null }).coverColor, null);
});
test('cover extraction keeps colors through track changes and revisits without a system-color frame', () => {
  const colors = new CoverColorState();
  const sample = (trackId, ready, color, now) => colors.resolve({ trackId, coverUrl: 'cover-'+trackId, ready, color }, now);
  assert.equal(sample('one', true, '#123456', 0).color, '#123456');
  assert.equal(sample('one', false, null, 10).color, '#123456');
  const waiting = sample('two', false, null, 100);
  assert.equal(waiting.color, '#123456'); assert.equal(waiting.pending, true);
  assert.equal(sample('two', true, '#abcdef', 350).color, '#abcdef');
  const revisit = sample('one', false, null, 500);
  assert.equal(revisit.color, '#123456'); assert.equal(revisit.expiresAt, 0);
  assert.equal(sample('one', false, null, 5000).color, '#123456');
});
test('first cover waits briefly without showing black text; missing artwork falls back after the deadline', () => {
  const colors = new CoverColorState(2000);
  const sample = now => colors.resolve({ trackId: 'one', ready: false }, now);
  assert.deepEqual(sample(100), { color: null, pending: true, expiresAt: 2100 });
  assert.equal(sample(2099).pending, true);
  assert.deepEqual(sample(2100), { color: null, pending: false, expiresAt: 0 });
  const appearance = { coverColor: null, coverColorPending: true };
  assert.equal(displayState({ ...snapshot, appearance }, [], [], { ...config, colorMode: 'cover' }).hidden, true);
  assert.equal(displayState({ ...snapshot, appearance }, [], [], { ...config, colorMode: 'system' }).hidden, false);
  assert.equal(displayState({ ...snapshot, appearance: { coverColorPending: false } }, [], [], { ...config, colorMode: 'cover' }).hidden, false);
});
test('host line seconds and per-character milliseconds both normalize correctly', () => {
  const lines = normalizeLines(snapshot); assert.deepEqual(lines.map(x => x.startMs), [0, 2000, 5000]);
  const s = structuredClone(snapshot); s.lyric.lines = [{ time: 1, text: 'one', characters: [{ startTime: 1250 }] }];
  assert.equal(normalizeLines(s)[0].startMs, 1250);
});
test('character highlight timing preserves UTF-16 ranges, trimmed whitespace, and paired translation timing', () => {
  const spans = normalizeCharacterTiming('你好 🌙', [{ text: '你好 ', startTime: 1000, endTime: 2000 }, { text: '🌙', startTime: 2000, endTime: 3000 }]);
  assert.deepEqual(spans.map(x => [x.start, x.end]), [[0, 2], [3, 5]]);
  const s = structuredClone(snapshot);
  s.playback = { ...s.playback, currentTime: 1.5, updatedAt: 1000, isPlaying: false };
  s.lyric.lines = [{ time: 1, text: 'hello', translated: '你好', characters: [{ text: 'hello', startTime: 1000, endTime: 3000 }], translatedCharacters: [{ text: '你好', startTime: 1100, endTime: 2800 }] }];
  const state = displayState(s, normalizeLines(s), [], { ...config, displayMode: 'bilingual' }, 2000);
  assert.equal(state.timing.timelineMs, 1500); assert.equal(state.timing.endMs, 3000);
  assert.equal(state.timing.primary[0].end, 5); assert.equal(state.timing.secondary[0].end, 2);
  assert.equal(state.timing.advancing, false);
});
test('line-only lyrics start unpainted and advance proportionally instead of arriving fully colored', () => {
  const s = structuredClone(snapshot); s.playback.isPlaying = false;
  const lines = normalizeLines(s);
  s.playback.currentTime = 2;
  let state = displayState(s, lines, [], config, 1000);
  assert.equal(state.timing.startMs, 2000); assert.equal(state.timing.endMs, 5000); assert.equal(state.timing.timelineMs, 2000);
  s.playback.currentTime = 3.5;
  state = displayState(s, lines, [], config, 1000);
  assert.equal((state.timing.timelineMs-state.timing.startMs)/(state.timing.endMs-state.timing.startMs), .5);
  assert.deepEqual(state.timing.primary, []);
});
test('stale lyrics from another track are rejected, including hash-vs-track-id mapping', () => {
  assert.equal(normalizeLines(snapshot).length, 3);
  assert.deepEqual(normalizeLines({ ...snapshot, playback: { ...snapshot.playback, trackId: 'two', lyricHash: 'hash-two' } }), []);
});
test('filtering hides paired translations without removing timestamps or early advancing', () => {
  const lines = normalizeLines(snapshot); const hidden = evaluateFilters(lines, config);
  assert.deepEqual(hidden, [true, false, false]);
  const at = time => displayState({ ...snapshot, playback: { ...snapshot.playback, isPlaying: false, currentTime: time } }, lines, hidden, config, 1000);
  assert.equal(at(1).reason, 'filtered'); assert.equal(at(1).primary, 'Song · Artist');
  assert.equal(at(2).primary, '是时候唱歌了'); assert.equal(at(5).primary, '真正的歌词');
});
test('plain colons in lyrics are not treated as credits', () => {
  assert.deepEqual(evaluateFilters([{ original: 'You said: hello', translation: '' }], config), [false]);
  assert.deepEqual(evaluateFilters([{ original: 'Bass: Someone', translation: '' }], config), [true]);
});
test('regex validation and translation matching', () => {
  assert.equal(validateFilters(['[']).length, 1); assert.deepEqual(validateFilters(['/hello/i', '^吉他']), []);
  assert.equal(validateFilters(['/hello/g']).length, 1);
  assert.equal(validateFilters(['a'.repeat(501)]).length, 1);
  assert.deepEqual(evaluateFilters([{ original: 'hello', translation: '再见' }], { ...config, customFilters: ['^再见$'] }), [true]);
});
test('clock respects pause, buffering, speed, duration and stale-sample limits', () => {
  const p = snapshot.playback;
  assert.equal(estimatedPlaybackMs({ ...p, playbackRate: 2 }, 1500), 1000);
  assert.equal(estimatedPlaybackMs({ ...p, isPlaying: false }, 1500), 0);
  assert.equal(estimatedPlaybackMs(p, 60000), 1800);
  assert.equal(estimatedPlaybackMs({ ...p, clock: { positionMs: 1000, sampledAt: 1000, isPlaying: true, isAdvancing: false } }, 2000), 1000);
  assert.equal(estimatedPlaybackMs({ ...p, currentTime: 9.9 }, 2000), 10000);
});
test('last duplicate timestamp wins and pre-roll has no future line', () => {
  const lines = [{ startMs: 1000 }, { startMs: 1000 }, { startMs: 2000 }];
  assert.equal(findLineIndex(lines, 999), -1); assert.equal(findLineIndex(lines, 1000), 1);
});
test('translation fallback and bilingual display do not alter host settings', () => {
  const lines = normalizeLines(snapshot), hidden = [false, false, false];
  const p = { ...snapshot, playback: { ...snapshot.playback, isPlaying: false, currentTime: 5 } };
  const state = displayState(p, lines, hidden, { ...config, displayMode: 'bilingual' }, 1000);
  assert.equal(state.primary, 'A real lyric'); assert.equal(state.secondary, '真正的歌词');
  lines[2].translation = ''; assert.equal(displayState(p, lines, hidden, config, 1000).primary, 'A real lyric');
  assert.equal(p.lyric.wantTranslation, undefined);
});
test('offset layers once, pause timeout works, previous track is never held', () => {
  const lines = normalizeLines(snapshot);
  const p = { ...snapshot, playback: { ...snapshot.playback, isPlaying: false, currentTime: 1 }, lyric: { ...snapshot.lyric, timeOffset: 500 } };
  assert.equal(displayState(p, lines, [], { ...config, offsetMs: 500 }, 1000).primary, '是时候唱歌了');
  assert.equal(displayState(p, lines, [], { ...config, pauseBehavior: 'hide', pauseDelay: 1 }, 3000, null, 1000).hidden, true);
  const held = displayState(p, lines, [true], { ...config, idleBehavior: 'hold' }, 1000, { trackId: 'two', primary: 'WRONG' });
  assert.notEqual(held.primary, 'WRONG');
});
