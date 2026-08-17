/**
 * lan-access 插件 —— 浏览器端（client half）。
 *
 * 在侧边栏底部注册「手机访问」按钮，点击弹出二维码面板：
 * - fetch /lan-info 获取局域网访问信息（IP、端口、URL、是否已开启监听）
 * - 用 qrcode 渲染二维码（URL 已含 IP，手机扫码直接访问）
 * - 未开启局域网监听时给出引导提示
 *
 * 打包：esbuild -> CJS bundle（react / react-jsx-runtime / @deepseek-ai/* 保持
 * external，由前端 ModuleLoader 的 require 提供；qrcode 打进 bundle），
 * 再包装成 window.__ModuleLoader__.load({ id, factory }) 格式。
 */
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

const PLUGIN_ID = "@dsh-desktop/lan-access";

const NS = "@dsh-desktop/lan-access";

// ── 文案：zh/en 双字典，注册进 Harness locale 服务，跟随其语言设置 ──
const DICT = {
  zh: {
    btn: "局域网",
    btnTitle: "局域网访问：手机扫码连接电脑（在家）",
    closeLabel: "关闭",
    title: "局域网访问",
    subtitle: "手机扫码后，在局域网内随时连接你的电脑",
    tip: "请确保手机与电脑连接同一 Wi-Fi / 网络\n如无法打开，请检查电脑防火墙是否允许局域网访问",
    off: "局域网访问未开启\n请在桌面端「设置 → 局域网访问」中开启后刷新本页",
    enableBtn: "一键开启局域网访问",
    enablingBtn: "正在开启…",
    openSettingsBtn: "打开桌面端设置",
    enableErr: "开启失败：",
    fetchErr: "获取局域网信息失败：",
    trustDevice: "首次打开请按页面提示信任该设备",
    desktopSettingsTitle: "DSH Desktop 设置",
    desktopSettingsDesc: "端口、局域网访问、自动更新等桌面端配置",
    desktopSettingsOpen: "打开",
  },
  en: {
    btn: "LAN",
    btnTitle: "LAN access: scan to connect from your phone (at home)",
    closeLabel: "Close",
    title: "LAN Access",
    subtitle: "Scan to connect to your computer over the LAN",
    tip: "Make sure your phone and computer are on the same Wi-Fi\nIf it fails, check your firewall allows LAN access",
    off: "LAN access is off\nEnable it in Desktop Settings → LAN Access, then refresh",
    enableBtn: "Enable LAN Access",
    enablingBtn: "Enabling…",
    openSettingsBtn: "Open Desktop Settings",
    enableErr: "Failed to enable: ",
    fetchErr: "Failed to get LAN info: ",
    trustDevice: "On first open, tap \"Trust\" in the browser prompt to allow this device",
    desktopSettingsTitle: "DSH Desktop Settings",
    desktopSettingsDesc: "Ports, LAN access, auto-updates and other desktop options",
    desktopSettingsOpen: "Open",
  },
};

/** 兜底（组件未注入 locale 或 t 缺失时按浏览器语言取词）。 */
const FALLBACK =
  typeof navigator !== "undefined" && /^zh/i.test(navigator.language)
    ? DICT.zh
    : DICT.en;

function makeT(t?: (key: string) => string): typeof FALLBACK {
  if (!t) return FALLBACK;
  return new Proxy(FALLBACK, {
    get: (_o, k) => (typeof k === "string" ? t(k) : undefined),
  }) as typeof FALLBACK;
}

// ── 桌面端桥（仅桌面端窗口内可用；手机浏览器无此桥） ─────────────────
interface DesktopBridge {
  openSettings?: () => Promise<void>;
  setSettings?: (patch: { lanAccess?: boolean }) => Promise<unknown>;
  restartServer?: () => Promise<unknown>;
}

function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const b = (window as unknown as { dshDesktop?: DesktopBridge }).dshDesktop;
  return b && typeof b.openSettings === "function" ? b : null;
}

// ── 样式注入（data-plugin-css 模式，黑白主题） ─────────────────────
const css = `
.lan-access-btn {
  display:flex;align-items:center;gap:8px;width:100%;height:38px;padding:0 12px;
  border:1px solid transparent;border-radius:10px;background:transparent;
  color:var(--dsw-alias-label-primary,#e8e8ec);font-size:13px;cursor:pointer;box-sizing:border-box;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;
}
.lan-access-btn:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07)); }
.lan-access-btn svg { flex:none; }
.lan-access-btn span { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.lan-access-btn.narrow { justify-content:center;padding:0; }
/* 折叠态：两个插件按钮上下堆叠，避免左右挤压 */
.dshd-footer-stack { display:flex !important; flex-direction:column !important; flex-wrap:nowrap !important; gap:4px; }
.dshd-footer-stack .lan-access-btn,
.dshd-footer-stack .tg-btn { width:100% !important; flex:0 0 auto; }
.dshd-desktop-row { display:flex;align-items:center;gap:16px;justify-content:space-between;padding:10px 0; }
.dshd-desktop-row-text { min-width:0; }
.dshd-desktop-row-title { font-size:14px;color:var(--dsw-alias-label-primary,#e8e8ec); }
.dshd-desktop-row-desc { font-size:12px;color:var(--dsw-alias-label-secondary,#8f8f96);margin-top:2px; }
.dshd-desktop-row-btn { flex:none;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.18));background:var(--dsw-alias-button-elevated-fill,#1a1c20);color:var(--dsw-alias-label-primary,#e8e8ec);font-size:12.5px;padding:6px 14px;border-radius:9px;cursor:pointer; }
.dshd-desktop-row-btn:hover { border-color:var(--dsw-alias-border-l3,rgba(255,255,255,.32)); }
.lan-access-overlay {
  position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.66);
  display:flex;align-items:center;justify-content:center;
}
.lan-access-card {
  width:340px;background:#0d0d10;border:1px solid rgba(255,255,255,.14);
  border-radius:16px;padding:22px 22px 18px;box-shadow:0 18px 60px rgba(0,0,0,.65);
  color:var(--dsw-alias-label-primary,#f2f2f4);font-size:13px;
}
.lan-access-head { display:flex;align-items:center;gap:8px;margin-bottom:4px; }
.lan-access-head h3 { margin:0;font-size:15px;font-weight:600;flex:1; }
.lan-access-close {
  border:none;background:transparent;color:var(--dsw-alias-label-secondary,#8f8f96);
  font-size:16px;cursor:pointer;padding:4px 8px;border-radius:8px;
}
.lan-access-close:hover { background:rgba(255,255,255,.09); color:#fff; }
.lan-access-sub { color:var(--dsw-alias-label-secondary,#8f8f96);font-size:12px;margin:0 0 14px; }
.lan-access-qr { display:flex;justify-content:center;padding:8px 0 4px; }
.lan-access-qr canvas { border-radius:10px;background:#fff;padding:10px;box-shadow:0 8px 24px rgba(0,0,0,.5); }
.lan-access-url {
  margin:14px 0 0;text-align:center;font-size:14px;font-weight:600;
  color:#d6d6dc;user-select:text;word-break:break-all;
}
.lan-access-tip {
  margin:10px 0 0;text-align:center;color:var(--dsw-alias-label-secondary,#8f8f96);
  font-size:11.5px;line-height:1.6;
}
.lan-access-off {
  margin:6px 0 0;text-align:center;color:#fbbf24;font-size:12px;line-height:1.7;
}
.lan-access-off-actions { display:flex;gap:8px;justify-content:center;margin-top:14px; }
.lan-access-action {
  border:1px solid rgba(255,255,255,.22);background:transparent;color:#e8e8ec;
  font-size:12px;padding:7px 14px;border-radius:9px;cursor:pointer;line-height:1.4;
}
.lan-access-action:hover { background:rgba(255,255,255,.08); }
.lan-access-action-primary { background:#3b82f6;border-color:#3b82f6;color:#fff;font-weight:600; }
.lan-access-action-primary:hover { background:#2f6fe0; }
.lan-access-action:disabled { opacity:.55;cursor:default; }
.lan-access-err { text-align:center;color:#f87171;font-size:12px;margin-top:10px; }
`;

const tagId = `${PLUGIN_ID}/style`;
if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${tagId}"]`) === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = PLUGIN_ID;
  tag.dataset.pluginCss = tagId;
  tag.textContent = css;
  document.head.appendChild(tag);
}

// ── 组件 ─────────────────────────────────────────────────────────────

interface LanInfo {
  enabled: boolean;
  ip: string | null;
  port: number | null;
  url: string | null;
  lanAddresses: string[];
}

function LanPanel({ onClose, t }: { onClose: () => void; t?: (key: string) => string }) {
  const L = makeT(t);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [info, setInfo] = useState<LanInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);
  const bridge = getDesktopBridge();

  // 1) 获取局域网信息
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/lan-info", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as LanInfo;
        if (cancelled) return;
        setInfo(data);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 3) 一键开启：写入桌面端设置并重启服务（重启后桌面端会自动重载本页，
  //    此时 /lan-info 将返回 enabled=true，重新打开面板即可看到二维码）。
  const handleEnable = async () => {
    if (!bridge?.setSettings || !bridge.restartServer) return;
    setEnabling(true);
    setEnableError(null);
    try {
      await bridge.setSettings({ lanAccess: true });
      await bridge.restartServer();
    } catch (err) {
      setEnableError((err as Error)?.message ?? String(err));
      setEnabling(false);
    }
  };

  // 2) 二维码渲染：独立 effect，等 info 就绪 + canvas 挂载后再画。
  //    若放在同一个 effect 里，fetch 完成时 canvasRef 可能尚未挂载
  //    （setInfo 触发的重渲染是异步的），二维码会静默空白。
  useEffect(() => {
    if (!info?.url || !canvasRef.current) return;
    let cancelled = false;
    QRCode.toCanvas(canvasRef.current, info.url, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0b1220", light: "#ffffff" },
    }).catch((err: unknown) => {
      if (!cancelled) setError((err as Error).message);
    });
    return () => {
      cancelled = true;
    };
  }, [info]);

  return (
    <div className="lan-access-overlay" onClick={onClose}>
      <div className="lan-access-card" onClick={(e) => e.stopPropagation()}>
        <div className="lan-access-head">
          <h3>{L.title}</h3>
          <button className="lan-access-close" onClick={onClose} aria-label={L.closeLabel}>
            ✕
          </button>
        </div>
        <p className="lan-access-sub">{L.subtitle}</p>

        {info?.enabled && info.url ? (
          <>
            <div className="lan-access-qr">
              <canvas ref={canvasRef} width={220} height={220} />
            </div>
            <p className="lan-access-url">{info.url}</p>
            <p className="lan-access-tip">
              {L.tip}
              <br />
              {L.trustDevice}
            </p>
          </>
        ) : (
          <>
            <div className="lan-access-qr" style={{ padding: "18px 0" }}>
              <svg width="96" height="96" viewBox="0 0 24 24" fill="none" opacity="0.4">
                <rect x="3" y="3" width="7" height="7" rx="1" stroke="#cfcfd6" strokeWidth="1.6" />
                <rect x="14" y="3" width="7" height="7" rx="1" stroke="#cfcfd6" strokeWidth="1.6" />
                <rect x="3" y="14" width="7" height="7" rx="1" stroke="#cfcfd6" strokeWidth="1.6" />
                <path d="M14 14h3v3h-3zM17 17h4v4h-4z" fill="#cfcfd6" />
                <path d="M14 21v-1M21 14v-1" stroke="#cfcfd6" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </div>
            <p className="lan-access-off">
              {L.off.split("\n")[0]}
              <br />
              {L.off.split("\n")[1]}
            </p>
            {bridge && (
              <div className="lan-access-off-actions">
                <button
                  className="lan-access-action lan-access-action-primary"
                  onClick={() => void handleEnable()}
                  disabled={enabling}
                >
                  {enabling ? L.enablingBtn : L.enableBtn}
                </button>
                <button
                  className="lan-access-action"
                  onClick={() => void bridge.openSettings?.()}
                  disabled={enabling}
                >
                  {L.openSettingsBtn}
                </button>
              </div>
            )}
            {enableError && (
              <p className="lan-access-err">
                {L.enableErr}
                {enableError}
              </p>
            )}
          </>
        )}
        {error && <p className="lan-access-err">{L.fetchErr}{error}</p>}
      </div>
    </div>
  );
}

function DesktopSettingsRow({ t }: { t?: (key: string) => string }) {
  const bridge = getDesktopBridge();
  if (!bridge) return null; // 非桌面端环境不显示
  const L = makeT(t);
  return (
    <div className="dshd-desktop-row">
      <div className="dshd-desktop-row-text">
        <div className="dshd-desktop-row-title">{L.desktopSettingsTitle}</div>
        <div className="dshd-desktop-row-desc">{L.desktopSettingsDesc}</div>
      </div>
      <button className="dshd-desktop-row-btn" onClick={() => void bridge.openSettings?.()}>
        {L.desktopSettingsOpen}
      </button>
    </div>
  );
}

function LanAccessButton(props: { wide?: boolean; t?: (key: string) => string }) {
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
        className={"lan-access-btn" + (narrow ? " narrow" : "")}
        onClick={() => setOpen(true)}
        title={L.btnTitle}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.7" />
          <rect x="14" y="3" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.7" />
          <rect x="3" y="14" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.7" />
          <path d="M14 14h3v3h-3z" fill="currentColor" />
          <path d="M17 17h4v4h-4z" fill="currentColor" />
          <path d="M14 21v-1M21 14v-1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        {!narrow && <span>{L.btn}</span>}
      </button>
      {open && <LanPanel onClose={() => setOpen(false)} t={t} />}
    </>
  );
}

// ── 插件契约 ─────────────────────────────────────────────────────────
// 注意：inject 是「服务名」而非包名（客户端运行时按服务名注入）。
const inject = ["slots", "locale"];

function apply(ctx: any) {
  ctx.effect(() => ctx.locale.register(NS, DICT), "lan-access: dictionaries");
  ctx.effect(
    () =>
      ctx.slots.register(
        {
          name: "sidebar.footer.action",
          // list 槽：每条注册需要唯一 id（参考官方 cordis-panel 的写法）
          id: "lan-access",
          priority: 20,
          locale: NS,
        },
        LanAccessButton,
      ),
    "lan-access: sidebar footer button",
  );
  // Harness 设置页「常规」区新增 Desktop 设置入口（重复点击桌面端只聚焦已有窗口）
  ctx.slots.inject("settings.general.item", () =>
    ctx.slots.register(
      {
        name: "settings.general.item",
        id: "desktop-settings",
        order: 90,
        locale: NS,
      },
      DesktopSettingsRow,
    ),
  );
}

export { apply, inject };
