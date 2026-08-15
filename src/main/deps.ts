/**
 * 运行环境检测与一键安装：
 * - Node.js：Electron 内置（始终可用），系统 Node 仅用于可选的 dsh 命令行工具。
 * - Python：DSH 代理运行 Python 脚本时需要；缺失时提供一键安装（winget 优先，
 *   回退 python.org 官方安装包）。
 * - dsh 命令行：可选，供高级用户在终端中使用。
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import type { EnvCheck, InstallKind, InstallProgress } from "../shared/types";
import { info, error as logError } from "./logger";

export type ProgressListener = (p: InstallProgress) => void;

const PYTHON_VERSION = "3.12.10";
const PYTHON_INSTALLER_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-amd64.exe`;

const listeners = new Set<ProgressListener>();

export function onInstallProgress(fn: ProgressListener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emitProgress(p: InstallProgress) {
  for (const fn of listeners) fn(p);
}

/** 运行一个命令并收集 stdout/stderr 行（带超时）。 */
function run(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
      // Windows 上 npm/dsh 等是 .cmd 批处理，spawn 无法直接执行，需 shell
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* 忽略 */
      }
    }, opts.timeoutMs ?? 30_000);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr || err.message });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function firstVersion(cmd: string, args: string[]): Promise<{ version: string; path?: string } | null> {
  const r = await run(cmd, args, { timeoutMs: 8_000 });
  const out = (r.stdout + r.stderr).trim();
  if (r.code === 0 && out) {
    return { version: out.split("\n")[0].trim(), path: cmd };
  }
  return null;
}

/** 在常见安装路径中查找 Python（Windows 安装目录 + macOS 框架/brew 路径）。 */
function findPythonByPath(): { version: string; path: string; source: string } | null {
  if (process.platform === "darwin") {
    // macOS：/Library/Frameworks/Python.framework、Homebrew 等
    const candidates: string[] = [];
    const framework = "/Library/Frameworks/Python.framework/Versions";
    if (existsSync(framework)) {
      try {
        for (const v of readdirSync(framework)) {
          const exe = join(framework, v, "bin", "python3");
          if (existsSync(exe)) return { version: `Python ${v}`, path: exe, source: exe };
        }
      } catch {
        /* 忽略 */
      }
    }
    for (const base of ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]) {
      const exe = join(base, "python3");
      if (existsSync(exe)) {
        candidates.push(exe);
        return { version: base.replace("/", ""), path: exe, source: exe };
      }
    }
    void candidates;
    return null;
  }
  const candidates: string[] = [];
  const local = process.env.LOCALAPPDATA;
  if (local) candidates.push(join(local, "Programs", "Python"));
  const programFiles = process.env.ProgramFiles;
  if (programFiles) candidates.push(join(programFiles, "Python"));
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  if (programFilesX86) candidates.push(join(programFilesX86, "Python"));
  const roots = [...new Set(candidates)];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let dirs: string[] = [];
    try {
      dirs = readdirSync(root);
    } catch {
      continue;
    }
    for (const d of dirs) {
      if (/^Python\d+$/.test(d)) {
        const exe = join(root, d, "python.exe");
        if (existsSync(exe)) {
          return { version: d.replace("Python", "Python "), path: exe, source: exe };
        }
      }
    }
  }
  return null;
}

export async function checkEnv(): Promise<EnvCheck> {
  info("开始环境检测");
  const bundledNode = { ok: true as const, version: process.versions.node };

  // 系统 node
  let systemNode: EnvCheck["systemNode"] = { ok: false };
  const nodeR = await firstVersion("node", ["--version"]);
  if (nodeR) systemNode = { ok: true, version: nodeR.version };

  // python：依次尝试 python / py -3 / python3 / 常见路径
  let python: EnvCheck["python"] = { ok: false };
  const attempts: Array<[string, string[]]> = [
    ["python", ["--version"]],
    ["py", ["-3", "--version"]],
    ["python3", ["--version"]],
  ];
  for (const [cmd, args] of attempts) {
    const r = await firstVersion(cmd, args);
    if (r) {
      python = { ok: true, version: r.version, path: r.path, source: cmd };
      break;
    }
  }
  if (!python.ok) {
    const found = findPythonByPath();
    if (found) python = { ok: true, version: found.version, path: found.path, source: found.source };
  }

  // dsh 命令行
  let dshCli: EnvCheck["dshCli"] = { ok: false };
  const dshR = await firstVersion("dsh", ["--version"]);
  if (dshR) dshCli = { ok: true, version: dshR.version };

  // winget
  let winget: EnvCheck["winget"] = { ok: false };
  const wR = await firstVersion("winget", ["--version"]);
  if (wR) winget = { ok: true, version: wR.version };

  const result: EnvCheck = { bundledNode, systemNode, python, dshCli, winget };
  info(
    `环境检测完成: systemNode=${systemNode.ok} python=${python.ok} dshCli=${dshCli.ok} winget=${winget.ok}`,
  );
  return result;
}

/** 流式执行安装命令并把输出转发给监听者。 */
function streamRun(
  kind: InstallKind,
  cmd: string,
  args: string[],
  opts: { stageLabels?: Partial<Record<string, string>> } = {},
): Promise<{ code: number | null }> {
  return new Promise((resolve) => {
    emitProgress({ kind, stage: "installing", percent: null, lines: [`$ ${cmd} ${args.join(" ")}`] });
    const child = spawn(cmd, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      // Windows 上 npm 是 .cmd 批处理，spawn 无法直接执行，需 shell
      shell: process.platform === "win32",
    });
    let out = "";
    const onData = (d: Buffer) => {
      out += d.toString("utf8");
      const lines = out.split("\n");
      out = lines.pop() ?? "";
      const clean = lines
        .map((l) => l.replace(/\r/g, "").trimEnd())
        .filter((l) => l.length > 0 && !l.includes("\x1b["));
      if (clean.length) {
        emitProgress({ kind, stage: "installing", percent: null, lines: clean });
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (err) => {
      emitProgress({ kind, stage: "error", percent: null, lines: [], error: err.message });
      resolve({ code: -1 });
    });
    child.on("exit", (code) => {
      emitProgress({ kind, stage: "finishing", percent: null, lines: [] });
      resolve({ code });
    });
  });
}

/** 安装 Python（Windows：winget 优先回退官方安装包；macOS：brew 优先，否则引导官网）。 */
export async function installPython(): Promise<boolean> {
  info("开始安装 Python");
  const env = await checkEnv();
  if (env.python.ok) {
    emitProgress({ kind: "python", stage: "done", percent: 100, lines: ["Python 已可用，无需安装"] });
    return true;
  }
  if (process.platform === "darwin") {
    return installPythonOnMac();
  }
  let ok = false;
  if (env.winget.ok) {
    emitProgress({ kind: "python", stage: "downloading", percent: null, lines: ["使用 winget 安装 Python…"] });
    const r = await streamRun("python", "winget", [
      "install",
      "-e",
      "--id",
      "Python.Python.3.12",
      "--silent",
      "--accept-package-agreements",
      "--accept-source-agreements",
      "--disable-interactivity",
    ]);
    ok = r.code === 0;
  }
  if (!ok) {
    // 回退：下载官方安装包并静默安装
    emitProgress({
      kind: "python",
      stage: "downloading",
      percent: null,
      lines: [`winget 不可用或失败，改用官方安装包: ${PYTHON_INSTALLER_URL}`],
    });
    const installerPath = join(process.env.TEMP ?? ".", `python-${PYTHON_VERSION}-amd64.exe`);
    try {
      const res = await fetch(PYTHON_INSTALLER_URL);
      if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`);
      const file = await BunLikeWrite(installerPath, res);
      emitProgress({ kind: "python", stage: "installing", percent: null, lines: [`已下载 ${file}`] });
      const r = await streamRun("python", installerPath, [
        "/quiet",
        "InstallAllUsers=0",
        "PrependPath=1",
        "Include_test=0",
        "Include_launcher=1",
      ]);
      ok = r.code === 0;
    } catch (err) {
      logError(`Python 安装失败: ${(err as Error).message}`);
      emitProgress({ kind: "python", stage: "error", percent: null, lines: [], error: (err as Error).message });
      return false;
    }
  }
  const after = await checkEnv();
  if (after.python.ok) {
    emitProgress({
      kind: "python",
      stage: "done",
      percent: 100,
      lines: [`Python 安装完成: ${after.python.version}`],
    });
    return true;
  }
  emitProgress({ kind: "python", stage: "error", percent: null, lines: [], error: "安装后未能检测到 Python" });
  return false;
}

/** macOS：优先 Homebrew 安装；无 brew 时引导用户打开 python.org 下载页。 */
async function installPythonOnMac(): Promise<boolean> {
  const { shell } = await import("electron");
  const brew = await firstVersion("brew", ["--version"]);
  if (brew) {
    emitProgress({ kind: "python", stage: "downloading", percent: null, lines: ["检测到 Homebrew，执行 brew install python …"] });
    const r = await streamRun("python", "brew", ["install", "python"]);
    if (r.code === 0) {
      const after = await checkEnv();
      if (after.python.ok) {
        emitProgress({ kind: "python", stage: "done", percent: 100, lines: [`Python 安装完成: ${after.python.version}`] });
        return true;
      }
    }
    emitProgress({ kind: "python", stage: "error", percent: null, lines: [], error: "brew install python 未能完成" });
  }
  emitProgress({
    kind: "python",
    stage: "error",
    percent: null,
    lines: [],
    error: "macOS 上需要管理员权限安装 Python，已打开官方下载页，请手动安装后重试",
  });
  shell.openExternal("https://www.python.org/downloads/macos/");
  return false;
}

/** 安装 dsh 命令行（可选）。若系统无 Node，先用 winget 安装 Node LTS。 */
export async function installCli(): Promise<boolean> {
  info("开始安装 dsh 命令行");
  const env = await checkEnv();
  if (env.dshCli.ok) {
    emitProgress({ kind: "dsh-cli", stage: "done", percent: 100, lines: ["dsh 命令行已可用"] });
    return true;
  }
  if (!env.systemNode.ok) {
    // 系统无 Node：Windows 用 winget，macOS 用 brew / 引导官网
    if (process.platform === "darwin") {
      const { shell } = await import("electron");
      const brew = await firstVersion("brew", ["--version"]);
      if (brew) {
        emitProgress({ kind: "node-cli", stage: "downloading", percent: null, lines: ["安装 Node.js（brew install node）…"] });
        const r = await streamRun("node-cli", "brew", ["install", "node"]);
        if (r.code !== 0) {
          emitProgress({ kind: "node-cli", stage: "error", percent: null, lines: [], error: "Node.js 安装失败" });
          return false;
        }
      } else {
        emitProgress({
          kind: "node-cli",
          stage: "error",
          percent: null,
          lines: [],
          error: "未找到 Node.js 且没有 Homebrew，已打开 nodejs.org 下载页，请手动安装后重试",
        });
        shell.openExternal("https://nodejs.org/");
        return false;
      }
    } else if (!env.winget.ok) {
      emitProgress({
        kind: "node-cli",
        stage: "error",
        percent: null,
        lines: [],
        error: "未找到 Node.js，且系统没有 winget，无法自动安装。请手动安装 Node.js LTS。",
      });
      return false;
    } else {
      emitProgress({ kind: "node-cli", stage: "downloading", percent: null, lines: ["安装 Node.js LTS（winget）…"] });
      const r = await streamRun("node-cli", "winget", [
        "install",
        "-e",
        "--id",
        "OpenJS.NodeJS.LTS",
        "--silent",
        "--accept-package-agreements",
        "--accept-source-agreements",
        "--disable-interactivity",
      ]);
      if (r.code !== 0) {
        emitProgress({ kind: "node-cli", stage: "error", percent: null, lines: [], error: "Node.js 安装失败" });
        return false;
      }
    }
  }
  emitProgress({ kind: "dsh-cli", stage: "installing", percent: null, lines: ["npm install -g @deepseek-ai/dsh …"] });
  const r = await streamRun("dsh-cli", "npm", ["install", "-g", "@deepseek-ai/dsh"]);
  if (r.code !== 0) {
    emitProgress({ kind: "dsh-cli", stage: "error", percent: null, lines: [], error: "dsh 安装失败" });
    return false;
  }
  const after = await checkEnv();
  if (after.dshCli.ok) {
    emitProgress({ kind: "dsh-cli", stage: "done", percent: 100, lines: [`dsh 安装完成: ${after.dshCli.version}`] });
    return true;
  }
  emitProgress({ kind: "dsh-cli", stage: "error", percent: null, lines: [], error: "安装后未检测到 dsh（可能需要重启终端）" });
  return false;
}

/** 写入下载流到文件（纯 Node 实现）。 */
async function BunLikeWrite(
  path: string,
  res: Response,
): Promise<string> {
  const { writeFile } = await import("node:fs/promises");
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(path, buf);
  return path;
}
