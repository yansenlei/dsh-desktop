/**
 * 主进程轻量 i18n：托盘菜单、窗口标题等文案按 settings.language 取词。
 * （渲染层已有独立的 i18n.ts，这里是主进程（Node）侧的字典。）
 */
import { app } from "electron";
import { getSettings } from "./settings";

const dict: Record<string, Record<string, unknown>> = {
  zh: {
    settingsTitle: "DeepSeek Harness Desktop 设置",
    tray: {
      showMain: "显示主界面",
      openBrowser: "在浏览器中打开",
      openBrowserDisabled: "在浏览器中打开（不可用）",
      settings: "设置",
      restartService: "重启服务",
      helpUserGuide: "用户指南",
      helpFeedback: "问题反馈",
      helpDshSite: "DSH 网站",
      helpDshdSite: "DSHD 网站",
      quit: "退出",
    },
  },
  en: {
    settingsTitle: "DeepSeek Harness Desktop Settings",
    tray: {
      showMain: "Show Main Window",
      openBrowser: "Open in Browser",
      openBrowserDisabled: "Open in Browser (unavailable)",
      settings: "Settings",
      restartService: "Restart Service",
      helpUserGuide: "User Guide",
      helpFeedback: "Report an Issue",
      helpDshSite: "DSH Website",
      helpDshdSite: "DSHD Website",
      quit: "Quit",
    },
  },
};

/** 解析有效语言：auto 跟随系统（Electron locale），否则用用户选择。 */
function resolveLang(): "zh" | "en" {
  const lang = getSettings().language;
  if (lang === "zh" || lang === "en") return lang;
  let sys = "en";
  try {
    sys = app.getLocale();
  } catch {
    /* 未 ready 时回退 */
  }
  return /^zh/i.test(sys) ? "zh" : "en";
}

/** 按 settings.language 取文案；缺省回退中文，再回退 key。 */
export function t(key: string): string {
  const table = dict[resolveLang()] ?? dict.zh;
  const value = key.split(".").reduce<unknown>((o, k) => {
    if (o && typeof o === "object") return (o as Record<string, unknown>)[k];
    return undefined;
  }, table);
  return typeof value === "string" ? value : key;
}
