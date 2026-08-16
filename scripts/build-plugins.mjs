/**
 * 构建并安装内置插件（lan-access / telegram-bridge）：
 * 1. esbuild 打包 browser half（src/client.tsx）→ CJS bundle
 *    （react / react-jsx-runtime / @deepseek-ai/* 保持 external，由前端
 *    ModuleLoader 的 require 提供；qrcode 等第三方依赖打进 bundle）。
 * 2. 包装成 window.__ModuleLoader__.load({ id, factory }) 格式 → lib/client.js
 * 3. 将插件包复制到 runtime 的 node_modules（服务端从此解析）。
 *
 * 用法: node scripts/build-plugins.mjs [plugin-name...]（缺省构建全部）
 *
 * 说明（双仓库结构）：本目录 plugins/<name> 保留插件源码，用于打包进安装包
 * （内置插件）；插件的“外部分发”走各自独立仓库 + npm 包，见：
 *   ../dsh-plugin-lan-access       → npm: dsh-plugin-lan-access（npx 安装）
 *   ../dsh-plugin-telegram-bridge  → npm: dsh-plugin-telegram-bridge（npx 安装）
 * 修改插件源码后，两边都要同步（本目录 + 独立仓库），并重跑本脚本。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, cpSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginsDir = join(root, "plugins");

// 定位 esbuild 平台二进制
const esbuildRel =
  process.platform === "win32"
    ? "@esbuild/win32-x64/esbuild.exe"
    : process.platform === "darwin"
      ? `@esbuild/darwin-${process.arch}/bin/esbuild`
      : `@esbuild/linux-${process.arch}/bin/esbuild`;
const esbuild = join(root, "node_modules", esbuildRel);
if (!existsSync(esbuild)) throw new Error(`找不到 esbuild 二进制: ${esbuild}`);

const requested = process.argv.slice(2);
const names = requested.length > 0
  ? requested
  : readdirSync(pluginsDir).filter((n) => existsSync(join(pluginsDir, n, "src", "client.tsx")));

for (const name of names) {
  const pluginDir = join(pluginsDir, name);
  if (!existsSync(join(pluginDir, "src", "client.tsx"))) {
    console.log(`跳过 ${name}（无 browser half 源码）`);
    continue;
  }
  const tmpBundle = join(pluginDir, ".tmp-client.cjs");
  const finalClient = join(pluginDir, "lib", "client.js");
  const runtimePkgDir = join(root, "runtime", "dsh", "node_modules", "@dsh-desktop", name);

  // 1. esbuild 打包
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

  // 2. 包装成 ModuleLoader 格式
  const bundle = readFileSync(tmpBundle, "utf8");
  const wrapped = `window.__ModuleLoader__.load({
\tid: "@dsh-desktop/${name}",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
${bundle.split("\n").map((l) => "\t" + l).join("\n")}
\t\treturn module.exports;
\t}
});
`;
  mkdirSync(join(pluginDir, "lib"), { recursive: true });
  writeFileSync(finalClient, wrapped, "utf8");
  rmSync(tmpBundle, { force: true });

  // 3. 安装到 runtime
  rmSync(runtimePkgDir, { recursive: true, force: true });
  mkdirSync(runtimePkgDir, { recursive: true });
  cpSync(join(pluginDir, "package.json"), join(runtimePkgDir, "package.json"));
  cpSync(join(pluginDir, "lib"), join(runtimePkgDir, "lib"), { recursive: true });

  console.log(`✔ 插件 ${name} 构建完成 (${(Buffer.byteLength(wrapped) / 1024).toFixed(1)}KB) -> ${runtimePkgDir}`);
}
