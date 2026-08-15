/**
 * 构建并安装 lan-access 插件：
 * 1. esbuild 打包 browser half（src/client.tsx）→ CJS bundle
 *    （react / react-jsx-runtime / @deepseek-ai/* 保持 external，由前端
 *    ModuleLoader 的 require 提供；qrcode 等第三方依赖打进 bundle）。
 * 2. 包装成 window.__ModuleLoader__.load({ id, factory }) 格式 → lib/client.js
 * 3. 将整个插件包复制到 runtime 的 node_modules（服务端从此解析）。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, copyFileSync, cpSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = join(root, "plugins", "lan-access");
const tmpBundle = join(pluginDir, ".tmp-client.cjs");
const finalClient = join(pluginDir, "lib", "client.js");
const runtimePkgDir = join(root, "runtime", "dsh", "node_modules", "@dsh-desktop", "lan-access");

// 定位 esbuild 平台二进制
const esbuildRel =
  process.platform === "win32"
    ? "@esbuild/win32-x64/esbuild.exe"
    : process.platform === "darwin"
      ? `@esbuild/darwin-${process.arch}/bin/esbuild`
      : `@esbuild/linux-${process.arch}/bin/esbuild`;
const esbuild = join(root, "node_modules", esbuildRel);
if (!existsSync(esbuild)) throw new Error(`找不到 esbuild 二进制: ${esbuild}`);

// ── 1. esbuild 打包（直接调用二进制，避开 JS API 的管道限制） ──────
execFileSync(
  esbuild,
  [
    join(pluginDir, "src", "client.tsx"),
    "--bundle",
    "--platform=browser",
    "--format=cjs",
    "--target=es2020",
    "--jsx=automatic",
    "--external:react",
    "--external:react/jsx-runtime",
    "--external:react-dom",
    "--external:@deepseek-ai/*",
    "--log-level=info",
    `--outfile=${tmpBundle}`,
  ],
  { stdio: "inherit" },
);

// ── 2. 包装成 ModuleLoader 格式 ─────────────────────────────────────
const bundle = readFileSync(tmpBundle, "utf8");
const wrapped = `window.__ModuleLoader__.load({
	id: "@dsh-desktop/lan-access",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
${bundle
  .split("\n")
  .map((l) => "\t" + l)
  .join("\n")}
		return module.exports;
	}
});
`;
mkdirSync(join(pluginDir, "lib"), { recursive: true });
writeFileSync(finalClient, wrapped, "utf8");
rmSync(tmpBundle, { force: true });
console.log(`✔ browser half 打包完成 -> ${finalClient} (${finalClient.length > 0 ? `${(Buffer.byteLength(wrapped) / 1024).toFixed(1)}KB` : ""})`);

// ── 3. 安装到 runtime ───────────────────────────────────────────────
rmSync(runtimePkgDir, { recursive: true, force: true });
mkdirSync(runtimePkgDir, { recursive: true });
cpSync(join(pluginDir, "package.json"), join(runtimePkgDir, "package.json"));
cpSync(join(pluginDir, "lib"), join(runtimePkgDir, "lib"), { recursive: true });
console.log(`✔ 插件已安装到 runtime -> ${runtimePkgDir}`);

// 输出大小信息
const size = (Buffer.byteLength(wrapped) / 1024).toFixed(1);
console.log(`  client.js 体积: ${size}KB`);
