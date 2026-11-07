export function registerSettings(ctx, session) {
  const { h, ref, onMounted, onUnmounted } = ctx.vue;
  ctx.ui.settings.define({ title: 'Mac 菜单栏歌词', component: {
    setup() {
      const url = ref(session.settingsURL), status = ref(session.status);
      let unsubscribe;
      onMounted(() => { unsubscribe = session.subscribe(() => { url.value = session.settingsURL; status.value = session.status; }); });
      onUnmounted(() => unsubscribe?.());
      return () => url.value
        ? h('iframe', { src: url.value, title: '菜单栏歌词设置', sandbox: 'allow-scripts allow-same-origin',
          style: 'display:block;width:100%;height:76vh;min-height:520px;border:0;border-radius:12px;background:transparent' })
        : h('div', { style: 'padding:24px' }, [h('p', status.value), h('button', { onClick: () => session.launch() }, '启动菜单栏组件')]);
    },
  } });
}
