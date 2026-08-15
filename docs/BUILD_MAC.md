# macOS 构建与验证指南

DeepSeek Harness Desktop 已做完整的 macOS 兼容适配。本文档说明如何在 macOS 上构建、验证与发布。

## 前置要求（macOS 上执行）

- macOS 12+（Intel x64 或 Apple Silicon arm64）
- Node.js 22+（仅构建需要，产品运行时内置）
- Xcode Command Line Tools（`xcode-select --install`，编译原生依赖/签名用）
- 网络可访问 npm registry（Electron 二进制会从镜像下载）

## 构建步骤

```bash
cd dsh-desktop

# 1. 安装构建依赖（Electron 等）
#    mac 上若 electron 下载慢/失败，设置镜像后重试：
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install --ignore-scripts --no-audit --no-fund
node node_modules/electron/install.js   # 手动解压 electron（若 postinstall 未跑）

# 2. 准备 DSH 运行时（自动按当前平台裁剪：mac 保留 darwin 的 node-pty prebuild）
npm run prepare:runtime

# 3. 打包 lan-access 插件（node half + browser half → runtime）
node scripts/build-lan-access.mjs

# 4. 构建主程序（main/preload/renderer → dist/）
npm run build

# 5. 冒烟测试（可选，无窗口验证服务启动 + UI 可达）
npm run smoke

# 6. 打包 macOS 应用
#    x64 与 arm64 双架构：
npx electron-builder --mac dmg zip
#    或仅当前架构：
npx electron-builder --mac dmg --x64
npx electron-builder --mac dmg --arm64
```

产物在 `release/`：
- `DeepSeek-Harness-Desktop-<version>-x64.dmg` / `-arm64.dmg`（安装镜像）
- `DeepSeek-Harness-Desktop-<version>-<arch>.zip`（绿色版）

## 平台适配说明（已实现）

| 模块 | Windows | macOS |
|---|---|---|
| 进程终止（server.ts） | `taskkill /T /F` | SIGTERM → SIGKILL |
| 插件链接（server.ts） | junction | `dir` 符号链接 |
| Python 检测（deps.ts） | `py -3` + `%LOCALAPPDATA%` 路径 | `python3` + Framework/brew 路径 |
| Python 安装（deps.ts） | winget → 官方 exe | brew → 引导 python.org 下载页 |
| Node 安装（deps.ts） | winget | brew → 引导 nodejs.org |
| 托盘 | 系统托盘 | 菜单栏图标（点击弹菜单） |
| 关窗行为（settings.ts） | 默认最小化到托盘 | 默认关窗即退（Cmd+Q 退出） |
| 应用菜单 | 隐藏 | About/Quit + 编辑/视图/窗口菜单 |
| 图标 | icon.ico | icon.icns（16–1024，脚本生成） |
| 打包 | NSIS | dmg + zip（x64/arm64） |

## 首次启动注意事项（macOS）

1. **Gatekeeper**：未签名/未公证的构建首次启动会被拦截。终端运行
   `xattr -dr com.apple.quarantine "/Applications/DeepSeek Harness Desktop.app"`，
   或右键 → 打开 → 确认。
2. **数据目录**：`~/Library/Application Support/DeepSeek Harness Desktop`（会话/配置/日志）。
3. **首次使用提示**：若系统未装 Python 且需要，设置页「一键安装」会引导到 python.org
   （macOS 系统自带 `/usr/bin/python3`，一般已可用）。

## 签名与公证（正式发布可选）

```bash
# 1. 开发者证书签名
export CSC_LINK="/path/to/cert.p12" CSC_KEY_PASSWORD="xxx"
npx electron-builder --mac dmg --arm64 --x64

# 2. 公证（需要 Apple Developer 账号）
xcrun notarytool submit release/DeepSeek-Harness-Desktop-0.1.0-arm64.dmg \
  --apple-id "$APPLE_ID" --password "$APP_SPECIFIC_PASSWORD" --team-id "$TEAM_ID" --wait
```

## Windows 无回归说明

所有平台分支均以 `process.platform` 隔离，Windows 路径保持原逻辑；
已在本机（Windows）重新打包 + smoke 验证通过。
