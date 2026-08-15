/**
 * Smoke 测试：以 DSHDESKTOP_SMOKE=1 启动 Electron 主进程，
 * 验证 DSH 服务能启动、健康检查通过、壳 UI 资源存在，然后打印结果退出。
 *
 * 为避免受限环境下的管道捕获限制，Electron 以 stdio inherit 启动，
 * 结果通过 SMOKE_OUT 指向的 JSON 文件返回。
 *
 * 用法: node scripts/smoke.mjs [--timeout 180]
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, openSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Electron 可执行路径：Windows 为 dist/electron.exe；macOS 为 .app 内可执行文件
const electronExe =
  process.platform === "darwin"
    ? join(root, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron")
    : join(root, "node_modules", "electron", "dist", "electron.exe");

if (!existsSync(electronExe)) {
  console.error("✘ 未找到 electron 可执行文件，请先执行 npm install");
  process.exit(1);
}

const timeoutArg = process.argv.find((a) => a.startsWith("--timeout="));
const timeoutSec = timeoutArg ? Number(timeoutArg.split("=")[1]) : 180;
const resultFile = join(root, "smoke-result.json");
const userDataDir = join(root, ".smoke-userdata");
const outFile = join(root, "smoke-out.log");
const errFile = join(root, "smoke-err.log");
try {
  rmSync(resultFile, { force: true });
  rmSync(userDataDir, { recursive: true, force: true });
  rmSync(outFile, { force: true });
  rmSync(errFile, { force: true });
} catch {
  /* 忽略 */
}

console.log(`SMOKE: electron=${electronExe}`);
console.log(`SMOKE: timeout=${timeoutSec}s, result=${resultFile}`);

// stdout/stderr 用文件描述符（避免管道在受限环境下被拒/触发 Mojo 问题）
const fdOut = openSync(outFile, "w");
const fdErr = openSync(errFile, "w");

const child = spawn(electronExe, [".", "--no-sandbox", `--user-data-dir=${userDataDir}`], {
  cwd: root,
  env: {
    ...process.env,
    DSHDESKTOP_SMOKE: "1",
    DSHDESKTOP_SMOKE_TIMEOUT: String(timeoutSec * 1000),
    SMOKE_OUT: resultFile,
    SMOKE_TRACE: join(root, "smoke-trace.log"),
    ELECTRON_ENABLE_LOGGING: "1",
  },
  stdio: ["ignore", fdOut, fdErr],
});

// 轮询结果文件
const deadline = Date.now() + timeoutSec * 1000 + 15_000;
const timer = setInterval(() => {
  if (existsSync(resultFile)) {
    clearInterval(timer);
    try {
      const result = JSON.parse(readFileSync(resultFile, "utf8"));
      console.log("SMOKE_RESULT " + JSON.stringify(result, null, 2));
      console.log(result.ok === true ? "✔ SMOKE PASS" : "✘ SMOKE FAIL");
      process.exit(result.ok === true ? 0 : 1);
    } catch (err) {
      console.error("✘ 结果文件解析失败:", err.message);
      process.exit(1);
    }
  } else if (Date.now() > deadline) {
    clearInterval(timer);
    console.error("✘ smoke 超时，未生成结果文件");
    try {
      child.kill();
    } catch {
      /* 忽略 */
    }
    process.exit(2);
  }
}, 1000);

child.on("exit", (code) => {
  // Electron 提前退出（未写结果文件）也视为失败
  setTimeout(() => {
    if (!existsSync(resultFile)) {
      clearInterval(timer);
      console.error(`✘ Electron 提前退出 code=${code}，无结果文件`);
      process.exit(code ?? 1);
    }
  }, 500);
});
