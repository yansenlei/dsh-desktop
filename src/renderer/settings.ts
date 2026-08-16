/**
 * 设置页（壳 UI）：端口、开机自启、托盘行为、运行环境一键安装、数据/日志目录、关于。
 */
import { setLang, detectLang, t } from "./i18n";
import type { EnvCheck, InstallProgress } from "../shared/types";

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
  aboutVersion: $("about-version"),
  aboutDshVersion: $("about-dsh-version"),
  engineUpdateHint: $("engine-update-hint"),
  aboutElectron: $("about-electron"),
  aboutNode: $("about-node"),
  btnCheckUpdate: $<HTMLButtonElement>("btn-check-update"),
  btnUpdateInstall: $<HTMLButtonElement>("btn-update-install"),
  updateResult: $("update-result"),
  updateProgress: $("update-progress"),
  toast: $("toast"),
};

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(msg: string) {
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2200);
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

  // ── 关于 ──
  el.aboutVersion.textContent = info.version;
  el.aboutDshVersion.textContent = info.dshVersion ?? "-";
  el.aboutElectron.textContent = info.electron;
  el.aboutNode.textContent = info.node;
  // 引擎更新提示：内置 Harness 引擎若落后于 npm 最新版，提示用户（静默失败）
  window.dshDesktop.checkEngineUpdate().then((e) => {
    if (e.latest && !e.upToDate && e.current) {
      el.engineUpdateHint.hidden = false;
      el.engineUpdateHint.textContent = t("settings.engineUpdateAvailable").replace("{v}", e.latest);
    }
  }).catch(() => { /* 静默 */ });
  el.btnCheckUpdate.addEventListener("click", async () => {
    const r = await window.dshDesktop.checkUpdate();
    if (r.latest && !r.upToDate) {
      el.updateResult.textContent = t("settings.updateAvailable").replace("{v}", r.latest);
      // 有可用更新：Windows/macOS 均提供「下载并安装」，其它平台打开下载页
      if (info.platform === "win32" || info.platform === "darwin") {
        el.btnUpdateInstall.hidden = false;
      } else {
        window.dshDesktop.openExternal("https://github.com/yansenlei/dsh-desktop/releases");
      }
    } else if (r.upToDate) {
      el.updateResult.textContent = t("settings.upToDate");
      el.btnUpdateInstall.hidden = true;
    } else {
      el.updateResult.textContent = t("settings.updatePlaceholder");
      el.btnUpdateInstall.hidden = true;
    }
  });

  // ── 静默自动更新：下载 → 安装 → 退出（Windows） ──
  let downloadedPath: string | undefined;
  el.btnUpdateInstall.addEventListener("click", async () => {
    el.btnUpdateInstall.disabled = true;
    el.btnCheckUpdate.disabled = true;
    el.updateProgress.hidden = false;
    if (!downloadedPath) {
      el.updateProgress.textContent = t("settings.updateDownloading");
      const d = await window.dshDesktop.downloadUpdate();
      if (d.error || d.stage === "error") {
        el.updateProgress.textContent = t("settings.updateDownloadFailed") + (d.error ? `: ${d.error}` : "");
        el.btnUpdateInstall.disabled = false;
        el.btnCheckUpdate.disabled = false;
        return;
      }
      downloadedPath = d.filePath;
    }
    el.updateProgress.textContent = t("settings.updateInstalling");
    const r = await window.dshDesktop.installUpdate(downloadedPath);
    if (!r.ok) {
      el.updateProgress.textContent = t("settings.updateInstallFailed") + (r.error ? `: ${r.error}` : "");
      el.btnUpdateInstall.disabled = false;
      el.btnCheckUpdate.disabled = false;
    }
    // 安装器接管后应用会退出；此处不重置按钮
  });

  window.dshDesktop.onUpdateProgress((p) => {
    if (p.stage === "downloading" && p.percent !== null) {
      el.updateProgress.textContent = t("settings.updateDownloading") + ` ${p.percent}%`;
    } else if (p.stage === "installing") {
      el.updateProgress.textContent = t("settings.updateInstalling");
    } else if (p.stage === "error") {
      el.updateProgress.textContent = t("settings.updateDownloadFailed") + (p.error ? `: ${p.error}` : "");
    } else if (p.stage === "downloaded") {
      el.updateProgress.textContent = t("settings.updateReady");
    }
  });

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
  el.btnCheckUpdate.textContent = t("settings.checkUpdate");
  el.btnUpdateInstall.textContent = t("settings.downloadAndInstall");
  el.selLanguage.options[0].textContent = t("settings.langAuto");
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
