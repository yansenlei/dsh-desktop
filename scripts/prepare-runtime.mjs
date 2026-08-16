/**
 * 准备 DSH 运行时：确保 runtime/node_modules 已安装，裁剪跨平台冗余，
 * 并写入版本标记。
 */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = join(root, "runtime");
// 运行时根：node_modules 嵌套在 dsh/ 下（electron-builder 会排除源根部的 node_modules）
const bundleDir = join(runtimeDir, "dsh");
const markerPath = join(bundleDir, ".dsh-runtime.json");
const pkgPath = join(bundleDir, "package.json");
const lockPath = join(bundleDir, "package-lock.json");

const cacheDir = process.env.DSH_NPM_CACHE ?? join(root, "..", ".npm-cache");

if (!existsSync(join(bundleDir, "node_modules", "@deepseek-ai", "dsh", "package.json"))) {
  console.log("安装 DSH 运行时依赖到 runtime/dsh/ …");
  const args = ["install", "--no-audit", "--no-fund", "--omit=dev", "--ignore-scripts"];
  if (existsSync(cacheDir)) args.push("--cache", cacheDir);
  // Windows 上 npm 是 .cmd 包装：execFileSync 直接执行会 ENOENT/EINVAL，
  // 必须走 shell（spawnSync + shell:true）才能在 Windows CI runner 上工作。
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync(npmCmd, args, {
    cwd: bundleDir,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  if (r.status !== 0) {
    throw new Error(`npm install 失败 (code=${r.status})`);
  }
} else {
  console.log("DSH 运行时已存在，跳过安装");
}

// ── 裁剪：只保留当前构建平台的预编译产物 ───────────────────────────
// node-pty / sharp 等带平台 prebuild 的包，只留本平台的（win 留 win32-x64，
// mac 留 darwin-x64/arm64），其余删除以缩小安装包。
const platform = process.platform;
const keepPty = platform === "darwin" ? ["darwin-x64", "darwin-arm64"] : ["win32-x64"];
const ptyPrebuildsDir = join(bundleDir, "node_modules", "node-pty", "prebuilds");
if (existsSync(ptyPrebuildsDir)) {
  try {
    for (const name of readdirSync(ptyPrebuildsDir)) {
      if (!keepPty.includes(name)) {
        rmSync(join(ptyPrebuildsDir, name), { recursive: true, force: true });
        console.log(`裁剪: runtime/dsh/node_modules/node-pty/prebuilds/${name}`);
      }
    }
  } catch {
    /* 忽略 */
  }
}
// sharp：删除 wasm 回退（本平台原生构建已足够）
const sharpWasm = join(bundleDir, "node_modules", "@img", "sharp-wasm32");
if (existsSync(sharpWasm)) {
  rmSync(sharpWasm, { recursive: true, force: true });
  console.log("裁剪: runtime/dsh/node_modules/@img/sharp-wasm32");
}

// 写入标记
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const dshPkgPath = join(bundleDir, "node_modules", "@deepseek-ai", "dsh", "package.json");
const dshPkg = JSON.parse(readFileSync(dshPkgPath, "utf8"));
const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : null;

writeFileSync(
  markerPath,
  JSON.stringify(
    {
      name: pkg.name,
      dshVersion: dshPkg.version,
      preparedAt: new Date().toISOString(),
      lockfileVersion: lock?.lockfileVersion ?? null,
    },
    null,
    2,
  ),
  "utf8",
);
console.log(`✔ DSH 运行时就绪: @deepseek-ai/dsh@${dshPkg.version}`);
