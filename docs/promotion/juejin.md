# 掘金发布稿（前端 / Electron 标签）

**标题**：用 Electron 把 DeepSeek Harness 打包成桌面应用：架构设计与三个 CI 大坑

**摘要**：介绍 DeepSeek Harness Desktop 的壳架构（主进程编排 / 子进程服务 / IPC 桥），以及 macOS 打包时踩过的 EMFILE、koffi 原生模块缺失、GITHUB_TOKEN 不触发链式工作流三个坑。

**正文**：

## 背景

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 是一个「一切皆插件」的 Agent 框架，但官方分发形态以 CLI 为主，非技术用户上手有门槛。我们做了一个社区桌面版 [dsh-desktop](https://github.com/yansenlei/dsh-desktop)：把整个 Harness 运行时打进安装包，双击即用。

## 架构

```
Electron 41（Chromium 146 + Node 24）
├─ main 进程
│   ├─ 窗口/托盘/生命周期 —— 壳 UI（启动页 / 设置页，本地 HTML）
│   ├─ IPC 桥（contextBridge + sandbox 渲染进程）
│   └─ DshServerManager：spawn dsh web 子进程（ELECTRON_RUN_AS_NODE）
│        ├─ 端口探测（默认 3080，被占顺延）
│        ├─ 健康轮询（HTTP 200 → ready → BrowserWindow 加载 Harness UI）
│        └─ 崩溃自动重启（≤3 次，2s 退避）
└─ resources/dsh-runtime/：@deepseek-ai/dsh + 全部依赖 + 内置插件
```

要点：
1. **服务与壳隔离**：Harness 服务是独立子进程，崩溃不影响壳，可随时重启；
2. **零外部依赖**：Electron 内置的 Node 24 满足 DSH 的 zstd / type-stripping 要求；
3. **插件注入**：桌面端通过 `--patch` 生成 cordis patch（局域网访问时把 webserver 绑到 0.0.0.0），插件包用 junction 链到 `$DSH_HOME/profiles/web/node_modules`，loader 从 profile 目录解析模块。

## 三个值得记录的坑

### 1. EMFILE：3 万+ 文件的签名地狱

macOS 打包时 electron-builder 稳定报 `EMFILE: too many open files`。先试了 `ulimit -n 4096` 无效——根因是内置 `@electron/osx-sign` 的 `walkAsync` + `isBinaryFile` **无并发上限地打开文件**（上游修复 [electron/osx-sign#286](https://github.com/electron/osx-sign/pull/286) 至今未合并）。最终方案：`build.mac.identity` 置 null 跳过内置签名，用 `afterPack` 钩子直接调 `codesign --deep`（串行、稳定），dmg/zip 打包的自然就是已签名的 .app。

### 2. Windows 机器生成的 lockfile 不包含 darwin 平台包

`package-lock.json` 在 Windows 上生成，`@koromix/koffi-darwin-arm64` 这类平台可选依赖没有完整条目；`npm ci` 严格按 lock 安装，mac 上根本不会补装，导致 koffi 原生模块缺失、服务启动即崩（`Cannot find the native Koffi module`）。修复：prepare-runtime 里按当前平台显式补装 `@koromix/koffi-<platform>-<arch>`（版本与已装 koffi 严格一致），并且**必须和 sharp 平台包合并成同一次 `npm install --no-save`**——分两次装，后一次的对账会把前一次的平台包当 extraneous 剪掉。

### 3. GITHUB_TOKEN 推送不会触发其它 workflow

发版后想自动更新下载页的 `latest.json` 再提交回 main：最初监听 tag 推送，结果在 tag 的 detached HEAD 上 `git push` 必败；改成 `workflow_run` 监听 build-release 成功后重试成功，但用 `GITHUB_TOKEN` 提交后 Pages 部署工作流**不触发**（GitHub 防循环机制）。最终把 Pages 部署直接并入发布后工作流，自包含。

## 总结

代码量不大（主进程 + 两个插件 + 站点），但把「给非技术用户的分发体验」打磨到能用，细节不少：自动更新、托盘/Dock 菜单、中英文切换、扫码场景的安全边界。

- 仓库：https://github.com/yansenlei/dsh-desktop
- 下载页（自动识别系统）：https://yansenlei.github.io/dsh-desktop/

社区项目（MIT），与官方无隶属关系。欢迎 Star / issue / PR。
