# DeepSeek Harness Desktop（DeepSeek Harness 桌面版）

面向非技术用户的 **DeepSeek Harness** 一键安装 + 桌面客户端。

> 目标：让没有技术背景的用户也能 30 秒装好并用上 DeepSeek Harness —— 无需安装
> Node.js、无需命令行、无需理解「服务」「端口」这些概念。

**仓库**：[github.com/yansenlei/dsh-desktop](https://github.com/yansenlei/dsh-desktop)
**下载**：安装包发布在 **GitHub Releases**（应用内「设置 → 检查更新」以 Releases 为更新源）。
**插件**：内置插件各自独立维护、支持 npx 独立安装（桌面版内置版本与独立仓库同源同步）：
- [dsh-plugin-lan-access](https://github.com/yansenlei/dsh-plugin-lan-access)（局域网二维码）· `npx dsh-plugin-lan-access`
- [dsh-plugin-telegram-bridge](https://github.com/yansenlei/dsh-plugin-telegram-bridge)（Telegram 桥接）· `npx dsh-plugin-telegram-bridge`

## 产品特性

- **一键安装**：NSIS 安装包，双击 → 安装 → 自动启动，桌面/开始菜单快捷方式、卸载器齐全。
- **免装 Node.js**：应用自带 Electron（含 Node 22 运行时），DSH 服务在应用内以子进程运行，用户机器完全不需要安装 Node.js。
- **内置 DSH 运行时**：`@deepseek-ai/dsh@0.1.0-rc.6` 与其全部依赖随安装包分发，离线可用。
- **桌面壳体验**：暗黑科技风品牌启动页（旋转光环 logo + 启动进度 + 运行日志）→ 自动载入 Harness 工作台；系统托盘常驻（状态、打开/重启/设置/退出）。
- **局域网访问（手机扫码）**：内置 `lan-access` 插件，Harness 侧边栏「手机访问」按钮弹出二维码（内容为局域网访问 URL）；手机连同一 Wi-Fi 扫码即可在局域网内随时连接自己的电脑。桌面端「设置 → 局域网访问」一键开关（默认关闭，开启时服务绑定 0.0.0.0 并自动放行本机局域网 IP，详见下文安全说明）。
- **Telegram 接入（随时随地控制电脑）**：内置 `telegram-bridge` 插件，用户在自己的 Telegram 中与 Harness 对话、让 AI 操作电脑；配置引导（@BotFather 创建 Bot）+ t.me 二维码扫码直达。消息通过 DSH agents 服务接入，与浏览器工作台共用同一会话。
- **环境一键补齐**：可选组件自动检测与一键安装 —— Python（winget 优先，回退官方安装包）、`dsh` 命令行工具（自动装 Node LTS + 全局 dsh）。
- **数据自包含**：会话、配置、存储都放在应用数据目录，卸载不丢失；端口冲突自动顺延。
- **跨平台**：Windows（NSIS 安装器）与 macOS（dmg/zip，x64 + Apple Silicon）均已适配；macOS 构建见 `docs/BUILD_MAC.md`。
- **i18n**：壳 UI 与主进程文案支持中/英文，设置页可切换语言。
- **可靠性**：服务崩溃自动重启（带退避）、启动超时检测、日志文件轮转、单实例锁、窗口状态记忆。

## 技术架构

```
┌────────────────────── Electron 38（Chromium + Node 22）─────────────────┐
│  main 进程                                                              │
│  ├─ 窗口/托盘/生命周期    ── 壳 UI（本地 HTML：启动页 / 设置页）        │
│  ├─ IPC 桥（contextBridge, sandbox 渲染进程）                           │
│  └─ DshServerManager：spawn dsh web 子进程（ELECTRON_RUN_AS_NODE）      │
│        ├─ 端口探测（默认 3080，被占顺延）                               │
│        ├─ 健康轮询（HTTP 200 → ready）                                  │
│        ├─ 崩溃自动重启（≤3 次，退避 2s）                                │
│        └─ 局域网访问：生成 patch（host=0.0.0.0）+ 插件 junction 链接    │
├─ resources/dsh-runtime/：@deepseek-ai/dsh + 依赖 + lan-access 插件      │
├─ 内置插件 @dsh-desktop/lan-access（局域网二维码）                       │
│    ├─ node half：注册 /lan-info（返回局域网 IP/URL/开关状态）           │
│    └─ client half：侧边栏「手机访问」按钮 + 二维码面板（qrcode 打包）   │
└─ 子进程：dsh web（Node 22.22 · DSH_HOME=userData/dsh-home · 端口动态）  │
        └─ http://127.0.0.1:<port>  →  BrowserWindow 加载 Harness UI      │
```

- **服务与壳隔离**：Harness 服务是独立子进程，崩溃不影响应用壳，可随时重启。
- **无外部依赖启动**：Electron 内置 Node 22 满足 DSH rc.6 的要求（zstd / type-stripping）。
- **局域网访问机制**：开启后通过 `--patch` 把 webserver 绑定到 `0.0.0.0`；
  DSH 的 `resolveLanTrust` 会自动把本机局域网 IPv4 加入 browser-trust 放行列表，
  手机等局域网设备即可访问。插件通过 `$DSH_HOME/profiles/web/node_modules`
  的 junction 链接注入（loader 从 profile 目录做模块解析）。
- **Python / dsh CLI 是可选项**：仅在用户需要时一键安装，不阻塞主流程。

## 目录结构

```
dsh-desktop/
├── src/
│   ├── main/          # Electron 主进程（index/server/deps/ipc/settings/logger）
│   ├── preload/       # contextBridge 桥接
│   ├── renderer/      # 壳 UI（boot 启动页 / settings 设置页 + i18n）
│   └── shared/        # 主进程与渲染层共享的类型与常量
├── runtime/           # DSH 运行时（node_modules 由 prepare-runtime 安装）
├── scripts/           # build（esbuild）/ prepare-runtime / make-icon / smoke
├── build/             # 生成的应用图标（icon.ico/icon.png/tray.png）
└── docs/              # 用户指南、FAQ
```

## 本地开发

要求：Windows 10+，Node 22（仅用于构建，最终产品不需要）。

```bash
npm install                      # 安装 electron/electron-builder/esbuild 等
npm run prepare:runtime          # 安装并裁剪 DSH 运行时到 runtime/
npm run build                    # esbuild 打包 main/preload/renderer 到 dist/
npm run smoke                    # 端到端冒烟测试（启动服务→HTTP 探活→退出）
npm start                        # 本地运行（构建后启动 Electron）
npm run dist                     # 打包 NSIS 一键安装器（release/ 目录）
npm run check:upstream           # 检查 runtime 内置 dsh 是否为 npm 最新版（维护用）
```

> 构建时若无法访问 GitHub（下载 Electron/NSIS 工具链），可设置镜像：
> ```powershell
> $env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
> ```

### Smoke 测试

`npm run smoke` 以无窗口模式启动应用，验证：DSH 服务启动 → HTTP 200 →
`window.__DSH_BOOT__` 注入 → 干净退出。结果写入 `smoke-result.json`。

### CI 构建与发布

`.github/workflows/build-release.yml` 提供 GitHub Actions 流水线：
- push 到 `main`：自动构建 Windows / macOS 安装包并上传 artifact
- 打 `v*` tag：自动发布 GitHub Release（应用内「检查更新」以此为源）

## 安装包产物

- `release/DeepSeek-Harness-Desktop-Setup-<version>.exe` — NSIS 一键安装器（约 130MB，含完整 DSH 运行时与 Electron）
  - 安装到 `%LOCALAPPDATA%\Programs\dsh-desktop\`，创建桌面/开始菜单快捷方式，安装后自动启动
- `release/win-unpacked/` — 免安装绿色版（直接运行 `DeepSeek Harness Desktop.exe`）
- 卸载通过 Windows「应用与功能」或 `Uninstall DeepSeek Harness Desktop.exe` 完成；卸载**不删除**用户数据（`%APPDATA%\DeepSeek Harness Desktop`）

### 已验证的完整链路（本机实测）

| 环节 | 结果 |
|---|---|
| 构建 | esbuild 打包 main/preload/renderer + lan-access 插件 ✔ |
| 冒烟测试（无窗口） | DSH 服务 4-8s 就绪，HTTP 200，`__DSH_BOOT__` 注入，干净退出 ✔ |
| 内置插件 | `/lan-info` 路由 + `__DSH_BOOT__` 注入 + `/plugins/@dsh-desktop/lan-access/client.js` 可加载 ✔ |
| 局域网访问 | 开启后 `http://<局域网IP>:<port>` HTTP 200（browser-trust 自动放行）✔ |
| 打包 | electron-builder 产出 NSIS 安装器 ✔ |
| 静默安装 | 安装成功，注册表卸载项、快捷方式创建 ✔ |
| 正常 GUI 启动 | 主窗口加载 Harness UI；托盘正常 ✔ |
| 端口冲突 | 3080 被占用时自动顺延 ✔ |
| 优雅退出 | 服务子进程干净停止 ✔ |

## 局域网访问安全说明

「设置 → 局域网访问」默认**关闭**（服务仅监听 127.0.0.1）。开启后：
- 服务改为监听 `0.0.0.0`，**同一局域网内的任何设备**都能访问（无登录鉴权，仅靠 browser-trust 校验来源）。
- 请只在可信网络（家庭/办公 Wi-Fi）开启；公共 Wi-Fi 下不要开启。
- 关闭后重启服务即恢复仅本机可访问。

## 已知边界（v0.1）

- 未做代码签名：Windows SmartScreen 会提示「未知发布者」，选择「仍要运行」即可。
- 更新为「检查更新 + 静默安装」模式：设置页查询 GitHub Releases 最新版，Windows 上可直接
  「下载并安装」——流式下载安装包（带进度）→ NSIS `/S` 静默安装 → 应用退出并由安装器拉起新版本。
- 当前仅 Windows x64 目标；macOS/Linux 的打包配置可在 `package.json` 中扩展。

## 许可

MIT。DeepSeek Harness 本身遵循其上游许可（MIT）。
