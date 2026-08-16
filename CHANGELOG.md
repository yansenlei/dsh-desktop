# CHANGELOG

本仓库的发布历史与维护记录。版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## 维护待办（按优先级）

### 中优先级

- 代码签名（消除 SmartScreen「未知发布者」与 macOS Gatekeeper 拦截，需代码签名证书 / Apple 开发者证书 + 公证）

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
