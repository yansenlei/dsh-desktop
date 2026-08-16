/**
 * IPC 注册：渲染进程（壳 UI）与主进程之间的全部通道。
 */
import { ipcMain, shell, BrowserWindow, app } from "electron";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { join, dirname } from "node:path";
import { rm, mkdir } from "node:fs/promises";
import {
  IPC,
  EnvCheck,
  InstallKind,
  AppInfo,
  UpdateCheckResult,
  UpdateProgress,
} from "../shared/types";
import { DshServerManager } from "./server";
import { getSettings, setSettings } from "./settings";
import { checkEnv, installPython, installCli, onInstallProgress } from "./deps";
import { getLogDir, info, warn, error as logError } from "./logger";

export interface IpcDeps {
  server: DshServerManager;
  getAppInfo: () => AppInfo;
  openSettingsWindow: () => void;
}

/** 更新事件：下载安装包的进度广播（主进程 → 全部窗口）。 */
export function broadcastUpdateProgress(p: UpdateProgress) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.updateProgress, p);
  }
}

/** GitHub 更新源。 */
const UPDATE_REPO = "yansenlei/dsh-desktop";
const UPDATE_API = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;

/** 查询最新 release 元信息（版本号 + 当前平台安装包 asset）。 */
async function fetchLatestRelease(): Promise<{ tag: string; assetUrl: string | null; assetName: string | null } | null> {
  const res = await fetch(UPDATE_API, {
    signal: AbortSignal.timeout(8_000),
    headers: { "user-agent": "dsh-desktop", accept: "application/vnd.github+json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const tag = typeof data.tag_name === "string" ? data.tag_name.replace(/^v/, "") : null;
  // 按当前平台选择资产：
  // - win32: NSIS exe（安装器）
  // - darwin: zip（按架构 x64/arm64；解压后替换 .app，未签名场景更可靠）
  let assetUrl: string | null = null;
  let assetName: string | null = null;
  const isMac = process.platform === "darwin";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  for (const a of data.assets ?? []) {
    const name = typeof a.name === "string" ? a.name : "";
    if (isMac) {
      if (name.endsWith(".zip") && name.includes(arch) && !name.endsWith(".blockmap")) {
        assetUrl = typeof a.browser_download_url === "string" ? a.browser_download_url : null;
        assetName = name;
        break;
      }
    } else if (name.endsWith(".exe") && !name.endsWith(".blockmap")) {
      assetUrl = typeof a.browser_download_url === "string" ? a.browser_download_url : null;
      assetName = name;
      break;
    }
  }
  return tag === null ? null : { tag, assetUrl, assetName };
}

/** 下载文件（流式），返回本地路径。 */
async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(600_000) });
  if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const reader = res.body.getReader();
  const writer = createWriteStream(dest);
  let received = 0;
  let lastPct = -1;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      writer.write(Buffer.from(value));
      if (total > 0) {
        const pct = Math.min(99, Math.floor((received / total) * 100));
        if (pct !== lastPct) {
          lastPct = pct;
          broadcastUpdateProgress({ stage: "downloading", percent: pct });
        }
      }
    }
    await new Promise<void>((resolve, reject) => writer.end((err?: Error | null) => (err ? reject(err) : resolve())));
    broadcastUpdateProgress({ stage: "downloaded", percent: 100, filePath: dest });
  } finally {
    reader.releaseLock();
  }
}

/** 查询 npm 上 @deepseek-ai/dsh 最新版本（引擎上游）。 */
async function fetchEngineLatest(): Promise<string | null> {
  try {
    const res = await fetch("https://registry.npmjs.org/@deepseek-ai/dsh", {
      signal: AbortSignal.timeout(8_000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const doc = await res.json();
    const latest = doc?.["dist-tags"]?.latest;
    return typeof latest === "string" && latest ? latest : null;
  } catch {
    return null;
  }
}

/** 检查引擎更新：对比 runtime 内置 dsh 与 npm 最新版。 */
export async function checkEngineUpdate(): Promise<{ current: string | null; latest: string | null; upToDate: boolean }> {
  let current: string | null = null;
  try {
    const { readFileSync } = await import("node:fs");
    const { join: pjoin } = await import("node:path");
    const markerPath = pjoin(app.getAppPath(), "runtime", "dsh", ".dsh-runtime.json");
    const marker = JSON.parse(readFileSync(markerPath, "utf8"));
    current = typeof marker.dshVersion === "string" ? marker.dshVersion : null;
  } catch {
    /* runtime 标记缺失（开发态等）忽略 */
  }
  const latest = await fetchEngineLatest();
  return { current, latest, upToDate: latest === null || latest === current };
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

  // ── 引擎更新检查：内置 dsh vs npm 最新 ──────────────────────────────
  ipcMain.handle(IPC.engineCheck, async () => {
    const result = await checkEngineUpdate();
    info(`引擎版本检查: current=${result.current ?? "?"} latest=${result.latest ?? "?"} upToDate=${result.upToDate}`);
    return result;
  });

  // ── 更新检查：以 GitHub Releases 为更新源 ─────────────────────────
  ipcMain.handle(IPC.updateCheck, async (): Promise<UpdateCheckResult> => {
    const current = getAppInfo().version;
    try {
      const rel = await fetchLatestRelease();
      if (rel) {
        return {
          current,
          latest: rel.tag,
          upToDate: rel.tag === current,
          feedConfigured: true,
        };
      }
      return { current, latest: null, upToDate: true, feedConfigured: false };
    } catch {
      return { current, latest: null, upToDate: true, feedConfigured: false };
    }
  });

  // ── 下载更新安装包（流式，带进度广播） ─────────────────────────────
  ipcMain.handle(IPC.updateDownload, async (): Promise<UpdateProgress> => {
    try {
      const rel = await fetchLatestRelease();
      if (!rel || !rel.assetUrl) {
        const p: UpdateProgress = { stage: "error", percent: null, error: "未找到可下载的安装包（需要当前平台的 Release 资产）" };
        broadcastUpdateProgress(p);
        return p;
      }
      const destDir = join(app.getPath("temp"), "dsh-desktop-update");
      await mkdir(destDir, { recursive: true });
      const dest = join(destDir, rel.assetName ?? (process.platform === "darwin" ? "dsh-desktop-update.zip" : "dsh-desktop-setup.exe"));
      await rm(dest, { force: true });
      info(`开始下载更新: ${rel.tag} → ${dest}`);
      broadcastUpdateProgress({ stage: "downloading", percent: 0 });
      await downloadToFile(rel.assetUrl, dest);
      const ok: UpdateProgress = { stage: "downloaded", percent: 100, filePath: dest };
      broadcastUpdateProgress(ok);
      return ok;
    } catch (err) {
      logError(`更新下载失败: ${(err as Error).message}`);
      const p: UpdateProgress = { stage: "error", percent: null, error: (err as Error).message };
      broadcastUpdateProgress(p);
      return p;
    }
  });

  // ── 安装更新：Windows 用 NSIS 静默安装；macOS 解压 zip 替换 .app ──
  ipcMain.handle(IPC.updateInstall, async (_e, filePath?: string): Promise<{ ok: boolean; error?: string }> => {
    const installer = filePath || join(
      app.getPath("temp"),
      "dsh-desktop-update",
      process.platform === "darwin" ? "dsh-desktop-update.zip" : "dsh-desktop-setup.exe",
    );
    try {
      const { stat } = await import("node:fs/promises");
      await stat(installer);
    } catch {
      return { ok: false, error: `安装包不存在: ${installer}` };
    }
    info(`开始安装更新: ${installer}`);
    broadcastUpdateProgress({ stage: "installing", percent: null });

    if (process.platform === "darwin") {
      // macOS：写一个 detached 脚本，等本应用退出后解压 zip 并替换 .app，
      // 最后重新启动。ditto 保留权限/符号链接；替换前移除 quarantine 属性
      // （未签名场景下避免 Gatekeeper 二次拦截）。
      const script = join(app.getPath("temp"), "dsh-desktop-update", "update-mac.sh");
      const appPath = app.getAppPath(); // 打包后为 .../DeepSeek Harness Desktop.app/Contents/Resources/app.asar
      const appRoot = join(dirname(dirname(dirname(appPath)))); // .app 根目录
      const scriptBody = [
        "#!/bin/sh",
        'sleep 2 # 等待本应用退出',
        `ZIP="${installer.replace(/"/g, '\\"')}"`,
        `APP="${appRoot.replace(/"/g, '\\"')}"`,
        "TMP=\"$(mktemp -d)\"",
        'ditto -xk "$ZIP" "$TMP"',
        'NEWAPP="$(find "$TMP" -maxdepth 2 -name "*.app" -type d | head -1)"',
        'if [ -z "$NEWAPP" ]; then echo "解压后未找到 .app"; exit 1; fi',
        'rm -rf "$APP"',
        'mv "$NEWAPP" "$APP"',
        'xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true',
        'rm -rf "$TMP" "$ZIP"',
        'open "$APP"',
      ].join("\n");
      try {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(script, scriptBody, { encoding: "utf8", mode: 0o755 });
      } catch (err) {
        const msg = `写入更新脚本失败: ${(err as Error).message}`;
        logError(msg);
        broadcastUpdateProgress({ stage: "error", percent: null, error: msg });
        return { ok: false, error: msg };
      }
      const child = spawn("/bin/sh", [script], { detached: true, stdio: "ignore" });
      child.on("error", (err) => {
        logError(`启动更新脚本失败: ${err.message}`);
        broadcastUpdateProgress({ stage: "error", percent: null, error: err.message });
      });
      child.unref();
      setTimeout(() => {
        broadcastUpdateProgress({ stage: "done", percent: 100 });
        app.quit();
      }, 500);
      return { ok: true };
    }

    // Windows：NSIS 静默安装（/S）；安装完成后应用自退出，由安装器拉起新版本。
    const child = spawn(installer, ["/S"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", (err) => {
      logError(`启动安装器失败: ${err.message}`);
      broadcastUpdateProgress({ stage: "error", percent: null, error: err.message });
    });
    child.unref();
    // 让安装器接管后，本应用退出
    setTimeout(() => {
      broadcastUpdateProgress({ stage: "done", percent: 100 });
      app.quit();
    }, 500);
    return { ok: true };
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
