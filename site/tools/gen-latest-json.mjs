#!/usr/bin/env node
/**
 * 从 GitHub Releases/latest 生成 site/latest.json —— 下载页自动获取版本信息的源头。
 *
 * 无第三方依赖，Node 18+。CI（打 v* tag 时）与本地均可运行：
 *   node tools/gen-latest-json.mjs
 * 环境变量（可选）：
 *   GITHUB_TOKEN —— CI 自带；本地无 token 受 60 次/小时 API 限额，失败属正常
 *   LATEST_JSON   —— 输出路径，默认 <脚本目录>/../latest.json
 *
 * 合并策略：新 Release 中缺某平台（如 Intel 停发时没有 x64）则沿用旧值；
 * 各平台版本号取该平台资产文件名中的版本（Intel 可能长期停留在旧版）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = process.env.DSH_REPO || 'yansenlei/dsh-desktop';
const OUT = process.env.LATEST_JSON || join(dirname(fileURLToPath(import.meta.url)), '..', 'latest.json');
const API = process.env.DSH_API || `https://api.github.com/repos/${REPO}/releases/latest`;

const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-desktop-latest-json' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

function mb(bytes) {
  const v = bytes / 1024 / 1024;
  return (v >= 100 ? Math.round(v) : v.toFixed(1)) + ' MB';
}

const res = await fetch(API, { headers });
if (!res.ok) {
  console.error(`GitHub API 失败：HTTP ${res.status}`);
  if (res.status === 403) console.error('提示：本地运行需设置 GITHUB_TOKEN（CI 中自动可用）。');
  process.exit(1);
}
const rel = await res.json();
const tag = rel.tag_name.replace(/^v/, '');

/* 旧的 latest.json（存在则合并） */
let prev = { latest: '', windows: {}, macApple: {}, macIntel: {} };
try { prev = JSON.parse(readFileSync(OUT, 'utf8')); } catch (e) {}

const out = {
  latest: tag,
  publishedAt: new Date(rel.published_at || Date.now()).toISOString().slice(0, 10),
  windows: { ...(prev.windows || {}) },
  macApple: { ...(prev.macApple || {}) },
  macIntel: { ...(prev.macIntel || {}) },
};

for (const a of rel.assets || []) {
  const name = a.name || '';
  const size = mb(a.size || 0);
  if (/Setup-[\d.]+\.exe$/.test(name)) {
    out.windows = { ver: tag, exe: name, size };
  } else if (/-[\d.]+-arm64\.dmg$/.test(name)) {
    out.macApple.ver = tag; out.macApple.dmg = name; out.macApple.dmgSize = size;
  } else if (/-[\d.]+-arm64\.zip$/.test(name)) {
    out.macApple.ver = tag; out.macApple.zip = name; out.macApple.zipSize = size;
  } else if (/-[\d.]+-x64\.dmg$/.test(name)) {
    out.macIntel.ver = tag; out.macIntel.dmg = name; out.macIntel.dmgSize = size;
    out.macIntel.note = '';
  } else if (/-[\d.]+-x64\.zip$/.test(name)) {
    out.macIntel.ver = tag; out.macIntel.zip = name; out.macIntel.zipSize = size;
    out.macIntel.note = '';
  }
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`✔ 已生成 ${OUT}`);
console.log(`  latest=v${out.latest}`);
console.log(`  windows: ${out.windows.ver} · ${out.windows.exe} (${out.windows.size})`);
console.log(`  macApple: ${out.macApple.ver} · ${out.macApple.dmg} (${out.macApple.dmgSize})`);
console.log(`  macIntel: ${out.macIntel.ver} · ${out.macIntel.dmg} (${out.macIntel.dmgSize})`);
if (out.macIntel.ver && out.macIntel.ver !== tag) {
  console.log(`  ⚠ Intel 版停留 v${out.macIntel.ver}（本 Release 无 x64 资产，沿用旧值）`);
}
