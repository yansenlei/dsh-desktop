/**
 * 验证 lan-access 插件在真实 Harness 页面中激活成功：
 * 1. 加载 http://127.0.0.1:<port>
 * 2. 捕获浏览器 console 中 "Failed to load plugins"/"did not activate" 错误
 * 3. 检查侧边栏是否出现 .lan-access-btn（「手机访问」按钮）
 */
const { app, BrowserWindow } = require("electron");
const fs = require("fs");

const port = process.argv[2] || "3081";
const outFile = process.argv[3];
const url = `http://127.0.0.1:${port}`;
// 供外部使用：Electron 可执行路径（Windows/macOS）
const electronExe =
  process.platform === "darwin"
    ? require("path").join(__dirname, "..", "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron")
    : require("path").join(__dirname, "..", "node_modules", "electron", "dist", "electron.exe");

function emit(msg) {
  console.log(msg);
  if (outFile) fs.appendFileSync(outFile, msg + "\n");
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: { contextIsolation: true },
  });
  const consoleLines = [];
  win.webContents.on("console-message", (_e, _level, message) => {
    consoleLines.push(String(message));
  });
  await win.loadURL(url);
  await new Promise((r) => setTimeout(r, 9000)); // 等前端 kernel 激活全部插件

  const bootErrors = consoleLines.filter((l) => /Failed to load plugins|did not activate|lan-access/.test(l));
  emit(`console lines: ${consoleLines.length}`);
  for (const l of bootErrors.slice(0, 5)) emit("CONSOLE: " + l.slice(0, 160));

  const dom = await win.webContents.executeJavaScript(`
    (() => {
      const btn = document.querySelector('.lan-access-btn');
      const tgBtn = document.querySelector('.tg-btn');
      return {
        hasBtn: !!btn,
        btnText: btn ? btn.textContent.trim() : null,
        hasTgBtn: !!tgBtn,
        tgBtnText: tgBtn ? tgBtn.textContent.trim() : null,
        hasOverlay: !!document.querySelector('.lan-access-overlay'),
        rootChildren: document.querySelector('#root') ? document.querySelector('#root').children.length : -1,
      };
    })()
  `);
  emit(`hasButton: ${dom.hasBtn} btnText: ${dom.btnText} hasTgButton: ${dom.hasTgBtn} tgText: ${dom.tgBtnText} rootChildren: ${dom.rootChildren}`);

  // 点 Telegram 按钮验证面板
  if (dom.hasTgBtn) {
    await win.webContents.executeJavaScript(`document.querySelector('.tg-btn').click()`);
    await new Promise((r) => setTimeout(r, 1800));
    const tg = await win.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('.tg-card');
      const input = document.querySelector('.tg-input');
      const createBtn = document.querySelector('.tg-btn-outer');
      return { hasCard: !!card, hasInput: !!input, hasCreateBtn: !!createBtn };
    })()`);
    emit(`tgPanel: card=${tg.hasCard} input=${tg.hasInput} createBtn=${tg.hasCreateBtn}`);
    await win.webContents.executeJavaScript(`document.querySelector('.tg-close').click()`);
    await new Promise((r) => setTimeout(r, 400));
  }

  // 点一下按钮，验证弹层出现
  if (dom.hasBtn) {
    await win.webContents.executeJavaScript(`document.querySelector('.lan-access-btn').click()`);
    await new Promise((r) => setTimeout(r, 2000));
    const after = await win.webContents.executeJavaScript(`(() => {
      const canvas = document.querySelector('.lan-access-qr canvas');
      let qrPixels = 0;
      let dataUrlLen = 0;
      if (canvas) {
        try {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 3; i < img.length; i += 4) if (img[i] > 0) qrPixels++;
            dataUrlLen = canvas.toDataURL('image/png').length;
          }
        } catch (e) { qrPixels = -1; }
      }
      return {
        hasOverlay: !!document.querySelector('.lan-access-overlay'),
        hasCanvas: !!canvas,
        qrPixels,
        dataUrlLen,
        offTip: !!document.querySelector('.lan-access-off'),
        urlText: document.querySelector('.lan-access-url') ? document.querySelector('.lan-access-url').textContent : null,
        errText: document.querySelector('.lan-access-err') ? document.querySelector('.lan-access-err').textContent : null,
      };
    })()`);
    emit(`afterClick: overlay=${after.hasOverlay} canvas=${after.hasCanvas} qrPixels=${after.qrPixels} dataUrlLen=${after.dataUrlLen}`);
    emit(`  offTip=${after.offTip} url=${after.urlText} err=${after.errText}`);
    const qrRendered = after.hasCanvas && after.qrPixels > 100 && after.dataUrlLen > 1000;
    emit(`QR_RENDERED: ${qrRendered}`);
  }

  const ok = dom.hasBtn && bootErrors.length === 0;
  emit(`PLUGIN_OK: ${ok}`);
  emit("=====END=====");
  app.exit(ok ? 0 : 2);
});
