/**
 * GitHub 发布脚本：创建仓库、推送代码、发布 Release（附安装包）。
 *
 * 用法：
 *   $env:GITHUB_TOKEN = "ghp_xxx"      # 或直接传入参数
 *   node scripts/publish-github.mjs [token]
 *
 * 发布对象：
 *   - dsh-desktop                主程序仓库（含 Release + 安装包上传）
 *   - dsh-plugin-lan-access      插件①：局域网二维码（独立仓库 + npm 包）
 *   - dsh-plugin-telegram-bridge 插件②：Telegram 桥接（独立仓库 + npm 包）
 *
 * 插件均为独立仓库 + 独立 npm 包（npx 可单独安装）：
 *   npm publish -C ../dsh-plugin-lan-access
 *   npm publish -C ../dsh-plugin-telegram-bridge
 * 本脚本负责 GitHub 侧的仓库/Release；npm 侧需先手动 publish（见插件仓库 README）。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OWNER = "yansenlei";
const VERSION = "0.2.3";
const PLUGIN_VERSION = "0.1.0"; // 与两个插件 npm 包当前版本保持一致

const token = process.argv[2] || process.env.GITHUB_TOKEN;
if (!token) {
  console.error("✘ 请提供 GITHUB_TOKEN（参数或环境变量）");
  process.exit(1);
}

const API = "https://api.github.com";
const auth = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "user-agent": "dsh-desktop-publish" };

async function api(path, method = "GET", body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...auth, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
  if (!res.ok && res.status !== 404 && res.status !== 422) {
    throw new Error(`GitHub API ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return { status: res.status, json };
}

async function ensureRepo(name, description) {
  const { status } = await api(`/repos/${OWNER}/${name}`);
  if (status === 200) {
    console.log(`✔ 仓库已存在: ${OWNER}/${name}`);
    return;
  }
  const r = await api("/user/repos", "POST", {
    name,
    description,
    private: false,
    has_issues: true,
    has_wiki: false,
  });
  if (r.status !== 201 && r.status !== 422) throw new Error(`创建仓库失败: ${r.status}`);
  console.log(`✔ 仓库已创建: ${OWNER}/${name}`);
}

function pushRepo(repoDir, repoName) {
  console.log(`推送 ${repoName} …`);
  execFileSync("git", ["branch", "-M", "main"], { cwd: repoDir, stdio: "inherit" });
  // 一次性 remote URL（带 token），push 后移除，避免 token 留在 git config
  const remoteUrl = `https://x-access-token:${token}@github.com/${OWNER}/${repoName}.git`;
  try {
    execFileSync("git", ["remote", "remove", "origin"], { cwd: repoDir, stdio: "ignore" });
  } catch {
    /* 本地没有 origin，忽略 */
  }
  execFileSync("git", ["remote", "add", "origin", remoteUrl], { cwd: repoDir, stdio: "inherit" });
  try {
    execFileSync("git", ["push", "-u", "origin", "main"], { cwd: repoDir, stdio: "inherit" });
  } finally {
    try {
      execFileSync("git", ["remote", "remove", "origin"], { cwd: repoDir, stdio: "ignore" });
    } catch {
      /* 忽略 */
    }
  }
  console.log(`✔ ${repoName} 已推送`);
}

async function releaseAndUpload(repoName, tag, name, assets) {
  // 检查/创建 release
  let r = await api(`/repos/${OWNER}/${repoName}/releases/tags/${tag}`);
  if (r.status === 404) {
    r = await api(`/repos/${OWNER}/${repoName}/releases`, "POST", {
      tag_name: tag,
      name,
      body: `DeepSeek Harness Desktop v${tag}\n\n安装包见下方 Assets。\n\n**仓库**: https://github.com/${OWNER}/${repoName}`,
      draft: false,
      prerelease: false,
    });
  }
  const releaseId = r.json?.id;
  if (!releaseId) throw new Error(`获取 release id 失败: ${r.status}`);
  console.log(`✔ Release ${tag} 就绪 (id=${releaseId})`);

  for (const asset of assets) {
    if (!existsSync(asset.path)) {
      console.warn(`⚠ 跳过不存在的资产: ${asset.path}`);
      continue;
    }
    const data = readFileSync(asset.path);
    const upload = await fetch(
      `https://uploads.github.com/repos/${OWNER}/${repoName}/releases/${releaseId}/assets?name=${encodeURIComponent(asset.name)}`,
      { method: "POST", headers: { ...auth, "content-type": "application/octet-stream" }, body: data },
    );
    if (!upload.ok) {
      const t = await upload.text();
      console.error(`⚠ 上传失败 ${asset.name}: ${upload.status} ${t.slice(0, 200)}`);
    } else {
      console.log(`✔ 已上传 ${asset.name}`);
    }
  }
}

// ── 主程序仓库 ──────────────────────────────────────────────────────
console.log("=== dsh-desktop ===");
await ensureRepo("dsh-desktop", "DeepSeek Harness Desktop —— 一键安装、开箱即用的本地 AI 助手工作台（Windows/macOS）");
pushRepo(root, "dsh-desktop");
const installer = join(root, "release", `DeepSeek-Harness-Desktop-Setup-${VERSION}.exe`);
await releaseAndUpload("dsh-desktop", `v${VERSION}`, `DeepSeek Harness Desktop v${VERSION}`, [
  { name: `DeepSeek-Harness-Desktop-Setup-${VERSION}.exe`, path: installer },
]);

// ── 插件仓库（两个独立仓库，各自含 Release）──────────────────────────
const plugins = [
  {
    dir: join(root, "..", "dsh-plugin-lan-access"),
    repo: "dsh-plugin-lan-access",
    desc: "DeepSeek Harness 局域网二维码插件（手机扫码访问）—— 独立 npm 包，npx dsh-plugin-lan-access 可单独安装",
  },
  {
    dir: join(root, "..", "dsh-plugin-telegram-bridge"),
    repo: "dsh-plugin-telegram-bridge",
    desc: "DeepSeek Harness Telegram 桥接插件（随时随地对话控制电脑）—— 独立 npm 包，npx dsh-plugin-telegram-bridge 可单独安装",
  },
];
for (const p of plugins) {
  console.log(`=== ${p.repo} ===`);
  await ensureRepo(p.repo, p.desc);
  if (existsSync(join(p.dir, ".git"))) {
    pushRepo(p.dir, p.repo);
  } else {
    console.warn(`⚠ ${p.repo} 本地目录未初始化 git，跳过推送（可在其目录 git init 后重试）`);
  }
  await releaseAndUpload(p.repo, `v${PLUGIN_VERSION}`, `${p.repo} v${PLUGIN_VERSION}`, []);
}

console.log("\n✔ 全部完成！");
