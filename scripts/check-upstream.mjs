/**
 * 检查 DSH 上游版本：对比 runtime 打包的 @deepseek-ai/dsh 与 npm 最新版。
 *
 * 用法:
 *   node scripts/check-upstream.mjs            # 只报告
 *   node scripts/check-upstream.mjs --json     # JSON 输出（供脚本/CI 消费）
 *
 * 退出码: 0 = 已是最新; 1 = 有更新可跟进; 2 = 检查失败（网络/读取）
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const markerPath = join(root, "runtime", "dsh", ".dsh-runtime.json");
const jsonOut = process.argv.includes("--json");

function fail(msg, code = 2) {
  if (jsonOut) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
  else console.error(`✘ ${msg}`);
  process.exit(code);
}

// 1. 读取 runtime 当前版本
let current = null;
try {
  const marker = JSON.parse(readFileSync(markerPath, "utf8"));
  current = marker.dshVersion;
} catch {
  fail(`无法读取 runtime 版本标记: ${markerPath}（先运行 npm run prepare:runtime）`);
}
if (!current) fail("runtime 版本标记为空");

// 2. 直接请求 npm registry（不 spawn 子进程，兼容受限环境）
//    对比版本只需 dist-tags.latest + versions 列表；packument 较大但一次
//    请求即可拿到两者。
let latest = null;
let versions = [];
try {
  const res = await fetch("https://registry.npmjs.org/@deepseek-ai/dsh", {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`registry HTTP ${res.status}`);
  const doc = await res.json();
  latest = doc?.["dist-tags"]?.latest ?? null;
  versions = Object.keys(doc?.versions ?? {});
} catch (err) {
  fail(`查询 npm registry 失败: ${String(err).split("\n")[0]}`);
}
if (!latest) fail("npm 未返回 latest 版本");

// 3. 比较
const currentIsPublished = versions.includes(current);
const upToDate = latest === current;
const result = {
  ok: true,
  upToDate,
  current,
  latest,
  currentIsPublished,
  updateAvailable: !upToDate,
  versions,
};

if (jsonOut) {
  console.log(JSON.stringify(result, null, 2));
} else if (upToDate) {
  console.log(`✔ runtime 已是最新: @deepseek-ai/dsh@${current}（npm latest 相同）`);
} else {
  console.log(`↑ 有更新可跟进: runtime @deepseek-ai/dsh@${current} → npm latest ${latest}`);
  if (!currentIsPublished) console.log(`  注意: 当前版本 ${current} 不在 npm 已发布列表中，可能已被 yank 或为本地构建`);
}
process.exit(upToDate ? 0 : 1);
