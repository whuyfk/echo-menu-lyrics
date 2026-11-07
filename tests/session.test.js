import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../plugin/src/index.js';
import { BrowserWorker } from './worker-adapter.js';
globalThis.Worker = BrowserWorker;

function fixture(overrides = {}) {
  const snapshot = { playback: { trackId: 'one', title: 'Song', isPlaying: false }, lyric: { trackId: 'one', lines: [{ time: 0, text: 'hello', translated: '你好' }], revision: 1 } };
  const data = { commands: [], saved: [], terminated: [], options: null, subscriber: null, closed: 0 };
  const ctx = {
    electron: { platform: 'darwin' }, storage: { get: async () => null, set: async (key, value) => data.saved.push(structuredClone(value)) },
    nowPlaying: { getSnapshot: async () => snapshot, onSnapshot: fn => { data.subscriber = fn; return () => { data.subscriber = null; }; }, command: value => data.commands.push(value) },
    webServer: { onConnection() {}, listen: async options => { data.options = options; return { ok: true, origin: 'http://127.0.0.1:12345' }; }, close: async () => { data.closed++; } },
    process: { launch: async options => { data.launchOptions = options; return { ok: true, pid: 123 }; }, terminate: async pid => data.terminated.push(pid), ...overrides },
  };
  const socket = { messages: [], send(text) { this.messages.push(JSON.parse(text)); }, onMessage(fn) { this.receive = fn; }, onClose(fn) { this.closeHandler = fn; }, close() { this.closeHandler?.(); } };
  return { ctx, data, socket, snapshot };
}
const turn = () => new Promise(resolve => setTimeout(resolve, 25));

test('session authenticates connections, rejects stale commands, and cleans up', async () => {
  const { ctx, data, socket } = fixture(); const session = createSession(ctx);
  try {
    await session.start();
    assert.equal(data.options.onUpgrade({ protocols: ['other'] }), false);
    const protocol = data.launchOptions.env.ECHO_LYRICS_PROTOCOL;
    assert.equal(data.options.onUpgrade({ protocols: [protocol] }).accept, true);
    data.options.onConnection(socket);
    socket.receive({ data: JSON.stringify({ type: 'command', command: 'toggleFavorite', trackId: 'old', id: '1' }) });
    await turn(); assert.equal(data.commands.length, 0); assert.equal(socket.messages.find(x => x.type === 'ack' && x.id === '1').ok, false);
    socket.receive({ data: JSON.stringify({ type: 'command', command: 'togglePlayback', trackId: 'one', id: '2' }) });
    await turn(); assert.deepEqual(data.commands, ['togglePlayback']);
    socket.receive({ data: JSON.stringify({ type: 'command', command: 'arbitrary', trackId: 'one', id: '3' }) });
    await turn(); assert.equal(data.commands.length, 1);
  } finally { await session.dispose(); }
  assert.deepEqual(data.terminated, [123]); assert.equal(data.closed, 1); assert.equal(data.subscriber, null);
});
test('both settings entrances share the same page and settings clients cannot impersonate native status', async () => {
  const { ctx, data, socket } = fixture(); const session = createSession(ctx);
  try {
    await session.start();
    assert.match(session.settingsURL, /^http:\/\/127\.0\.0\.1:12345\/settings\/#echo-lyrics\./);
    assert.equal(data.options.onRequest({ path: '/settings/' }).headers['cache-control'], 'no-store');
    assert.equal(data.options.onRequest({ path: '/other' }).status, 404);
    data.options.onConnection(socket);
    socket.receive({ data: JSON.stringify({ type: 'hello', role: 'settings' }) });
    socket.receive({ data: JSON.stringify({ type: 'nativeStatus', text: 'spoofed' }) });
    await turn(); assert.notEqual(session.status, 'spoofed');
    socket.receive({ data: JSON.stringify({ type: 'preview', patterns: [], id: 'preview' }) });
    await turn();
    assert.equal(socket.messages.find(x => x.type === 'preview')?.lines[0].translation, '你好');
  } finally { await session.dispose(); }
});
test('all five controls dispatch, play mode follows the player, and rejected commands fail', async () => {
  const { ctx, data, socket } = fixture();
  let onModeChange, stopped = false;
  ctx.player = { playMode: { value: 'single' } };
  ctx.vue = { watch: (source, callback) => { onModeChange = callback; return () => { stopped = true; }; } };
  const session = createSession(ctx);
  try {
    await session.start(); data.options.onConnection(socket);
    assert.equal(session.state.playMode, 'single');
    ctx.player.playMode.value = 'random'; onModeChange();
    assert.equal(session.state.playMode, 'random');
    const commands = ['togglePlayMode', 'previousTrack', 'togglePlayback', 'nextTrack', 'toggleFavorite'];
    for (const command of commands) {
      socket.receive({ data: JSON.stringify({ type: 'command', command, trackId: 'one', id: command }) });
      await turn();
      assert.equal(socket.messages.find(x => x.id === command)?.ok, true);
    }
    assert.deepEqual(data.commands, commands);
    ctx.nowPlaying.command = async () => false;
    socket.receive({ data: JSON.stringify({ type: 'command', command: 'togglePlayMode', trackId: 'one', id: 'rejected' }) });
    await turn(); assert.equal(socket.messages.find(x => x.id === 'rejected')?.ok, false);
    ctx.nowPlaying.command = async () => { throw new Error('dispatch failed'); };
    socket.receive({ data: JSON.stringify({ type: 'command', command: 'toggleFavorite', trackId: 'one', id: 'failed' }) });
    await turn(); assert.equal(socket.messages.find(x => x.id === 'failed')?.error, 'dispatch failed');
  } finally { await session.dispose(); }
  assert.equal(stopped, true);
});
test('configuration updates are serialized and invalid regex is never persisted', async () => {
  const { ctx, data } = fixture(); const session = createSession(ctx);
  try {
    await session.start();
    await Promise.all([session.configure({ maxWidth: 340 }), session.configure({ displayMode: 'bilingual' })]);
    assert.equal(session.config.maxWidth, 340); assert.equal(session.config.displayMode, 'bilingual');
    await assert.rejects(session.configure({ customFilters: ['['] })); assert.equal(data.saved.length, 2);
    await session.configure({ fontSize: 15 }); assert.equal(session.config.fontSize, 15);
  } finally { await session.dispose(); }
});
test('host cover extraction streams independently of the theme accent and unsubscribes', async () => {
  const { ctx, data, snapshot } = fixture();
  snapshot.appearance = { accentColor: '#ff0000' };
  ctx.stores = { theme: { coverColor: '#123456', coverColorReady: true } };
  let colorChanged, stopped = false;
  ctx.vue = { watch: (getter, callback) => { colorChanged = callback; return () => { stopped = true; }; } };
  const session = createSession(ctx);
  try {
    await session.start(); assert.equal(session.state.coverColor, '#123456');
    ctx.stores.theme.coverColorReady = false; colorChanged();
    assert.equal(session.state.coverColor, '#123456');
    ctx.stores.theme.coverColor = '#abcdef'; ctx.stores.theme.coverColorReady = true; colorChanged();
    assert.equal(session.state.coverColor, '#abcdef');
    await session.configure({ colorMode: 'cover' });
    assert.equal(data.saved.at(-1).colorMode, 'cover');
    assert.equal(snapshot.appearance.accentColor, '#ff0000');
  } finally { await session.dispose(); }
  assert.equal(stopped, true);
});
test('disabling while the host launch dialog is pending terminates any late-started helper', async () => {
  let complete;
  const { ctx, data } = fixture({ launch: () => new Promise(resolve => { complete = resolve; }) });
  const session = createSession(ctx); const start = session.start();
  await turn(); await session.dispose(); complete({ ok: true, pid: 456 }); await start;
  assert.deepEqual(data.terminated, [456]); assert.equal(data.closed, 1);
});
