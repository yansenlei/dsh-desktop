/**
 * IPC 注册：渲染进程（壳 UI）与主进程之间的全部通道。
 */
import { ipcMain, shell, BrowserWindow, app, dialog } from "electron";
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
import { t } from "./l10n";

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

// ── 更新状态机（设置页关闭重开后据此恢复 UI；取消下载据此中断） ──
type UpdatePhase = "idle" | "downloading" | "downloaded" | "installing";
let updatePhase: UpdatePhase = "idle";
let updateAbort: AbortController | null = null;
let lastUpdateProgress: UpdateProgress | null = null;

function pushProgress(p: UpdateProgress) {
  lastUpdateProgress = p;
  broadcastUpdateProgress(p);
}

/** 更新检查（启动检查 / 每日定时 / 设置页手动检查共用）。 */
export async function checkAutoUpdate(): Promise<UpdateCheckResult> {
  const current = app.getVersion();
  try {
    const rel = await fetchLatestRelease();
    if (rel) {
      return { current, latest: rel.tag, upToDate: rel.tag === current, feedConfigured: true };
    }
    return { current, latest: null, upToDate: false, feedConfigured: false };
  } catch {
    return { current, latest: null, upToDate: false, feedConfigured: false };
  }
}

/** GitHub 更新源。 */
const UPDATE_REPO = "yansenlei/dsh-desktop";
const UPDATE_API = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
/** 兜底源：与下载页同源的 site/latest.json（jsDelivr 国内可达、无 API 限额）。 */
const LATEST_JSON_SOURCES = [
  `https://cdn.jsdelivr.net/gh/${UPDATE_REPO}@main/site/latest.json`,
  `https://raw.githubusercontent.com/${UPDATE_REPO}/main/site/latest.json`,
];

async function fetchJson(url: string, timeoutMs: number): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": "dsh-desktop", accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 按平台挑选资产：mac 用 zip（按架构），Windows 用 exe。 */
function pickAsset(
  assets: { name: string; url: string }[],
  macArch: string,
): { assetUrl: string | null; assetName: string | null } {
  for (const a of assets) {
    const name = a.name || "";
    if (process.platform === "darwin") {
      if (name.endsWith(".zip") && name.includes(macArch) && !name.endsWith(".blockmap")) {
        return { assetUrl: a.url || null, assetName: name };
      }
    } else if (name.endsWith(".exe") && !name.endsWith(".blockmap")) {
      return { assetUrl: a.url || null, assetName: name };
    }
  }
  return { assetUrl: null, assetName: null };
}

/**
 * 查询最新 release 元信息（版本号 + 当前平台安装包 asset）。
 * 主源 GitHub API（实时）；失败/限流（403 rate limit）时回退
 * jsDelivr / GitHub raw 的 site/latest.json（与下载页同源，国内可达）。
 */
async function fetchLatestRelease(): Promise<{ tag: string; assetUrl: string | null; assetName: string | null; source: string } | null> {
  const arch = process.arch === "arm64" ? "arm64" : "x64";

  // 1) GitHub API（实时，但未鉴权有 60 次/小时/IP 限额，国内网络也可能不通）
  const api = await fetchJson(UPDATE_API, 8_000);
  if (api && typeof api.tag_name === "string" && Array.isArray(api.assets)) {
    const tag = String(api.tag_name).replace(/^v/, "");
    const assets = (api.assets as { name?: string; browser_download_url?: string }[]).map((a) => ({
      name: typeof a.name === "string" ? a.name : "",
      url: typeof a.browser_download_url === "string" ? a.browser_download_url : "",
    }));
    return { tag, ...pickAsset(assets, arch), source: "github" };
  }

  // 2) latest.json 兜底：版本号取 latest，下载文件名取对应平台资产
  for (const url of LATEST_JSON_SOURCES) {
    const j = await fetchJson(url, 8_000);
    if (!j || typeof j.latest !== "string") continue;
    const latest = String(j.latest).replace(/^v/, "");
    const plat = (process.platform === "darwin" ? (arch === "arm64" ? j.macApple : j.macIntel) : j.windows) as
      | { ver?: string; zip?: string; dmg?: string; exe?: string }
      | undefined;
    if (!plat || typeof plat.ver !== "string") continue;
    const file = process.platform === "darwin" ? plat.zip || plat.dmg : plat.exe;
    if (typeof file !== "string" || !file) continue;
    const pver = plat.ver.replace(/^v/, "");
    return {
      tag: latest,
      assetUrl: `https://github.com/${UPDATE_REPO}/releases/download/v${pver}/${file}`,
      assetName: file,
      source: "latest-json",
    };
  }
  return null;
}

/** 下载文件（流式，多源重试），返回本地路径。 */
const DOWNLOAD_SOURCES = [
  { name: "gh-proxy.com", prefix: "https://gh-proxy.com/" },
  { name: "github-direct", prefix: "" },
  { name: "ghproxy.net", prefix: "https://ghproxy.net/" },
];
const DOWNLOAD_ATTEMPTS_PER_SOURCE = 2;
const DOWNLOAD_TIMEOUT_MS = 20 * 60 * 1000; // 慢速网络下 183MB 可能需十几分钟

async function downloadOnce(url: string, dest: string, signal: AbortSignal | null): Promise<void> {
  const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  const ctl = signal ? AbortSignal.any([timeout, signal]) : timeout;
  const res = await fetch(url, { signal: ctl });
  if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const reader = res.body.getReader();
  const writer = createWriteStream(dest);
  let received = 0;
  let lastPct = -1;
  let lastTick = Date.now();
  let lastBytes = 0;
  let emaSpeed = 0; // 500ms 窗口瞬时速度的 EMA，避免跳变
  let lastBcast = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      writer.write(Buffer.from(value));
      const now = Date.now();
      if (now - lastTick >= 500) {
        const inst = (received - lastBytes) / ((now - lastTick) / 1000);
        emaSpeed = emaSpeed ? emaSpeed * 0.6 + inst * 0.4 : inst;
        lastTick = now;
        lastBytes = received;
      }
      // 250ms 节流广播：百分比 + 已下载/总大小 + 网速
      if (now - lastBcast >= 250) {
        lastBcast = now;
        const pct = total > 0 ? Math.min(99, Math.floor((received / total) * 100)) : null;
        if (pct !== null && pct !== lastPct) lastPct = pct;
        pushProgress({
          stage: "downloading",
          percent: pct,
          downloadedBytes: received,
          totalBytes: total,
          speedBps: Math.round(emaSpeed),
        });
      }
    }
    await new Promise<void>((resolve, reject) => writer.end((err?: Error | null) => (err ? reject(err) : resolve())));
    pushProgress({ stage: "downloaded", percent: 100, downloadedBytes: received, totalBytes: total, speedBps: 0, filePath: dest });
  } finally {
    reader.releaseLock();
  }
}

async function downloadToFile(url: string, dest: string, signal: AbortSignal | null): Promise<void> {
  let lastErr: Error | null = null;
  for (const src of DOWNLOAD_SOURCES) {
    const full = src.prefix ? src.prefix + url : url;
    for (let i = 1; i <= DOWNLOAD_ATTEMPTS_PER_SOURCE; i++) {
      try {
        info(`更新下载: 源=${src.name} 第${i}次`);
        await downloadOnce(full, dest, signal);
        info(`更新下载完成（源=${src.name}）`);
        return;
      } catch (err) {
        lastErr = err as Error;
        if ((err as Error).name === "AbortError") throw err; // 用户取消，直接上抛
        warn(`更新下载失败（源=${src.name} 第${i}次）: ${lastErr.message}`);
        pushProgress({ stage: "retrying", percent: null });
      }
    }
  }
  logError(`更新下载所有源均失败，最后错误: ${lastErr?.message ?? "unknown"}`);
  throw new Error("ALL_SOURCES_FAILED");
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

  // ── 更新检查：以 GitHub Releases 为更新源（API 失败时回退 latest.json CDN） ──
  ipcMain.handle(IPC.updateCheck, async (): Promise<UpdateCheckResult> => {
    const r = await checkAutoUpdate();
    if (r.feedConfigured) {
      info(`更新检查: current=${r.current} latest=${r.latest} upToDate=${r.upToDate}`);
    } else {
      warn("更新检查失败: 所有更新源均不可用（GitHub API 与 latest.json CDN）");
    }
    return r;
  });

  // ── 下载更新安装包（流式，带进度广播；支持取消与状态恢复） ─────────
  ipcMain.handle(IPC.updateDownload, async (): Promise<UpdateProgress> => {
    if (updatePhase === "downloading") {
      const p: UpdateProgress = { stage: "error", percent: null, error: "ALREADY_DOWNLOADING" };
      return p;
    }
    const abort = new AbortController();
    updateAbort = abort;
    updatePhase = "downloading";
    try {
      const rel = await fetchLatestRelease();
      if (!rel || !rel.assetUrl) {
        const p: UpdateProgress = { stage: "error", percent: null, error: "NO_ASSET" };
        updatePhase = "idle";
        pushProgress(p);
        return p;
      }
      const destDir = join(app.getPath("temp"), "dsh-desktop-update");
      await mkdir(destDir, { recursive: true });
      const dest = join(destDir, rel.assetName ?? (process.platform === "darwin" ? "dsh-desktop-update.zip" : "dsh-desktop-setup.exe"));
      await rm(dest, { force: true });
      info(`开始下载更新: ${rel.tag} → ${dest}`);
      pushProgress({ stage: "downloading", percent: 0 });
      await downloadToFile(rel.assetUrl, dest, abort.signal);
      const ok: UpdateProgress = { stage: "downloaded", percent: 100, filePath: dest };
      updatePhase = "downloaded";
      pushProgress(ok);
      return ok;
    } catch (err) {
      const isCancel = (err as Error).name === "AbortError";
      updatePhase = "idle";
      const p: UpdateProgress = isCancel
        ? { stage: "cancelled", percent: null }
        : { stage: "error", percent: null, error: (err as Error).message };
      if (!isCancel) logError(`更新下载失败: ${(err as Error).message}`);
      pushProgress(p);
      return p;
    } finally {
      updateAbort = null;
      if (updatePhase === "downloading") updatePhase = "idle";
    }
  });

  // ── 更新状态查询：设置页打开时恢复下载中的 UI 状态 ────────────────
  ipcMain.handle(IPC.updateStatus, (): { phase: UpdatePhase; progress: UpdateProgress | null } => {
    return { phase: updatePhase, progress: lastUpdateProgress };
  });

  // ── 取消下载：弹原生确认框，确认后中断当前下载 ─────────────────────
  ipcMain.handle(IPC.updateCancel, async (e): Promise<boolean> => {
    if (updatePhase !== "downloading" || !updateAbort) return false;
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      type: "question" as const,
      buttons: [t("update.keep"), t("update.cancelDownload")],
      defaultId: 0,
      cancelId: 0,
      message: t("update.cancelMsg"),
      detail: t("update.cancelDetail"),
    };
    const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    if (response === 1) {
      info("用户取消更新下载");
      updateAbort.abort();
      return true;
    }
    return false;
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
      return { ok: false, error: "NO_INSTALLER" };
    }
    info(`开始安装更新: ${installer}`);
    updatePhase = "installing";
    pushProgress({ stage: "installing", percent: null });

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
        const msg = (err as Error).message; // 详情只进日志，界面显示语言无关的错误码
        logError(msg);
        updatePhase = "idle";
        pushProgress({ stage: "error", percent: null, error: "SCRIPT_WRITE_FAILED" });
        return { ok: false, error: "SCRIPT_WRITE_FAILED" };
      }
      const child = spawn("/bin/sh", [script], { detached: true, stdio: "ignore" });
      child.on("error", (err) => {
        logError(`启动更新脚本失败: ${err.message}`);
        updatePhase = "idle";
        pushProgress({ stage: "error", percent: null, error: "SCRIPT_LAUNCH_FAILED" });
      });
      child.unref();
      setTimeout(() => {
        pushProgress({ stage: "done", percent: 100 });
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
      updatePhase = "idle";
      pushProgress({ stage: "error", percent: null, error: "INSTALLER_LAUNCH_FAILED" });
    });
    child.unref();
    // 让安装器接管后，本应用退出
    setTimeout(() => {
      pushProgress({ stage: "done", percent: 100 });
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
