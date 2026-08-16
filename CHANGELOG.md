# CHANGELOG

本仓库的发布历史与维护记录。版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## 维护待办（按优先级）

### ✅ 已完成：Electron 38 EOL 升级（声明层面完成）

- **状态**：`package.json` / `package-lock.json` 已升级到 `electron@41.10.5`（Electron 41 = Node 24.18 / Chromium 146，见 `8077f55` 兼容性确认）。构建、类型检查、插件构建均验证通过。
- **剩余步骤**（需有正常网络/无沙箱限制的环境执行一次）：
  ```bash
  node node_modules/electron/install.js   # 下载 Electron 41 二进制（此前 --ignore-scripts 跳过）
  npm run smoke                            # 端到端验证
  npm run dist                             # 重新打包
  ```
- **升级后**：把本文档本条目移除。

### 中优先级

- 代码签名（消除 SmartScreen「未知发布者」，需代码签名证书）
- macOS 自动更新适配（当前「下载并安装」仅 Windows；macOS 走打开下载页）

## [0.1.0] - 2026-08-16

初始发布：DeepSeek Harness 桌面版（Windows 一键安装 + 内置插件 + 局域网访问 + Telegram 桥接）。

Git tag：`v0.1.0` · GitHub Release：附 NSIS 安装包

### 维护提交（v0.1.0 之后、尚未发版）

以下提交已合入 `main`，将在下个版本 tag 时随 Release 发布：

- `83d317b` **fix(scripts)**: 修复 `prepare-runtime.mjs` 两个 bug
  - 补上缺失的 `readdirSync` 导入（此前裁剪 node-pty prebuilds 的逻辑被静默吞掉，从未执行）
  - 修正 dsh 版本读取路径 `runtime/node_modules` → `runtime/dsh/node_modules`（此前脚本必崩 ENOENT）
- `90b3576` **feat(ci)**: GitHub Actions 构建发布流水线 + 上游版本检查脚本
  - `.github/workflows/build-release.yml`：push 到 main 自动构建 win/mac 安装包并上传 artifact；打 `v*` tag 自动发布 Release
  - `scripts/check-upstream.mjs`（`npm run check:upstream`）：对比 runtime 内置 dsh 与 npm latest
- `11e36d1` **feat(update)**: 静默自动更新
  - 设置页「检查更新」发现新版本后可直接「下载并安装」（Windows）
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
