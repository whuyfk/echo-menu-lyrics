# EchoMusic Mac 菜单栏歌词

为 [EchoMusic](https://github.com/hoowhoami/EchoMusicPlugins) 提供原生 macOS 菜单栏歌词。
鼠标移入歌词，原位置显示 **播放模式、上一首、播放／暂停、下一首、收藏**；移出恢复歌词。

**0.2.1 开发预览版 · macOS 13+ · EchoMusic 2.3.2+ · MIT**

## 功能

- 应用菜单后方或右侧状态图标前显示歌词，不额外保留小音符入口。
- 原文、译文优先、双语双行；译文来自播放器，缺译文时回退原文。
- 逐字／逐句播放填色，字体、字重、透明度、宽度和长句滚动。
- 歌词颜色跟随系统、歌曲封面或自定义；切歌取色期间短暂保留已知颜色。
- 内置制作人员过滤、自定义正则、当前歌曲预览及独立歌词偏移。
- 区分实体显示器和 macOS 桌面／全屏空间，可按显示器覆盖宽度与字号。
- 播放器内与歌词右键打开的独立设置共用同一页面。

## 安装

### 添加插件源

在 EchoMusic 的插件管理中添加插件源：

```text
https://github.com/whuyfk/echo-menu-lyrics
```

刷新在线列表，找到「Mac 菜单栏歌词」并安装、启用。官方源收录后，也可直接从官方源搜索。

### 手动安装

从 [Releases](https://github.com/whuyfk/echo-menu-lyrics/releases) 下载 macOS ZIP，
解压后将 `echo-menu-lyrics` 文件夹放入 EchoMusic 插件目录，再刷新并启用。
默认目录为 `~/Library/Application Support/echo-music/plugins`，以播放器页面显示为准。

首次启动或程序文件更新后，EchoMusic 会请求原生程序运行确认。
左侧定位、指定桌面和双行排版使用原位浮层，需要辅助功能权限读取菜单边界；
系统可能将权限归属到 EchoMusic，请以系统设置实际显示为准。

**预编译组件为 ad-hoc 签名，未做 Developer ID 签名及公证。**
跨设备首次运行可能受系统限制；运行条件、实际测试范围及尚待验证的场景见
[兼容性说明](https://github.com/whuyfk/echo-menu-lyrics/blob/main/docs/COMPATIBILITY.md)。

## 设置说明

右键歌词选择「歌词设置」，或从 EchoMusic 插件管理打开设置。

- **宽度**是上限，短句自动收缩。屏幕独立宽度优先于统一宽度；需要时可恢复统一设置。
- **显示器范围**选择实体显示器；**桌面范围**选择仅当前桌面或全部桌面／全屏空间。
- 「仅当前桌面」固定到启动组件或选择此项时所在桌面；在目标桌面重启组件可重新固定。
- 双行两侧利用完整菜单行高度，优先使用设置字号，超出可用高度才缩小。
- 封面色直接读取宿主取色结果，不修改主程序主题，也不额外请求封面。
- 无法安全读取菜单边界或空间不足时收起歌词，可从插件管理再次打开设置。

正则过滤每行一条，支持 `i`、`m`、`u` 标志，例如：

```text
^吉他[：:]
/^Bass\s*:/i
```

匹配原文或译文时隐藏整组，保留时间轴。耗时过滤在隔离任务中执行，超时终止，
回退内置规则。没有译文的歌曲不会自行生成翻译；没有逐字时间时按句估算填色。

## 源码与构建

需要 Node.js 20+、Xcode 或 Command Line Tools，不需要 npm 第三方依赖。

```sh
npm test
node scripts/build.mjs --universal
npm run package
npm run verify:package
```

- `plugin/src/`、`plugin/ui/`：播放器桥接、歌词逻辑及共用设置页。
- `native/`：Swift / AppKit / Core Text 原生渲染、定位与交互。
- `packages/echo-menu-lyrics/`：**已构建、可直接安装的插件目录**，供在线插件源从仓库 ZIP 安装。
- `dist/echo-menu-lyrics-0.2.1-macos.zip`：本机构建的分发 ZIP，不纳入 Git。
- `scripts/`：构建、分发准备、包校验及本地安装；`tests/`：自动检查。

修改源码后运行上述完整命令，提交更新后的源码和 `packages/echo-menu-lyrics/`。
版本以 `plugin/manifest.json` 和 `package.json` 为准，两者须同步。
`echo-plugins.json` 仅记录仓库及安装目录，不单独维护版本号。

本地试用可运行 `npm run install:local`，安装前会备份同名旧插件。
原生组件还支持 `--self-test`、`--diagnose`、`--render-checks <目录>`；
诊断仅输出屏幕几何与辅助功能授权状态，不输出登录信息或会话凭据。

通信仅监听 `127.0.0.1`，每次启动生成随机会话凭据。禁用插件会清理订阅、连接和原生进程。

## 许可证与反馈

源码使用 [MIT 许可证](https://github.com/whuyfk/echo-menu-lyrics/blob/main/LICENSE)。
本项目是第三方插件，与 EchoMusic 官方独立维护。

问题与建议请提交到 [Issues](https://github.com/whuyfk/echo-menu-lyrics/issues)。
开发接口依据 [EchoMusic 插件文档](https://github.com/hoowhoami/EchoMusicPlugins/tree/main/docs)。
