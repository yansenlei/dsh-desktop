/**
 * 构建脚本：直接调用 esbuild 原生二进制打包 main / preload / renderer 到 dist/。
 * （直接调用二进制、stdio inherit，避免 Node 管道捕获在受限环境下被拒。）
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, cpSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

// 定位 esbuild 平台二进制
function findEsbuild() {
  const platform = process.platform;
  const arch = process.arch;
  const pkgMap = {
    win32: { x64: "@esbuild/win32-x64/esbuild.exe", ia32: "@esbuild/win32-ia32/esbuild.exe", arm64: "@esbuild/win32-arm64/esbuild.exe" },
    darwin: { x64: "@esbuild/darwin-x64/bin/esbuild", arm64: "@esbuild/darwin-arm64/bin/esbuild" },
    linux: { x64: "@esbuild/linux-x64/bin/esbuild", arm64: "@esbuild/linux-arm64/bin/esbuild" },
  };
  const rel = pkgMap[platform]?.[arch];
  if (!rel) throw new Error(`不支持的平台: ${platform}/${arch}`);
  const p = join(root, "node_modules", rel);
  if (!existsSync(p)) throw new Error(`找不到 esbuild 二进制: ${p}`);
  return p;
}

const esbuild = findEsbuild();

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "main"), { recursive: true });
mkdirSync(join(dist, "preload"), { recursive: true });
mkdirSync(join(dist, "renderer"), { recursive: true });

function runEsbuild(args) {
  execFileSync(esbuild, args, { stdio: "inherit", cwd: root });
}

// 主进程（CJS，external electron）
runEsbuild([
  "src/main/index.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--outfile=dist/main/index.cjs",
  "--external:electron",
  "--target=es2022",
  "--log-level=info",
]);

// preload（CJS，external electron）
runEsbuild([
  "src/preload/index.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--outfile=dist/preload/index.cjs",
  "--external:electron",
  "--target=es2022",
  "--log-level=info",
]);

// renderer 页面（浏览器 IIFE）
runEsbuild([
  "src/renderer/boot.ts",
  "src/renderer/settings.ts",
  "--bundle",
  "--platform=browser",
  "--format=iife",
  "--outdir=dist/renderer",
  "--target=es2022",
  "--log-level=info",
]);

// 拷贝静态资源
for (const f of ["boot.html", "settings.html", "shared.css", "boot.css", "settings.css"]) {
  cpSync(join(root, "src/renderer", f), join(dist, "renderer", f));
}
// 启动页 logo（复用应用图标）
cpSync(join(root, "build", "icon.png"), join(dist, "renderer", "logo.png"));

console.log("✔ 构建完成 -> dist/");
