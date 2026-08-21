# AGENTS.md — dsh-desktop-launcher

DSH web GUI 插件 dsh-desktop-launcher：桌面启动器 + 一键关机。在桌面创建
一键启动图标（Windows .lnk / macOS .command / Linux .desktop），双击启动
dsh web 并打开 Web GUI；界面右下角浮动关机按钮，确认后请求宿主进程优雅退出。
包级规则：只写本包特有约定，不重复根 AGENTS.md 与 packages/AGENTS.md 的全局/
包级规则。

## 本包要点

- 双半区：host 半区（src/index.ts + src/routes.ts + src/shutdown-routes.ts）
  提供 loopback 专用路由 -- /api/dsh-desktop-launcher/create（写
  ~/.dsh/desktop-launcher/ 与桌面图标）和
  /api/dsh-desktop-launcher/shutdown（请求宿主进程退出，限 loopback）；
  browser 半区（src/client/）在「Web UI 插件」组注册设置卡片（创建按钮 +
  enabled / announceToAgent / dshCommand / url / profile / iconPath /
  confirmShutdown 字段），并挂载右下角浮动关机按钮。
- Windows 启动链路是纯 Node：`.lnk` 指向运行 dsh 的 node 可执行文件，静态
  `launcher-win.js`（renderNodeLauncher）以 detached + windowsHide 分离、无控制台
  方式拉起 `dsh web`，`.lnk` 参数由 renderWindowsShortcutArgs 生成（仅含空格的
  token 加引号）；`.lnk` 本身由宿主经 `powershell -NoProfile -Command` 的纯 COM
  一次性创建（无 -ExecutionPolicy Bypass / -File / 落盘脚本 / Add-Type）。图标为
  内置白底黑鲸资产（assets/dsh.ico + dsh.png），改图标先改 assets/ 再重建。
- 纯逻辑在 src/core/launcher.ts（脚本渲染、文件名、路径转义），禁止在
  routes.ts 里内联生成逻辑；测试注入 homeDir / platform / run，不碰真实进程。
- shutdown-routes.ts 是独立于 routes.ts 的第二个路由文件（各持不同测试 seam），
  共享 loopback 围栏。
- 三件套（settings-form.ts / PluginSettingsCard.tsx / settings-card.module.css）
  是 scripts/sync-shared.mjs 生成的同步副本，禁手改；本包样式新增
  launcher-card.module.css 与 shutdown.module.css。
- 图标创建会写用户桌面与 ~/.dsh，两个路由均仅限 loopback；改动安全语义需同步
  README「安全模型」与测试。
- 退出经 ctx.appExit（launcher 提供的 bounded exit），缺失时回退 process.exit(0)；
  关机按钮默认弹确认框。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-desktop-launcher typecheck
pnpm --filter @linxin666/dsh-desktop-launcher test
pnpm --filter @linxin666/dsh-desktop-launcher build
```
