/**
 * electron-builder afterPack 钩子：用 codesign 直接做 ad-hoc 签名。
 *
 * 背景：electron-builder 内置的 @electron/osx-sign 在签名数万文件的
 * dsh-runtime 时会并发打开文件（walkAsync + isBinaryFile 无并发上限），
 * 触发 EMFILE: too many open files（上游修复 electron/osx-sign#286 尚未合并）。
 * codesign 自身为串行签名，稳定可靠；因此 mac 构建关闭 electron-builder
 * 签名（build.mac.identity = null），改在 afterPack 阶段（打包完成、dmg/zip
 * 产出之前）用 codesign 签名，dmg/zip 打包的自然就是已签名的 .app。
 */
const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!existsSync(appPath)) {
    console.error(`after-pack-sign: 未找到应用包: ${appPath}`);
    process.exit(1);
  }
  console.log(`after-pack-sign: codesign --force --deep --sign - → ${appPath}`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  console.log("after-pack-sign: ✔ ad-hoc 签名完成");
};
