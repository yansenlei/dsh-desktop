/**
 * 临时验证脚本：加载壳 UI 页面，检查 CSP 违规与控制台错误，
 * 并用 getComputedStyle 验证关键样式确实生效。
 * 用法: electron verify-ui.cjs <boot|settings> [outFile]
 */
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

const page = process.argv[2] || "boot";
const outFile = process.argv[3];
const rootDir = path.resolve(__dirname, "..");
const file = path.join(rootDir, "dist", "renderer", `${page}.html`);
// 供外部使用：Electron 可执行路径（Windows/macOS）
const electronExe =
  process.platform === "darwin"
    ? path.join(rootDir, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron")
    : path.join(rootDir, "node_modules", "electron", "dist", "electron.exe");

function emit(msg) {
  console.log(msg);
  if (outFile) fs.appendFileSync(outFile, msg + "\n");
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 900, height: 700 });
  const violations = [];
  win.webContents.on("console-message", (_e, level, message) => {
    if (/Content Security Policy|Refused/.test(message)) violations.push(message);
  });
  win.webContents.on("did-fail-load", (_e, code, desc) => emit(`FAIL-LOAD: ${code} ${desc}`));
  await win.loadFile(file);
  await new Promise((r) => setTimeout(r, 1200));

  const checks = await win.webContents.executeJavaScript(`
    (() => {
      const g = (sel) => { const el = document.querySelector(sel); if (!el) return null; const s = getComputedStyle(el); return { display: s.display, background: s.backgroundColor, fontSize: s.fontSize, padding: s.padding, color: s.color }; };
      return {
        cssLoaded: document.styleSheets.length,
        bootDisplay: g('.boot'),
        brand: g('.brand'),
        logoMark: g('.logo-mark'),
        statusCard: g('.status-card'),
        statusText: g('.status-text'),
        detail: g('.detail'),
        progress: g('.progress'),
        actions: g('.actions'),
        hint: g('.hint'),
        bodyBg: getComputedStyle(document.body).backgroundImage.slice(0, 80),
        bodyColor: getComputedStyle(document.body).color,
      };
    })()
  `);

  emit(`PAGE: ${page}`);
  emit(`styleSheets: ${checks.cssLoaded}`);
  emit(`boot: ${JSON.stringify(checks.bootDisplay)}`);
  emit(`logoMark: ${JSON.stringify(checks.logoMark)}`);
  emit(`statusCard: ${JSON.stringify(checks.statusCard)}`);
  emit(`progress: ${JSON.stringify(checks.progress)}`);
  emit(`bodyBg: ${checks.bodyBg}`);
  emit(`bodyColor: ${checks.bodyColor}`);
  emit(`CSP violations: ${violations.length}`);
  for (const v of violations) emit("  " + v.slice(0, 160));
  emit("=====END=====");
  app.exit(violations.length === 0 ? 0 : 2);
});
