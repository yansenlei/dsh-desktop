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
  // 用 npm ci：严格按已入库的 package-lock.json 安装，保证 CI 与本地
  // 依赖树完全一致（js-yaml 等 hoist 位置不漂移）。
  // --ignore-scripts 必须保留：koffi 等包在 mac arm64 上源码编译会失败
  // （prebuilt 缺失时触发编译，linker 缺符号）。sharp 的平台二进制随后
  // 用单独命令补装（见下）。
  const args = ["ci", "--no-audit", "--no-fund", "--omit=dev", "--ignore-scripts"];
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
    throw new Error(`npm ci 失败 (code=${r.status})`);
  }
  // 补装 sharp 当前平台的预编译二进制（ignore-scripts 跳过了它；
  // 不补则 make-icon 在 mac 上报 "Could not load the sharp module"）。
  const sharpRebuild = spawnSync(npmCmd, ["rebuild", "sharp", "--ignore-scripts=false"], {
    cwd: bundleDir,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  if (sharpRebuild.status !== 0) {
    console.warn("⚠ sharp rebuild 未完成（make-icon 可能不可用），继续");
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
