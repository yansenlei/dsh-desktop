/**
 * plugin-market 插件 —— 浏览器端（client half）。
 *
 * 在 Harness 设置 → 插件 模块的 Tab 区新增「搜索安装」：
 * - 搜索：调用 /plugin-market/search（npm 全网搜索 DSH 插件）
 * - 结果卡片：插件信息 + 来源链接 + 一键安装（经桌面端桥，桌面端内置 npm 安装并重启服务）
 * - 按包名安装：输入 npm 包名直接安装
 * - 拖入安装包：拖入 .tgz 文件安装
 *
 * 安装依赖桌面端桥（window.dshDesktop.installPlugin）；无桥（纯 Web 部署）时
 * 提示需在桌面端使用。
 */
import { useEffect, useRef, useState } from "react";

const PLUGIN_ID = "@dsh-desktop/plugin-market";
const NS = PLUGIN_ID;

// ── 文案：zh/en 双字典，注册进 Harness locale 服务 ──
const DICT = {
  zh: {
    tabLabel: "搜索安装",
    searchPlaceholder: "搜索全网 DSH 插件，如：telegram、二维码、搜索工具…",
    searchBtn: "AI 搜索",
    searching: "搜索中…",
    namePlaceholder: "输入 npm 包名（如 dsh-plugin-xxx）",
    installByName: "按包名安装",
    dragHint: "点击选择安装包，或拖拽到这里（.tgz）",
    dragActive: "松开以安装",
    install: "一键安装",
    installing: "安装中…",
    installed: "已安装",
    installedTip: "安装成功，服务正在重启，插件稍后生效",
    alreadyInstalled: "已安装，无需重复安装",
    noDesktop: "请在 DSH Desktop 桌面端使用此功能",
    empty: "没有找到相关插件，换个关键词试试",
    source: "npm",
    openRepo: "来源 ↗",
    errFetch: "搜索失败：",
    errInstall: "安装失败：",
    desc: "搜索并安装全网 DSH 插件",
    safetyTip: "仅展示含 dsh 标识且带来源链接的插件；安装前请自行核实来源与代码",
  },
  en: {
    tabLabel: "Search & Install",
    searchPlaceholder: "Search DSH plugins across npm, e.g. telegram, qrcode, search…",
    searchBtn: "AI Search",
    searching: "Searching…",
    namePlaceholder: "Enter an npm package name (e.g. dsh-plugin-xxx)",
    installByName: "Install by name",
    dragHint: "Click to choose a plugin package, or drag one here (.tgz)",
    dragActive: "Release to install",
    install: "Install",
    installing: "Installing…",
    installed: "Installed",
    installedTip: "Installed — service is restarting, the plugin will take effect shortly",
    alreadyInstalled: "Already installed — no need to reinstall",
    noDesktop: "This feature requires the DSH Desktop app",
    empty: "No plugins found. Try another keyword.",
    source: "npm",
    openRepo: "Source ↗",
    errFetch: "Search failed: ",
    errInstall: "Install failed: ",
    desc: "Search and install DSH plugins from across npm",
    safetyTip: "Only packages with a dsh marker and a source link are shown; verify the source and code before installing",
  },
};

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

// ── 桌面端桥 ──
interface DesktopBridge {
  installPlugin?: (req: { spec?: string; fileName?: string; fileBase64?: string }) => Promise<{ ok: boolean; name?: string; error?: string }>;
  managePlugin?: (req: { action: "disable" | "enable" | "uninstall"; name: string }) => Promise<{ ok: boolean; name?: string; error?: string }>;
}
function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const b = (window as unknown as { dshDesktop?: DesktopBridge }).dshDesktop;
  return b && typeof b.installPlugin === "function" && typeof b.managePlugin === "function" ? b : null;
}

// ── 样式 ──
const css = `
.pm-wrap { display:flex; flex-direction:column; gap:14px; }
.pm-search { display:flex; gap:8px; }
.pm-input {
  flex:1; min-width:0; box-sizing:border-box; padding:9px 12px;
  background:var(--dsw-alias-input-fill, #151517); border:1px solid var(--dsw-alias-border-l2, #2e2e33);
  border-radius:10px; color:var(--dsw-alias-label-primary, #f2f2f4); font-size:13px; outline:none;
}
.pm-input:focus { border-color:#6a6a70; }
.pm-btn {
  flex:none; padding:9px 18px; border-radius:10px; cursor:pointer;
  background:#3b82f6; border:1px solid #3b82f6; color:#fff; font-size:13px; font-weight:600;
}
.pm-btn:hover { background:#2f6fe0; }
.pm-btn:disabled { opacity:.55; cursor:default; }
.pm-btn.ghost { background:transparent; border-color:var(--dsw-alias-border-l2,#3a3a40); color:var(--dsw-alias-label-primary,#e8e8ec); font-weight:500; }
.pm-btn.ghost:hover { background:rgba(255,255,255,.06); }
.pm-list { display:flex; flex-direction:column; gap:10px; }
.pm-card {
  display:flex; align-items:center; gap:12px; padding:12px 14px;
  background:var(--dsw-alias-panel-2,#141418); border:1px solid var(--dsw-alias-border-l2,#2a2a30);
  border-radius:12px;
}
.pm-card-main { flex:1; min-width:0; }
.pm-card-name { font-size:14px; font-weight:600; color:var(--dsw-alias-label-primary,#f2f2f4); word-break:break-all; }
.pm-card-ver { font-size:11.5px; color:var(--dsw-alias-label-secondary,#8f8f96); margin-left:8px; }
.pm-card-desc { font-size:12px; color:var(--dsw-alias-label-secondary,#9a9aa2); margin-top:3px; line-height:1.6; }
.pm-card-links { display:flex; gap:12px; margin-top:5px; font-size:11.5px; }
.pm-card-links a { color:var(--dsw-alias-link,#4d9fff); text-decoration:none; }
.pm-drop {
  border:1.5px dashed var(--dsw-alias-border-l3,#3a3a42); border-radius:12px;
  padding:18px; text-align:center; color:var(--dsw-alias-label-secondary,#8f8f96);
  font-size:12.5px; transition:border-color .15s, background .15s;
}
.pm-drop.active { border-color:#3b82f6; background:rgba(59,130,246,.08); color:#dbeafe; }
.pm-msg { font-size:12px; line-height:1.7; color:var(--dsw-alias-label-secondary,#9a9aa2); word-break:break-all; }
.pm-installed-head {
  display:flex; align-items:center; gap:10px; width:100%;
  background:var(--dsw-alias-panel-2,#141418); border:1px solid var(--dsw-alias-border-l2,#2a2a30);
  border-radius:12px; padding:12px 14px; cursor:pointer; text-align:left;
  transition:background .15s;
}
.pm-installed-head:hover { background:rgba(255,255,255,.04); }
.pm-installed-title { font-size:13.5px; font-weight:600; color:var(--dsw-alias-label-primary,#f2f2f4); }
.pm-installed-count { margin-left:6px; font-size:11.5px; font-weight:400; color:var(--dsw-alias-label-secondary,#8f8f96); }
.pm-installed-desc { flex:1; min-width:0; font-size:11.5px; color:var(--dsw-alias-label-secondary,#8f8f96); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pm-installed-chev { flex:none; color:var(--dsw-alias-label-secondary,#8f8f96); font-size:12px; }
.pm-msg.ok { color:#4ade80; }
.pm-msg.err { color:#f87171; }
`;

const tagId = `${PLUGIN_ID}/style`;
if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${tagId}"]`) === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = PLUGIN_ID;
  tag.dataset.pluginCss = tagId;
  tag.textContent = css;
  document.head.appendChild(tag);
}

// ── 数据模型（与 host 端统一格式） ──
interface InstalledItem {
  name: string;
  version?: string;
  description?: string;
  disabled?: boolean;
}

interface PluginItem {
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  repository?: string;
  source?: string;
  score?: number | null;
}

function PluginMarketTab({ t }: { t?: (key: string) => string }) {
  const L = makeT(t);
  const bridge = getDesktopBridge();

  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PluginItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installedNames, setInstalledNames] = useState<string[]>([]);
  const [installedList, setInstalledList] = useState<InstalledItem[]>([]);
  const [managing, setManaging] = useState<string | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null);
  const [showInstalled, setShowInstalled] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (f: File | undefined | null) => {
    if (!f) return;
    if (!/\.tgz$|\.tar\.gz$/i.test(f.name)) {
      setMessage({ text: L.errInstall + "需要 .tgz 文件", kind: "err" });
      return;
    }
    const buf = await f.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    void doInstall(f.name, { name: f.name, data: b64 });
  };
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [nameSpec, setNameSpec] = useState("");

  const refreshInstalled = async () => {
    try {
      const res = await fetch(`/plugin-market/installed`, { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; items?: InstalledItem[] };
      if (data.ok && data.items) {
        setInstalledList(data.items);
        setInstalledNames(data.items.map((i) => i.name));
      }
    } catch {
      /* 忽略 */
    }
  };
  useEffect(() => { void refreshInstalled(); }, []);

  const doManage = async (action: "disable" | "enable" | "uninstall", name: string) => {
    if (!bridge) return;
    setManaging(name);
    setMessage(null);
    try {
      const r = await bridge.managePlugin({ action, name });
      if (r.ok) {
        setMessage({ text: `${name} ${action === "uninstall" ? L.uninstall : action === "disable" ? L.disable : L.enable} · ${L.installedTip}`, kind: "ok" });
        setConfirmUninstall(null);
        void refreshInstalled();
      } else {
        setMessage({ text: L.errInstall + (r.error || ""), kind: "err" });
      }
    } catch (err) {
      setMessage({ text: L.errInstall + (err as Error).message, kind: "err" });
    } finally {
      setManaging(null);
    }
  };

  const doSearch = async (q: string) => {
    const kw = q.trim();
    if (!kw) return;
    setSearching(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/plugin-market/search?q=${encodeURIComponent(kw)}`, { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; items?: PluginItem[]; installed?: string[]; error?: string };
      if (!data.ok || !data.items) {
        setError((data.error || "unknown") as string);
        setItems([]);
      } else {
        setItems(data.items);
        setInstalledNames(data.installed ?? []);
        if (data.items.length === 0) setError(null);
      }
    } catch (err) {
      setError((err as Error).message);
      setItems([]);
    } finally {
      setSearching(false);
    }
  };

  const doInstall = async (spec: string, file?: { name: string; data: string }) => {
    if (!bridge) {
      setMessage({ text: L.noDesktop, kind: "err" });
      return;
    }
    setInstalling(spec);
    setMessage(null);
    try {
      const r = await bridge.installPlugin(
        file ? { fileName: file.name, fileBase64: file.data } : { spec },
      );
      if (r.ok && r.name) {
        setMessage({ text: `${L.installed} ${r.name} · ${L.installedTip}`, kind: "ok" });
        // 服务重启后页面会重载；标记安装过的项
      } else {
        setMessage({ text: L.errInstall + (r.error || ""), kind: "err" });
      }
    } catch (err) {
      setMessage({ text: L.errInstall + (err as Error).message, kind: "err" });
    } finally {
      setInstalling(null);
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    void handleFile(f);
  };

  return (
    <div className="pm-wrap">
      {installedList.length > 0 && (
        <div className="pm-list">
          <button className="pm-installed-head" onClick={() => setShowInstalled(!showInstalled)} aria-expanded={showInstalled}>
            <span className="pm-installed-title">{L.installedSection}<span className="pm-installed-count">{installedList.length}</span></span>
            <span className="pm-installed-desc">{L.installedSectionDesc}</span>
            <span className="pm-installed-chev">{showInstalled ? "▾" : "▸"}</span>
          </button>
          {showInstalled && installedList.map((it) => (
            <div className="pm-card" key={it.name} style={{ opacity: it.disabled ? 0.55 : 1 }}>
              <div className="pm-card-main">
                <div className="pm-card-name">
                  {it.name}
                  {it.version && <span className="pm-card-ver">v{it.version}</span>}
                  {it.disabled && <span className="pm-card-ver" style={{ color: "#fbbf24" }}>{L.disabledTag}</span>}
                </div>
                {it.description && <div className="pm-card-desc">{it.description}</div>}
              </div>
              <button
                className="pm-btn ghost"
                disabled={managing === it.name}
                onClick={() => void doManage(it.disabled ? "enable" : "disable", it.name)}
              >
                {managing === it.name ? L.managing : it.disabled ? L.enable : L.disable}
              </button>
              {confirmUninstall === it.name ? (
                <button className="pm-btn" style={{ background: "#dc2626", borderColor: "#dc2626" }} onClick={() => void doManage("uninstall", it.name)}>
                  {L.uninstallConfirm}
                </button>
              ) : (
                <button className="pm-btn ghost" disabled={managing === it.name} onClick={() => { setConfirmUninstall(it.name); setTimeout(() => setConfirmUninstall((c) => (c === it.name ? null : c)), 4000); }}>
                  {L.uninstall}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="pm-msg" style={{ fontSize: "11.5px", marginBottom: "-6px" }}>{L.safetyTip}</div>

      <div className="pm-search">
        <input
          className="pm-input"
          value={query}
          placeholder={L.searchPlaceholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void doSearch(query); }}
        />
        <button className="pm-btn" onClick={() => void doSearch(query)} disabled={searching || !query.trim()}>
          {searching ? L.searching : L.searchBtn}
        </button>
      </div>

      <div className="pm-search">
        <input
          className="pm-input"
          value={nameSpec}
          placeholder={L.namePlaceholder}
          onChange={(e) => setNameSpec(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void doInstall(nameSpec); }}
        />
        <button className="pm-btn ghost" onClick={() => void doInstall(nameSpec)} disabled={!nameSpec.trim() || installing === nameSpec}>
          {installing === nameSpec ? L.installing : L.installByName}
        </button>
      </div>

      <div
        className={"pm-drop" + (dragOver ? " active" : "")}
        role="button"
        tabIndex={0}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => void onDrop(e)}
      >
        {dragOver ? L.dragActive : L.dragHint}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".tgz,.tar.gz"
        style={{ display: "none" }}
        onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ""; }}
      />

      {message && <div className={"pm-msg " + message.kind}>{message.text}</div>}
      {error && <div className="pm-msg err">{L.errFetch}{error}</div>}

      {items && items.length === 0 && !searching && !error && <div className="pm-msg">{L.empty}</div>}

      {items && items.length > 0 && (
        <div className="pm-list">
          {items.map((it) => (
            <div className="pm-card" key={it.name}>
              <div className="pm-card-main">
                <div className="pm-card-name">
                  {it.name}
                  <span className="pm-card-ver">v{it.version}</span>
                </div>
                <div className="pm-card-desc">{it.description || (it.author ? `by ${it.author}` : "")}</div>
                <div className="pm-card-links">
                  <span style={{ color: "var(--dsw-alias-label-secondary,#8f8f96)" }}>{L.source}</span>
                  {it.homepage && (
                    <a href={it.homepage} target="_blank" rel="noopener noreferrer">{L.openRepo}</a>
                  )}
                </div>
              </div>
              {installedNames.includes(it.name) ? (
                <button className="pm-btn ghost" disabled title={L.alreadyInstalled}>
                  {L.installed}
                </button>
              ) : (
                <button className="pm-btn ghost" onClick={() => void doInstall(it.name)} disabled={installing === it.name || !bridge}>
                  {installing === it.name ? L.installing : L.install}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 插件契约 ──
const inject = ["slots", "locale"];

function apply(ctx: any) {
  ctx.effect(() => ctx.locale.register(NS, DICT), "plugin-market: dictionaries");
  const t = ctx.locale.bind(NS);
  ctx.slots.inject("settings.plugins.tab", () =>
    ctx.slots.register(
      {
        name: "settings.plugins.tab",
        id: "plugin-market",
        order: 99,
        // tab 标题必须提供 label（宿主用 resolveSlotLabel(entry.options.label) 渲染）
        label: () => t("tabLabel"),
        locale: NS,
      },
      PluginMarketTab,
    ),
  );
}

export { apply, inject };
