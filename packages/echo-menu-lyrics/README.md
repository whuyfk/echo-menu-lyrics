# EchoMusic Mac 菜单栏歌词

为 [EchoMusic](https://github.com/hoowhoami/EchoMusicPlugins) 提供 macOS 原生状态栏歌词。
鼠标移入歌词，原位置显示 **播放模式、上一首、播放／暂停、下一首、收藏**；移出恢复歌词。

**0.4.2 开发预览版 · macOS 13+ · EchoMusic 2.3.2+ · MIT**

## 功能

- 歌词完全使用 macOS 原生 `NSStatusItem`，不创建悬浮歌词窗口。
- 跨桌面、全屏隐藏和鼠标移到屏幕顶部时的菜单栏唤出均由 macOS 管理。
- 支持原文、译文优先、单行双语和原生双行双语。
- 原生双行会按实际状态栏高度自动缩放，不使用辅助功能或屏幕录制权限。
- 逐字／逐句播放填色，支持字体字号、字重、透明度、最大宽度和长句滚动。
- 歌词颜色可跟随系统、歌曲封面或自定义。
- 内置制作人员过滤、自定义正则、当前歌曲预览和歌词时间偏移。
- 过滤完成前显示歌名，不会短暂展示未处理的制作人员行。
- 播放器内与歌词右键打开的独立设置共用同一页面。

## 安装

### 添加插件源

在 EchoMusic 的插件管理中添加：

```text
https://github.com/whuyfk/echo-menu-lyrics
```

刷新在线列表，找到「Mac 菜单栏歌词」并安装、启用。官方源收录后，也可以直接从官方源搜索。

### 手动安装

从 [Releases](https://github.com/whuyfk/echo-menu-lyrics/releases) 下载 macOS ZIP，
解压后将 `echo-menu-lyrics` 文件夹放入 EchoMusic 插件目录，再刷新并启用。
默认目录为 `~/Library/Application Support/echo-music/plugins`，以播放器页面显示为准。

首次启动或程序文件更新后，EchoMusic 会请求原生程序运行确认。
插件不请求辅助功能或屏幕录制权限。

**预编译组件为 ad-hoc 签名，未做 Developer ID 签名及公证。**
跨设备首次运行可能受系统限制；运行条件、实际测试范围及尚待验证的场景见
[兼容性说明](https://github.com/whuyfk/echo-menu-lyrics/blob/main/docs/COMPATIBILITY.md)。

## 歌词模式

- **原文**：只显示歌词原文。
- **译文优先**：有译文时显示译文，否则显示原文。
- **单行双语**：在同一个状态栏内显示 `原文 · 译文`。
- **双行双语**：在原生状态栏内显示上下两行，并根据菜单栏高度自动缩小字号。

## 其他设置

- **最大宽度**是上限，短句会自动收缩；至少 128 点，以容纳悬停播放控制。
- **长句显示**支持末尾省略或水平滚动。
- **字号和字重**统一使用 macOS 系统字体。
- **颜色来源**可选择跟随系统、跟随歌曲封面或自定义原文／译文颜色。
- **时间偏移**用于整体提前或延后歌词，只影响本插件。
- **无歌词、间奏或过滤后**可显示歌名、保留上一句或隐藏。
- **暂停后**可保持、降低透明度或隐藏。

正则过滤每行一条，支持 `i`、`m`、`u` 标志，例如：

```text
^吉他[：:]
/^Bass\s*:/i
```

匹配原文或译文时隐藏整组，但保留时间轴。没有译文的歌曲不会自行生成翻译；
没有逐字时间时按整句时间估算填色。

## 源码与构建

需要 Node.js 20+、Xcode 或 Command Line Tools，不需要 npm 第三方依赖。

```sh
npm test
node scripts/build.mjs --universal
npm run package
npm run verify:package
npm run check:generated
```

- `plugin/src/`、`plugin/ui/`：播放器桥接、歌词逻辑及共用设置页。
- `native/`：Swift / AppKit / Core Text 原生渲染与状态栏交互。
- `packages/echo-menu-lyrics/`：可直接安装的构建目录，供在线插件源从仓库 ZIP 提取。
- `dist/echo-menu-lyrics-0.4.2-macos.zip`：本机构建的分发 ZIP，不纳入 Git。
- `scripts/`：构建、打包、校验及本地安装；`tests/`：自动检查。

修改源码后运行上述完整命令，提交源码和更新后的 `packages/echo-menu-lyrics/`。
CI 会重新构建并执行 `check:generated`，确认安装包与源码产物一致。
版本以 `plugin/manifest.json` 和 `package.json` 为准，两者须同步。

原生组件支持 `--self-test`、`--diagnose` 和 `--render-checks <目录>`。
诊断只读取本进程状态栏和屏幕几何，不读取其他应用内容，也不输出登录信息或会话凭据。

通信仅监听 `127.0.0.1`，每次启动生成随机会话凭据。禁用插件会清理订阅、连接和原生进程。

## 许可证与反馈

源码使用 [MIT 许可证](https://github.com/whuyfk/echo-menu-lyrics/blob/main/LICENSE)。
本项目是第三方插件，与 EchoMusic 官方独立维护。

问题与建议请提交到 [Issues](https://github.com/whuyfk/echo-menu-lyrics/issues)。
