# Product Hunt 发布稿（英文）

## Tagline（必填，60 字内）

One-click desktop app for DeepSeek Harness — no Node.js, no terminal, ready in 30 seconds.

## Description

DeepSeek Harness Desktop is a community (unofficial) desktop client that bundles the DeepSeek Harness agent workspace into a double-click installer.

For everyone who was told "install Node.js, open a terminal, start a service" and gave up.

- ⚡ One-click install: Windows installer & macOS dmg/zip (Apple Silicon + Intel), auto-launch after install
- 📦 Self-contained: the entire Harness runtime ships inside the app — nothing else to install, works offline
- 📱 Phone remote: scan a QR on the same Wi-Fi and drive the workspace from your phone (off by default)
- ✈️ Telegram bridge: keep commanding your PC via your own Telegram bot when you're away
- 🔄 In-app updates: one click, silent install, Windows + macOS
- 🌐 Chinese / English UI

Open source (MIT). Not affiliated with DeepSeek.

## Topics

Developer Tools, Productivity, Artificial Intelligence, Open Source, Windows, Mac

## 首发评论（发布后立刻自己发第一条）

Maker here 👋

This started as a tool for my non-technical family members — one "how do I install this AI thing" question too many. The whole point is that you never see Node.js, a terminal, or a port number: double-click, and the Harness workspace loads itself.

Two details I'm proud of:
1. The runtime ships entirely inside the app (~150 MB), so it works on a machine with nothing else installed.
2. The phone-remote plugins (LAN QR + Telegram) share the same session as the desktop — your AI follows you around the house.

AMA about the Electron shell, the child-process service manager, or the packaging pipeline (the macOS signing story is a fun one).

## Gallery（图片素材）

1. 主截图 site/deepseek-harness.png
2. 下载页截图（自动识别系统 + 三平台卡片）
3. 手机扫码工作流截图（如有）

## 更新模板（之后每次发版）

New in v0.2.x: <一句话亮点>. Release notes: https://github.com/yansenlei/dsh-desktop/releases
