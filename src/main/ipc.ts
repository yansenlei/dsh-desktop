/**
 * IPC 注册：渲染进程（壳 UI）与主进程之间的全部通道。
 */
import { ipcMain, shell, BrowserWindow, app } from "electron";
import { IPC, EnvCheck, InstallKind, AppInfo } from "../shared/types";
import { DshServerManager } from "./server";
import { getSettings, setSettings } from "./settings";
import { checkEnv, installPython, installCli, onInstallProgress } from "./deps";
import { getLogDir, info } from "./logger";

export interface IpcDeps {
  server: DshServerManager;
  getAppInfo: () => AppInfo;
  openSettingsWindow: () => void;
}

export function registerIpc(deps: IpcDeps) {
  const { server, getAppInfo, openSettingsWindow } = deps;

  // ── 基础信息 ─────────────────────────────────────────────
  ipcMain.handle(IPC.appInfo, () => getAppInfo());

  // ── 服务状态 ─────────────────────────────────────────────
  ipcMain.handle(IPC.serverStatus, () => server.getStatus());
  ipcMain.handle(IPC.serverRestart, async () => {
    await server.stop();
    await server.start();
    return server.getStatus();
  });
  ipcMain.handle(IPC.serverOpenBrowser, () => {
    const st = server.getStatus();
    if (st.url) shell.openExternal(st.url);
  });

  // ── 服务日志（增量推送） ─────────────────────────────────
  server.onLog((line) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.serverLog, line);
    }
  });

  // ── 环境检测与一键安装 ───────────────────────────────────
  ipcMain.handle(IPC.envCheck, async (): Promise<EnvCheck> => checkEnv());
  ipcMain.handle(IPC.envInstall, async (_e, kind: InstallKind): Promise<boolean> => {
    if (kind === "python") return installPython();
    if (kind === "dsh-cli") return installCli();
    return false;
  });

  onInstallProgress((p) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.envProgress, p);
    }
  });

  // ── 设置 ─────────────────────────────────────────────────
  ipcMain.handle(IPC.settingsGet, () => getSettings());
  ipcMain.handle(IPC.settingsSet, (_e, patch: Record<string, unknown>) => {
    const next = setSettings(patch as never);
    info(`设置已更新: ${JSON.stringify(next)}`);
    if (typeof patch.autoStart === "boolean") {
      app.setLoginItemSettings({ openAtLogin: patch.autoStart });
    }
    return next;
  });

  // ── 路径/外部打开 ────────────────────────────────────────
  ipcMain.handle(IPC.openPath, (_e, p: string) => {
    shell.openPath(p);
  });
  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
  ipcMain.handle(IPC.logsOpen, () => {
    shell.openPath(getLogDir());
  });

  // ── 更新检查：以 GitHub Releases 为更新源 ─────────────────────────
  ipcMain.handle(IPC.updateCheck, async () => {
    const current = getAppInfo().version;
    try {
      const res = await fetch("https://api.github.com/repos/yansenlei/dsh-desktop/releases/latest", {
        signal: AbortSignal.timeout(8_000),
        headers: { "user-agent": "dsh-desktop", accept: "application/vnd.github+json" },
      });
      if (res.ok) {
        const data = await res.json();
        const latest = typeof data.tag_name === "string" ? data.tag_name.replace(/^v/, "") : null;
        return { current, latest, upToDate: !latest || latest === current, feedConfigured: true };
      }
      return { current, latest: null, upToDate: true, feedConfigured: false };
    } catch {
      return { current, latest: null, upToDate: true, feedConfigured: false };
    }
  });

  // ── 窗口控制 ─────────────────────────────────────────────
  ipcMain.handle(IPC.windowMinimize, (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize();
  });
  ipcMain.handle(IPC.windowClose, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) win.close();
  });
  ipcMain.handle(IPC.windowSetCloseToTray, (_e, v: boolean) => {
    setSettings({ closeToTray: v });
  });
  ipcMain.handle(IPC.openSettings, () => {
    openSettingsWindow();
  });

  // 供托盘菜单使用
  void openSettingsWindow;
}
