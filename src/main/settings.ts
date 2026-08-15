/**
 * 应用设置持久化：userData/settings.json。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS, DesktopSettings } from "../shared/types";

let settingsPath = "";
let cache: DesktopSettings = { ...DEFAULT_SETTINGS };

/** 平台化默认值：macOS 遵循关窗即退惯例（Windows 默认最小化到托盘）。 */
function platformDefaults(): DesktopSettings {
  const defaults = { ...DEFAULT_SETTINGS };
  if (process.platform === "darwin") {
    defaults.closeToTray = false;
    defaults.minimizeToTray = false;
  }
  return defaults;
}

export function initSettings(userDataDir: string) {
  settingsPath = join(userDataDir, "settings.json");
  const defaults = platformDefaults();
  if (existsSync(settingsPath)) {
    try {
      const raw = JSON.parse(readFileSync(settingsPath, "utf8"));
      cache = { ...defaults, ...raw };
    } catch {
      cache = defaults;
    }
  } else {
    cache = defaults;
  }
}

export function getSettings(): DesktopSettings {
  return { ...cache };
}

export function setSettings(patch: Partial<DesktopSettings>): DesktopSettings {
  cache = { ...cache, ...patch };
  persist();
  return getSettings();
}

export function getSettingsPath() {
  return settingsPath;
}

function persist() {
  if (!settingsPath) return;
  try {
    mkdirSync(join(settingsPath, ".."), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(cache, null, 2), "utf8");
  } catch {
    /* 写入失败时保持内存态 */
  }
}
