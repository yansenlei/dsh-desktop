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
  // 补装 sharp / koffi 当前平台的预编译二进制。
  // 原因：runtime/dsh/package-lock.json 在 Windows 机器上生成，其中只有
  // win32-x64 的平台可选依赖有完整条目，darwin/linux 平台包仅出现在父包
  // 的 optionalDependencies 里；npm ci 严格按 lockfile 安装，不会为其他
  // 平台补装这些可选包，--ignore-scripts 又跳过了 koffi 的 install 脚本
  // （cnoke 预编译下载兜底），导致 mac 等平台缺 koffi.node，dsh web 启动
  // 即崩：Cannot find the native Koffi module。
  // 注意：所有平台包必须合并在【同一次】npm install 里补装——`--no-save`
  // 安装会重新对账依赖树，分多次执行时后一次会把前一次装上的平台包当作
  // extraneous 剪掉（实测 koffi 补装会把 sharp 平台包删掉）。koffi 版本
  // 必须与已装的 koffi 一致（wrapNative 校验版本，不一致会报 Mismatched
  // native Koffi modules）。
  const sharpPkg = {
    win32: process.arch === "arm64" ? "@img/sharp-win32-arm64" : "@img/sharp-win32-x64",
    darwin: process.arch === "arm64" ? "@img/sharp-darwin-arm64" : "@img/sharp-darwin-x64",
    linux: process.arch === "arm64" ? "@img/sharp-linux-arm64" : "@img/sharp-linux-x64",
  }[process.platform];

  const koffiPkgJsonPath = join(bundleDir, "node_modules", "koffi", "package.json");
  const koffiVer = existsSync(koffiPkgJsonPath)
    ? JSON.parse(readFileSync(koffiPkgJsonPath, "utf8")).version
    : null;
  const koffiPkg = koffiVer
    ? {
        win32: process.arch === "arm64" ? "@koromix/koffi-win32-arm64" : "@koromix/koffi-win32-x64",
        darwin: process.arch === "arm64" ? "@koromix/koffi-darwin-arm64" : "@koromix/koffi-darwin-x64",
        linux: {
          arm64: "@koromix/koffi-linux-arm64",
          x64: "@koromix/koffi-linux-x64",
          riscv64: "@koromix/koffi-linux-riscv64",
          loong64: "@koromix/koffi-linux-loong64",
        }[process.arch],
      }[process.platform]
    : null;
  if (koffiVer && !koffiPkg) {
    console.warn(`⚠ 无 koffi 平台包匹配 ${process.platform}/${process.arch}，跳过补装`);
  } else if (!koffiVer) {
    console.warn("⚠ 未找到 koffi 包，跳过平台二进制补装");
  }

  // 需要补装的包：[包名, 版本(可为空), 缺失是否致命]
  const needPkgs = [];
  if (sharpPkg && !existsSync(join(bundleDir, "node_modules", sharpPkg))) {
    needPkgs.push({ spec: sharpPkg, fatal: false });
  } else if (sharpPkg) {
    console.log(`✔ sharp 平台二进制已存在: ${sharpPkg}`);
  }
  if (koffiPkg && !existsSync(join(bundleDir, "node_modules", koffiPkg))) {
    needPkgs.push({ spec: `${koffiPkg}@${koffiVer}`, fatal: true });
  } else if (koffiPkg) {
    console.log(`✔ koffi 平台二进制已存在: ${koffiPkg}`);
  }

  if (needPkgs.length > 0) {
    const r = spawnSync(
      npmCmd,
      ["install", "--no-save", "--no-audit", "--no-fund", "--ignore-scripts", ...needPkgs.map((p) => p.spec), "--cache", cacheDir],
      {
        cwd: bundleDir,
        stdio: "inherit",
        shell: process.platform === "win32",
        env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
      },
    );
    for (const p of needPkgs) {
      // spec 形如 "@koromix/koffi-darwin-arm64@3.1.5"（或 "@img/sharp-darwin-arm64"）：
      // 仅剥掉末尾的 @版本 部分，保留作用域包名。
      const atIdx = p.spec.lastIndexOf("@");
      const name = atIdx > 0 ? p.spec.slice(0, atIdx) : p.spec;
      const ok = r.status === 0 && existsSync(join(bundleDir, "node_modules", name));
      if (ok) {
        console.log(`✔ 平台二进制就绪: ${p.spec}`);
      } else if (p.fatal) {
        throw new Error(`平台包 ${p.spec} 安装失败 (code=${r.status})，dsh web 将无法启动`);
      } else {
        console.warn(`⚠ 平台包 ${p.spec} 安装失败 (code=${r.status})（make-icon / 附件缩略图可能不可用），继续`);
      }
    }
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

// ── 内置 npm CLI：支持应用内「Harness 引擎独立更新」 ──────────────────
// 桌面应用打包后不含 npm；引擎更新（npm install @deepseek-ai/dsh@latest）
// 需要真正的依赖解析器。这里把 npm CLI 及其纯 JS 依赖装到
// runtime/dsh/npm-cli/ 下，运行时用 ELECTRON_RUN_AS_NODE 直接执行。
const npmCliDir = join(bundleDir, "npm-cli");
if (!existsSync(join(npmCliDir, "node_modules", "npm", "bin", "npm-cli.js"))) {
  console.log("内置 npm CLI 到 runtime/dsh/npm-cli/ …");
  const n = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--prefix", npmCliDir, "--no-audit", "--no-fund", "--ignore-scripts", "--loglevel=error", "npm@11", "--cache", cacheDir], {
    cwd: bundleDir,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  if (n.status !== 0) {
    throw new Error(`内置 npm CLI 安装失败 (code=${n.status})，引擎独立更新将不可用`);
  }
  console.log("✔ npm CLI 就绪: runtime/dsh/npm-cli");
} else {
  console.log("npm CLI 已存在，跳过");
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
