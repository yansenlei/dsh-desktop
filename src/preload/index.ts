/**
 * Preload：通过 contextBridge 向壳 UI 暴露类型安全的主进程 API。
 * 渲染进程保持 sandbox + contextIsolation，无 Node 访问。
 */
import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  PRELOAD_API,
  AppInfo,
  ServerStatus,
  EnvCheck,
  InstallKind,
  InstallProgress,
  DesktopSettings,
} from "../shared/types";

const api = {
  // 基础信息
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.appInfo),

  // 服务状态
  getServerStatus: (): Promise<ServerStatus> => ipcRenderer.invoke(IPC.serverStatus),
  onServerStatusChanged: (fn: (st: ServerStatus) => void) => {
    const listener = (_e: unknown, st: ServerStatus) => fn(st);
    ipcRenderer.on(IPC.serverStatusChanged, listener);
    return () => ipcRenderer.removeListener(IPC.serverStatusChanged, listener);
  },
  onServerLog: (fn: (line: string) => void) => {
    const listener = (_e: unknown, line: string) => fn(line);
    ipcRenderer.on(IPC.serverLog, listener);
    return () => ipcRenderer.removeListener(IPC.serverLog, listener);
  },
  restartServer: (): Promise<ServerStatus> => ipcRenderer.invoke(IPC.serverRestart),
  openInBrowser: (): Promise<void> => ipcRenderer.invoke(IPC.serverOpenBrowser),

  // 环境检测与一键安装
  checkEnv: (): Promise<EnvCheck> => ipcRenderer.invoke(IPC.envCheck),
  install: (kind: InstallKind): Promise<boolean> => ipcRenderer.invoke(IPC.envInstall, kind),
  onInstallProgress: (fn: (p: InstallProgress) => void) => {
    const listener = (_e: unknown, p: InstallProgress) => fn(p);
    ipcRenderer.on(IPC.envProgress, listener);
    return () => ipcRenderer.removeListener(IPC.envProgress, listener);
  },

  // 设置
  getSettings: (): Promise<DesktopSettings> => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch: Partial<DesktopSettings>): Promise<DesktopSettings> =>
    ipcRenderer.invoke(IPC.settingsSet, patch),

  // 路径 / 外部打开
  openPath: (p: string): Promise<string> => ipcRenderer.invoke(IPC.openPath, p),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),
  openLogsDir: (): Promise<void> => ipcRenderer.invoke(IPC.logsOpen),

  // 更新
  checkUpdate: (): Promise<{ current: string; latest: string | null; upToDate: boolean; feedConfigured: boolean }> =>
    ipcRenderer.invoke(IPC.updateCheck),
  checkEngineUpdate: (): Promise<{ current: string | null; latest: string | null; upToDate: boolean }> =>
    ipcRenderer.invoke(IPC.engineCheck),
  downloadUpdate: (): Promise<{ stage: string; percent: number | null; filePath?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.updateDownload),
  installUpdate: (filePath?: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.updateInstall, filePath),
  onUpdateProgress: (fn: (p: { stage: string; percent: number | null; filePath?: string; error?: string }) => void) => {
    const listener = (_e: unknown, p: { stage: string; percent: number | null; filePath?: string; error?: string }) => fn(p);
    ipcRenderer.on(IPC.updateProgress, listener);
    return () => ipcRenderer.removeListener(IPC.updateProgress, listener);
  },

  // 窗口控制
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.windowMinimize),
  closeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.windowClose),
  setCloseToTray: (v: boolean): Promise<void> => ipcRenderer.invoke(IPC.windowSetCloseToTray, v),
  openSettings: (): Promise<void> => ipcRenderer.invoke(IPC.openSettings),
};

contextBridge.exposeInMainWorld(PRELOAD_API, api);

export type DesktopApi = typeof api;
