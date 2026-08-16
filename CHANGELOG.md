# CHANGELOG

本仓库的发布历史与维护记录。版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## 维护待办（按优先级）

### 中优先级

- 正式代码签名 + 公证（消除 SmartScreen「未知发布者」与 macOS「无法验证开发者」弹窗，需代码签名证书 / Apple 开发者证书 + 公证）
- 更新体验优化（可选：迁移 electron-updater 实现差分更新 / sha512 校验 / 失败回滚）

## [0.2.5] - 2026-08-16

macOS 修复与功能：

- **修复**：macOS 首次打开卡加载页后报「出现服务问题」——打包的 DSH 运行时缺 koffi 原生模块（`Cannot find the native Koffi module`，Windows 生成的 lockfile 不含 darwin 平台可选包，`--ignore-scripts` 又跳过 cnoke 预编译下载）。`prepare-runtime.mjs` 现在在 `npm ci` 后为当前平台补装 `@koromix/koffi-<platform>-<arch>` 预编译包（版本与已装 koffi 严格一致），并与 sharp 平台包合并为同一次 `npm install`（`--no-save` 对账会剪掉分次安装的平台包）
- **功能**：macOS 托盘图标改为**模板图**（自动适配深/浅色菜单栏，浅色下不再"隐身"）；同一套菜单（显示主界面 / 在浏览器打开 / 设置 / 重启服务 / 退出）同时挂到 **Dock 图标右键菜单**，与 Windows 托盘右键菜单对应
- **文档**：用户指南补充 macOS 托盘 / Dock 操作说明

## [0.2.4] - 2026-08-16

macOS 修复：

- **修复**：macOS 构建时强制 **ad-hoc 签名**（`mac.identity: "-"` + `hardenedRuntime: false`）——此前打包产物残留 Electron 官方构建的过期签名（封印已失效），Gatekeeper 误报「已损坏，无法打开」；现在重新签名后封印与最终内容一致，首次打开仅需「右键 → 打开」或弹窗点「打开」，无需终端操作
- **CI**：Release 发布不再等待 Intel mac 构建（公共 runner 稀缺导致长期排队阻塞发布），Windows + Apple Silicon 构建完成后即可发布，Intel 资产改为排到 runner 后尽力补传

## [0.2.3] - 2026-08-16

界面修复：

- **修复**：侧边栏插件按钮并排时文字换行——按钮加 `white-space:nowrap` + 超宽省略号
- **优化**：按钮文案调整——lan-access「手机访问」→「局域网」，telegram-bridge「Telegram 接入」→「Telegram」，并排更对称

## [0.2.2] - 2026-08-16

功能更新：

- **功能**：**Harness 引擎更新检测**——打开设置页时静默查询 npm 最新引擎版本，若内置引擎落后则提示
  「检测到 Harness 引擎新版本 vX，将在下个应用版本中提供」（网络不可用静默跳过）
- **文档**：README 插件介绍改为用户价值导向（在家扫码局域网 / 出门扫码 Telegram）

## [0.2.1] - 2026-08-16

功能更新：

- **功能**：**macOS 自动更新**——「检查更新」发现新版本后可直接「下载并安装」
  - 按架构（x64/arm64）选择对应 zip 资产
  - 流式下载（带进度）→ 应用退出 → `ditto` 解压替换 `.app`（移除 quarantine 属性）→ 自动重启
- **文档**：README 已知边界更新（macOS 自动更新支持说明）

## [0.2.0] - 2026-08-16

安全与功能更新（在 v0.1.0 基础上）：

- **安全**：Electron 38.8.6（已 EOL）→ **41.10.5**（Node 24.18 / Chromium 146）
- **修复**：`prepare-runtime.mjs` 两个 bug（readdirSync 缺失、dsh 版本路径错误）
- **修复**：Electron 41 兼容——dsh web 子进程补 `--expose-internals`（否则 HMR 崩溃）
- **功能**：**静默自动更新**——「检查更新」后可直接「下载并安装」新版本（流式下载 + 进度 + NSIS /S 静默安装）
- **CI**：GitHub Actions 构建发布流水线 + 上游版本检查脚本（`npm run check:upstream`）

## [0.1.0] - 2026-08-16

初始发布：DeepSeek Harness 桌面版（Windows 一键安装 + 内置插件 + 局域网访问 + Telegram 桥接）。

Git tag：`v0.1.0` · GitHub Release：附 NSIS 安装包
  - 流式下载（进度广播）→ NSIS `/S` 静默安装 → 应用退出并由安装器拉起新版本
- `213e62b` / `1114faf` **ci**: 两个独立插件仓库（`dsh-plugin-lan-access` / `dsh-plugin-telegram-bridge`）新增 npm 发布流水线（打 `v*` tag 自动 publish）

## 发布流程（维护者须知）

### 主仓库发布（Windows 安装包）

```bash
npm run prepare:runtime   # 确保 runtime 依赖在位
npm run build             # esbuild 打包
node scripts/build-plugins.mjs
npm run dist              # electron-builder 产出 NSIS 安装包
```

- 手动发布：`node scripts/publish-github.mjs <GITHUB_TOKEN>`（创建/推送仓库 + Release + 上传安装包）
- 或依赖 CI：推 tag 后由 `.github/workflows/build-release.yml` 自动构建并发布

### 插件发布（npm）

```bash
# 每个插件独立仓库（dsh-plugin-lan-access / dsh-plugin-telegram-bridge）：
npm run build
npm publish
```

- 或打 `v*` tag 触发 `.github/workflows/publish-npm.yml` 自动 publish
- 需要仓库配置 `NPM_TOKEN` secret

### 插件源码同步（三处保持一致）

| 位置 | 用途 |
|---|---|
| `dsh-desktop/plugins/<name>` | 主仓库内置（打包进安装包） |
| `dsh-desktop-plugins/<name>` | 源码合集仓库（同步枢纽） |
| `dsh-plugin-<name>`（独立仓库） | npm 外部分发（npx 安装） |

修改插件源码后：改主仓库 `plugins/` → 同步到独立仓库 → 重跑 `node scripts/build-plugins.mjs`。

### 上游跟进

```bash
npm run check:upstream   # runtime 内置 dsh 是否为 npm 最新版
```
