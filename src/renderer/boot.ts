/**
 * 启动页（壳 UI）：展示服务启动状态、运行日志；服务就绪后由主进程自动导航到 Harness。
 * 支持 ?phase=error&detail=... 的错误态（服务崩溃后主进程回退到这里）。
 */
import { setLang, detectLang, t } from "./i18n";
import type { ServerStatus } from "../shared/types";

declare global {
  interface Window {
    dshDesktop: import("../preload").DesktopApi;
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  appName: $("app-name"),
  appSubtitle: $("app-subtitle"),
  dot: $("status-dot"),
  statusText: $("status-text"),
  statusDetail: $("status-detail"),
  restartBadge: $("restart-badge"),
  progressWrap: $("progress-wrap"),
  progressBar: $("progress-bar"),
  logCard: $("log-card"),
  logTitle: $("log-title"),
  logToggle: $("log-toggle"),
  logBox: $("log-box"),
  btnBrowser: $<HTMLButtonElement>("btn-browser"),
  btnLogs: $<HTMLButtonElement>("btn-logs"),
  btnSettings: $<HTMLButtonElement>("btn-settings"),
  btnRetry: $<HTMLButtonElement>("btn-retry"),
  firstRunHint: $("first-run-hint"),
  footVersion: $("foot-version"),
};

let logShown = false;
let logLines: string[] = [];

async function main() {
  const params = new URLSearchParams(location.search);
  const errorPhase = params.get("phase") === "error";
  const errorDetail = params.get("detail") ?? "";

  const info = await window.dshDesktop.getAppInfo();
  const settings = await window.dshDesktop.getSettings();
  setLang(detectLang(settings.language));
  el.appName.textContent = t("appName");
  el.appSubtitle.textContent = t("appSubtitle");
  el.footVersion.textContent = `${t("version")} ${info.version}`;
  el.firstRunHint.textContent = t("firstRunHint");

  // 静态按钮文本（HTML 中为空，避免语言切换后残留中文）
  el.btnBrowser.textContent = t("actions.openBrowser");
  el.btnLogs.textContent = t("actions.viewLogs");
  el.btnSettings.textContent = t("actions.settings");
  el.btnRetry.textContent = t("actions.retry");
  el.logTitle.textContent = t("log");

  // 按钮
  el.btnBrowser.addEventListener("click", () => window.dshDesktop.openInBrowser());
  el.btnSettings.addEventListener("click", () => window.dshDesktop.openSettings());
  el.btnLogs.addEventListener("click", () => window.dshDesktop.openLogsDir());
  el.btnRetry.addEventListener("click", async () => {
    el.btnRetry.disabled = true;
    setState({ phase: "restarting", messageKey: "restarting", lastError: null } as ServerStatus);
    await window.dshDesktop.restartServer();
  });
  el.logToggle.addEventListener("click", () => {
    logShown = !logShown;
    el.logCard.classList.toggle("hidden", !logShown);
    el.logToggle.textContent = logShown ? "－" : "＋";
    if (logShown) el.logBox.scrollTop = el.logBox.scrollHeight;
  });

  // 服务日志
  window.dshDesktop.onServerLog((line) => {
    logLines.push(line);
    if (logLines.length > 400) logLines = logLines.slice(-400);
    el.logBox.textContent = logLines.join("\n");
    if (logShown) el.logBox.scrollTop = el.logBox.scrollHeight;
  });

  const status = await window.dshDesktop.getServerStatus();
  if (errorPhase) {
    setState({ ...status, phase: "error", messageKey: "error", lastError: errorDetail || status.lastError });
    el.btnRetry.classList.remove("hidden");
  } else {
    setState(status);
  }
  window.dshDesktop.onServerStatusChanged((st) => {
    setState(st);
    if (st.phase === "ready") {
      // 主进程会负责导航；这里给出提示
      el.statusDetail.textContent = t("statusDetail.ready");
    }
  });
}

function setState(st: ServerStatus) {
  const key = st.messageKey || st.phase;
  el.statusText.textContent = t(`status.${st.phase}`);
  el.dot.className = "dot " + (st.phase === "ready" ? "ok" : st.phase === "error" ? "err" : "warn");

  switch (st.phase) {
    case "starting":
      el.statusDetail.textContent = t("statusDetail.starting");
      el.progressWrap.classList.remove("hidden");
      el.progressBar.style.animation = "indeterminate 1.2s linear infinite";
      el.btnRetry.classList.add("hidden");
      break;
    case "restarting":
      el.statusDetail.textContent = t("restartingDetail");
      el.progressWrap.classList.remove("hidden");
      el.btnRetry.classList.add("hidden");
      break;
    case "ready":
      el.statusDetail.textContent = t("statusDetail.ready");
      el.progressWrap.classList.add("hidden");
      el.btnRetry.classList.add("hidden");
      break;
    case "error":
      el.statusDetail.textContent = st.lastError
        ? `${t("statusDetail.error")}（${st.lastError}）`
        : t("statusDetail.error");
      el.progressWrap.classList.add("hidden");
      el.btnRetry.classList.remove("hidden");
      el.btnRetry.disabled = false;
      break;
    case "stopped":
      el.statusDetail.textContent = t("statusDetail.stopped");
      el.progressWrap.classList.add("hidden");
      el.btnRetry.classList.remove("hidden");
      break;
    default:
      break;
  }

  if (st.restartCount > 0) {
    el.restartBadge.classList.remove("hidden");
    el.restartBadge.textContent = t("settings.restartBadge").replace("{n}", String(st.restartCount));
  }
  void key;
}

main();
