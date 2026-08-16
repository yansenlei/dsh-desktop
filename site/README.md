# dsh-desktop-site

> 🌐 线上地址：https://yansenlei.github.io/dsh-desktop/（GitHub Pages 自动部署）

DeepSeek Harness Desktop 的**下载页** —— 参考 [DeepSeek Harness 官方页面](https://www.deepseek.com/harness/)的极简暗色设计语言
（近黑背景 `#0a0a0a` + 白色文字 + 品牌蓝 `#4d6bfe` 单色强调），单文件、零外部依赖。

## 社区版声明

页面已内置版权与免责声明（导航「社区版」标签 / Hero 非官方提示 / 页脚完整声明 / FAQ 第 06 条）：
本项目为社区开源项目（MIT），**非 DeepSeek 官方产品**，与 DeepSeek（深度求索）无隶属关系；
「DeepSeek」「DeepSeek Harness」等名称与商标归其权利方所有，仅作兼容性说明使用。
如品牌、描述或链接有变，请同步修改 `index.html` 中对应文案。

## 功能

- 🖥️ **自动识别操作系统**并高亮对应下载卡片：Windows / macOS / Linux / 手机（提示用电脑访问）
- 🍎 macOS 区分 **Apple Silicon（M1–M4）** 与 **Intel（x64）** 两个按钮；
  在 Chrome/Edge 上还能通过 `getHighEntropyValues` 进一步识别 CPU 架构，精确高亮芯片版本
- 🇨🇳 **国内镜像优先**：配置 `mirrorBase`（阿里云 OSS / 腾讯云 COS）后主按钮走国内加速线路，
  「GitHub 线路」永远直连 GitHub（海外/兜底）
- 🔄 **版本信息自动更新**：页面加载时自动拉取 `latest.json`（同源 / jsDelivr / GitHub raw 依次尝试，
  超时兜底内置值）刷新版本号与下载链接 —— 配合 `tools/gen-latest-json.mjs` + GitHub Actions，
  发新版后页面 HTML 零改动
- ✨ 克制动效：蓝色系粒子 + 连线背景（鼠标靠近粒子轻推开、光标光晕跟随、网格视差），
  滚动显现、卡片悬停微抬升（尊重 `prefers-reduced-motion`，触屏自动降级）
- 📱 移动端适配：汉堡菜单、单列卡片、全宽按钮、居中排版
- 📦 **零外部依赖**：单 HTML + 一张截图，适合国内网络环境，直接静态托管

## 文件

```
dsh-desktop-site/
├── index.html              # 下载页（内置 CFG 为兜底值，可被 latest.json 自动覆盖）
├── latest.json             # 最新版本数据源（CI 发版时自动生成；也可手动编辑）
├── icon.png                # 应用图标（与安装包一致的官方 DeepSeek 品牌图标，黑底圆角）
├── deepseek-harness.png    # 程序截图
├── preview-top.png         # 桌面首屏预览（本地生成，可选，部署时可删）
├── preview-full.png        # 桌面整页预览（同上）
├── preview-mobile-top.png  # 移动端首屏预览（同上）
├── preview-mobile-full.png # 移动端整页预览（同上）
├── mockup-desktop.png      # Hero 概念效果图（同上）
├── mockup-mobile.png       # 移动端概念效果图（同上）
├── DEPLOY_CN.md            # 国内部署指南（Gitee Pages + OSS/COS 镜像 + 版本自动更新）
└── tools/
    ├── oss-upload.mjs                # 安装包一键上传阿里云 OSS（无依赖）
    ├── gen-latest-json.mjs           # 从 GitHub Releases 生成 latest.json（无依赖）
    └── release-latest-json.yml.example  # GitHub Actions 发版自动更新 latest.json 模板
```

## 本地预览

```bash
python3 -m http.server 8931
# 打开 http://127.0.0.1:8931/
```

## 发布新版本

1. 改 `index.html` 顶部 `CFG`（版本号 / 文件名 / 大小 / mirrorBase）；
2. 按 `DEPLOY_CN.md` 上传安装包镜像并部署页面。

## 链接速查（当前 v0.2.4）

| 平台 | 文件 | 大小 |
|---|---|---|
| Windows 10/11 x64 | `DeepSeek-Harness-Desktop-Setup-0.2.4.exe` | 145 MB |
| macOS Apple Silicon | `DeepSeek-Harness-Desktop-0.2.4-arm64.dmg` / `.zip` | 154 / 174 MB |
| macOS Intel | `DeepSeek-Harness-Desktop-0.2.2-x64.dmg` / `.zip`（最新可用） | 149 / 163 MB |

GitHub Releases: <https://github.com/yansenlei/dsh-desktop/releases>
