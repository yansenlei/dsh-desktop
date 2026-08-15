/**
 * 主进程 / preload / 渲染进程之间共享的类型与常量。
 */

/** 服务端（dsh web 子进程）生命周期阶段。 */
export type ServerPhase =
  | "idle" // 尚未启动
  | "starting" // 正在启动
  | "ready" // 已就绪，UI 可达
  | "stopped" // 已停止
  | "error" // 启动失败或运行中崩溃
  | "restarting"; // 正在重启

export interface ServerStatus {
  phase: ServerPhase;
  /** 服务实际监听端口。 */
  port: number | null;
  /** 服务 URL（ready 后可用）。 */
  url: string | null;
  /** 子进程 PID。 */
  pid: number | null;
  /** 启动时间戳（epoch ms）。 */
  startedAt: number | null;
  /** 当前阶段提示文案（本地化由渲染层处理，此处给 key）。 */
  messageKey: string;
  /** 最近一次错误信息。 */
  lastError: string | null;
  /** 连续自动重启计数。 */
  restartCount: number;
}

export interface EnvCheck {
  /** Electron 内置 Node（始终可用）。 */
  bundledNode: { ok: true; version: string };
  /** 系统 PATH 中的 node（用于 dsh 命令行工具）。 */
  systemNode: { ok: boolean; version?: string };
  /** Python。 */
  python: { ok: boolean; version?: string; path?: string; source?: string };
  /** 全局 dsh 命令行。 */
  dshCli: { ok: boolean; version?: string };
  /** winget 是否可用。 */
  winget: { ok: boolean; version?: string };
}

export type InstallKind = "python" | "node-cli" | "dsh-cli";

export interface InstallProgress {
  kind: InstallKind;
  /** 阶段：detecting / downloading / installing / finishing / done / error */
  stage: string;
  /** 0-100 进度（尽力估算）。 */
  percent: number | null;
  /** 最近输出的日志行（增量追加）。 */
  lines: string[];
  error?: string;
}

export interface AppInfo {
  version: string;
  platform: NodeJS.Platform;
  arch: string;
  electron: string;
  chrome: string;
  node: string;
  dshVersion: string | null;
  userDataDir: string;
  dshHome: string;
}

export interface DesktopSettings {
  /** 首选端口；被占用时自动顺延。 */
  port: number;
  /** 数据目录（DSH_HOME）；null 表示使用默认 userData/dsh-home。 */
  dshHome: string | null;
  /** 开机自启。 */
  autoStart: boolean;
  /** 关闭主窗口时最小化到托盘而不是退出。 */
  closeToTray: boolean;
  /** 最小化时隐藏到托盘。 */
  minimizeToTray: boolean;
  /** 是否在启动失败时自动重试。 */
  autoRestart: boolean;
  /** 局域网访问：监听 0.0.0.0 并允许手机/局域网设备通过二维码访问。 */
  lanAccess: boolean;
  /** 语言：auto=跟随系统；仅支持 zh / en。 */
  language: "auto" | "zh" | "en";
}

export const DEFAULT_SETTINGS: DesktopSettings = {
  port: 3080,
  dshHome: null,
  autoStart: false,
  closeToTray: true,
  minimizeToTray: false,
  autoRestart: true,
  lanAccess: false,
  language: "auto",
};

export const IPC = {
  appInfo: "app:info",
  serverStatus: "server:status",
  serverStatusChanged: "server:status-changed",
  serverLog: "server:log",
  serverRestart: "server:restart",
  serverOpenBrowser: "server:open-browser",
  envCheck: "env:check",
  envInstall: "env:install",
  envProgress: "env:progress",
  settingsGet: "settings:get",
  settingsSet: "settings:set",
  openPath: "shell:open-path",
  openExternal: "shell:open-external",
  logsOpen: "logs:open",
  updateCheck: "update:check",
  windowMinimize: "window:minimize",
  windowClose: "window:close",
  windowSetCloseToTray: "window:set-close-to-tray",
  openSettings: "window:open-settings",
} as const;

/** 渲染层通过 preload 暴露的全局 API 名称。 */
export const PRELOAD_API = "dshDesktop";

/** 渲染进程本地页面的 URL 前缀（file:// 打包资源）。 */
export const RENDERER_BASE = "../renderer";
