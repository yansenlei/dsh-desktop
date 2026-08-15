/**
 * 主进程日志：写入 userData/logs/main.log，带简单轮转。
 * 同时维护一个内存环形缓冲，供 UI/诊断读取。
 */
import { appendFileSync, mkdirSync, renameSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const MAX_BYTES = 2 * 1024 * 1024; // 2MB
const KEEP_FILES = 4;
const RING_SIZE = 500;

let logDir = "";
let logFile = "";
let ring: string[] = [];

function ensureDir(dir: string) {
  if (!logDir) {
    logDir = dir;
    logFile = join(dir, "main.log");
    mkdirSync(dir, { recursive: true });
  }
}

function rotate() {
  if (!existsSync(logFile)) return;
  let size = 0;
  try {
    size = statSync(logFile).size;
  } catch {
    return;
  }
  if (size < MAX_BYTES) return;
  // main.log -> main.1.log -> main.2.log ...
  for (let i = KEEP_FILES - 1; i >= 1; i--) {
    const from = i === 1 ? logFile : `${logFile}.${i - 1}`;
    const to = `${logFile}.${i}`;
    if (existsSync(from)) {
      try {
        renameSync(from, to);
      } catch {
        /* 忽略轮转竞争 */
      }
    }
  }
  try {
    renameSync(logFile, `${logFile}.1`);
  } catch {
    /* 忽略 */
  }
}

function stamp(level: string) {
  return `${new Date().toISOString()} [${level}]`;
}

export function initLogger(dir: string) {
  ensureDir(dir);
}

export function log(level: "info" | "warn" | "error" | "debug", msg: string) {
  const line = `${stamp(level)} ${msg}`;
  ring.push(line);
  if (ring.length > RING_SIZE) ring = ring.slice(-RING_SIZE);
  if (!logFile) return;
  try {
    rotate();
    appendFileSync(logFile, line + "\n");
  } catch {
    /* 磁盘满等情况下静默降级 */
  }
}

export const info = (msg: string) => log("info", msg);
export const warn = (msg: string) => log("warn", msg);
export const error = (msg: string) => log("error", msg);
export const debug = (msg: string) => log("debug", msg);

export function getLogDir() {
  return logDir;
}

export function getRecentLines(n = 200) {
  return ring.slice(-n);
}
