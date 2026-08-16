/**
 * Telegram 桥接插件 —— 浏览器端（client half）。
 *
 * 在侧边栏底部提供「Telegram 接入」入口：
 * - 未配置：引导在 @BotFather 创建 Bot、粘贴 token、保存
 * - 已配置：显示 bot 用户名 + t.me 二维码（手机扫码直达对话）+ 重置
 * 黑白主题，中英文按浏览器语言。
 */
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

const PLUGIN_ID = "@dsh-desktop/telegram-bridge";

// ── 文案 ───────────────────────────────────────────────────────────
const T = (() => {
  const zh = typeof navigator !== "undefined" && /^zh/i.test(navigator.language);
  return {
    btn: zh ? "Telegram" : "Telegram",
    btnTitle: zh ? "在 Telegram 中对话控制电脑（出门在外）" : "Chat with your computer via Telegram (away from home)",
    close: zh ? "关闭" : "Close",
    title: zh ? "Telegram 接入" : "Telegram Bridge",
    subtitle: zh ? "在自己的 Telegram 里随时与 DeepSeek Harness 对话、控制电脑" : "Chat with DeepSeek Harness from your Telegram",
    step1: zh ? "1. 在 Telegram 中创建机器人" : "1. Create a bot in Telegram",
    step2: zh ? "2. 把 @BotFather 给的 Token 粘贴到下面" : "2. Paste the token from @BotFather below",
    createBot: zh ? "打开 @BotFather 创建 Bot" : "Open @BotFather to create a bot",
    tokenPlaceholder: zh ? "粘贴 Bot Token（形如 123456:ABC-...）" : "Paste bot token (e.g. 123456:ABC-...)",
    save: zh ? "保存并连接" : "Save & Connect",
    connecting: zh ? "连接中…" : "Connecting…",
    connected: zh ? "已连接" : "Connected",
    connectedDesc: zh ? "手机扫码后在 Telegram 中向该 Bot 发消息即可" : "Scan with your phone, then message the bot in Telegram",
    reset: zh ? "断开并清除" : "Disconnect",
    resetting: zh ? "断开中…" : "Disconnecting…",
    err: zh ? "连接失败：" : "Connection failed: ",
    qrHint: zh ? "扫码直达对话" : "Scan to open the chat",
    tip: zh ? "首次使用需在 @BotFather 输入 /newbot 创建机器人，把获得的 Token 粘贴到上方。" : "First, run /newbot in @BotFather to create a bot, then paste the token above.",
    proxyLabel: zh ? "代理地址（可选）" : "Proxy (optional)",
    proxyPlaceholder: zh ? "如 http://127.0.0.1:7890；留空自动检测系统代理" : "e.g. http://127.0.0.1:7890; empty = auto-detect system proxy",
    proxyDetected: zh ? "检测到系统代理：" : "System proxy detected: ",
    proxyUsed: zh ? "当前使用代理：" : "Using proxy: ",
    proxyNote: zh ? "如连接失败，请填写本地代理地址（Clash/v2ray 等）" : "If connection fails, enter your local proxy (Clash/v2ray etc.)",
    helpHint: zh ? "连接后，在 Telegram 中发送 /help 可查看全部操作指令（新建/切换对话等）" : "After connecting, send /help in Telegram for all commands (new/switch conversations etc.)",
  };
})();

// ── 样式（黑白主题，data-plugin-css 模式） ──────────────────────────
const css = `
.tg-btn {
  display:flex;align-items:center;gap:8px;width:100%;height:38px;padding:0 12px;
  border:1px solid transparent;border-radius:10px;background:transparent;
  color:var(--dsw-alias-label-primary,#e8e8ec);font-size:13px;cursor:pointer;box-sizing:border-box;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;
}
.tg-btn:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07)); }
.tg-btn svg { flex:none; }
.tg-btn span { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.tg-overlay {
  position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.66);
  display:flex;align-items:center;justify-content:center;
}
.tg-card {
  width:360px;max-height:86vh;overflow:auto;background:#0d0d10;
  border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:22px;
  box-shadow:0 18px 60px rgba(0,0,0,.65);
  color:var(--dsw-alias-label-primary,#f2f2f4);font-size:13px;
}
.tg-head { display:flex;align-items:center;gap:8px;margin-bottom:4px; }
.tg-head h3 { margin:0;font-size:15px;font-weight:600;flex:1; }
.tg-close {
  border:none;background:transparent;color:var(--dsw-alias-label-secondary,#8f8f96);
  font-size:16px;cursor:pointer;padding:4px 8px;border-radius:8px;
}
.tg-close:hover { background:rgba(255,255,255,.09); color:#fff; }
.tg-sub { color:var(--dsw-alias-label-secondary,#8f8f96);font-size:12px;margin:0 0 16px;line-height:1.6; }
.tg-step { color:#c6c6cc;font-size:12.5px;margin:10px 0 6px; }
.tg-btn-outer {
  width:100%;display:flex;align-items:center;gap:8px;margin:6px 0 4px;
  border:1px solid #34343a;background:rgba(20,20,22,.7);color:#f2f2f4;
  font-size:13px;padding:9px 12px;border-radius:10px;cursor:pointer;box-sizing:border-box;
}
.tg-btn-outer:hover { background:#1d1d21; }
.tg-input {
  width:100%;box-sizing:border-box;margin:6px 0 10px;padding:9px 12px;
  background:#151517;border:1px solid #2e2e33;border-radius:10px;color:#f2f2f4;
  font-size:12.5px;outline:none;
}
.tg-input:focus { border-color:#6a6a70; }
.tg-save {
  width:100%;padding:9px 0;border-radius:10px;border:none;cursor:pointer;
  background:#f4f4f5;color:#0a0a0b;font-size:13px;font-weight:600;
}
.tg-save:disabled { opacity:.45; cursor:not-allowed; }
.tg-qr { display:flex;justify-content:center;padding:6px 0; }
.tg-qr canvas { border-radius:10px;background:#fff;padding:10px;box-shadow:0 8px 24px rgba(0,0,0,.5); }
.tg-ok { text-align:center;color:#d6d6dc;font-size:14px;font-weight:600;margin:12px 0 2px;word-break:break-all; }
.tg-hint { text-align:center;color:#8f8f96;font-size:11.5px;margin:6px 0 14px;line-height:1.6; }
.tg-err { text-align:center;color:#f87171;font-size:12px;margin-top:10px;word-break:break-all; }
.tg-reset {
  width:100%;padding:8px 0;border-radius:10px;cursor:pointer;
  border:1px solid #3a3a40;background:transparent;color:#c6c6cc;font-size:12.5px;margin-top:12px;
}
.tg-reset:hover { background:rgba(255,255,255,.06); }
`;

const tagId = `${PLUGIN_ID}/style`;
if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${tagId}"]`) === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = PLUGIN_ID;
  tag.dataset.pluginCss = tagId;
  tag.textContent = css;
  document.head.appendChild(tag);
}

// ── 组件 ───────────────────────────────────────────────────────────
interface TgInfo {
  configured: boolean;
  username: string | null;
  link: string | null;
  tokenSet: boolean;
  proxy: string | null;
  proxyDetected: string | null;
}

function TelegramPanel({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [info, setInfo] = useState<TgInfo | null>(null);
  const [token, setToken] = useState("");
  const [proxy, setProxy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = await fetch("/telegram-info", { cache: "no-store" });
      const data = (await res.json()) as TgInfo;
      setInfo(data);
      setProxy(data.proxy ?? "");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  // 二维码：info.link 就绪且 canvas 挂载后渲染
  useEffect(() => {
    if (!info?.link || !canvasRef.current) return;
    let cancelled = false;
    QRCode.toCanvas(canvasRef.current, info.link, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0b1220", light: "#ffffff" },
    }).catch((e: unknown) => {
      if (!cancelled) setError((e as Error).message);
    });
    return () => {
      cancelled = true;
    };
  }, [info]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/telegram-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token.trim(), proxy: proxy.trim() }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? T.err);
      } else {
        setToken("");
        await refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      await fetch("/telegram-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "" }),
      });
      setInfo({ configured: false, username: null, link: null, tokenSet: false });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tg-overlay" onClick={onClose}>
      <div className="tg-card" onClick={(e) => e.stopPropagation()}>
        <div className="tg-head">
          <h3>{T.title}</h3>
          <button className="tg-close" onClick={onClose} aria-label={T.close}>
            ✕
          </button>
        </div>
        <p className="tg-sub">{T.subtitle}</p>

        {info?.configured ? (
          <>
            <div className="tg-qr">
              <canvas ref={canvasRef} width={220} height={220} />
            </div>
            <p className="tg-ok">@{info.username}</p>
            <p className="tg-hint">
              {T.qrHint} · {T.connectedDesc}
              {info.proxy ? ` · ${T.proxyUsed}${info.proxy}` : ""}
            </p>
            <p className="tg-hint">{T.helpHint}</p>
            <button className="tg-reset" onClick={reset} disabled={busy}>
              {busy ? T.resetting : T.reset}
            </button>
          </>
        ) : (
          <>
            <div className="tg-step">{T.step1}</div>
            <button
              className="tg-btn-outer"
              onClick={() => window.open("https://t.me/BotFather", "_blank")}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M21.9 4.1 18.7 19c-.2 1.1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-4.9L18 6.2c.4-.4-.1-.6-.6-.2L7.2 12.9l-4.8-1.5c-1-.3-1-1 .2-1.5L20.6 2.6c.9-.3 1.6.2 1.3 1.5z" />
              </svg>
              {T.createBot}
            </button>
            <div className="tg-step">{T.step2}</div>
            <input
              className="tg-input"
              value={token}
              placeholder={T.tokenPlaceholder}
              onChange={(e) => setToken(e.target.value)}
              spellCheck={false}
            />
            <div className="tg-step">{T.proxyLabel}</div>
            <input
              className="tg-input"
              value={proxy}
              placeholder={T.proxyPlaceholder}
              onChange={(e) => setProxy(e.target.value)}
              spellCheck={false}
            />
            {info?.proxyDetected && !info.proxy && (
              <p className="tg-hint" style={{ margin: "-4px 0 8px" }}>
                {T.proxyDetected}{info.proxyDetected}
              </p>
            )}
            <button className="tg-save" onClick={save} disabled={busy || token.trim() === ""}>
              {busy ? T.connecting : T.save}
            </button>
            <p className="tg-hint">{T.tip} {T.proxyNote}</p>
          </>
        )}

        {error && <p className="tg-err">{T.err}{error}</p>}
      </div>
    </div>
  );
}

function TelegramButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="tg-btn" onClick={() => setOpen(true)} title={T.btnTitle}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M21.9 4.1 18.7 19c-.2 1.1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-4.9L18 6.2c.4-.4-.1-.6-.6-.2L7.2 12.9l-4.8-1.5c-1-.3-1-1 .2-1.5L20.6 2.6c.9-.3 1.6.2 1.3 1.5z" />
        </svg>
        <span>{T.btn}</span>
      </button>
      {open && <TelegramPanel onClose={() => setOpen(false)} />}
    </>
  );
}

// ── 插件契约 ───────────────────────────────────────────────────────
const inject = ["slots"];

function apply(ctx: any) {
  ctx.effect(
    () =>
      ctx.slots.register(
        {
          name: "sidebar.footer.action",
          id: "telegram-bridge",
          priority: 21,
        },
        TelegramButton,
      ),
    "telegram-bridge: sidebar footer button",
  );
}

export { apply, inject };
