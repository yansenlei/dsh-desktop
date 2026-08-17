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

const NS = "@dsh-desktop/telegram-bridge";

// ── 文案：zh/en 双字典，注册进 Harness locale 服务，跟随其语言设置 ──
const DICT = {
  zh: {
    btn: "Telegram",
    btnTitle: "在 Telegram 中对话控制电脑（出门在外）",
    close: "关闭",
    title: "Telegram 接入",
    subtitle: "在自己的 Telegram 里随时与 DeepSeek Harness 对话、控制电脑",
    step1: "1. 在 Telegram 中创建机器人",
    step2: "2. 把 @BotFather 给的 Token 粘贴到下面",
    createBot: "打开 @BotFather 创建 Bot",
    tokenPlaceholder: "粘贴 Bot Token（形如 123456:ABC-...）",
    save: "保存并连接",
    connecting: "连接中…",
    connected: "已连接",
    connectedDesc: "手机扫码后在 Telegram 中向该 Bot 发消息即可",
    reset: "断开并清除",
    resetting: "断开中…",
    err: "连接失败：",
    qrHint: "扫码直达对话",
    tip: "首次使用需在 @BotFather 输入 /newbot 创建机器人，把获得的 Token 粘贴到上方。",
    proxyLabel: "代理地址（可选）",
    proxyPlaceholder: "如 http://127.0.0.1:7890；留空自动检测系统代理",
    proxyDetected: "检测到系统代理：",
    proxyUsed: "当前使用代理：",
    proxyNote: "如连接失败，请填写本地代理地址（Clash/v2ray 等）",
    helpHint: "连接后，在 Telegram 中发送 /help 可查看全部操作指令（新建/切换对话等）",
  },
  en: {
    btn: "Telegram",
    btnTitle: "Chat with your computer via Telegram (away from home)",
    close: "Close",
    title: "Telegram Bridge",
    subtitle: "Chat with DeepSeek Harness from your Telegram",
    step1: "1. Create a bot in Telegram",
    step2: "2. Paste the token from @BotFather below",
    createBot: "Open @BotFather to create a bot",
    tokenPlaceholder: "Paste bot token (e.g. 123456:ABC-...)",
    save: "Save & Connect",
    connecting: "Connecting…",
    connected: "Connected",
    connectedDesc: "Scan with your phone, then message the bot in Telegram",
    reset: "Disconnect",
    resetting: "Disconnecting…",
    err: "Connection failed: ",
    qrHint: "Scan to open the chat",
    tip: "First, run /newbot in @BotFather to create a bot, then paste the token above.",
    proxyLabel: "Proxy (optional)",
    proxyPlaceholder: "e.g. http://127.0.0.1:7890; empty = auto-detect system proxy",
    proxyDetected: "System proxy detected: ",
    proxyUsed: "Using proxy: ",
    proxyNote: "If connection fails, enter your local proxy (Clash/v2ray etc.)",
    helpHint: "After connecting, send /help in Telegram for all commands (new/switch conversations etc.)",
  },
};

const T =
  typeof navigator !== "undefined" && /^zh/i.test(navigator.language)
    ? DICT.zh
    : DICT.en;

function makeT(t?: (key: string) => string): typeof T {
  if (!t) return T;
  return new Proxy(T, {
    get: (_o, k) => (typeof k === "string" ? t(k) : undefined),
  }) as typeof T;
}

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
.tg-btn.narrow { justify-content:center;padding:0; }
/* 折叠态：两个插件按钮上下堆叠，避免左右挤压 */
.dshd-footer-stack { display:flex !important; flex-direction:column !important; flex-wrap:nowrap !important; gap:4px; }
.dshd-footer-stack .tg-btn,
.dshd-footer-stack .lan-access-btn { width:100% !important; flex:0 0 auto; }
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

function TelegramPanel({ onClose, t }: { onClose: () => void; t?: (key: string) => string }) {
  const L = makeT(t);
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
        setError(json.error ?? L.err);
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
          <h3>{L.title}</h3>
          <button className="tg-close" onClick={onClose} aria-label={L.close}>
            ✕
          </button>
        </div>
        <p className="tg-sub">{L.subtitle}</p>

        {info?.configured ? (
          <>
            <div className="tg-qr">
              <canvas ref={canvasRef} width={220} height={220} />
            </div>
            <p className="tg-ok">@{info.username}</p>
            <p className="tg-hint">
              {L.qrHint} · {L.connectedDesc}
              {info.proxy ? ` · ${L.proxyUsed}${info.proxy}` : ""}
            </p>
            <p className="tg-hint">{L.helpHint}</p>
            <button className="tg-reset" onClick={reset} disabled={busy}>
              {busy ? L.resetting : L.reset}
            </button>
          </>
        ) : (
          <>
            <div className="tg-step">{L.step1}</div>
            <button
              className="tg-btn-outer"
              onClick={() => window.open("https://t.me/BotFather", "_blank")}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M21.9 4.1 18.7 19c-.2 1.1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-4.9L18 6.2c.4-.4-.1-.6-.6-.2L7.2 12.9l-4.8-1.5c-1-.3-1-1 .2-1.5L20.6 2.6c.9-.3 1.6.2 1.3 1.5z" />
              </svg>
              {L.createBot}
            </button>
            <div className="tg-step">{L.step2}</div>
            <input
              className="tg-input"
              value={token}
              placeholder={L.tokenPlaceholder}
              onChange={(e) => setToken(e.target.value)}
              spellCheck={false}
            />
            <div className="tg-step">{L.proxyLabel}</div>
            <input
              className="tg-input"
              value={proxy}
              placeholder={L.proxyPlaceholder}
              onChange={(e) => setProxy(e.target.value)}
              spellCheck={false}
            />
            {info?.proxyDetected && !info.proxy && (
              <p className="tg-hint" style={{ margin: "-4px 0 8px" }}>
                {L.proxyDetected}{info.proxyDetected}
              </p>
            )}
            <button className="tg-save" onClick={save} disabled={busy || token.trim() === ""}>
              {busy ? L.connecting : L.save}
            </button>
            <p className="tg-hint">{L.tip} {L.proxyNote}</p>
          </>
        )}

        {error && <p className="tg-err">{L.err}{error}</p>}
      </div>
    </div>
  );
}

function TelegramButton(props: { wide?: boolean; t?: (key: string) => string }) {
  const { wide, t } = props;
  const L = makeT(t);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [collapsedByHost, setCollapsedByHost] = useState(false);

  // ── 折叠检测（只依赖框架原生信号，避免宽度启发式误判）──
  // 1) wide prop：宿主 renderSlot("sidebar.footer.action", { wide })，wide=false 即折叠
  // 2) 祖先类名：侧边栏根元素折叠时带 hHd-Xa_collapsed 类（dsh-client-ui-sidebar 源码），
  //    用 MutationObserver 精确监听 class 变化（1s 轮询兜底）
  useEffect(() => {
    const el = btnRef.current;
    if (!el) return;
    const scan = () => {
      let c = false;
      for (let n: HTMLElement | null = el; n; n = n.parentElement) {
        if (/collapsed|compact|icon-only|minimize/i.test(String(n.className || ""))) {
          c = true;
          break;
        }
        if (n.tagName === "BODY") break;
      }
      setCollapsedByHost(c);
    };
    scan();
    const mo = new MutationObserver(scan);
    for (let n: HTMLElement | null = el; n; n = n.parentElement) {
      mo.observe(n, { attributes: true, attributeFilter: ["class"] });
      if (n.tagName === "BODY") break;
    }
    const timer = setInterval(scan, 1000);
    return () => {
      mo.disconnect();
      clearInterval(timer);
    };
  }, []);

  const narrow = props.wide === false || collapsedByHost;

  // 折叠态：把宿主容器切成上下堆叠（两个插件按钮各占一行，不再左右挤压）
  useEffect(() => {
    const el = btnRef.current;
    if (el?.parentElement) el.parentElement.classList.toggle("dshd-footer-stack", narrow);
  }, [narrow]);

  return (
    <>
      <button
        ref={btnRef}
        className={"tg-btn" + (narrow ? " narrow" : "")}
        onClick={() => setOpen(true)}
        title={L.btnTitle}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M21.9 4.1 18.7 19c-.2 1.1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-4.9L18 6.2c.4-.4-.1-.6-.6-.2L7.2 12.9l-4.8-1.5c-1-.3-1-1 .2-1.5L20.6 2.6c.9-.3 1.6.2 1.3 1.5z" />
        </svg>
        {!narrow && <span>{L.btn}</span>}
      </button>
      {open && <TelegramPanel onClose={() => setOpen(false)} t={t} />}
    </>
  );
}

// ── 插件契约 ───────────────────────────────────────────────────────
const inject = ["slots", "locale"];

function apply(ctx: any) {
  ctx.effect(() => ctx.locale.register(NS, DICT), "telegram-bridge: dictionaries");
  ctx.effect(
    () =>
      ctx.slots.register(
        {
          name: "sidebar.footer.action",
          id: "telegram-bridge",
          priority: 21,
          locale: NS,
        },
        TelegramButton,
      ),
    "telegram-bridge: sidebar footer button",
  );
}

export { apply, inject };
