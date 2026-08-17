/**
 * 设置页（壳 UI）：端口、开机自启、托盘行为、运行环境一键安装、数据/日志目录、关于。
 */
import { setLang, detectLang, t } from "./i18n";
import type { EnvCheck, InstallProgress, UpdateProgress } from "../shared/types";
import { LINKS } from "../shared/links";

declare global {
  interface Window {
    dshDesktop: import("../preload").DesktopApi;
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  title: $("title"),
  btnClose: $("btn-close"),
  inputPort: $<HTMLInputElement>("input-port"),
  lblPortCurrent: $("lbl-port-current"),
  chkAutostart: $<HTMLInputElement>("chk-autostart"),
  chkCloseTray: $<HTMLInputElement>("chk-close-tray"),
  chkMinTray: $<HTMLInputElement>("chk-min-tray"),
  chkLan: $<HTMLInputElement>("chk-lan"),
  selLanguage: $<HTMLSelectElement>("sel-language"),
  btnRestart: $<HTMLButtonElement>("btn-restart"),
  envBundledNodeVal: $("env-bundled-node-val"),
  envSystemNodeVal: $("env-system-node-val"),
  envPythonVal: $("env-python-val"),
  envDshCliVal: $("env-dsh-cli-val"),
  envWingetVal: $("env-winget-val"),
  btnInstallPython: $<HTMLButtonElement>("btn-install-python"),
  btnInstallCli: $<HTMLButtonElement>("btn-install-cli"),
  installProgress: $("install-progress"),
  installProgressLog: $("install-progress-log"),
  btnOpenData: $("btn-open-data"),
  btnOpenLogs: $("btn-open-logs"),
  dataDirPath: $("data-dir-path"),
  btnHelpGuide: $<HTMLButtonElement>("btn-help-guide"),
  btnHelpFeedback: $<HTMLButtonElement>("btn-help-feedback"),
  btnHelpDsh: $<HTMLButtonElement>("btn-help-dsh"),
  btnHelpDshd: $<HTMLButtonElement>("btn-help-dshd"),
  aboutVersion: $("about-version"),
  aboutDshVersion: $("about-dsh-version"),
  engineUpdateHint: $("engine-update-hint"),
  aboutElectron: $("about-electron"),
  aboutNode: $("about-node"),
  btnCheckUpdate: $<HTMLButtonElement>("btn-check-update"),
  btnUpdateInstall: $<HTMLButtonElement>("btn-update-install"),
  btnCancelUpdate: $<HTMLButtonElement>("btn-cancel-update"),
  updateResult: $("update-result"),
  updateProgress: $("update-progress"),
  updateBar: $("update-bar"),
  updateBarFill: $("update-bar-fill"),
  updateStats: $("update-stats"),
  toast: $("toast"),
};

let toastTimer: ReturnType<typeof setTimeout> | null = null;
let updateBusy = false; // 更新下载/安装进行中：applyLabels 不得重置按钮文案

/** 动态文案状态：语言切换时据此重渲染，避免切换后残留旧语言文案。 */
let lastUpdateResult: "available" | "upToDate" | "placeholder" | null = null;
let lastUpdateVer: string | null = null;
let lastProgress: UpdateProgress | null = null;
let lastEngineVer: string | null = null;

/** 主进程错误码 → 本地化文案；非已知码原样展示（多为网络层英文错误）。 */
function updateErrText(err?: string): string {
  if (!err) return "";
  const known: Record<string, string> = {
    ALREADY_DOWNLOADING: "settings.updateErrAlready",
    NO_ASSET: "settings.updateErrNoAsset",
    ALL_SOURCES_FAILED: "settings.updateErrAllSources",
    NO_INSTALLER: "settings.updateErrNoInstaller",
    SCRIPT_WRITE_FAILED: "settings.updateErrScriptWrite",
    SCRIPT_LAUNCH_FAILED: "settings.updateErrScriptLaunch",
    INSTALLER_LAUNCH_FAILED: "settings.updateErrInstallerLaunch",
  };
  return known[err] ? t(known[err]) : err;
}
function toast(msg: string) {
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2200);
}

/** 字节数格式化：1234567 → "1.2 MB"。 */
function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return (i === 0 ? String(Math.round(v)) : v.toFixed(1)) + " " + units[i];
}

/** 网速格式化：1250000 → "1.2 MB/s"。 */
function fmtSpeed(bps: number | undefined): string {
  if (typeof bps !== "number" || !Number.isFinite(bps) || bps <= 0) return "-";
  return fmtBytes(Math.round(bps)) + "/s";
}

  /** 按进度事件渲染 UI（下载中/安装中/失败/重试/完成/取消）。 */
  function applyProgress(p: UpdateProgress) {
    lastProgress = p;
    updateBusy = p.stage === "downloading" || p.stage === "installing";
    if (p.stage === "downloading") {
      el.btnCheckUpdate.disabled = true;
      el.btnUpdateInstall.hidden = false;
      el.btnUpdateInstall.disabled = true;
      el.btnUpdateInstall.textContent = t("settings.updateDownloadingBtn");
      el.btnCancelUpdate.hidden = false;
      el.btnCancelUpdate.disabled = false;
      el.updateBar.hidden = false;
      if (p.percent !== null) el.updateBarFill.style.width = p.percent + "%";
      el.updateProgress.hidden = false;
      el.updateProgress.textContent =
        p.percent !== null ? t("settings.updateDownloading") + ` ${p.percent}%` : t("settings.updateDownloading");
      // 已下载 / 总大小 / 实时网速
      if (typeof p.downloadedBytes === "number") {
        el.updateStats.hidden = false;
        el.updateStats.textContent = t("settings.updateStats")
          .replace("{down}", fmtBytes(p.downloadedBytes))
          .replace("{total}", (p.totalBytes ?? 0) > 0 ? fmtBytes(p.totalBytes!) : "—")
          .replace("{speed}", fmtSpeed(p.speedBps));
      }
    } else if (p.stage === "installing") {
      el.btnUpdateInstall.hidden = false;
      el.btnUpdateInstall.disabled = true;
      el.btnUpdateInstall.textContent = t("settings.updateInstallingBtn");
      el.btnCancelUpdate.hidden = true;
      el.updateStats.hidden = true;
      el.updateBar.hidden = true;
      el.updateProgress.hidden = false;
      el.updateProgress.textContent = t("settings.updateInstalling");
    } else if (p.stage === "error") {
      el.btnUpdateInstall.disabled = false;
      el.btnUpdateInstall.textContent = t("settings.downloadAndInstall");
      el.btnCheckUpdate.disabled = false;
      el.btnCancelUpdate.hidden = true;
      el.updateStats.hidden = true;
      el.updateBar.hidden = true;
      el.updateProgress.hidden = false;
      el.updateProgress.textContent = t("settings.updateDownloadFailed") + (p.error ? `: ${updateErrText(p.error)}` : "");
    } else if (p.stage === "retrying") {
      el.btnCancelUpdate.hidden = false;
      el.updateStats.hidden = true;
      el.updateBar.hidden = true;
      el.updateProgress.hidden = false;
      el.updateProgress.textContent = t("settings.updateRetrying");
    } else if (p.stage === "downloaded") {
      el.btnCheckUpdate.disabled = false;
      el.btnUpdateInstall.hidden = false;
      el.btnUpdateInstall.disabled = false;
      el.btnUpdateInstall.textContent = t("settings.downloadAndInstall");
      el.btnCancelUpdate.hidden = true;
      el.updateStats.hidden = true;
      el.updateBarFill.style.width = "100%";
      el.updateBar.hidden = false;
      el.updateProgress.hidden = false;
      el.updateProgress.textContent = t("settings.updateReady");
    } else if (p.stage === "cancelled") {
      el.btnCheckUpdate.disabled = false;
      el.btnUpdateInstall.hidden = true;
      el.btnCancelUpdate.hidden = true;
      el.updateStats.hidden = true;
      el.updateBar.hidden = true;
      el.updateProgress.hidden = false;
      el.updateProgress.textContent = t("settings.updateCancelled");
    }
  }



async function main() {
  const info = await window.dshDesktop.getAppInfo();
  const settings = await window.dshDesktop.getSettings();
  setLang(detectLang(settings.language));

  el.title.textContent = t("settings.title");
  el.btnClose.addEventListener("click", () => window.dshDesktop.closeWindow());

  // ── 常规 ──
  el.inputPort.value = String(settings.port);
  const currentPort = (await window.dshDesktop.getServerStatus()).port ?? "-";
  el.lblPortCurrent.textContent = t("settings.currentPort").replace("{port}", String(currentPort));
  el.chkAutostart.checked = settings.autoStart;
  el.chkCloseTray.checked = settings.closeToTray;
  el.chkMinTray.checked = settings.minimizeToTray;
  el.chkLan.checked = settings.lanAccess;
  el.selLanguage.value = settings.language;

  el.inputPort.addEventListener("change", async () => {
    const v = Number(el.inputPort.value);
    if (Number.isInteger(v) && v >= 1024 && v <= 65535) {
      await window.dshDesktop.setSettings({ port: v });
      toast(t("settings.saved") + " · " + t("settings.restartTip"));
    }
  });
  el.chkAutostart.addEventListener("change", async () => {
    await window.dshDesktop.setSettings({ autoStart: el.chkAutostart.checked });
    applyAutoStart(el.chkAutostart.checked);
  });
  el.chkCloseTray.addEventListener("change", async () => {
    await window.dshDesktop.setSettings({ closeToTray: el.chkCloseTray.checked });
    await window.dshDesktop.setCloseToTray(el.chkCloseTray.checked);
  });
  el.chkMinTray.addEventListener("change", async () => {
    await window.dshDesktop.setSettings({ minimizeToTray: el.chkMinTray.checked });
  });
  el.chkLan.addEventListener("change", async () => {
    await window.dshDesktop.setSettings({ lanAccess: el.chkLan.checked });
    toast(t("settings.saved") + " · " + t("settings.restartTip"));
  });
  el.selLanguage.addEventListener("change", async () => {
    const val = el.selLanguage.value;
    const lang = val === "zh" || val === "en" ? val : "auto";
    await window.dshDesktop.setSettings({ language: lang });
    setLang(detectLang(lang));
    applyLabels();
    toast(t("settings.saved"));
  });
  el.btnRestart.addEventListener("click", async () => {
    el.btnRestart.disabled = true;
    el.btnRestart.textContent = "…";
    await window.dshDesktop.restartServer();
    setTimeout(() => {
      el.btnRestart.disabled = false;
      el.btnRestart.textContent = t("restart");
    }, 2000);
  });

  // ── 环境 ──
  renderEnv(await window.dshDesktop.checkEnv());

  el.btnInstallPython.addEventListener("click", async () => {
    el.btnInstallPython.disabled = true;
    el.installProgress.classList.remove("hidden");
    el.installProgressLog.textContent = "";
    const ok = await window.dshDesktop.install("python");
    el.btnInstallPython.disabled = false;
    if (ok) {
      renderEnv(await window.dshDesktop.checkEnv());
      el.installProgress.classList.add("hidden");
      toast(t("env.installed") + " · Python");
    }
  });
  el.btnInstallCli.addEventListener("click", async () => {
    el.btnInstallCli.disabled = true;
    el.installProgress.classList.remove("hidden");
    el.installProgressLog.textContent = "";
    const ok = await window.dshDesktop.install("dsh-cli");
    el.btnInstallCli.disabled = false;
    if (ok) {
      renderEnv(await window.dshDesktop.checkEnv());
      el.installProgress.classList.add("hidden");
      toast(t("env.installed") + " · dsh CLI");
    }
  });

  window.dshDesktop.onInstallProgress((p: InstallProgress) => {
    appendInstallLog(p);
  });

  // ── 数据与日志 ──
  el.dataDirPath.textContent = info.userDataDir;
  el.btnOpenData.addEventListener("click", () => window.dshDesktop.openPath(info.userDataDir));
  el.btnOpenLogs.addEventListener("click", () => window.dshDesktop.openLogsDir());

  // ── 帮助与反馈 ──
  el.btnHelpGuide.addEventListener("click", () => window.dshDesktop.openExternal(LINKS.userGuide));
  el.btnHelpFeedback.addEventListener("click", () => window.dshDesktop.openExternal(LINKS.feedback));
  el.btnHelpDsh.addEventListener("click", () => window.dshDesktop.openExternal(LINKS.dshSite));
  el.btnHelpDshd.addEventListener("click", () => window.dshDesktop.openExternal(LINKS.dshdSite));

  // ── 关于 ──
  el.aboutVersion.textContent = info.version;
  el.aboutDshVersion.textContent = info.dshVersion ?? "-";
  el.aboutElectron.textContent = info.electron;
  el.aboutNode.textContent = info.node;
  // 引擎更新提示：内置 Harness 引擎若落后于 npm 最新版，提示用户（静默失败）
  window.dshDesktop.checkEngineUpdate().then((e) => {
    if (e.latest && !e.upToDate && e.current) {
      lastEngineVer = e.latest;
      el.engineUpdateHint.hidden = false;
      el.engineUpdateHint.textContent = t("settings.engineUpdateAvailable").replace("{v}", e.latest);
    }
  }).catch(() => { /* 静默 */ });
  el.btnCheckUpdate.addEventListener("click", async () => {
    // Loading 态：禁用按钮 + 转圈 + 「检查中…」，等待 checkUpdate 返回
    el.btnCheckUpdate.disabled = true;
    el.btnCheckUpdate.classList.add("loading");
    el.btnCheckUpdate.textContent = t("settings.checkingUpdate");
    el.btnCancelUpdate.hidden = true;
    el.updateBar.hidden = true;
    el.updateProgress.hidden = true;
    try {
      const r = await window.dshDesktop.checkUpdate();
      if (!r.feedConfigured) {
        // 更新源全部不可用（限流/网络），不能误报"已是最新"
        lastUpdateResult = "placeholder";
        lastUpdateVer = null;
        el.updateResult.textContent = t("settings.updatePlaceholder");
        el.btnUpdateInstall.hidden = true;
      } else if (r.latest && !r.upToDate) {
        lastUpdateResult = "available";
        lastUpdateVer = r.latest;
        el.updateResult.textContent = t("settings.updateAvailable").replace("{v}", r.latest);
        // 有可用更新：Windows/macOS 均提供「下载并安装」，其它平台打开下载页
        if (info.platform === "win32" || info.platform === "darwin") {
          el.btnUpdateInstall.hidden = false;
        } else {
          window.dshDesktop.openExternal("https://github.com/yansenlei/dsh-desktop/releases");
        }
      } else {
        lastUpdateResult = "upToDate";
        lastUpdateVer = null;
        el.updateResult.textContent = t("settings.upToDate");
        el.btnUpdateInstall.hidden = true;
      }
    } finally {
      el.btnCheckUpdate.disabled = false;
      el.btnCheckUpdate.classList.remove("loading");
      el.btnCheckUpdate.textContent = t("settings.checkUpdate");
    }
  });

  // ── 静默自动更新：下载 → 安装 → 退出（Windows） ──
  let downloadedPath: string | undefined;
  el.btnUpdateInstall.addEventListener("click", async () => {
    el.btnUpdateInstall.disabled = true;
    el.btnCheckUpdate.disabled = true;
    el.btnCancelUpdate.hidden = true;
    el.updateBar.hidden = true;
    el.updateProgress.hidden = false;
    if (!downloadedPath) {
      el.btnUpdateInstall.textContent = t("settings.updateDownloadingBtn");
      el.updateProgress.textContent = t("settings.updateDownloading");
      const d = await window.dshDesktop.downloadUpdate();
      if (d.error || d.stage === "error" || d.stage === "cancelled") {
        el.updateProgress.textContent = d.stage === "cancelled"
          ? t("settings.updateCancelled")
          : t("settings.updateDownloadFailed") + (d.error ? `: ${updateErrText(d.error)}` : "");
        el.btnUpdateInstall.disabled = false;
        el.btnUpdateInstall.textContent = t("settings.downloadAndInstall");
        el.btnCheckUpdate.disabled = false;
        return;
      }
      downloadedPath = d.filePath;
    }
    el.btnUpdateInstall.textContent = t("settings.updateInstallingBtn");
    el.updateProgress.textContent = t("settings.updateInstalling");
    const r = await window.dshDesktop.installUpdate(downloadedPath);
    if (!r.ok) {
      el.updateProgress.textContent = t("settings.updateInstallFailed") + (r.error ? `: ${updateErrText(r.error)}` : "");
      el.btnUpdateInstall.disabled = false;
      el.btnUpdateInstall.textContent = t("settings.downloadAndInstall");
      el.btnCheckUpdate.disabled = false;
    }
    // 安装器接管后应用会退出；此处不重置按钮
  });

  // ── 取消下载：点击 ✕ → 主进程弹原生确认框 → 确认后中断 ──
  el.btnCancelUpdate.addEventListener("click", async () => {
    el.btnCancelUpdate.disabled = true;
    await window.dshDesktop.cancelUpdate();
    el.btnCancelUpdate.disabled = false;
    // 确认取消后主进程会广播 cancelled 事件驱动 UI 复位
  });

  window.dshDesktop.onUpdateProgress((p) => applyProgress(p));

  // ── 恢复状态：下载中途关闭设置窗再打开时，保持"更新中"的 UI 状态 ──
  try {
    const st = await window.dshDesktop.getUpdateStatus();
    if (st && st.phase !== "idle") {
      if (st.phase === "downloading") {
        applyProgress({ stage: "downloading", percent: st.progress?.percent ?? null, downloadedBytes: st.progress?.downloadedBytes, totalBytes: st.progress?.totalBytes, speedBps: st.progress?.speedBps });
      } else if (st.phase === "installing") {
        applyProgress({ stage: "installing", percent: null });
      } else if (st.phase === "downloaded") {
        el.updateResult.textContent = t("settings.updateReady");
        applyProgress({ stage: "downloaded", percent: 100 });
      }
    }
  } catch { /* 忽略 */ }

  // ── 自动更新引导：滚动到「关于」模块 + 高亮 + 展示新版本 ──
  const focusAbout = (version?: string) => {
    const sec = document.getElementById("sec-about");
    if (sec) {
      sec.scrollIntoView({ behavior: "smooth", block: "start" });
      sec.classList.remove("about-highlight");
      void (sec as HTMLElement).offsetWidth; // 强制重排以重新触发动画
      sec.classList.add("about-highlight");
      setTimeout(() => sec.classList.remove("about-highlight"), 2600);
    }
    if (version) {
      lastUpdateResult = "available";
      lastUpdateVer = version;
      el.updateResult.textContent = t("settings.updateAvailable").replace("{v}", version);
      if (info.platform === "win32" || info.platform === "darwin") {
        el.btnUpdateInstall.hidden = false;
      }
    }
  };
  // 主进程在自动更新检查发现新版本时推送（设置窗已打开的场景）
  window.dshDesktop.onFocusAbout((payload) => focusAbout(payload.version));
  // 打开设置窗时携带的 query 参数（focus=about&update=<ver>）
  try {
    const qs = new URLSearchParams(location.search);
    if (qs.get("focus") === "about") focusAbout(qs.get("update") ?? undefined);
  } catch { /* 忽略 */ }

  // ── 文案 ──
  applyLabels();
}

function applyLabels() {
  const map: Record<string, string> = {
    "sec-general": "settings.general",
    "sec-env": "env.title",
    "sec-data": "settings.data",
    "sec-about": "settings.about",
    "lbl-port": "settings.port",
    "lbl-port-detail": "settings.portDetail",
    "lbl-autostart": "settings.autoStart",
    "lbl-close-tray": "settings.closeToTray",
    "lbl-min-tray": "settings.minimizeToTray",
    "lbl-lan": "settings.lanAccess",
    "lbl-lan-detail": "settings.lanAccessDetail",
    "lbl-language": "settings.language",
    "lbl-language-detail": "settings.languageDetail",
    "lbl-restart": "settings.serviceMgmt",
    "lbl-restart-detail": "settings.restartDetail",
    "env-bundled-node": "env.bundledNode",
    "env-bundled-node-detail": "env.bundledNodeDetail",
    "env-python": "env.python",
    "env-python-detail": "env.pythonDetail",
    "env-dsh-cli": "env.dshCli",
    "env-dsh-cli-detail": "env.dshCliDetail",
    "lbl-data-dir": "settings.dataDir",
    "lbl-data-dir-detail": "settings.dataDirDetail",
    "lbl-log-dir": "settings.logDir",
    "sec-help": "settings.help",
    "lbl-help-guide": "settings.userGuide",
    "lbl-help-guide-detail": "settings.userGuideDetail",
    "lbl-help-feedback": "settings.feedback",
    "lbl-help-feedback-detail": "settings.feedbackDetail",
    "lbl-help-dsh": "settings.dshSite",
    "lbl-help-dsh-detail": "settings.dshSiteDetail",
    "lbl-help-dshd": "settings.dshdSite",
    "lbl-help-dshd-detail": "settings.dshdSiteDetail",
    "lbl-version": "version",
    "lbl-dsh-version": "settings.dshVersion",
    "lbl-update": "settings.update",
  };
  for (const [id, key] of Object.entries(map)) {
    const node = document.getElementById(id);
    if (node) node.textContent = t(key);
  }
  // 按钮与选项文本
  el.btnRestart.textContent = t("settings.restart");
  el.btnOpenData.textContent = t("settings.open");
  el.btnOpenLogs.textContent = t("settings.open");
  el.btnHelpGuide.textContent = t("settings.open");
  el.btnHelpFeedback.textContent = t("settings.open");
  el.btnHelpDsh.textContent = t("settings.open");
  el.btnHelpDshd.textContent = t("settings.open");
  el.btnCheckUpdate.textContent = t("settings.checkUpdate");
  if (!updateBusy) el.btnUpdateInstall.textContent = t("settings.downloadAndInstall");
  el.btnCancelUpdate.title = t("settings.cancelTitle");
  el.selLanguage.options[0].textContent = t("settings.langAuto");
  // 语言切换后重渲染动态文案（检查结果/引擎提示/进度），避免残留旧语言
  if (lastEngineVer) {
    el.engineUpdateHint.hidden = false;
    el.engineUpdateHint.textContent = t("settings.engineUpdateAvailable").replace("{v}", lastEngineVer);
  }
  if (lastUpdateResult === "available" && lastUpdateVer) {
    el.updateResult.textContent = t("settings.updateAvailable").replace("{v}", lastUpdateVer);
  } else if (lastUpdateResult === "upToDate") {
    el.updateResult.textContent = t("settings.upToDate");
  } else if (lastUpdateResult === "placeholder") {
    el.updateResult.textContent = t("settings.updatePlaceholder");
  }
  if (lastProgress) applyProgress(lastProgress);
}

function renderEnv(env: EnvCheck) {
  el.envBundledNodeVal.textContent = env.bundledNode.version;
  el.envSystemNodeVal.textContent = env.systemNode.ok ? env.systemNode.version! : t("env.missing");
  el.envSystemNodeVal.className = "badge " + (env.systemNode.ok ? "ok" : "missing");
  el.envPythonVal.textContent = env.python.ok ? env.python.version! : t("env.missing");
  el.envPythonVal.className = "badge " + (env.python.ok ? "ok" : "missing");
  el.envDshCliVal.textContent = env.dshCli.ok ? env.dshCli.version! : t("env.missing");
  el.envDshCliVal.className = "badge " + (env.dshCli.ok ? "ok" : "missing");
  el.envWingetVal.textContent = env.winget.ok ? env.winget.version! : t("env.missing");
  el.envWingetVal.className = "badge " + (env.winget.ok ? "ok" : "missing");
  el.btnInstallPython.textContent = env.python.ok ? t("env.installed") : t("env.install");
  el.btnInstallPython.disabled = env.python.ok;
  el.btnInstallCli.textContent = env.dshCli.ok ? t("env.installed") : t("env.install");
  el.btnInstallCli.disabled = env.dshCli.ok;
}

function appendInstallLog(p: InstallProgress) {
  el.installProgress.classList.remove("hidden");
  const lines = p.lines.join("\n");
  if (lines) el.installProgressLog.textContent += lines + "\n";
  if (p.error) el.installProgressLog.textContent += `\n${t("settings.errorPrefix")} ${p.error}\n`;
  if (p.stage === "done") {
    el.installProgressLog.textContent += "\n✔ " + t("env.installed") + "\n";
  }
  el.installProgressLog.scrollTop = el.installProgressLog.scrollHeight;
}

/** 开机自启通过 Electron 的登录项实现（默认关闭，仅当用户开启时启用）。 */
function applyAutoStart(enabled: boolean) {
  // 实际实现位于主进程；此处保留调用占位（由主进程 app.setLoginItemSettings 处理）
  void enabled;
}

main();
