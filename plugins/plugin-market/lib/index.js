/**
 * plugin-market 插件 —— Node 端（服务端半部）。
 *
 * 职责：
 * - 注册 `/plugin-market/search`：通过 npm registry 搜索全网 DSH 插件
 *   （text=dsh-plugin <query>，npm 索引覆盖所有已发布包），返回统一数据格式。
 * - 注册 `/plugin-market/info`：按精确包名查询单个插件信息（安装前预览）。
 *
 * 安装动作由浏览器端调用桌面端桥（window.dshDesktop.installPlugin）完成：
 * 桌面端用内置 npm CLI 装到 profile 目录并重启服务。
 */
const name = "plugin-market";
const inject = ["webServer"];

import { readFileSync } from "node:fs";

const NPM_SEARCH = "https://registry.npmjs.org/-/v1/search";

/** 搜索 npm（统一数据格式）。 */
async function npmSearch(query, size = 50) {
  const res = await fetch(`${NPM_SEARCH}?text=${encodeURIComponent(query)}&size=${size}`, {
    headers: { "user-agent": "dsh-desktop-plugin-market" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`npm search HTTP ${res.status}`);
  const data = await res.json();
  const items = (data.objects || []).map((o) => {
    const p = o.package || {};
    const links = p.links || {};
    return {
      name: p.name,
      version: p.version,
      description: p.description || "",
      author: (p.author && p.author.name) || (p.maintainers && p.maintainers[0] && p.maintainers[0].name) || "",
      homepage: links.homepage || links.repository || links.npm || "",
      repository: links.repository || "",
      source: "npm",
      score: o.score && o.score.final != null ? Math.round(o.score.final * 100) : null,
    };
  });
  return items;
}

/**
 * 搜索结果精炼：
 * - 准确性：仅保留包名含 "dsh" 的社区插件，剔除核心生态包（@deepseek-ai/*）与引擎本体 dsh
 * - 安全性：必须有实质描述 + 来源链接（homepage/repository），否则排除
 * - 流行度：dsh-plugin-* > @dsh-desktop/* > 其它 dsh 包；同档按 npm 评分降序
 */
function refine(items) {
  // 准确性：包名必须含 dsh，剔除核心生态包（@deepseek-ai/*）与引擎本体 dsh
  const filtered = items.filter((i) => {
    const dshNamed = /dsh/i.test(i.name);
    const core = i.name === "dsh" || i.name.startsWith("@deepseek-ai/");
    const credible = (i.description || "").trim().length > 10;
    return dshNamed && !core && credible;
  });
  // 排序：名称档（dsh-plugin-* > @dsh-desktop/* > 其它 dsh）> 安全性（有来源链接优先）> 流行度（评分降序）
  const nameRank = (n) => (/^dsh-plugin-/i.test(n) ? 0 : /^@dsh-desktop\//i.test(n) ? 1 : 2);
  const sortKey = (i) => nameRank(i.name) * 10 + (i.homepage || i.repository ? 0 : 1);
  filtered.sort((a, b) => sortKey(a) - sortKey(b) || (b.score ?? 0) - (a.score ?? 0));
  return filtered;
}

/** 已安装插件列表：读 profile 的 package.json dependencies。 */
function installedPlugins() {
  try {
    const home = process.env.DSH_HOME;
    if (!home) return [];
    const pkg = JSON.parse(readFileSync(`${home}/profiles/web/package.json`, "utf8"));
    return Object.keys(pkg.dependencies || {});
  } catch {
    return [];
  }
}

function respond(res, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(200, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function queryOf(req) {
  try {
    return new URL(req.url || "/", "http://localhost");
  } catch {
    return new URL("/", "http://localhost");
  }
}

function apply(ctx) {
  // 搜索：text = "dsh-plugin <关键词>"，覆盖全网已发布的 dsh 插件
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: "/plugin-market/search",
        handler: async (req, res) => {
          const q = (queryOf(req).searchParams.get("q") || "").trim();
          if (!q) {
            respond(res, { ok: false, error: "empty-query" });
            return;
          }
          try {
            // 双查询并集提升召回；只返回与关键词相关的 DSH 插件
            const [a, b] = await Promise.all([npmSearch(`dsh-plugin ${q}`), npmSearch(q)]);
            const byName = new Map();
            for (const it of [...a, ...b]) byName.set(it.name, it);
            const items = refine([...byName.values()]);
            respond(res, { ok: true, items, installed: installedPlugins() });
          } catch (err) {
            respond(res, { ok: false, error: err.message });
          }
        },
      }),
    "plugin-market: /plugin-market/search",
  );

  // 已安装插件列表（名称/版本/描述/禁用状态）
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: "/plugin-market/installed",
        handler: async (req, res) => {
          try {
            const home = process.env.DSH_HOME;
            const profileDir = home ? `${home}/profiles/web` : "";
            const deps = installedPlugins();
            let disabledSet = new Set();
            try {
              const list = JSON.parse(readFileSync(`${home}/plugin-market.json`, "utf8"));
              for (const p of list.plugins ?? []) {
                if (typeof p === "object" && p && p.disabled) disabledSet.add(p.name);
              }
            } catch {
              /* 忽略 */
            }
            const items = deps.map((name) => {
              let version = "";
              let description = "";
              try {
                const pkg = JSON.parse(readFileSync(`${profileDir}/node_modules/${name}/package.json`, "utf8"));
                version = pkg.version || "";
                description = pkg.description || "";
              } catch {
                /* 元数据缺失 */
              }
              return { name, version, description, disabled: disabledSet.has(name) };
            });
            respond(res, { ok: true, items });
          } catch (err) {
            respond(res, { ok: false, error: err.message });
          }
        },
      }),
    "plugin-market: /plugin-market/installed",
  );

  // 精确包名查询（安装前预览）
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: "/plugin-market/info",
        handler: async (req, res) => {
          const name = (queryOf(req).searchParams.get("name") || "").trim();
          if (!name) {
            respond(res, { ok: false, error: "empty-name" });
            return;
          }
          try {
            const items = await npmSearch(`exact:${name}`);
            respond(res, { ok: true, items: items.filter((i) => i.name === name).slice(0, 1) });
          } catch (err) {
            respond(res, { ok: false, error: err.message });
          }
        },
      }),
    "plugin-market: /plugin-market/info",
  );
}

export { apply, inject, name };
