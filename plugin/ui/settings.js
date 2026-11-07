(() => {
  const $ = selector => document.querySelector(selector);
  let socket, config = {}, state = {}, sequence = 0, reconnect, filterDirty = false;
  const pendingFilters = new Set();
  const modeSvg = body => '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">'+body+'</svg>';
  const modeStroke = ' fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"';
  const repeatBody = '<path d="M4 10V9a3 3 0 0 1 3-3h11M20 14v1a3 3 0 0 1-3 3H6"'+modeStroke+'/><path d="m15 2 6 4-6 4V2ZM9 14l-6 4 6 4v-8Z" fill="currentColor"/>';
  const modeIcons = {
    sequential: modeSvg('<path d="M4 12h13"'+modeStroke+'/><path d="m13 5 8 7-8 7V5Z" fill="currentColor"/>'),
    list: modeSvg(repeatBody),
    single: modeSvg(repeatBody+'<path d="m10.5 10 2-1v6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
    random: modeSvg('<path d="M4 7h2c5 0 7 10 12 10h1M4 17h2c1.8 0 3.2-1.5 4.5-3.5M13.5 9.5C15 7.9 16.4 7 18 7h1"'+modeStroke+'/><path d="m16 3 6 4-6 4V3Zm0 10 6 4-6 4v-8Z" fill="currentColor"/>'),
  };
  $('#play-mode').innerHTML=modeIcons.list;
  const protocol = decodeURIComponent(location.hash.slice(1));
  const message = (text, error = false) => { $('#message').textContent = text; $('#message').classList.toggle('error', error); };
  function send(type, values = {}) {
    if (!socket || socket.readyState !== WebSocket.OPEN) { message('连接尚未恢复，请稍后重试', true); return null; }
    const id = String(++sequence); socket.send(JSON.stringify({ type, id, ...values })); return id;
  }
  const patch = values => send('configure', { patch: values });
  const patterns = () => $('#filters').value.split('\n').map(x => x.trim()).filter(Boolean);
  const element = (tag, text, cls) => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };
  const formatNumber = (key, value) => Number(Number(value).toFixed(['opacity', 'unplayedOpacity'].includes(key) ? 2 : ['fontSize', 'scrollDelay'].includes(key) ? 1 : 0));
  function card(panel, title) { const e = element('section', '', 'card'); e.append(element('h2', title)); panel.append(e); return e; }
  function field(parent, key, title, type, extra, detail) {
    const row = element('label', '', 'field'), label = element('span', title); if (detail) label.append(element('small', detail)); row.append(label);
    const input = element(Array.isArray(type) ? 'select' : 'input'); input.dataset.key = key;
    if (Array.isArray(type)) type.forEach(([value, text]) => { const option = element('option', text); option.value = value; input.append(option); });
    else { input.type = type; if (type === 'checkbox') input.setAttribute('role', 'switch'); }
    for (const [name, value] of Object.entries(extra || {})) input.setAttribute(name, String(value)); row.append(input); parent.append(row);
    input.addEventListener('change', () => {
      if (input.type === 'number' && (!input.value || !input.checkValidity())) { input.reportValidity(); return; }
      patch({ [key]: input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value });
    });
    return row;
  }
  const form = $('#settings'), panels = {};
  for (const name of ['display', 'appearance', 'lyrics']) { const p = element('div'); p.dataset.panel = name; p.hidden = name !== 'display'; form.append(p); panels[name] = p; }
  let c = card(panels.display, '位置与语言');
  field(c, 'enabled', '显示菜单栏歌词', 'checkbox');
  field(c, 'displayMode', '歌词语言', [['translation', '译文优先'], ['original', '原文'], ['bilingualInline', '原文与译文（单行）'], ['bilingual', '原文与译文（双行）']]);
  field(c, 'maxWidth', '歌词最大宽度（点）', 'number', {min:128,max:800,step:1}, '按内容收缩；至少 128 点以容纳五个按钮');
  field(c, 'longLine', '长句显示', [['ellipsis','省略'],['scroll','滚动']]);
  field(c, 'scrollSpeed', '滚动速度（点/秒）', 'number', {min:8,max:100});
  field(c, 'scrollDelay', '滚动前停留（秒）', 'number', {min:0,max:8,step:.5});
  c = card(panels.display, '显示方式'); c.append(element('p', '歌词完全使用 macOS 原生状态栏项：跨桌面、全屏隐藏及鼠标移到顶部时恢复均由系统管理。双行模式使用原生状态栏高度自动缩放两层文字。'));
  const permissionActions=element('div','','actions');c.append(permissionActions);
  const restart = element('button', '重启菜单栏组件'); restart.type = 'button'; restart.addEventListener('click', () => send('nativeAction', {action:'restart'})); permissionActions.append(restart);
  c = card(panels.appearance, '文字');
  field(c, 'fontSize', '字号（点）', 'number', {min:9,max:24,step:.5}, '双行优先使用设置字号，超出实际菜单栏高度时才缩小');
  field(c, 'fontWeight', '字重', [['regular','常规'],['medium','中等'],['semibold','半粗'],['bold','粗体']]);
  c = card(panels.appearance, '歌词颜色');
  field(c, 'colorMode', '颜色来源', [['system','跟随系统'],['cover','跟随歌曲封面'],['custom','自定义颜色']]);
  const colorStatus=element('div','','color-status');
  const colorSwatch=element('span','','color-swatch'), colorDescription=element('span');colorStatus.append(colorSwatch,colorDescription);c.append(colorStatus);
  const customColorRows=[field(c, 'originalColor', '原文已唱颜色', 'color'),field(c, 'translationColor', '译文已唱颜色', 'color')];
  c = card(panels.appearance, '播放填色与透明度');
  field(c, 'progressiveHighlight', '随播放进度填色', 'checkbox', null, '优先逐字时序，没有时按整句时间估算');
  field(c, 'unplayedOpacity', '未唱文字透明度', 'number', {min:.1,max:.8,step:.05});
  field(c, 'opacity', '整体不透明度', 'number', {min:.2,max:1,step:.05});
  c = card(panels.lyrics, '同步与空白状态');
  field(c,'offsetMs','时间偏移（毫秒）','number',{min:-30000,max:30000,step:100},'正数提前，负数延后；只影响本插件');
  field(c,'idleBehavior','无歌词、间奏或过滤后',[['title','显示歌名与歌手'],['hold','保留上一句'],['hide','隐藏']]);
  field(c,'pauseBehavior','暂停后',[['keep','保持显示'],['dim','降低透明度'],['hide','隐藏']]);
  field(c,'pauseDelay','暂停等待（秒）','number',{min:0,max:300});
  c = card(panels.lyrics,'制作人员与正则过滤'); field(c,'filterCredits','启用内置制作人员规则','checkbox',null,'作词、作曲、吉他、贝斯等字段');
  c.append(element('p','每行一条正则，匹配原文或译文后隐藏整组，保持时间轴。'));
  const filters = element('textarea'); filters.id='filters'; filters.spellcheck=false; filters.setAttribute('aria-label','正则过滤规则'); filters.placeholder='^吉他[：:]\n/^Bass\\s*:/i'; filters.addEventListener('input',()=>{filterDirty=true;}); c.append(filters);
  const actions = element('div','','actions'); c.append(actions);
  const button = (title, callback, parent=actions) => { const b=element('button',title);b.type='button';b.addEventListener('click',callback);parent.append(b);return b; };
  button('保存规则',()=>{const id=patch({customFilters:patterns()});if(id)pendingFilters.add(id);});
  button('预览当前歌曲',()=>send('preview',{patterns:patterns()}));
  button('关闭过滤',()=>{filterDirty=false;patch({filterCredits:false,customFilters:[]});});
  const preview = element('div');preview.id='filter-preview';c.append(preview);
  button('恢复默认设置',()=>{filterDirty=false;send('reset');},panels.lyrics);
  function applyConfig(value) {
    config=value;document.querySelectorAll('[data-key]').forEach(input=>{
      if(document.activeElement===input)return;
      if(input.type==='checkbox')input.checked=!!config[input.dataset.key];
      else if(input.type==='number' && typeof config[input.dataset.key]==='number') input.value=formatNumber(input.dataset.key,config[input.dataset.key]);
      else input.value=config[input.dataset.key]??'';
    });
    if(!filterDirty&&document.activeElement!==filters)filters.value=(config.customFilters||[]).join('\n');renderColors();
  }
  function renderColors() {
    const mode=config.colorMode||'system';customColorRows.forEach(row=>{row.hidden=mode!=='custom';});
    colorStatus.hidden=mode!=='cover';
    const cover=/^#[\da-f]{6}$/i.test(state.coverColor||'')?state.coverColor:null;
    colorSwatch.style.backgroundColor=cover||'var(--muted)';
    colorDescription.textContent=state.coverColorPending?(cover?'正在取色，暂时保持已有颜色':'正在读取封面颜色…'):cover?'当前封面颜色 '+cover.toUpperCase():'未取得封面颜色，使用系统文字颜色';
    const primary=mode==='cover'?cover:mode==='custom'?(config.displayMode==='translation'?config.translationColor:config.originalColor):null;
    const secondary=mode==='cover'?cover:mode==='custom'?config.translationColor:null;
    $('#lyric').style.color=primary||'';$('#secondary').style.color=secondary||'';
    const waiting=mode==='cover'&&state.coverColorPending&&!cover;
    $('#lyric').style.visibility=waiting?'hidden':'';$('#secondary').style.visibility=waiting?'hidden':'';
    document.querySelectorAll('.playback button').forEach(button=>{button.style.color=primary||'';});
  }
  function renderState(value) {
    if (typeof value.appearanceDark === 'boolean') document.documentElement.dataset.theme = value.appearanceDark ? 'dark' : 'light';
    state=value;$('#song').textContent=[value.title||'EchoMusic',value.artist].filter(Boolean).join(' · ');
    $('#lyric').textContent=value.primary||(value.hidden?'歌词已收起':'暂无歌词');$('#secondary').textContent=value.secondary||'';
    const modes={sequential:'顺序播放',list:'列表循环',random:'随机播放',single:'单曲循环'};
    const mode=modes[value.playMode]?value.playMode:'list';$('#play-mode').innerHTML=modeIcons[mode];$('#play-mode').title='播放模式：'+modes[mode]+'（点击切换）';$('#play-mode').setAttribute('aria-label',$('#play-mode').title);
    $('#play').textContent=value.isPlaying?'Ⅱ':'▶';$('#favorite').textContent=value.isFavorite?'♥':'♡';
    document.querySelectorAll('[data-command]').forEach(b=>{b.disabled=!value.hasTrack;});
    renderColors();
  }
  function connect() {
    if(!protocol.startsWith('echo-lyrics.')){message('请从 EchoMusic 插件设置打开此页面。',true);return;}
    socket=new WebSocket(location.origin.replace(/^http/,'ws')+'/live',protocol);
    socket.addEventListener('open',()=>{send('hello',{role:'settings'});});
    socket.addEventListener('message',event=>{
      let v;try{v=JSON.parse(event.data);}catch{return;}
      if(v.type==='config')applyConfig(v.config);else if(v.type==='state')renderState(v.state);
      else if(v.type==='ack'){if(!v.ok)message(v.error||'操作未完成，请重试',true);else if(pendingFilters.delete(v.id)){filterDirty=false;message('规则已保存');}else if(!v.dispatched)message('设置已保存');}
      else if(v.type==='preview'){preview.replaceChildren();v.lines.forEach(line=>{const row=element('div'),text=element(line.hidden?'s':'span',`${(line.startMs/1000).toFixed(1)}s  ${line.original}${line.translation?' / '+line.translation:''}`);row.append(text);preview.append(row);});message(`共 ${v.lines.length} 行，命中 ${v.lines.filter(x=>x.hidden).length} 行`);}
    });
    socket.addEventListener('close',()=>{message('连接中断，正在重新连接…',true);clearTimeout(reconnect);reconnect=setTimeout(connect,1500);});
    socket.addEventListener('error',()=>message('连接中断，正在重试…',true));
  }
  form.addEventListener('submit',event=>event.preventDefault());
  form.addEventListener('focusout',()=>setTimeout(()=>{if(Object.keys(config).length)applyConfig(config);},0));
  document.querySelectorAll('[data-command]').forEach(b=>b.addEventListener('click',()=>send('command',{command:b.dataset.command,trackId:state.trackId})));
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(item=>item.setAttribute('aria-selected',String(item===b)));document.querySelectorAll('[data-panel]').forEach(p=>{p.hidden=p.dataset.panel!==b.dataset.tab;});}));
  window.addEventListener('beforeunload',()=>{clearTimeout(reconnect);socket?.close();});connect();
})();
