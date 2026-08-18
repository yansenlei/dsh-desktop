/**
 * DSH Desktop 主进程入口。
 *
 * 职责：应用生命周期、单实例、主窗口（壳 UI → Harness UI）、设置窗口、
 * 系统托盘、服务管理编排、退出清理、smoke 测试模式。
 */
import { app, BrowserWindow, Tray, Menu, nativeImage, shell, Notification } from "electron";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { IPC, ServerStatus, AppInfo, DesktopSettings, DEFAULT_SETTINGS } from "../shared/types";
import { LINKS } from "../shared/links";
import { initLogger, info, warn, error as logError } from "./logger";
import { initSettings, getSettings, setSettings } from "./settings";
import { DshServerManager } from "./server";
import { registerIpc } from "./ipc";
import { checkAutoUpdate } from "./ipc";
import { t } from "./l10n";

/** Smoke/诊断追踪：写入 SMOKE_TRACE 指向的文件（工作区内，便于受限环境排查）。 */
function trace(msg: string) {
  const p = process.env.SMOKE_TRACE;
  if (!p) return;
  try {
    const { appendFileSync } = require("node:fs") as typeof import("node:fs");
    appendFileSync(p, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* 忽略 */
  }
}

// ── 单实例 ─────────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  main();
}

function main() {
  trace("main() enter");
  let mainWindow: BrowserWindow | null = null;
  let settingsWindow: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let quitting = false;
  let harnessLoaded = false;

  app.setName("DeepSeek Harness Desktop");
  // Windows：系统通知（自动更新提示等）需要 AppUserModelID，否则 toast 不显示
  if (process.platform === "win32") {
    try {
      app.setAppUserModelId("com.deepseekai.dsh-desktop");
    } catch (err) {
      warn(`设置 AppUserModelID 失败: ${(err as Error).message}`);
    }
  }

  // ── 基础设施 ─────────────────────────────────────────────────────────
  initLogger(join(app.getPath("userData"), "logs"));
  initSettings(app.getPath("userData"));
  try {
    app.setLoginItemSettings({ openAtLogin: getSettings().autoStart });
  } catch (err) {
    warn(`设置开机自启失败: ${(err as Error).message}`);
  }
  info(`DSH Desktop 启动 (v${app.getVersion()}) platform=${process.platform} arch=${process.arch}`);

  // 应用数据目录里放置 DSH_HOME（会话、配置、存储都随应用管理）
  const userDataDir = app.getPath("userData");
  const dshHome = getSettings().dshHome ?? join(userDataDir, "dsh-home");
  const runtimeDir = resolveRuntimeDir();
  info(`runtimeDir=${runtimeDir}`);
  info(`dshHome=${dshHome}`);

  const server = new DshServerManager({
    runtimeDir,
    dshHome,
    execPath: process.execPath,
  });
  trace(`server created, runtimeDir=${runtimeDir}`);

  // ── 窗口 ─────────────────────────────────────────────────────────────
  function createMainWindow() {
    const bounds = loadWindowBounds();
    mainWindow = new BrowserWindow({
      width: bounds.width ?? 1280,
      height: bounds.height ?? 820,
      x: bounds.x,
      y: bounds.y,
      minWidth: 940,
      minHeight: 600,
      title: "DeepSeek Harness Desktop",
      icon: iconPath("icon.png"),
      backgroundColor: "#0b1220",
      webPreferences: {
        preload: join(__dirname, "../preload/index.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    mainWindow.setMenuBarVisibility(false);

    // 记住窗口位置与大小
    let boundsTimer: ReturnType<typeof setTimeout> | null = null;
    mainWindow.on("resize", () => scheduleSaveBounds());
    mainWindow.on("move", () => scheduleSaveBounds());
    function scheduleSaveBounds() {
      if (boundsTimer) clearTimeout(boundsTimer);
      boundsTimer = setTimeout(saveWindowBounds, 800);
    }

    mainWindow.on("close", (e) => {
      // macOS：点关闭只隐藏窗口（mac 应用惯例），点击 Dock 图标（activate）再唤回；
      // 真正退出走菜单/托盘「退出」或 Cmd+Q。Windows：尊重「关闭时最小化到托盘」设置。
      if (process.platform === "darwin" || (!quitting && getSettings().closeToTray)) {
        e.preventDefault();
        mainWindow?.hide();
      }
    });
    mainWindow.on("minimize", () => {
      if (getSettings().minimizeToTray) {
        mainWindow?.hide();
      }
    });
    mainWindow.on("closed", () => {
      mainWindow = null;
    });

    // 外部链接一律交给系统浏览器
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
      return { action: "deny" };
    });
    mainWindow.webContents.on("will-navigate", (e, url) => {
      // 允许壳 UI 与 harness 同源 URL，其它一律外部打开
      const isLocal = url.startsWith("file:") || url.includes("127.0.0.1") || url.includes("localhost");
      if (!isLocal) {
        e.preventDefault();
        shell.openExternal(url);
      }
    });

    mainWindow.loadFile(join(__dirname, "../renderer/boot.html"));
    return mainWindow;
  }

  function createSettingsWindow(query?: Record<string, string>) {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.focus();
      return;
    }
    settingsWindow = new BrowserWindow({
      width: 640,
      height: 700,
      minWidth: 560,
      minHeight: 560,
      title: t("settingsTitle"),
      // 不设置 parent：与主窗口完全独立，关闭设置窗不影响主窗，
      // 主窗隐藏到托盘时设置窗也保持独立显示。
      backgroundColor: "#0a0a0b",
      webPreferences: {
        preload: join(__dirname, "../preload/index.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    settingsWindow.setMenuBarVisibility(false);
    settingsWindow.on("closed", () => {
      settingsWindow = null;
    });
    settingsWindow.loadFile(join(__dirname, "../renderer/settings.html"), query ? { query } : undefined);
  }

  // ── 服务状态 → 窗口导航 ──────────────────────────────────────────────
  server.onStatus((st) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (st.phase === "ready" && st.url && !harnessLoaded) {
      harnessLoaded = true;
      info(`主窗口加载 Harness UI: ${st.url}`);
      mainWindow.loadURL(st.url).catch((err) => logError(`loadURL 失败: ${err.message}`));
    } else if ((st.phase === "error" || st.phase === "stopped" || st.phase === "restarting") && harnessLoaded) {
      // 服务不可用 → 回到壳 UI 的错误/重试页
      harnessLoaded = false;
      const q = encodeURIComponent(st.messageKey + (st.lastError ? `: ${st.lastError}` : ""));
      mainWindow.loadFile(join(__dirname, "../renderer/boot.html"), { query: { phase: "error", detail: q } });
    }
    // 始终推送状态给当前显示的壳 UI（boot/settings）
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.serverStatusChanged, st);
    }
    updateTrayMenu();
  });

  // ── 托盘 ─────────────────────────────────────────────────────────────
  function createTray() {
    const img = nativeImage.createFromPath(iconPath("tray.png"));
    const trayImage = img.isEmpty() ? nativeImage.createEmpty() : img;
    // macOS：设为模板图（按 alpha 通道渲染，自动适配深/浅色菜单栏）。
    // tray.png 是白色鲸鱼，非模板时在浅色菜单栏上几乎看不见。
    if (process.platform === "darwin" && !trayImage.isEmpty()) {
      trayImage.setTemplateImage(true);
    }
    tray = new Tray(trayImage);
    tray.setToolTip("DeepSeek Harness Desktop");
    updateTrayMenu();
    // Windows：单击托盘图标 → 显示主窗口；macOS：设置了 contextMenu 后
    // 左/右键都是弹菜单（系统行为），无需 click 处理。
    tray.on("click", () => showMainWindow());
  }

  function updateTrayMenu() {
    const st = server.getStatus();
    const running = st.phase === "ready" || st.phase === "starting";
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: t("tray.showMain"), click: () => showMainWindow() },
      { label: running ? t("tray.openBrowser") : t("tray.openBrowserDisabled"), enabled: st.phase === "ready", click: () => { if (st.url) shell.openExternal(st.url); } },
      { type: "separator" },
      { label: t("tray.settings"), click: () => createSettingsWindow() },
      { label: t("tray.restartService"), click: async () => { await server.stop(); await server.start(); } },
      { type: "separator" },
      { label: t("tray.helpUserGuide"), click: () => shell.openExternal(LINKS.userGuide) },
      { label: t("tray.helpFeedback"), click: () => shell.openExternal(LINKS.feedback) },
      { label: t("tray.helpDshSite"), click: () => shell.openExternal(LINKS.dshSite) },
      { label: t("tray.helpDshdSite"), click: () => shell.openExternal(LINKS.dshdSite) },
      { type: "separator" },
      { label: t("tray.quit"), click: () => { quitting = true; app.quit(); } },
    ];
    tray?.setContextMenu(Menu.buildFromTemplate(template));
    // macOS：同一套操作也挂到 Dock（程序坞）图标右键菜单——Windows 托盘
    // 右键菜单的 mac 对应物。必须为 Dock 单独构建 Menu 实例（同一实例
    // 不能同时作为托盘菜单与 Dock 菜单）。
    if (process.platform === "darwin" && app.dock) {
      app.dock.setMenu(Menu.buildFromTemplate(template));
    }
  }

  function showMainWindow() {
    if (!mainWindow) {
      createMainWindow();
    } else {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  }

  // ── 自动更新检查：启动时一次 + 每天固定时间（09:00）一次 ───────────
  const AUTO_CHECK_HOUR = 9; // 每日固定检查时间（本地时区）
  const autoCheckStatePath = join(userDataDir, "update-check.json");

  interface AutoCheckState {
    lastCheckDate?: string;
    /** 已提示过的新版本号：同一版本只提示一次，避免每次启动都打扰。 */
    notifiedVersion?: string;
  }

  function readAutoCheckState(): AutoCheckState {
    try {
      return JSON.parse(readFileSync(autoCheckStatePath, "utf8")) as AutoCheckState;
    } catch {
      return {};
    }
  }

  function writeAutoCheckState(st: AutoCheckState) {
    try {
      writeFileSync(autoCheckStatePath, JSON.stringify(st, null, 2), "utf8");
    } catch {
      /* 忽略 */
    }
  }

  function todayStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  /** 引导用户到设置窗「关于」模块并展示新版本。 */
  function showUpdateInSettings(version: string) {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.focus();
      settingsWindow.webContents.send(IPC.settingsFocusAbout, { version });
    } else {
      createSettingsWindow({ focus: "about", update: version });
    }
  }

  /** 执行一次自动检查：发现新版本 → 系统通知 + 打开设置窗定位「关于」模块。 */
  async function runAutoUpdateCheck() {
    let result;
    try {
      result = await checkAutoUpdate();
    } catch (err) {
      warn(`自动更新检查异常: ${(err as Error).message}`);
      return;
    }
    if (!result.feedConfigured) {
      warn("自动更新检查: 更新源不可用，跳过");
      return;
    }
    const st = readAutoCheckState();
    st.lastCheckDate = todayStr();
    if (!result.latest || result.upToDate) {
      // 已是最新：清除旧的已提示记录
      if (st.notifiedVersion) {
        delete st.notifiedVersion;
        writeAutoCheckState(st);
      }
      return;
    }
    if (st.notifiedVersion === result.latest) return; // 同一版本不重复打扰
    st.notifiedVersion = result.latest;
    writeAutoCheckState(st);
    info(`自动更新检查: 发现新版本 v${result.latest}（当前 v${result.current}），提示用户`);
    // 系统通知（点击 → 打开设置窗「关于」模块）
    try {
      if (Notification.isSupported()) {
        const n = new Notification({
          title: t("update.notifyTitle"),
          body: t("update.notifyBody").replace("{v}", result.latest),
        });
        n.on("click", () => showUpdateInSettings(result.latest!));
        n.show();
      }
    } catch (err) {
      warn(`系统通知失败: ${(err as Error).message}`);
    }
    // 直接打开设置窗并滚动到「关于」模块
    showUpdateInSettings(result.latest);
  }

  /** 距下一次 09:00 的毫秒数（已过则取次日）。 */
  function msUntilNextDailyCheck(): number {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), AUTO_CHECK_HOUR, 0, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  }

  function startAutoUpdateChecks() {
    // 启动后延迟 20s 检查一次（避开启动高峰）
    setTimeout(() => {
      void runAutoUpdateCheck();
    }, 20_000);
    // 每天固定时间检查（setTimeout 链，避免 setInterval 长期漂移）
    let dailyTimer: ReturnType<typeof setTimeout>;
    const scheduleDaily = () => {
      dailyTimer = setTimeout(() => {
        void runAutoUpdateCheck();
        scheduleDaily();
      }, msUntilNextDailyCheck());
    };
    scheduleDaily();
    app.on("before-quit", () => clearTimeout(dailyTimer));
  }

  // ── 应用生命周期 ─────────────────────────────────────────────────────
  const smoke = process.env.DSHDESKTOP_SMOKE === "1";

  app.on("second-instance", () => {
    showMainWindow();
  });

  // macOS：点击 Dock 图标或再次激活应用时唤回主窗口（配合「关闭即隐藏」）
  app.on("activate", () => {
    showMainWindow();
  });

  app.whenReady().then(async () => {
    trace("whenReady enter");

    // macOS：设置应用菜单（About/Quit + 编辑菜单，符合平台惯例）
    if (process.platform === "darwin") {
      installMacAppMenu();
    }

    registerIpc({
      server,
      getAppInfo: () => getAppInfo(runtimeDir, userDataDir, dshHome),
      openSettingsWindow: () => createSettingsWindow(),
      runtimeDir,
      dshHome,
    });
    trace("registerIpc done");

    if (smoke) {
      // Smoke 模式：不开窗口，验证服务能启动并响应，然后退出
      await runSmoke(server, runtimeDir);
      return;
    }

    trace("createTray");
    createTray();
    updateTrayMenu();
    createMainWindow();
    trace("server.start");
    await server.start();

    // ── 自动更新检查：启动时 + 每天固定时间（09:00） ────────────────
    startAutoUpdateChecks();
  });

  app.on("before-quit", async (e) => {
    if (!quitting && !smoke) {
      // 由托盘“退出”或系统退出触发
      quitting = true;
    }
    e.preventDefault();
    await server.stop();
    app.exit(0);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && !smoke) {
      // 交给 close 事件处理（closeToTray 时窗口只隐藏，不会触发这里）
    }
  });

  // ── 工具函数 ─────────────────────────────────────────────────────────
  function loadWindowBounds(): { width?: number; height?: number; x?: number; y?: number } {
    try {
      const raw = readFileSync(join(userDataDir, "window.json"), "utf8");
      const b = JSON.parse(raw);
      if (typeof b.width === "number" && typeof b.height === "number") return b;
    } catch {
      /* 使用默认值 */
    }
    return {};
  }

  function saveWindowBounds() {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMaximized() || mainWindow.isFullScreen()) return;
    try {
      writeFileSync(join(userDataDir, "window.json"), JSON.stringify(mainWindow.getBounds()), "utf8");
    } catch {
      /* 忽略 */
    }
  }
}

// ── 模块级辅助 ─────────────────────────────────────────────────────────

/** macOS：安装应用菜单（About / Quit + 编辑菜单），符合平台惯例。 */
function installMacAppMenu() {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: "about" as const },
            { type: "separator" as const },
            { role: "hide" as const },
            { role: "hideOthers" as const },
            { role: "unhide" as const },
            { type: "separator" as const },
            { role: "quit" as const },
          ],
        }]
      : []),
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** 解析 DSH 运行时目录：打包后为 resources/dsh-runtime，开发时为项目 runtime/。 */
function resolveRuntimeDir(): string {
  const packaged = join(process.resourcesPath ?? "", "dsh-runtime");
  if (existsSync(join(packaged, "dsh", "node_modules", "@deepseek-ai", "dsh", "package.json"))) {
    return packaged;
  }
  const dev = join(app.getAppPath(), "runtime");
  return dev;
}

function iconPath(name: string): string {
  const candidates = [
    join(process.resourcesPath ?? "", "dsh-desktop", "icons", name),
    join(app.getAppPath(), "build", name),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

function getAppInfo(runtimeDir: string, userDataDir: string, dshHome: string): AppInfo {
  let dshVersion: string | null = null;
  try {
    const pkgPath = join(runtimeDir, "dsh", "node_modules", "@deepseek-ai", "dsh", "package.json");
    if (existsSync(pkgPath)) {
      dshVersion = JSON.parse(readFileSync(pkgPath, "utf8")).version ?? null;
    }
  } catch {
    /* 忽略 */
  }
  return {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron ?? "",
    chrome: process.versions.chrome ?? "",
    node: process.versions.node,
    dshVersion,
    userDataDir,
    dshHome,
  };
}

/** Smoke 测试：启动服务 → 等待 ready → HTTP 探活 → 打印 JSON → 退出。 */
async function runSmoke(server: DshServerManager, runtimeDir: string) {
  console.error("SMOKE: 启动服务…");
  info("SMOKE: 启动服务…");
  const started = Date.now();
  try {
    await server.start();
  } catch (err) {
    console.error("SMOKE: server.start 异常: " + (err as Error).message);
    writeSmokeResult({ ok: false, phase: "error", lastError: (err as Error).message }, null);
    process.exit(1);
    return;
  }
  const timeoutMs = Number(process.env.DSHDESKTOP_SMOKE_TIMEOUT ?? "120000");
  const status = await waitForReady(server, timeoutMs);
  console.error(`SMOKE: phase=${status.phase} url=${status.url} pid=${status.pid}`);
  const result: Record<string, unknown> = {
    ok: status.phase === "ready",
    phase: status.phase,
    url: status.url,
    port: status.port,
    pid: status.pid,
    lastError: status.lastError,
    elapsedMs: Date.now() - started,
    node: process.versions.node,
    runtimeDir,
  };
  if (status.phase === "ready" && status.url) {
    try {
      const res = await fetch(status.url, { signal: AbortSignal.timeout(10_000) });
      result.httpStatus = res.status;
      const html = await res.text();
      result.servedHtml = html.slice(0, 200);
      result.hasDshBoot = html.includes("__DSH_BOOT__") || html.includes("DeepSeek Harness");
    } catch (err) {
      result.fetchError = (err as Error).message;
    }
  }
  writeSmokeResult(result, status.url);
  await server.stop();
  trace("runSmoke: 完成，退出");
  // app.exit 可能被生命周期钩子干扰，smoke 模式直接用 process.exit 兜底
  process.exit(result.ok === true ? 0 : 1);
}

function writeSmokeResult(result: Record<string, unknown>, url: string | null) {
  const out = "SMOKE_RESULT " + JSON.stringify(result);
  console.error(out);
  // 同时写入结果文件（供 stdio inherit 场景读取）
  const smokeOut = process.env.SMOKE_OUT;
  if (smokeOut) {
    try {
      writeFileSync(smokeOut, JSON.stringify(result, null, 2), "utf8");
      console.error("SMOKE: 结果已写入 " + smokeOut);
    } catch (err) {
      console.error("SMOKE_RESULT_WRITE_FAILED " + (err as Error).message);
    }
  }
  void url;
}

function waitForReady(server: DshServerManager, timeoutMs: number): Promise<ServerStatus> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const unsub = server.onStatus((st) => {
      if (st.phase === "ready" || st.phase === "error" || st.phase === "stopped") {
        clearInterval(timer);
        unsub();
        resolve(st);
      }
    });
    const timer = setInterval(() => {
      const st = server.getStatus();
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        unsub();
        resolve(st);
      }
    }, 1000);
  });
}

// 防止 TS 把 DesktopSettings/DEFAULT_SETTINGS 当未使用（供后续扩展）
export type { DesktopSettings };
export const _defaults = DEFAULT_SETTINGS;
