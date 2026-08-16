/**
 * 壳 UI 的轻量 i18n（zh / en）。
 */

const dict = {
  zh: {
    appName: "DeepSeek Harness Desktop",
    appSubtitle: "DeepSeek Harness 桌面版",
    status: {
      idle: "就绪",
      starting: "正在启动服务…",
      ready: "服务已就绪",
      stopped: "服务已停止",
      error: "服务异常",
      restarting: "正在重启服务…",
    },
    statusDetail: {
      starting: "正在启动本地 Harness 服务，请稍候…",
      ready: "正在打开 Harness 工作台…",
      stopped: "服务已停止。",
      error: "服务出现问题，请查看下方日志或重试。",
      restarting: "服务将自动重新启动…",
    },
    startFailed: "启动失败",
    timeout: "启动超时",
    crashed: "服务意外退出",
    restartLimit: "自动重启次数已达上限",
    spawnFailed: "无法启动服务进程",
    runtimeMissing: "DSH 运行时缺失",
    restartingDetail: "服务正在自动重启，请稍候…",
    log: "运行日志",
    actions: {
      openBrowser: "在浏览器中打开",
      settings: "设置",
      retry: "重试",
      viewLogs: "查看日志",
    },
    firstRunHint: "首次使用：请在 Harness 界面右上角「设置」中配置模型 API Key（如 DeepSeek）。",
    version: "版本",
    env: {
      title: "运行环境",
      bundledNode: "内置 Node.js（Electron）",
      bundledNodeDetail: "已内置，无需安装",
      systemNode: "系统 Node.js",
      python: "Python",
      pythonDetail: "代理运行 Python 脚本时需要（可选）",
      dshCli: "dsh 命令行工具",
      dshCliDetail: "在终端中使用 dsh（可选）",
      install: "一键安装",
      installed: "已安装",
      installing: "安装中…",
      missing: "未检测到",
      available: "可用",
      winget: "winget",
    },
    settings: {
      title: "设置",
      general: "常规",
      port: "服务端口",
      portDetail: "启动后如被占用会自动顺延",
      autoStart: "开机自动启动",
      closeToTray: "关闭窗口时最小化到托盘",
      minimizeToTray: "最小化时隐藏到托盘",
      lanAccess: "局域网访问（手机扫码）",
      lanAccessDetail: "开启后手机连同一 Wi-Fi 即可访问；注意：会向局域网开放服务",
      language: "语言 Language",
      languageDetail: "跟随系统或手动选择（重启后主进程菜单完全生效）",
      langAuto: "跟随系统（Auto）",
      data: "数据与日志",
      dataDir: "数据目录",
      dataDirDetail: "会话记录与配置文件保存位置",
      logDir: "日志目录",
      open: "打开",
      about: "关于",
      checkUpdate: "检查更新",
      upToDate: "当前已是最新版本",
      updateAvailable: "发现新版本 {v}，已打开下载页",
      updatePlaceholder: "无法连接更新源（需访问 GitHub）",
      updateDownloading: "正在下载更新…",
      updateReady: "下载完成，点击「下载并安装」继续",
      updateInstalling: "正在静默安装，应用即将退出并自动重启…",
      updateDownloadFailed: "更新下载失败",
      updateInstallFailed: "更新安装失败",
      downloadAndInstall: "下载并安装",
      saved: "已保存",
      restartTip: "修改端口后需要重启服务",
      restart: "重启服务",
      restartDetail: "修改端口等设置后生效",
      serviceMgmt: "服务管理",
      currentPort: "当前端口 {port}",
      errorPrefix: "[错误]",
      dshVersion: "DSH 版本",
      engineUpdateAvailable: "检测到 Harness 引擎新版本 {v}，将在下个应用版本中提供",
      update: "更新",
      restartBadge: "重启 ×{n}",
    },
  },
  en: {
    appName: "DeepSeek Harness Desktop",
    appSubtitle: "DeepSeek Harness Desktop",
    status: {
      idle: "Idle",
      starting: "Starting service…",
      ready: "Service ready",
      stopped: "Service stopped",
      error: "Service error",
      restarting: "Restarting service…",
    },
    statusDetail: {
      starting: "Starting the local Harness service, please wait…",
      ready: "Opening Harness workspace…",
      stopped: "Service stopped.",
      error: "Something went wrong. Check the log below or retry.",
      restarting: "The service will restart automatically…",
    },
    startFailed: "Start failed",
    timeout: "Startup timeout",
    crashed: "Service exited unexpectedly",
    restartLimit: "Auto-restart limit reached",
    spawnFailed: "Failed to launch service process",
    runtimeMissing: "DSH runtime missing",
    restartingDetail: "Service is restarting, please wait…",
    log: "Log",
    actions: {
      openBrowser: "Open in browser",
      settings: "Settings",
      retry: "Retry",
      viewLogs: "View logs",
    },
    firstRunHint: "First run: configure your model API key in Settings (top-right) of the Harness UI.",
    version: "Version",
    env: {
      title: "Runtime Environment",
      bundledNode: "Bundled Node.js (Electron)",
      bundledNodeDetail: "Built-in, no installation needed",
      systemNode: "System Node.js",
      python: "Python",
      pythonDetail: "Needed when the agent runs Python scripts (optional)",
      dshCli: "dsh CLI",
      dshCliDetail: "Use dsh in your terminal (optional)",
      install: "Install",
      installed: "Installed",
      installing: "Installing…",
      missing: "Not found",
      available: "Available",
      winget: "winget",
    },
    settings: {
      title: "Settings",
      general: "General",
      port: "Service port",
      portDetail: "If occupied, the app picks the next free port",
      autoStart: "Launch at login",
      closeToTray: "Minimize to tray on close",
      minimizeToTray: "Hide to tray on minimize",
      lanAccess: "LAN access (phone QR)",
      lanAccessDetail: "Lets your phone access this PC on the same Wi-Fi; note: exposes the service to the LAN",
      language: "Language 语言",
      languageDetail: "Follow system or choose manually (restart for full effect on menus)",
      langAuto: "Follow System (Auto)",
      data: "Data & Logs",
      dataDir: "Data directory",
      dataDirDetail: "Sessions and config files live here",
      logDir: "Log directory",
      open: "Open",
      about: "About",
      checkUpdate: "Check for updates",
      upToDate: "You are on the latest version",
      updateAvailable: "New version {v} found, opening download page",
      updatePlaceholder: "Cannot reach update source (needs GitHub access)",
      updateDownloading: "Downloading update…",
      updateReady: "Download complete, click 'Download & Install' to continue",
      updateInstalling: "Installing silently; the app will exit and restart automatically…",
      updateDownloadFailed: "Update download failed",
      updateInstallFailed: "Update install failed",
      downloadAndInstall: "Download & Install",
      saved: "Saved",
      restartTip: "Restart the service after changing the port",
      restart: "Restart service",
      restartDetail: "Takes effect after restart",
      serviceMgmt: "Service",
      currentPort: "Port {port}",
      errorPrefix: "[Error]",
      dshVersion: "DSH Version",
      engineUpdateAvailable: "New Harness engine {v} available, will ship in the next app release",
      update: "Updates",
      restartBadge: "Restarts ×{n}",
    },
  },
} as const;

export type Lang = "zh" | "en";
export type LangPref = "auto" | Lang;

let lang: Lang = "zh";

/** 解析语言偏好：auto 跟随浏览器/系统语言；仅支持 zh/en。 */
export function detectLang(pref: LangPref = "auto"): Lang {
  if (pref === "zh" || pref === "en") return pref;
  const sys = typeof navigator !== "undefined" ? navigator.language : "en";
  return /^zh/i.test(sys) ? "zh" : "en";
}

export function setLang(l: Lang) {
  lang = l;
}

type Dict = (typeof dict)["zh"];

function deepGet(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

export function t(key: string): string {
  const value = deepGet(dict[lang], key);
  if (typeof value === "string") return value;
  const fallback = deepGet(dict.zh, key);
  return typeof fallback === "string" ? fallback : key;
}
