import { DEFAULTS, CoverColorState, sanitizeConfig, validateFilters, normalizeLines, playbackWithLiveClock, displayState, nextDisplayDelay } from './core.js';
import { FilterRunner } from './filters.js';
import { registerSettings } from './settings.js';

export function createSession(ctx) {
  let config = sanitizeConfig(), snapshot = {}, lines = [], hidden = [], signature = '';
  let lastVisible = null, pausedAt = null, lastPlaying = null, disposed = false, helperPid = 0;
  let server = null, filterGeneration = 0, filterPending = false, currentState = null, status = '正在初始化…', launching = false;
  let launchGeneration = 0, configureQueue = Promise.resolve();
  let displayTimer = null;
  const playerStore = ctx.player?.store;
  const coverColors = new CoverColorState();
  let coverTimer = null, coverExpiresAt = 0;
  const clients = new Set(), nativeClients = new Set(), listeners = new Set(), timers = [], actionTimers = new Set(), cleanups = [];
  const filter = new FilterRunner(), previewFilter = new FilterRunner();
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(24)), x => x.toString(16).padStart(2, '0')).join('');
  const protocol = 'echo-lyrics.' + secret;
  const notify = () => listeners.forEach(fn => fn());
  const setStatus = text => { status = text; notify(); };
  const send = (socket, message) => Promise.resolve(socket.send(JSON.stringify(message))).catch(() => { clients.delete(socket); });
  const broadcast = message => { if (!disposed) clients.forEach(socket => void send(socket, message)); };
  const emit = () => {
    if (disposed) return;
    const playMode = ctx.player?.playMode?.value ?? snapshot.playback?.playMode;
    const theme = ctx.stores?.theme;
    const now = Date.now();
    const playback = playbackWithLiveClock(snapshot.playback, playerStore?.playbackClock);
    if (playback?.isPlaying !== lastPlaying) {
      pausedAt = playback?.isPlaying === false ? now : null;
      lastPlaying = playback?.isPlaying;
    }
    const cover = coverColors.resolve({ trackId: snapshot.playback?.trackId, coverUrl: snapshot.playback?.coverUrl,
      color: theme?.coverColor ?? snapshot.appearance?.coverColor, ready: theme ? theme.coverColorReady : !!snapshot.appearance?.coverColor }, now);
    if (cover.expiresAt !== coverExpiresAt) {
      clearTimeout(coverTimer); coverExpiresAt = cover.expiresAt;
      coverTimer = cover.expiresAt ? setTimeout(emit, Math.max(1, cover.expiresAt - now)) : null;
    }
    const displaySnapshot = { ...snapshot, appearance: { ...snapshot.appearance, coverColor: cover.color, coverColorPending: cover.pending }, playback: playback ? { ...playback, playMode } : null };
    const state = displayState(displaySnapshot, lines, hidden, config, now, lastVisible, pausedAt, filterPending);
    if (state.reason === 'lyric') lastVisible = state;
    const text = JSON.stringify(state);
    if (text !== currentState) { currentState = text; broadcast({ type: 'state', state }); notify(); }
    // Wake at the next lyric boundary, and replace the timer whenever the clock or settings change.
    clearTimeout(displayTimer);
    const delay = nextDisplayDelay(displaySnapshot, lines, config, now, pausedAt, filterPending);
    displayTimer = delay == null ? null : setTimeout(emit, Math.max(1, Math.ceil(delay - (Date.now() - now))));
  };
  const refilter = async () => {
    const generation = ++filterGeneration;
    filterPending = true;
    hidden = lines.map(() => false);
    try {
      const results = await filter.run(lines, config);
      if (!disposed && generation === filterGeneration) { hidden = results; filterPending = false; emit(); }
    } catch (error) {
      if (error.name === 'AbortError' || disposed || generation !== filterGeneration) return;
      // Safe built-in rules remain usable if a custom expression exceeds its budget.
      let fallback;
      try { fallback = await filter.run(lines, { ...config, customFilters: [] }); } catch { fallback = lines.map(() => false); }
      if (disposed || generation !== filterGeneration) return;
      hidden = fallback; filterPending = false; setStatus(error.message); emit();
    }
  };
  const receiveSnapshot = value => {
    if (disposed || !value) return;
    const previousTrack = snapshot.playback?.trackId;
    const previousLyric = snapshot.lyric;
    snapshot = { ...snapshot, ...value };
    if (value.lyric) {
      const changedTrack = String(value.lyric.trackId) !== String(previousLyric?.trackId);
      snapshot.lyric = { ...(changedTrack ? {} : previousLyric), ...value.lyric };
    }
    const p = snapshot.playback;
    if (p?.trackId !== previousTrack) { lastVisible = null; pausedAt = null; lastPlaying = null; }
    const l = snapshot.lyric;
    const nextSignature = [p?.trackId, l?.trackId, l?.revision ?? JSON.stringify(l?.lines ?? [])].join('|');
    if (signature !== nextSignature) { signature = nextSignature; lines = normalizeLines(snapshot); void refilter(); }
    emit();
  };
  const configure = patch => {
    const operation = configureQueue.catch(() => {}).then(async () => {
      if (disposed) throw new Error('插件已停用');
      if (patch.customFilters) {
        const errors = validateFilters(patch.customFilters);
        if (errors.length) throw new Error(errors.join('\n'));
      }
      const next = sanitizeConfig({ ...config, ...patch });
      const errors = validateFilters(next.customFilters);
      if (errors.length) throw new Error(errors.join('\n'));
      await ctx.storage.set('settings', next);
      const filtersChanged = JSON.stringify([config.filterCredits, config.customFilters]) !== JSON.stringify([next.filterCredits, next.customFilters]);
      config = next;
      broadcast({ type: 'config', config }); notify();
      if (filtersChanged) await refilter();
      emit(); return config;
    });
    configureQueue = operation; return operation;
  };
  const launch = async (showSettings = false) => {
    if (launching || disposed || !server) return;
    launching = true; const generation = ++launchGeneration;
    try {
      if (helperPid) { await ctx.process.terminate(helperPid); helperPid = 0; }
      setStatus('等待启动菜单栏组件；首次启动会出现 EchoMusic 原生程序授权提示。');
      const result = await ctx.process.launch({
        executable: 'bin/EchoMenuLyrics.app/Contents/MacOS/EchoMenuLyrics',
        args: showSettings ? ['--settings'] : [], env: { ECHO_LYRICS_ENDPOINT: server.origin.replace(/^http/, 'ws') + '/live', ECHO_LYRICS_PROTOCOL: protocol },
      });
      if (disposed || generation !== launchGeneration) { if (result.ok) await ctx.process.terminate(result.pid); return; }
      if (result.ok) { helperPid = result.pid; setStatus(nativeClients.size ? '菜单栏组件已连接' : '组件已启动，正在连接…'); }
      else setStatus(result.canceled ? '启动授权已取消，可点击启动按钮重试。' : result.error || '菜单栏组件启动失败');
    } catch (error) { setStatus(error.message); } finally { launching = false; }
  };
  const handleMessage = async (socket, raw) => {
    if (typeof raw !== 'string' || raw.length > 65536 || disposed) return;
    let message; try { message = JSON.parse(raw); } catch { return; }
    try {
      if (message.type === 'hello') {
        if (message.role === 'native') { nativeClients.add(socket); setStatus('菜单栏组件已连接'); }
      } else if (message.type === 'nativeAction') {
        if (!['showSettings', 'restart'].includes(message.action)) throw new Error('未知界面操作');
        if (message.action === 'restart') await launch();
        else if (!nativeClients.size) await launch(true);
        else nativeClients.forEach(client => void send(client, { type: 'nativeAction', action: message.action }));
      } else if (message.type === 'preview') {
        const result = await session.preview((message.patterns || []).join('\n'));
        await send(socket, { type: 'preview', lines: result, id: message.id });
      } else if (message.type === 'reset') {
        await configure({ ...DEFAULTS }); await send(socket, { type: 'ack', id: message.id, ok: true });
      } else if (message.type === 'configure') {
        await configure(message.patch); await send(socket, { type: 'ack', id: message.id, ok: true });
      } else if (message.type === 'command') {
        if (!['togglePlayMode', 'togglePlayback', 'previousTrack', 'nextTrack', 'toggleFavorite'].includes(message.command)) throw new Error('未知播放命令');
        if (!snapshot.playback?.trackId || String(message.trackId) !== String(snapshot.playback.trackId)) throw new Error('歌曲已经切换，请重试');
        const accepted = await ctx.nowPlaying.command(message.command);
        if (accepted === false) throw new Error('播放器未接受操作，请重试');
        // This acknowledges dispatch, not a successful favorite mutation; state comes from the host snapshot.
        await send(socket, { type: 'ack', id: message.id, ok: true, dispatched: true });
        const timer = setTimeout(async () => {
          actionTimers.delete(timer);
          try { if (!disposed) receiveSnapshot(await ctx.nowPlaying.getSnapshot()); } catch {}
        }, 200);
        actionTimers.add(timer);
      }
    } catch (error) { await send(socket, { type: 'ack', id: message.id, ok: false, error: error.message }); }
  };
  const session = {
    get config() { return config; }, get status() { return status; }, get state() { return currentState ? JSON.parse(currentState) : null; }, configure, launch,
    get settingsURL() { return server?.ok ? server.origin + '/settings/#' + protocol : null; },
    openSettings() { if (!nativeClients.size) return launch(true); nativeClients.forEach(client => void send(client, { type: 'nativeAction', action: 'showSettings' })); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async preview(text) {
      const patterns = text.split('\n').map(x => x.trim()).filter(Boolean);
      const errors = validateFilters(patterns); if (errors.length) throw new Error(errors.join('\n'));
      const sample = lines.slice();
      const result = await previewFilter.run(sample, sanitizeConfig({ ...config, customFilters: patterns }));
      return sample.map((line, i) => ({ ...line, hidden: result[i] }));
    },
    async start() {
      if (ctx.electron.platform !== 'darwin') { setStatus('本插件仅支持 macOS。'); return; }
      if (!ctx.webServer?.onConnection || !ctx.process?.launch || !ctx.nowPlaying?.getSnapshot) throw new Error('当前 EchoMusic 缺少必要接口，请升级至 2.3.2 或更新版本。');
      config = sanitizeConfig(await ctx.storage.get('settings')); notify();
      const errors = validateFilters(config.customFilters);
      if (errors.length) { config.customFilters = []; setStatus('旧过滤规则无效，已临时停用自定义过滤。'); }
      server = await ctx.webServer.listen({
        path: '/live', onRequest: request => request.path === '/settings/' || request.path === '/settings'
          ? { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
            body: typeof SETTINGS_PAGE_HTML === 'string' ? SETTINGS_PAGE_HTML : '<!doctype html><title>Build required</title>' }
          : { status: 404, body: 'Not found' },
        onUpgrade: request => request.protocols?.includes(protocol) ? { accept: true, protocol } : false,
        onConnection(socket) {
          if (disposed) { socket.close(); return; }
          clients.add(socket);
          void send(socket, { type: 'config', config });
          if (currentState) void send(socket, { type: 'state', state: JSON.parse(currentState) });
          socket.onMessage(event => { void handleMessage(socket, event.data); });
          socket.onClose(() => { clients.delete(socket); nativeClients.delete(socket); if (!disposed && !nativeClients.size) setStatus('菜单栏组件已断开，可从设置中重新启动。'); });
          return () => { clients.delete(socket); nativeClients.delete(socket); };
        },
      });
      if (!server.ok) throw new Error(server.error || '本机歌词服务启动失败');
      notify();
      cleanups.push(ctx.nowPlaying.onSnapshot(receiveSnapshot));
      if (playerStore && 'playbackClock' in playerStore && ctx.vue?.watch) cleanups.push(ctx.vue.watch(() => playerStore.playbackClock, emit));
      if (ctx.player?.playMode && ctx.vue?.watch) cleanups.push(ctx.vue.watch(ctx.player.playMode, emit));
      if (ctx.stores?.theme && ctx.vue?.watch) cleanups.push(ctx.vue.watch(() => [ctx.stores.theme.coverColor, ctx.stores.theme.coverColorReady], emit));
      receiveSnapshot(await ctx.nowPlaying.getSnapshot());
      timers.push(setInterval(() => broadcast({ type: 'heartbeat' }), 3000));
      timers.push(setInterval(async () => { try { if (!disposed) receiveSnapshot(await ctx.nowPlaying.getSnapshot()); } catch {} }, 3000));
      await launch();
    },
    async dispose() {
      if (disposed) return; disposed = true; ++launchGeneration; ++filterGeneration;
      clearTimeout(displayTimer);
      clearTimeout(coverTimer);
      timers.forEach(clearInterval); actionTimers.forEach(clearTimeout); actionTimers.clear(); cleanups.forEach(fn => fn?.());
      filter.dispose(); previewFilter.dispose(); listeners.clear();
      for (const socket of clients) { try { await socket.close(); } catch {} } clients.clear(); nativeClients.clear();
      if (helperPid) { try { await ctx.process.terminate(helperPid); } catch {} helperPid = 0; }
      try { await ctx.webServer.close(); } catch {}
    },
  };
  return session;
}

let activeSession;
export async function activate(ctx) {
  const session = createSession(ctx); activeSession = session;
  registerSettings(ctx, session);
  ctx.dispose(() => session.dispose());
  try { await session.start(); } catch (error) { ctx.toast.warning(`菜单栏歌词：${error.message}`); await session.dispose(); }
}
export async function deactivate() { const session = activeSession; activeSession = null; await session?.dispose(); }
