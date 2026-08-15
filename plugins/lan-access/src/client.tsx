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

// ── 文案（按浏览器语言简单本地化；完整 i18n 由 DSH locale 服务管理） ──
const UI_TEXT = (() => {
  const zh =
    typeof navigator !== "undefined" && /^zh/i.test(navigator.language);
  return {
    btn: zh ? "手机访问" : "Phone Access",
    btnTitle: zh ? "手机访问电脑（局域网）" : "Access your computer from your phone (LAN)",
    closeLabel: zh ? "关闭" : "Close",
    title: zh ? "手机访问电脑" : "Phone Access",
    subtitle: zh ? "手机扫码后，在局域网内随时连接你的电脑" : "Scan to connect to your computer over the LAN",
    tip: zh
      ? "请确保手机与电脑连接同一 Wi-Fi / 网络\n如无法打开，请检查电脑防火墙是否允许局域网访问"
      : "Make sure your phone and computer are on the same Wi-Fi\nIf it fails, check your firewall allows LAN access",
    off: zh
      ? "局域网访问未开启\n请在桌面端「设置 → 局域网访问」中开启后刷新本页"
      : "LAN access is off\nEnable it in Desktop Settings → LAN Access, then refresh",
    fetchErr: zh ? "获取局域网信息失败：" : "Failed to get LAN info: ",
  };
})();

// ── 样式注入（data-plugin-css 模式，黑白主题） ─────────────────────
const css = `
.lan-access-btn {
  display:flex;align-items:center;gap:8px;width:100%;height:38px;padding:0 12px;
  border:1px solid transparent;border-radius:10px;background:transparent;
  color:var(--dsw-alias-label-primary,#e8e8ec);font-size:13px;cursor:pointer;box-sizing:border-box;
}
.lan-access-btn:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07)); }
.lan-access-btn svg { flex:none; }
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

function LanPanel({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [info, setInfo] = useState<LanInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          <h3>{UI_TEXT.title}</h3>
          <button className="lan-access-close" onClick={onClose} aria-label={UI_TEXT.closeLabel}>
            ✕
          </button>
        </div>
        <p className="lan-access-sub">{UI_TEXT.subtitle}</p>

        {info?.enabled && info.url ? (
          <>
            <div className="lan-access-qr">
              <canvas ref={canvasRef} width={220} height={220} />
            </div>
            <p className="lan-access-url">{info.url}</p>
            <p className="lan-access-tip">
              {UI_TEXT.tip}
              <br />
              首次打开请按页面提示信任该设备
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
              {UI_TEXT.off.split("\n")[0]}
              <br />
              {UI_TEXT.off.split("\n")[1]}
            </p>
          </>
        )}
        {error && <p className="lan-access-err">{UI_TEXT.fetchErr}{error}</p>}
      </div>
    </div>
  );
}

function LanAccessButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="lan-access-btn"
        onClick={() => setOpen(true)}
        title={UI_TEXT.btnTitle}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.7" />
          <rect x="14" y="3" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.7" />
          <rect x="3" y="14" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.7" />
          <path d="M14 14h3v3h-3z" fill="currentColor" />
          <path d="M17 17h4v4h-4z" fill="currentColor" />
          <path d="M14 21v-1M21 14v-1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        {UI_TEXT.btn}
      </button>
      {open && <LanPanel onClose={() => setOpen(false)} />}
    </>
  );
}

// ── 插件契约 ─────────────────────────────────────────────────────────
// 注意：inject 是「服务名」而非包名（客户端运行时按服务名注入）。
const inject = ["slots"];

function apply(ctx: any) {
  ctx.effect(
    () =>
      ctx.slots.register(
        {
          name: "sidebar.footer.action",
          // list 槽：每条注册需要唯一 id（参考官方 cordis-panel 的写法）
          id: "lan-access",
          priority: 20,
        },
        LanAccessButton,
      ),
    "lan-access: sidebar footer button",
  );
}

export { apply, inject };
