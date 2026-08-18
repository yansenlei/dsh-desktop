/**
 * IPC 注册：渲染进程（壳 UI）与主进程之间的全部通道。
 */
import { ipcMain, shell, BrowserWindow, app, dialog } from "electron";
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, cpSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { rm, mkdir } from "node:fs/promises";
import {
  IPC,
  EnvCheck,
  InstallKind,
  AppInfo,
  UpdateCheckResult,
  UpdateProgress,
  EngineCheckResult,
  EngineUpdateProgress,
  PluginInstallRequest,
  PluginInstallResult,
  PluginManageRequest,
  PluginManageResult,
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
  /** DSH 运行时目录（打包后为 resources/dsh-runtime，开发为项目 runtime/）。 */
  runtimeDir: string;
  /** DSH_HOME（profile 所在目录）。 */
  dshHome: string;
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
      if (rel.tag !== current) {
        lastNewVersionInfo = { version: rel.tag, body: rel.body ?? null };
      }
      return { current, latest: rel.tag, upToDate: rel.tag === current, feedConfigured: true, body: rel.body ?? null };
    }
    return { current, latest: null, upToDate: false, feedConfigured: false, body: null };
  } catch {
    return { current, latest: null, upToDate: false, feedConfigured: false, body: null };
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
let lastNewVersionInfo: { version: string; body: string | null } | null = null;

async function fetchLatestRelease(): Promise<{ tag: string; assetUrl: string | null; assetName: string | null; source: string; body: string | null } | null> {
  const arch = process.arch === "arm64" ? "arm64" : "x64";

  // 1) GitHub API（实时，但未鉴权有 60 次/小时/IP 限额，国内网络也可能不通）
  const api = await fetchJson(UPDATE_API, 8_000);
  if (api && typeof api.tag_name === "string" && Array.isArray(api.assets)) {
    const tag = String(api.tag_name).replace(/^v/, "");
    const assets = (api.assets as { name?: string; browser_download_url?: string }[]).map((a) => ({
      name: typeof a.name === "string" ? a.name : "",
      url: typeof a.browser_download_url === "string" ? a.browser_download_url : "",
    }));
    return { tag, ...pickAsset(assets, arch), source: "github", body: typeof api.body === "string" ? api.body : null };
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
      body: null,
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

// ── 引擎独立更新：内置 npm CLI + 真实 npm install 更新整棵运行时依赖树 ──
let engineUpdating = false;

interface MarketEntry {
  name: string;
  disabled?: boolean;
}

interface MarketList {
  plugins: MarketEntry[];
}

/** 读取插件市场清单（兼容旧版 string[]）。 */
function readMarketList(dshHome: string): MarketList {
  const raw = readJson(join(dshHome, "plugin-market.json")) as { plugins?: unknown } | null;
  const arr = Array.isArray(raw?.plugins) ? raw!.plugins : [];
  const plugins: MarketEntry[] = arr.map((p) =>
    typeof p === "string" ? { name: p } : { name: String((p as MarketEntry).name ?? ""), disabled: Boolean((p as MarketEntry).disabled) },
  ).filter((p) => p.name);
  return { plugins };
}

function writeMarketList(dshHome: string, list: MarketList) {
  writeFileSync(join(dshHome, "plugin-market.json"), JSON.stringify(list, null, 2), "utf8");
}

/** profile package.json 的 dsh.profile.bundles（随 profile 启动加载的插件）。 */
function readProfileBundles(profileDir: string): string[] {
  const pkg = readJson(join(profileDir, "package.json")) as { dsh?: { profile?: { bundles?: unknown } } } | null;
  const b = pkg?.dsh?.profile?.bundles;
  return Array.isArray(b) ? b.filter((x): x is string => typeof x === "string") : [];
}

function writeProfileBundles(profileDir: string, bundles: string[]) {
  const p = join(profileDir, "package.json");
  const pkg = (readJson(p) ?? {}) as { dsh?: { profile?: { bundles?: string[] } } };
  if (!pkg.dsh) pkg.dsh = {};
  if (!pkg.dsh.profile) pkg.dsh.profile = {};
  pkg.dsh.profile.bundles = bundles;
  writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n", "utf8");
}

function readJson(p: string): Record<string, unknown> | null {
  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function readRuntimeMarker(runtimeDir: string): Record<string, unknown> {
  return readJson(join(runtimeDir, "dsh", ".dsh-runtime.json")) ?? {};
}

function writeRuntimeMarker(runtimeDir: string, marker: Record<string, unknown>) {
  try {
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(join(runtimeDir, "dsh", ".dsh-runtime.json"), JSON.stringify(marker, null, 2), "utf8");
  } catch (err) {
    warn(`写入运行时标记失败: ${(err as Error).message}`);
  }
}

function npmCliPath(runtimeDir: string): string {
  return join(runtimeDir, "dsh", "npm-cli", "node_modules", "npm", "bin", "npm-cli.js");
}

function hasBundledNpm(runtimeDir: string): boolean {
  return existsSync(npmCliPath(runtimeDir));
}

/** 用内置 npm CLI 执行 npm 命令（runtimeDir 定位 CLI，cwd 为执行目录）。 */
function runNpm(runtimeDir: string, cwd: string, args: string[]): { code: number | null; log: string } {
  const cli = npmCliPath(runtimeDir);
  const cache = join(app.getPath("temp"), "dsh-npm-cache");
  const child = spawnSync(process.execPath, [cli, "--cache", cache, ...args], {
    cwd,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      npm_config_loglevel: "error",
      npm_config_update_notifier: "false",
    },
    encoding: "utf8",
    timeout: 20 * 60 * 1000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const log = `${child.stdout ?? ""}\n${child.stderr ?? ""}`.trim();
  if (child.status !== 0) warn(`npm 执行失败 (code=${child.status}): ${log.slice(0, 600)}`);
  return { code: child.status, log };
}

/** 引擎独立更新：npm install @deepseek-ai/dsh@<版本> → 平台包补齐 → 标记 →（mac 重签名）。 */
async function performEngineUpdate(runtimeDir: string, targetVersion: string | null): Promise<{ ok: boolean; version?: string; error?: string }> {
  const marker = readRuntimeMarker(runtimeDir);
  const current = typeof marker.dshVersion === "string" ? marker.dshVersion : null;
  if (!hasBundledNpm(runtimeDir)) return { ok: false, error: "NO_NPM" };
  const target = targetVersion ?? (await fetchEngineLatest());
  if (!target) return { ok: false, error: "NO_TARGET" };
  broadcastEngineProgress({ stage: "installing", percent: 10, version: target });

  // 0) 备份内置插件：npm install 会把外置的 @dsh-desktop/* 当多余包剪掉，需事后恢复
  const pluginsDir = join(runtimeDir, "dsh", "node_modules", "@dsh-desktop");
  const pluginsBak = join(app.getPath("temp"), "dsh-plugins-backup");
  const restorePlugins = () => {
    try {
      rmSync(pluginsDir, { recursive: true, force: true });
      if (existsSync(pluginsBak)) cpSync(pluginsBak, pluginsDir, { recursive: true });
    } catch (err) {
      warn(`恢复内置插件失败: ${(err as Error).message}`);
    }
  };
  if (existsSync(pluginsDir)) {
    rmSync(pluginsBak, { recursive: true, force: true });
    cpSync(pluginsDir, pluginsBak, { recursive: true });
  }

  // 1) 整树安装（npm 真实解析：新引擎的 @deepseek-ai/* 依赖随同版本升级）
  const spec = targetVersion ? `@deepseek-ai/dsh@${targetVersion}` : "@deepseek-ai/dsh@latest";
  const r1 = runNpm(runtimeDir, join(runtimeDir, "dsh"), ["install", "--no-audit", "--no-fund", "--ignore-scripts", spec]);
  if (r1.code !== 0) {
    restorePlugins();
    return { ok: false, error: `NPM_FAILED:${r1.log.slice(0, 300)}` };
  }
  restorePlugins();
  broadcastEngineProgress({ stage: "installing", percent: 70 });

  // 2) 平台原生包补齐（koffi / sharp），合并为一次 install（与 prepare-runtime 同款逻辑）
  const platPkgs: string[] = [];
  const koffiVer = (readJson(join(runtimeDir, "dsh", "node_modules", "koffi", "package.json"))?.version as string | undefined);
  const koromixDir = join(runtimeDir, "dsh", "node_modules", "@koromix");
  const imgDir = join(runtimeDir, "dsh", "node_modules", "@img");
  if (process.platform === "darwin") {
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    if (koffiVer && !existsSync(join(koromixDir, `koffi-darwin-${arch}`))) platPkgs.push(`@koromix/koffi-darwin-${arch}@${koffiVer}`);
    if (!existsSync(join(imgDir, `sharp-darwin-${arch}`))) platPkgs.push(`@img/sharp-darwin-${arch}`);
  } else if (process.platform === "win32") {
    if (koffiVer && !existsSync(join(koromixDir, "koffi-win32-x64"))) platPkgs.push(`@koromix/koffi-win32-x64@${koffiVer}`);
  }
  if (platPkgs.length > 0) {
    const r2 = runNpm(runtimeDir, join(runtimeDir, "dsh"), ["install", "--no-save", "--no-audit", "--no-fund", "--ignore-scripts", ...platPkgs]);
    if (r2.code !== 0) return { ok: false, error: `NPM_FAILED:${r2.log.slice(0, 300)}` };
  }
  broadcastEngineProgress({ stage: "finishing", percent: 90 });

  // 3) 校验安装结果 + 更新标记（记录上一版本用于恢复）
  const installed = readJson(join(runtimeDir, "dsh", "node_modules", "@deepseek-ai", "dsh", "package.json"));
  const installedVer = typeof installed?.version === "string" ? installed.version : null;
  if (!installedVer || (targetVersion !== null && installedVer !== targetVersion)) {
    return { ok: false, error: "VERIFY_FAILED" };
  }
  marker.dshVersion = installedVer;
  if (current && current !== installedVer) marker.prevVersion = current;
  writeRuntimeMarker(runtimeDir, marker);

  // 4) macOS：运行时在签名封印内，替换后需重新 ad-hoc 签名，否则 Gatekeeper 拦截
  if (process.platform === "darwin") {
    try {
      const resourcesPath = process.resourcesPath ?? "";
      const appRoot = join(dirname(dirname(resourcesPath))); // .../Contents/Resources → .app
      spawnSync("codesign", ["--force", "--deep", "--sign", "-", appRoot], { stdio: "ignore" });
      spawnSync("xattr", ["-dr", "com.apple.quarantine", appRoot], { stdio: "ignore" });
    } catch (err) {
      warn(`引擎更新后重签名失败: ${(err as Error).message}`);
    }
  }

  broadcastEngineProgress({ stage: "done", percent: 100, version: installedVer });
  info(`引擎独立更新完成: v${current ?? "?"} → v${installedVer}`);
  return { ok: true, version: installedVer };
}

function broadcastEngineProgress(p: EngineUpdateProgress) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.engineProgress, p);
  }
}

/** 检查引擎更新：对比 runtime 内置 dsh 与 npm 最新版（修正打包后标记路径）。 */
export async function checkEngineUpdate(runtimeDir: string): Promise<EngineCheckResult> {
  const marker = readRuntimeMarker(runtimeDir);
  const current = typeof marker.dshVersion === "string" ? marker.dshVersion : null;
  const prevVersion = typeof marker.prevVersion === "string" ? marker.prevVersion : null;
  const latest = await fetchEngineLatest();
  return {
    current,
    latest,
    upToDate: latest === null || latest === current,
    canUpdate: hasBundledNpm(runtimeDir) && latest !== null && latest !== current,
    prevVersion,
  };
}

export function registerIpc(deps: IpcDeps) {
  const { server, getAppInfo, openSettingsWindow, runtimeDir, dshHome } = deps;

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

  // ── 引擎更新检查：内置 dsh vs npm 最新（可独立更新） ───────────────
  ipcMain.handle(IPC.engineCheck, async (): Promise<EngineCheckResult> => {
    const result = await checkEngineUpdate(runtimeDir);
    info(`引擎版本检查: current=${result.current ?? "?"} latest=${result.latest ?? "?"} upToDate=${result.upToDate} canUpdate=${result.canUpdate}`);
    // 引擎已是最新且服务正常：清理「上一版本」记录，避免「恢复引擎」按钮长期占位
    if (result.upToDate && result.prevVersion && server.getStatus().phase === "ready") {
      const m = readRuntimeMarker(runtimeDir);
      delete m.prevVersion;
      writeRuntimeMarker(runtimeDir, m);
      result.prevVersion = null;
      info("引擎已是最新且服务正常，清除回滚记录");
    }
    return result;
  });

  // ── 引擎独立更新：安装最新版 → 重启服务 ─────────────────────────────
  ipcMain.handle(IPC.engineUpdate, async () => {
    if (engineUpdating) return { ok: false, error: "BUSY" };
    engineUpdating = true;
    try {
      const r = await performEngineUpdate(runtimeDir, null);
      if (r.ok) {
        await server.stop();
        await server.start();
      } else {
        broadcastEngineProgress({ stage: "error", error: r.error });
      }
      return r;
    } finally {
      engineUpdating = false;
    }
  });

  // ── 恢复上一版本引擎 ────────────────────────────────────────────────
  ipcMain.handle(IPC.engineRevert, async () => {
    const marker = readRuntimeMarker(runtimeDir);
    const prev = typeof marker.prevVersion === "string" ? marker.prevVersion : null;
    if (!prev) return { ok: false, error: "NO_PREV" };
    const r = await performEngineUpdate(runtimeDir, prev);
    if (r.ok) {
      const m2 = readRuntimeMarker(runtimeDir);
      delete m2.prevVersion;
      writeRuntimeMarker(runtimeDir, m2);
      await server.stop();
      await server.start();
    }
    return r;
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

  // ── 最近一次发现的新版本信息（含更新内容，供设置页展示） ──────────
  ipcMain.handle(IPC.updateInfo, () => lastNewVersionInfo);

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

  // ── 插件市场安装：npm 安装到 profile 目录 + 记录 + 重启服务 ──────
  ipcMain.handle(IPC.pluginInstall, async (_e, req: PluginInstallRequest): Promise<PluginInstallResult> => {
    try {
      const profileDir = join(dshHome, "profiles", "web");
      if (!existsSync(join(profileDir, "package.json"))) return { ok: false, error: "PROFILE_MISSING" };
      if (!hasBundledNpm(runtimeDir)) return { ok: false, error: "NO_NPM" };
      let spec: string;
      if (req.fileBase64 && req.fileName) {
        const tmpDir = join(app.getPath("temp"), "dsh-plugin-tgz");
        await mkdir(tmpDir, { recursive: true });
        const file = join(tmpDir, String(req.fileName).replace(/[^\w.\-]/g, "_"));
        writeFileSync(file, Buffer.from(req.fileBase64, "base64"));
        spec = file;
      } else if (req.spec && req.spec.trim()) {
        spec = req.spec.trim();
      } else {
        return { ok: false, error: "NO_SPEC" };
      }
      // 记录安装前依赖，用于识别新安装的包名（npm 会把包名写进 profile dependencies）
      const before = Object.keys(readJson(join(profileDir, "package.json"))?.dependencies ?? {});
      const r = runNpm(runtimeDir, profileDir, ["install", "--no-audit", "--no-fund", "--ignore-scripts", spec]);
      if (r.code !== 0) return { ok: false, error: `NPM_FAILED:${r.log.slice(0, 200)}` };
      const after = Object.keys(readJson(join(profileDir, "package.json"))?.dependencies ?? {});
      const added = after.find((n) => !before.includes(n));
      if (!added) return { ok: false, error: "NAME_UNKNOWN" };
      // 持久化安装列表（服务重启时 patch 注入该插件）
      const listPath = join(dshHome, "plugin-market.json");
      const list = (readJson(listPath) ?? {}) as { plugins?: string[] };
      const plugins = Array.isArray(list.plugins) ? list.plugins : [];
      if (!plugins.includes(added)) plugins.push(added);
      writeFileSync(listPath, JSON.stringify({ plugins }, null, 2), "utf8");
      info(`插件已安装: ${added}，1.5s 后重启服务加载`);
      // 先返回成功，再延迟重启：服务重启会卸载 Harness 页面，
      // 若在 IPC 内同步重启，调用方的响应会丢失 → 界面误报"安装失败"并卡顿
      setTimeout(() => {
        void server.stop().then(() => server.start());
      }, 1500);
      return { ok: true, name: added };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // ── 插件管理：禁用 / 启用 / 卸载 ──────────────────────────────────
  ipcMain.handle(IPC.pluginManage, async (_e, req: PluginManageRequest): Promise<PluginManageResult> => {
    try {
      const profileDir = join(dshHome, "profiles", "web");
      if (!existsSync(join(profileDir, "package.json"))) return { ok: false, error: "PROFILE_MISSING" };
      const list = readMarketList(dshHome);
      const bundlePlugin = readProfileBundles(profileDir).includes(req.name);

      if (req.action === "disable") {
        let entry = list.plugins.find((p) => p.name === req.name);
        if (!entry) {
          entry = { name: req.name };
          list.plugins.push(entry);
        }
        entry.disabled = true;
        if (bundlePlugin) writeProfileBundles(profileDir, readProfileBundles(profileDir).filter((n) => n !== req.name));
      } else if (req.action === "enable") {
        const entry = list.plugins.find((p) => p.name === req.name);
        if (entry) entry.disabled = false;
        if (bundlePlugin && !readProfileBundles(profileDir).includes(req.name)) {
          writeProfileBundles(profileDir, [...readProfileBundles(profileDir), req.name]);
        }
      } else if (req.action === "uninstall") {
        const r = runNpm(runtimeDir, profileDir, ["uninstall", "--no-audit", "--no-fund", "--ignore-scripts", req.name]);
        if (r.code !== 0) return { ok: false, error: `NPM_FAILED:${r.log.slice(0, 200)}` };
        list.plugins = list.plugins.filter((p) => p.name !== req.name);
        if (bundlePlugin) writeProfileBundles(profileDir, readProfileBundles(profileDir).filter((n) => n !== req.name));
      } else {
        return { ok: false, error: "BAD_ACTION" };
      }
      writeMarketList(dshHome, list);
      info(`插件管理: ${req.action} ${req.name}，1.5s 后重启服务`);
      setTimeout(() => {
        void server.stop().then(() => server.start());
      }, 1500);
      return { ok: true, name: req.name };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
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
