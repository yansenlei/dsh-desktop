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
  UpdateProgress,
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
  checkUpdate: (): Promise<import("../shared/types").UpdateCheckResult> =>
    ipcRenderer.invoke(IPC.updateCheck),
  getUpdateInfo: (): Promise<{ version: string; body: string | null } | null> =>
    ipcRenderer.invoke(IPC.updateInfo),
  checkEngineUpdate: (): Promise<import("../shared/types").EngineCheckResult> =>
    ipcRenderer.invoke(IPC.engineCheck),
  updateEngine: (): Promise<{ ok: boolean; version?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.engineUpdate),
  revertEngine: (): Promise<{ ok: boolean; version?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.engineRevert),
  onEngineProgress: (fn: (p: import("../shared/types").EngineUpdateProgress) => void) => {
    const listener = (_e: unknown, p: import("../shared/types").EngineUpdateProgress) => fn(p);
    ipcRenderer.on(IPC.engineProgress, listener);
    return () => ipcRenderer.removeListener(IPC.engineProgress, listener);
  },
  downloadUpdate: (): Promise<{ stage: string; percent: number | null; filePath?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.updateDownload),
  installUpdate: (filePath?: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.updateInstall, filePath),
  getUpdateStatus: (): Promise<{ phase: string; progress: UpdateProgress | null }> =>
    ipcRenderer.invoke(IPC.updateStatus),
  cancelUpdate: (): Promise<boolean> => ipcRenderer.invoke(IPC.updateCancel),
  onUpdateProgress: (fn: (p: UpdateProgress) => void) => {
    const listener = (_e: unknown, p: UpdateProgress) => fn(p);
    ipcRenderer.on(IPC.updateProgress, listener);
    return () => ipcRenderer.removeListener(IPC.updateProgress, listener);
  },
  onFocusAbout: (fn: (payload: { version?: string }) => void) => {
    const listener = (_e: unknown, payload: { version?: string }) => fn(payload ?? {});
    ipcRenderer.on(IPC.settingsFocusAbout, listener);
    return () => ipcRenderer.removeListener(IPC.settingsFocusAbout, listener);
  },

  // 窗口控制
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.windowMinimize),
  closeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.windowClose),
  setCloseToTray: (v: boolean): Promise<void> => ipcRenderer.invoke(IPC.windowSetCloseToTray, v),
  openSettings: (): Promise<void> => ipcRenderer.invoke(IPC.openSettings),
};

contextBridge.exposeInMainWorld(PRELOAD_API, api);

export type DesktopApi = typeof api;
