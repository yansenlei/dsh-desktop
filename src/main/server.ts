/**
 * DSH 服务管理器：用 Electron 内置的 Node（ELECTRON_RUN_AS_NODE）以子进程方式
 * 启动 `dsh web`，监控其生命周期，健康检查与自动重启。
 *
 * 设计要点：
 * - Electron 自带 Node.js 运行时，因此**用户机器上完全不需要安装 Node.js**。
 * - 子进程与 Electron 主进程隔离：服务崩溃不会拖垮应用壳，可独立重启。
 * - DSH_HOME 指向应用数据目录，所有会话数据随应用管理。
 * - 子进程 stdout/stderr 通过**文件描述符**重定向到 server.log（不创建管道，
 *   对沙箱/无控制台场景更友好）；就绪检测用主动健康轮询（端口由本模块选定，
 *   URL 已知，无需解析子进程输出）。
 */
import { spawn, ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { openSync, closeSync, statSync, readSync, mkdirSync, writeFileSync, symlinkSync, lstatSync, unlinkSync, rmSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import type { ServerPhase, ServerStatus } from "../shared/types";
import { info, warn, error as logError, getLogDir } from "./logger";
import { getSettings } from "./settings";

/** 诊断追踪（写入 SMOKE_TRACE 文件，仅在设了该环境变量时生效）。 */
function trace(msg: string) {
  const p = process.env.SMOKE_TRACE;
  if (!p) return;
  try {
    const { appendFileSync } = require("node:fs") as typeof import("node:fs");
    appendFileSync(p, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* 忽略 */
  }
}

const STARTUP_TIMEOUT_MS = 90_000;
const MAX_AUTO_RESTARTS = 3;
const RESTART_BACKOFF_MS = 2_000;
const HEALTH_INTERVAL_MS = 700;

export type StatusListener = (status: ServerStatus) => void;
export type LogListener = (line: string) => void;

export class DshServerManager {
  private child: ChildProcess | null = null;
  private status: ServerStatus = {
    phase: "idle",
    port: null,
    url: null,
    pid: null,
    startedAt: null,
    messageKey: "idle",
    lastError: null,
    restartCount: 0,
  };
  private statusListeners = new Set<StatusListener>();
  private logListeners = new Set<LogListener>();
  private stopping = false;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private startupDeadline = 0;
  private logFilePollTimer: ReturnType<typeof setInterval> | null = null;
  private logFileOffset = 0;

  constructor(
    private readonly opts: {
      runtimeDir: string;
      dshHome: string;
      execPath: string;
    },
  ) {}

  onStatus(fn: StatusListener) {
    this.statusListeners.add(fn);
    fn({ ...this.status });
    return () => this.statusListeners.delete(fn);
  }

  onLog(fn: LogListener) {
    this.logListeners.add(fn);
    return () => this.logListeners.delete(fn);
  }

  getStatus(): ServerStatus {
    return { ...this.status };
  }

  private setPhase(phase: ServerPhase, messageKey: string, lastError: string | null = null) {
    this.status = { ...this.status, phase, messageKey, lastError };
    this.emitStatus();
  }

  private emitStatus() {
    const snapshot = { ...this.status };
    for (const fn of this.statusListeners) fn(snapshot);
  }

  private emitLog(line: string) {
    for (const fn of this.logListeners) fn(line);
  }

  /** 找可用端口：从首选端口开始顺延尝试。 */
  private async findFreePort(preferred: number): Promise<number> {
    for (let port = preferred; port < preferred + 50; port++) {
      if (await isPortFree(port)) return port;
    }
    return 30000 + Math.floor(Math.random() * 20000);
  }

  async start(): Promise<void> {
    if (this.child && !this.child.killed) {
      warn("server.start: 服务已在运行");
      return;
    }
    this.stopping = false;
    this.setPhase("starting", "starting");

    const settings = getSettings();
    const port = await this.findFreePort(settings.port);
    const binPath = join(
      this.opts.runtimeDir,
      "dsh",
      "node_modules",
      "@deepseek-ai",
      "dsh",
      "lib",
      "bin.js",
    );
    if (!existsSync(binPath)) {
      this.setPhase("error", "runtime-missing", `找不到 DSH 运行时: ${binPath}`);
      return;
    }

    // 局域网访问：生成 patch（注入二维码插件行 + 可选 host=0.0.0.0），并确保
    // 插件可从 profile 目录解析（junction 链接到运行时内的插件包）。
    const patchPath = this.prepareLanAccessPatch(settings.lanAccess);

    const url = `http://127.0.0.1:${port}`;
    info(`启动 dsh web: ${binPath} --port ${port} (DSH_HOME=${this.opts.dshHome}, lanAccess=${settings.lanAccess})`);
    trace(`server.start: bin=${binPath} port=${port} patch=${patchPath}`);

    // stdout/stderr → server.log（文件描述符，避免管道）
    const logPath = join(getLogDir(), "server.log");
    let logFd: number | null = null;
    try {
      logFd = openSync(logPath, "a");
    } catch {
      logFd = null;
    }
    this.logFileOffset = logExistsSize(logPath);
    this.startLogFilePolling(logPath);

    let child: ChildProcess;
    try {
      // Electron 以 Node 模式运行时，HMR 服务需要 --expose-internals；
      // 不加在 Node 24（Electron 41+）下会报 "--expose-internals is required for HMR service"。
      child = spawn(this.opts.execPath, ["--expose-internals", binPath, "web", "--patch", patchPath, "--port", String(port)], {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          ELECTRON_NO_ATTACH_CONSOLE: "1",
          DSH_HOME: this.opts.dshHome,
        },
        cwd: this.opts.runtimeDir,
        windowsHide: true,
        stdio: ["ignore", logFd ?? "ignore", logFd ?? "ignore"],
      });
    } catch (err) {
      trace(`server.start: spawn 异常 ${(err as Error).message}`);
      if (logFd !== null) closeSync(logFd);
      this.setPhase("error", "spawn-failed", (err as Error).message);
      return;
    }
    if (logFd !== null) closeSync(logFd);
    this.child = child;
    trace(`server.start: spawned pid=${child.pid}`);
    this.status = {
      ...this.status,
      pid: child.pid ?? null,
      port,
      url,
      startedAt: Date.now(),
      restartCount: this.status.phase === "restarting" ? this.status.restartCount + 1 : 0,
    };
    this.emitStatus();

    this.startupDeadline = Date.now() + STARTUP_TIMEOUT_MS;
    this.startHealthPolling(url);

    child.on("error", (err) => {
      trace(`server: child error ${err.message}`);
      logError(`服务子进程错误: ${err.message}`);
      if (!this.stopping) {
        this.setPhase("error", "spawn-failed", err.message);
        this.scheduleRestart();
      }
    });

    child.on("exit", (code, signal) => {
      trace(`server: child exit code=${code} signal=${signal}`);
      info(`服务子进程退出: code=${code} signal=${signal}`);
      this.stopHealthPolling();
      this.stopLogFilePolling();
      this.child = null;
      if (this.stopping) {
        this.setPhase("stopped", "stopped");
        return;
      }
      if (this.status.phase !== "ready") {
        this.setPhase("error", "start-failed", `进程提前退出 (code=${code})`);
      } else {
        this.setPhase("error", "crashed", `进程退出 (code=${code})`);
      }
      this.scheduleRestart();
    });
  }

  /** 健康轮询：http 200 即就绪；超时判失败。 */
  private startHealthPolling(url: string) {
    this.stopHealthPolling();
    this.healthTimer = setInterval(async () => {
      if (this.stopping) return;
      const phase: ServerPhase = this.status.phase;
      if (phase === "ready") {
        this.stopHealthPolling();
        return;
      }
      let ok = false;
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 2_000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(t);
        ok = res.status === 200;
      } catch {
        ok = false;
      }
      if (ok) {
        this.stopHealthPolling();
        info(`服务就绪: ${url}`);
        this.status = { ...this.status, phase: "ready", messageKey: "ready" };
        this.emitStatus();
        return;
      }
      if (Date.now() > this.startupDeadline) {
        this.stopHealthPolling();
        logError("服务启动超时（健康检查未通过）");
        if (!this.stopping) {
          this.setPhase("error", "start-timeout", "启动超时：服务未在预期时间内响应");
          this.scheduleRestart();
        }
      }
    }, HEALTH_INTERVAL_MS);
  }

  /**
   * 生成内置插件 patch 并确保插件可从 profile 解析；返回 patch 路径。
   * - lan-access：局域网二维码（开启局域网访问时同时把 webserver 绑定
   *   0.0.0.0，webRuntime 会自动把本机局域网 IP 加入 trustedHosts）。
   * - telegram-bridge：Telegram 桥接（token 由浏览器端配置）。
   */
  private prepareLanAccessPatch(lanEnabled: boolean): string {
    const patchPath = join(this.opts.dshHome, "lan-access.patch.yml");
    try {
      const lines: string[] = [
        "# 由 DSH Desktop 生成：注入内置插件（lan-access / telegram-bridge）",
      ];
      if (lanEnabled) {
        lines.push("- id: webserver", "  config:", "    host: '0.0.0.0'", "    port: !!js ctx.webStartup.port ?? 3080");
      }
      lines.push("- insert:", "    - id: lan-access", "      name: '@dsh-desktop/lan-access'", "    - id: telegram-bridge", "      name: '@dsh-desktop/telegram-bridge'");
      mkdirSync(dirname(patchPath), { recursive: true });
      writeFileSync(patchPath, lines.join("\n") + "\n", "utf8");
    } catch (err) {
      warn(`生成内置插件 patch 失败: ${(err as Error).message}`);
    }
    this.ensurePluginLinked("lan-access");
    this.ensurePluginLinked("telegram-bridge");
    return patchPath;
  }

  /**
   * 确保 profile 目录能解析指定插件：把运行时内的插件包以符号链接
   * 链接到 $DSH_HOME/profiles/web/node_modules/@dsh-desktop/<name>。
   * （loader 从 profile 目录做普通 Node 解析；bundle 包走安装位置，
   * out-of-tree 插件需要 profile 可解析。）
   */
  private ensurePluginLinked(pluginName: string): void {
    const target = join(
      this.opts.runtimeDir,
      "dsh",
      "node_modules",
      "@dsh-desktop",
      pluginName,
    );
    const link = join(this.opts.dshHome, "profiles", "web", "node_modules", "@dsh-desktop", pluginName);
    try {
      if (!existsSync(target)) {
        warn(`内置插件 ${pluginName} 不存在: ${target}`);
        return;
      }
      try {
        const st = lstatSync(link);
        if (st.isSymbolicLink()) {
          try {
            if (realpathSync(link) === realpathSync(target)) return;
          } catch {
            /* 链接损坏，重建 */
          }
          try {
            unlinkSync(link);
          } catch {
            rmSync(link, { recursive: true, force: true });
          }
        } else if (st.isDirectory()) {
          rmSync(link, { recursive: true, force: true });
        }
      } catch {
        /* 链接不存在 */
      }
      mkdirSync(dirname(link), { recursive: true });
      // Windows 用 junction（无需管理员权限）；macOS/Linux 用目录符号链接
      if (process.platform === "win32") {
        symlinkSync(target, link, "junction");
      } else {
        symlinkSync(target, link, "dir");
      }
      info(`内置插件 ${pluginName} 已链接: ${link}`);
    } catch (err) {
      warn(`链接内置插件 ${pluginName} 失败: ${(err as Error).message}`);
    }
  }

  private stopHealthPolling() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  /** 轮询 server.log 新行并推送给 UI。 */
  private startLogFilePolling(logPath: string) {
    this.stopLogFilePolling();
    this.logFilePollTimer = setInterval(() => {
      try {
        const size = statSync(logPath).size;
        if (size < this.logFileOffset) {
          this.logFileOffset = 0; // 日志轮转
        }
        if (size === this.logFileOffset) return;
        const fd = openSync(logPath, "r");
        const buf = Buffer.alloc(size - this.logFileOffset);
        let read = 0;
        try {
          while (read < buf.length) {
            const n = readSyncAt(fd, buf, read, buf.length - read, this.logFileOffset + read);
            if (n <= 0) break;
            read += n;
          }
        } finally {
          closeSync(fd);
        }
        this.logFileOffset += read;
        const text = buf.toString("utf8");
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trimEnd();
          if (trimmed) this.emitLog(trimmed);
        }
      } catch {
        /* 文件尚未创建或已被删除 */
      }
    }, 500);
  }

  private stopLogFilePolling() {
    if (this.logFilePollTimer) {
      clearInterval(this.logFilePollTimer);
      this.logFilePollTimer = null;
    }
  }

  private scheduleRestart() {
    if (this.stopping) return;
    if (!getSettings().autoRestart) return;
    if (this.status.restartCount >= MAX_AUTO_RESTARTS) {
      this.setPhase("error", "restart-limit", "自动重启次数已达上限，请手动重试");
      return;
    }
    if (this.restartTimer) return;
    this.setPhase("restarting", "restarting");
    this.restartTimer = setTimeout(async () => {
      this.restartTimer = null;
      await this.start();
    }, RESTART_BACKOFF_MS);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.stopHealthPolling();
    this.stopLogFilePolling();
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const child = this.child;
    this.child = null;
    if (!child) {
      this.setPhase("stopped", "stopped");
      return;
    }
    info(`停止服务 (pid=${child.pid})`);
    // 先优雅请求退出，2 秒后兜底强制结束进程树
    const force = new Promise<void>((resolve) => {
      setTimeout(() => {
        if (!child.killed) {
          warn("优雅退出超时，强制结束进程树");
          try {
            if (process.platform === "win32") {
              // Windows：taskkill 结束整个进程树
              spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
                windowsHide: true,
                stdio: "ignore",
              });
            } else {
              // macOS/Linux：先 SIGTERM，再升级 SIGKILL
              try {
                child.kill("SIGTERM");
              } catch {
                child.kill("SIGKILL");
              }
            }
          } catch {
            child.kill();
          }
        }
        resolve();
      }, 2_000);
    });
    child.kill();
    await force;
    this.setPhase("stopped", "stopped");
  }
}

/** 读取文件指定偏移。 */
function readSyncAt(fd: number, buf: Buffer, offset: number, length: number, position: number): number {
  return readSync(fd, buf, offset, length, position);
}

function logExistsSize(p: string): number {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
}

/** 探测端口是否空闲。 */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => {
      srv.close(() => resolve(true));
    });
  });
}
