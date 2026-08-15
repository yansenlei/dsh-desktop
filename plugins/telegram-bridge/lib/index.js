/**
 * Telegram 桥接插件 —— Node 端（服务端半部）。
 *
 * 让用户在自己的 Telegram 中与 DeepSeek Harness 对话、控制电脑：
 * - 纯 HTTP 实现 Telegram Bot API（getUpdates 长轮询 + sendMessage + editMessageText
 *   + getMe），可选代理（自动检测系统代理或手动配置）。
 * - 消息通过 DSH agents 服务接入**Telegram 专属会话**（不依赖浏览器），支持
 *   多会话管理：/new 新建、/list 列出、/use N 切换、/info 查看当前。
 * - agent 回复通过 assistant/chunk 流式转回 Telegram（打字机效果）。
 *
 * 配置：token / 代理由浏览器端 UI 通过 POST /telegram-config 提供；
 * 会话列表按 Telegram chat 隔离，持久化到 `$DSH_HOME/telegram.config.json`。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { zstdDecompressSync } from "node:zlib";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { fetch as ufetch, ProxyAgent } from "undici";

const name = "telegram-bridge";
const inject = ["webServer", "agents", "agentDefaultModel", "sessions"];

const API = "https://api.telegram.org/bot";
const POLL_TIMEOUT_MS = 25_000;
const CONFIG_FILE = "telegram.config.json";
const DEFAULT_SESSION_ID = "session-telegram-main";

// ── 系统代理检测 ────────────────────────────────────────────────────
function detectSystemProxy() {
  const envProxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  if (envProxy) return envProxy;
  if (process.platform === "win32") {
    try {
      const enabled = execFileSync(
        "reg",
        ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings", "/v", "ProxyEnable"],
        { encoding: "utf8", windowsHide: true },
      );
      if (!/0x1\b/.test(enabled)) return null;
      const srv = execFileSync(
        "reg",
        ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings", "/v", "ProxyServer"],
        { encoding: "utf8", windowsHide: true },
      );
      const m = srv.match(/ProxyServer\s+REG_SZ\s+(\S+)/);
      const server = m?.[1]?.trim();
      if (server) return /^https?:\/\//.test(server) ? server : `http://${server}`;
    } catch {
      /* 忽略 */
    }
  }
  if (process.platform === "darwin") {
    try {
      const out = execFileSync("scutil", ["--proxy"], { encoding: "utf8" });
      const host = out.match(/HTTPProxy\s*:\s*(\S+)/)?.[1]?.trim();
      const port = out.match(/HTTPPort\s*:\s*(\d+)/)?.[1]?.trim();
      if (host && port) return `http://${host}:${port}`;
    } catch {
      /* 忽略 */
    }
  }
  return null;
}

// ── 配置持久化 ─────────────────────────────────────────────────────
function configPath() {
  return join(process.env.DSH_HOME ?? ".", CONFIG_FILE);
}

function loadConfig() {
  try {
    if (existsSync(configPath())) {
      return JSON.parse(readFileSync(configPath(), "utf8"));
    }
  } catch {
    /* 忽略 */
  }
  return { token: null };
}

function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  try {
    mkdirSync(process.env.DSH_HOME ?? ".", { recursive: true });
    writeFileSync(configPath(), JSON.stringify(next, null, 2), "utf8");
  } catch {
    /* 忽略 */
  }
  return next;
}

/** 某 chat 的会话状态：{ current, sessions: [id,...] } */
function chatState(chatId) {
  const cfg = loadConfig();
  const chats = cfg.chats ?? {};
  if (chats[chatId] && chats[chatId].sessions?.length) return chats[chatId];
  return { current: DEFAULT_SESSION_ID, sessions: [DEFAULT_SESSION_ID] };
}

function saveChatState(chatId, state) {
  const cfg = loadConfig();
  const chats = cfg.chats ?? {};
  chats[chatId] = state;
  saveConfig({ chats });
}

// ── Telegram Bot API ────────────────────────────────────────────────
let proxyAgent = null;

function buildProxyAgent(proxyUrl) {
  try {
    return proxyUrl ? new ProxyAgent(proxyUrl) : null;
  } catch {
    return null;
  }
}

async function tg(method, token, body) {
  const res = await ufetch(`${API}${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === void 0 ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(POLL_TIMEOUT_MS + 15_000),
    ...(proxyAgent ? { dispatcher: proxyAgent } : {}),
  });
  return res.json().catch(() => ({ ok: false, description: "bad response" }));
}

async function sendText(token, chatId, text) {
  if (!token || !chatId) return;
  try {
    await tg("sendMessage", token, { chat_id: Number(chatId), text: text.slice(0, 4000) });
  } catch {
    /* 忽略 */
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 开启 getUpdates 长轮询。 */
async function pollLoop(token, onMessage, onError) {
  let offset = 0;
  for (;;) {
    try {
      const res = await tg("getUpdates", token, {
        offset,
        timeout: POLL_TIMEOUT_MS / 1000,
        allowed_updates: ["message"],
      });
      if (!res.ok) {
        onError?.(res.description ?? "getUpdates failed");
        if (res.error_code === 401 || res.error_code === 404) break;
        await sleep(3_000);
        continue;
      }
      for (const update of res.result ?? []) {
        offset = Math.max(offset, update.update_id + 1);
        const msg = update.message;
        if (msg && typeof msg.text === "string") {
          await onMessage(msg).catch((e) => onError?.(e?.message ?? String(e)));
        }
      }
    } catch (err) {
      onError?.(err?.message ?? String(err));
      await sleep(3_000);
    }
  }
}

// ── 插件 ───────────────────────────────────────────────────────────
function apply(ctx) {
  let bot = null; // { token, username }
  let poller = null;
  let running = false;
  let tgAgent = null; // 当前活动的 Telegram agent（当前会话）
  let agentForSession = {}; // sessionId -> agent（缓存已创建/恢复的 agent）

  function stopBot() {
    running = false;
    poller = null;
    bot = null;
  }

  function resolveCwd() {
    try {
      const ws = JSON.parse(
        readFileSync(join(process.env.DSH_HOME ?? ".", "storages", "workspace.json"), "utf8"),
      );
      const first = ws?.tables?.workspaces && Object.values(ws.tables.workspaces)[0];
      if (first?.path && existsSync(first.path)) return first.path;
    } catch {
      /* 忽略 */
    }
    return process.env.USERPROFILE || process.env.HOME || process.cwd();
  }

  function buildOptions(sessionId) {
    const defaultModel = ctx.get("agentDefaultModel");
    const selection = defaultModel?.currentSelection?.();
    if (!selection?.provider || !selection?.model) {
      throw new Error("未配置模型：请先在 Harness 工作台设置中配置模型（Provider 与 API Key）");
    }
    return {
      sessionId: SessionId(sessionId),
      meta: { cwd: resolveCwd() },
      agentOptions: { provider: selection.provider, model: selection.model },
      // setup 必须用块语句（不返回值），工厂会对返回值调用 .commit()
      setup: (agentCtx) => {
        installModelSelection(agentCtx, { current: selection, assembled: void 0 });
      },
    };
  }

  /** 从磁盘读取会话历史事件（session.jsonl.zstd），截断未闭合尾部。 */
  function loadSessionSeed(sessionId) {
    const dir = sessionDir(sessionId);
    if (!dir) return undefined;
    try {
      const buf = zstdDecompressSync(readFileSync(join(dir, "session.jsonl.zstd")));
      const events = [];
      for (const line of buf.toString("utf8").split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try {
          events.push(JSON.parse(t));
        } catch {
          /* 忽略坏行 */
        }
      }
      return trimUnclosedTail(events);
    } catch {
      return undefined;
    }
  }

  /** 从尾部截掉未闭合的 turn/step/tool-call（磁盘可能残留崩溃现场）。 */
  function trimUnclosedTail(events) {
    const out = [...events];
    const counts = { turn: 0, step: 0, tool: 0 };
    const mark = (ev) => {
      if (ev.type === "turn/start") counts.turn++;
      else if (ev.type === "turn/end") counts.turn--;
      else if (ev.type === "step/start") counts.step++;
      else if (ev.type === "step/end") counts.step--;
      else if (ev.type === "tool/call") counts.tool++;
      else if (ev.type === "tool/result") counts.tool--;
    };
    for (const ev of out) mark(ev);
    while (out.length > 0 && (counts.turn > 0 || counts.step > 0 || counts.tool > 0)) {
      const ev = out.pop();
      if (ev.type === "turn/start") counts.turn--;
      else if (ev.type === "turn/end") counts.turn++;
      else if (ev.type === "step/start") counts.step--;
      else if (ev.type === "step/end") counts.step++;
      else if (ev.type === "tool/call") counts.tool--;
      else if (ev.type === "tool/result") counts.tool++;
    }
    return out;
  }

  /** 获取（创建/恢复）指定会话的 agent。 */
  async function ensureAgentFor(sessionId) {
    if (agentForSession[sessionId] && !agentForSession[sessionId].disposed) {
      return agentForSession[sessionId];
    }
    // 1) 已注册（进程内其他路径创建过）
    try {
      const existing = ctx.agents.get(sessionId);
      if (existing) {
        agentForSession[sessionId] = existing;
        return existing;
      }
    } catch {
      /* 忽略 */
    }
    // 2) 创建（带磁盘历史 seed，实现"新建 + 恢复"统一）
    const options = buildOptions(sessionId);
    const seed = loadSessionSeed(sessionId);
    if (seed && seed.length > 0) {
      options.seed = seed;
      console.error(`[telegram] 从磁盘恢复会话 ${sessionId}（${seed.length} 事件）`);
    }
    try {
      const handle = await ctx.agents.create(options);
      agentForSession[sessionId] = handle.agent;
      console.error(`[telegram] agent 创建成功: ${sessionId}`);
      return handle.agent;
    } catch (err) {
      console.error(`[telegram] create 失败: ${err?.message ?? String(err)}`);
      // 3) seed 校验失败（如日志不完整）→ 降级为新会话重试
      if (seed && seed.length > 0) {
        console.error(`[telegram] seed 恢复失败，降级为新会话`);
        delete options.seed;
        try {
          const handle = await ctx.agents.create(options);
          agentForSession[sessionId] = handle.agent;
          return handle.agent;
        } catch (err2) {
          // 4) 仍失败（可能是并发撞车）→ 复用已注册
          const existing = ctx.agents.get(sessionId);
          if (existing) {
            agentForSession[sessionId] = existing;
            return existing;
          }
          throw err2;
        }
      }
      const existing = ctx.agents.get(sessionId);
      if (existing) {
        agentForSession[sessionId] = existing;
        return existing;
      }
      throw err;
    }
  }

  /** 获取当前 chat 的活动 agent（并缓存为 tgAgent）。 */
  async function ensureAgent(chatId) {
    const state = chatState(chatId);
    tgAgent = await ensureAgentFor(state.current);
    return tgAgent;
  }

  /** 初始化 bot。 */
  async function startBot(token) {
    stopBot();
    const cfg = loadConfig();
    proxyAgent = buildProxyAgent(cfg.proxy || detectSystemProxy());
    const me = await tg("getMe", token);
    if (!me.ok) throw new Error(me.description ?? "getMe failed");
    bot = { token, username: me.result.username };
    running = true;
    poller = pollLoop(token, onTelegramMessage, (err) => {
      ctx.emit("telegram/error", { message: String(err) });
    });
    ctx.emit("telegram/status", { connected: true, username: bot.username });
  }

  // ── 命令处理 ────────────────────────────────────────────────────
  async function handleCommand(chatId, text) {
    const token = bot?.token;
    const state = chatState(chatId);
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    switch (cmd) {
      case "/help":
      case "/start":
        await sendText(
          token,
          chatId,
          "DeepSeek Harness · Telegram 接入\n\n" +
            "/new —— 新建对话\n" +
            "/list —— 查看对话列表\n" +
            "/use N —— 切换到第 N 个对话\n" +
            "/info —— 查看当前对话\n" +
            "直接发消息即可与当前对话交流",
        );
        return;
      case "/new": {
        const id = `session-telegram-${randomUUID()}`;
        try {
          const agent = await ensureAgentFor(id);
          void agent;
          state.sessions.push(id);
          state.current = id;
          saveChatState(chatId, state);
          await sendText(token, chatId, `已创建新对话（${state.sessions.length}）`);
        } catch (err) {
          await sendText(token, chatId, `⚠️ 创建失败：${err?.message ?? String(err)}`);
        }
        return;
      }
      case "/list": {
        const lines = state.sessions.map(
          (id, i) => `${i + 1}. ${id === state.current ? "▶ " : "  "}${displayName(id, i + 1)}`,
        );
        await sendText(token, chatId, `对话列表（${state.sessions.length} 个）：\n${lines.join("\n")}\n\n/use N 切换`);
        return;
      }
      case "/use": {
        const n = Number(parts[1]);
        if (!Number.isInteger(n) || n < 1 || n > state.sessions.length) {
          await sendText(token, chatId, `请输入有效序号（1-${state.sessions.length}）`);
          return;
        }
        state.current = state.sessions[n - 1];
        saveChatState(chatId, state);
        await sendText(token, chatId, `已切换到对话 ${n}：${displayName(state.current, n)}`);
        return;
      }
      case "/info": {
        const idx = state.sessions.indexOf(state.current) + 1;
        const name = displayName(state.current, idx || 1);
        const summary = sessionSummary(state.current);
        const lines = [`当前对话：${name}`, `会话 ID：${state.current}`, `工作目录：${resolveCwd()}`];
        if (summary.length > 0) {
          lines.push("", "最近消息：");
          for (const m of summary) {
            lines.push(`${m.role === "user" ? "👤" : "🤖"} ${m.text.slice(0, 120)}`);
          }
        } else {
          lines.push("", "（暂无消息）");
        }
        await sendText(token, chatId, lines.join("\n"));
        return;
      }
      default:
        await sendText(token, chatId, `未知指令 ${cmd}，发送 /help 查看可用指令`);
    }
  }

  function shortId(id) {
    return id.replace("session-telegram-", "").slice(0, 8);
  }

  // ── 会话信息（标题 / 最近消息汇总） ──────────────────────────────
  function sessionTitle(sessionId) {
    try {
      const cache = JSON.parse(
        readFileSync(join(process.env.DSH_HOME ?? ".", "storages", "session_projcache.json"), "utf8"),
      );
      const row = cache?.tables?.sessions?.[sessionId]?.rows?.title?.val;
      if (typeof row === "string" && row) return row;
    } catch {
      /* 忽略 */
    }
    return null;
  }

  function sessionDir(sessionId) {
    try {
      const root = join(process.env.DSH_HOME ?? ".", "sessions");
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const p = join(root, entry.name, sessionId);
        if (existsSync(p)) return p;
      }
    } catch {
      /* 忽略 */
    }
    return null;
  }

  function extractText(blocks) {
    return (blocks ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  }

  /** 读取会话最近几条 user/assistant 消息。 */
  function sessionSummary(sessionId) {
    const dir = sessionDir(sessionId);
    if (!dir) return [];
    try {
      const buf = zstdDecompressSync(readFileSync(join(dir, "session.jsonl.zstd")));
      const msgs = [];
      for (const line of buf.toString("utf8").split("\n")) {
        try {
          const ev = JSON.parse(line);
          if (ev.type === "user/message") {
            const t = extractText(ev.data.content);
            if (t) msgs.push({ role: "user", text: t });
          } else if (ev.type === "assistant/message") {
            const t = extractText(ev.data.message.content);
            if (t) msgs.push({ role: "assistant", text: t });
          }
        } catch {
          /* 忽略坏行 */
        }
      }
      return msgs.slice(-4);
    } catch {
      return [];
    }
  }

  function displayName(sessionId, index) {
    const title = sessionTitle(sessionId);
    return title ? title : `对话 ${index}（无标题）`;
  }

  /** Telegram 消息 → agent。 */
  async function onTelegramMessage(message) {
    const chatId = String(message.chat.id);
    const text = String(message.text ?? "").trim();
    if (text === "") return;
    if (text.startsWith("/")) {
      await handleCommand(chatId, text);
      return;
    }
    try {
      lastChatId = chatId; // 记录当前 chat，供回复转发使用
      flushReply(); // 新消息：立即发送上一轮残留的合并回复
      const agent = await ensureAgent(chatId);
      if (!bot) return;
      console.error(`[telegram] 收到消息 chat=${chatId} session=${agent.session.id}`);
      await sendText(bot.token, chatId, "收到，正在处理…");
      const userMsg = createUserMessage({
        content: [{ type: "text", text: `[Telegram 用户] ${text}` }],
        source: { kind: "user" },
      });
      agent.followup(userMsg);
      console.error(`[telegram] followup 已注入 session=${agent.session.id}`);
    } catch (err) {
      console.error(`[telegram] 消息处理失败: ${err?.message ?? String(err)}`);
      await sendText(bot?.token, chatId, `⚠️ ${err?.message ?? String(err)}`);
    }
  }

  // ── 回复输出（简单可靠：一轮输出合并为一条消息，空闲后一次性发送） ──
  let pendingReply = ""; // 待发送的合并回复
  let sendTimer = null;

  function scheduleSend(delay = 1500) {
    if (sendTimer) clearTimeout(sendTimer);
    sendTimer = setTimeout(() => {
      sendTimer = null;
      flushReply();
    }, delay);
  }

  function flushReply() {
    if (sendTimer) {
      clearTimeout(sendTimer);
      sendTimer = null;
    }
    if (!pendingReply || !bot) return;
    const text = pendingReply;
    pendingReply = "";
    console.error(`[telegram] 发送合并回复 len=${text.length}`);
    sendText(bot.token, lastChatId, text);
  }

  let lastChatId = null;

  const disposeEvents = ctx.on("session/event", (session, event) => {
    if (!running || !bot || !tgAgent) return;
    if (session !== tgAgent.session) return;
    switch (event.type) {
      // 不流式：忽略 assistant/chunk
      case "assistant/chunk":
        break;
      case "assistant/message": {
        // 一个 step 的完整文本。同一轮可能多 step，合并后一次性发送。
        const text = (event.data.message.content ?? [])
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("");
        if (!text) break;
        if (!pendingReply.includes(text)) {
          pendingReply = pendingReply ? `${pendingReply}\n\n${text}` : text;
        }
        scheduleSend();
        break;
      }
      case "turn/start":
        console.error(`[telegram] turn/start session=${session.id}`);
        break;
      case "turn/end": {
        const reason = event.data?.reason?.kind ?? event.data?.reason;
        console.error(`[telegram] turn/end reason=${JSON.stringify(reason)}`);
        scheduleSend(1500);
        break;
      }
      default:
        break;
    }
  });

  // ── HTTP 路由 ────────────────────────────────────────────────────
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: "/telegram-info",
        handler: async (req, res) => {
          const cfg = loadConfig();
          const chats = cfg.chats ?? {};
          const payload = {
            configured: Boolean(bot && bot.username),
            username: bot?.username ?? null,
            link: bot?.username ? `https://t.me/${bot.username}` : null,
            tokenSet: Boolean(cfg.token),
            proxy: cfg.proxy ?? null,
            proxyDetected: detectSystemProxy() ?? null,
            agentReady: Boolean(tgAgent),
            chatCount: Object.keys(chats).length,
          };
          const body = JSON.stringify(payload);
          res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
          res.end(body);
        },
      }),
    "telegram-bridge: /telegram-info",
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: "/telegram-config",
        handler: async (req, res) => {
          let body = "";
          for await (const chunk of req) body += chunk;
          let parsed = {};
          try {
            parsed = JSON.parse(body);
          } catch {
            /* 非法 body */
          }
          if (typeof parsed.proxy === "string") {
            saveConfig({ proxy: parsed.proxy.trim() || null });
          }
          const token = typeof parsed.token === "string" && parsed.token.length > 0 ? parsed.token : null;
          if (!token) {
            if (parsed.token === "") saveConfig({ token: null });
            stopBot();
            proxyAgent = null;
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true, configured: false }));
            return;
          }
          try {
            await startBot(token);
            saveConfig({ token });
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true, configured: true, username: bot?.username ?? null }));
          } catch (err) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: err?.message ?? String(err) }));
          }
        },
      }),
    "telegram-bridge: /telegram-config",
  );

  // 启动时若已有 token，自动恢复连接
  const cfg = loadConfig();
  if (cfg.token) {
    startBot(cfg.token).catch((err) => {
      ctx.emit("telegram/error", { message: `自动连接失败: ${err?.message ?? String(err)}` });
    });
  }

  return () => {
    disposeEvents();
    stopBot();
  };
}

export { apply, inject, name };
