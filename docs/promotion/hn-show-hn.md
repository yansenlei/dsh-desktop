# Hacker News Show HN 发布稿（英文）

**Title**: Show HN: DeepSeek Harness Desktop — one-click local AI agent workspace (no Node.js, no terminal)

**URL**: https://github.com/yansenlei/dsh-desktop

**Body**:

Hi HN,

I built a desktop wrapper around [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (the "everything is a plugin" agent framework) so non-technical people can use it — my parents asked me "how do I install this AI thing" one too many times.

**What it is**

- A community, unofficial desktop client (MIT). Double-click installer for Windows; dmg/zip for macOS (Apple Silicon + Intel).
- The whole Harness runtime + Electron ships inside the package — nothing else to install, works offline.
- The Harness service runs as a child process (ELECTRON_RUN_AS_NODE): auto-restart on crash, port probing, live logs on the boot screen, in-app one-click updates via GitHub Releases.

**Two built-in plugins**

- `lan-access`: scan a QR code in the sidebar and drive the workspace from your phone on the same Wi-Fi (off by default, security notes built in).
- `telegram-bridge`: chat with a bot in your own Telegram to keep commanding your PC when away — shares the same session as the browser workspace.

**Architecture in one paragraph**: Electron 41 shell (context-isolated, sandboxed renderer) spawns `dsh web` as a child process, injects bundled plugins through a cordis `--patch` file, and loads the Harness UI once the health check returns 200.

**Fighting the toolchain was half the work** (details in the CHANGELOG):

- electron-builder's built-in osx-sign hits EMFILE on a 30k-file runtime (parallel walk with unbounded fd use; upstream fix still unmerged) → switched to a codesign call in an afterPack hook.
- A lockfile generated on Windows never gets darwin platform optional deps installed by `npm ci` → explicit per-platform koffi/sharp binary install in prepare-runtime.
- GITHUB_TOKEN pushes don't trigger chained workflows → the release pipeline now self-contains the Pages deploy.

Download page (auto-detects your OS): https://yansenlei.github.io/dsh-desktop/

Feedback welcome — especially on the "non-technical user" UX. This is not affiliated with DeepSeek.

---

### 发布技巧

- 选美东时间周二~周四上午发，前 1 小时在线回评论；
- 如果上首页，把帖子链接加进 README 的"媒体报道/社区"一节，并同步到 Reddit r/selfhosted、r/LocalLLaMA、r/DeepSeek。
