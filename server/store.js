// A small JSON-file database. One file for bots, one file per bot for conversations.
// Good for one server and thousands of conversations. For bigger installs, swap this
// module for Postgres/SQLite: the rest of the app only uses the functions exported here.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { MODELS, EFFORTS } from "./config.js";

const DEFAULT_BOT = {
  name: "Assistant",
  subtitle: "Typically replies instantly",
  welcomeMessage: "Hi! 👋 How can I help you today?",
  placeholder: "Type your message…",
  primaryColor: "#4f46e5",
  textOnPrimary: "#ffffff",
  position: "right",
  suggestions: [],
  systemPrompt: "",
  knowledge: "",
  allowedOrigins: [],
  model: "",
  effort: "",
  enabled: true,
};

const LIMITS = {
  name: 60,
  subtitle: 100,
  welcomeMessage: 500,
  placeholder: 100,
  systemPrompt: 10_000,
  knowledge: 200_000,
};

export function newId(prefix) {
  return prefix + "_" + crypto.randomBytes(9).toString("base64url");
}

function isColor(v) {
  return typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v);
}

function normalizeOrigin(o) {
  o = String(o).trim().replace(/\/+$/, "");
  if (o === "*") return o;
  try {
    const u = new URL(o);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

// Validate and clean user input for a bot. Returns {bot} or {error}.
export function cleanBotInput(input, existing = {}) {
  const out = { ...DEFAULT_BOT, ...existing };
  if (!input || typeof input !== "object") return { error: "Invalid data." };
  for (const [k, max] of Object.entries(LIMITS)) {
    if (input[k] !== undefined) {
      if (typeof input[k] !== "string") return { error: `${k} must be text.` };
      if (input[k].length > max) return { error: `${k} is too long (max ${max} characters).` };
      out[k] = input[k];
    }
  }
  if (!out.name.trim()) return { error: "The bot needs a name." };
  for (const k of ["primaryColor", "textOnPrimary"]) {
    if (input[k] !== undefined) {
      if (!isColor(input[k])) return { error: `${k} must be a color like #4f46e5.` };
      out[k] = input[k];
    }
  }
  if (input.position !== undefined) {
    if (!["left", "right"].includes(input.position)) return { error: "position must be left or right." };
    out.position = input.position;
  }
  if (input.suggestions !== undefined) {
    if (!Array.isArray(input.suggestions)) return { error: "suggestions must be a list." };
    out.suggestions = input.suggestions.map((s) => String(s).trim().slice(0, 80)).filter(Boolean).slice(0, 6);
  }
  if (input.allowedOrigins !== undefined) {
    if (!Array.isArray(input.allowedOrigins)) return { error: "allowedOrigins must be a list." };
    const cleaned = [];
    for (const o of input.allowedOrigins) {
      if (!String(o).trim()) continue;
      const n = normalizeOrigin(o);
      if (!n) return { error: `"${o}" is not a valid website address (use https://example.com).` };
      cleaned.push(n);
    }
    out.allowedOrigins = [...new Set(cleaned)].slice(0, 20);
  }
  if (input.model !== undefined) {
    if (input.model && !MODELS.includes(input.model)) return { error: "Unknown model." };
    out.model = input.model;
  }
  if (input.effort !== undefined) {
    if (input.effort && !EFFORTS.includes(input.effort)) return { error: "Unknown effort level." };
    out.effort = input.effort;
  }
  if (input.enabled !== undefined) out.enabled = Boolean(input.enabled);
  return { bot: out };
}

export class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.convDir = path.join(dataDir, "conversations");
    fs.mkdirSync(this.convDir, { recursive: true });
    this.botsFile = path.join(dataDir, "bots.json");
    this.bots = this.#read(this.botsFile, {});
    this.convCache = new Map();
  }

  #read(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return fallback;
      throw new Error(`Could not read ${file}: ${e.message}`);
    }
  }

  // Write to a temp file then rename, so a crash never leaves a half-written file.
  #write(file, data) {
    const tmp = file + "." + process.pid + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }

  // ---- Bots ----
  listBots() {
    return Object.values(this.bots).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  getBot(id) {
    return Object.hasOwn(this.bots, id) ? this.bots[id] : null;
  }
  createBot(input) {
    const { bot, error } = cleanBotInput(input);
    if (error) return { error };
    const now = new Date().toISOString();
    bot.id = newId("bot");
    bot.createdAt = now;
    bot.updatedAt = now;
    this.bots[bot.id] = bot;
    this.#write(this.botsFile, this.bots);
    return { bot };
  }
  updateBot(id, input) {
    const existing = this.getBot(id);
    if (!existing) return { error: "Bot not found.", status: 404 };
    const { bot, error } = cleanBotInput(input, existing);
    if (error) return { error };
    bot.id = id;
    bot.createdAt = existing.createdAt;
    bot.updatedAt = new Date().toISOString();
    this.bots[id] = bot;
    this.#write(this.botsFile, this.bots);
    return { bot };
  }
  deleteBot(id) {
    if (!this.getBot(id)) return false;
    delete this.bots[id];
    this.#write(this.botsFile, this.bots);
    fs.rmSync(this.#convFile(id), { force: true });
    this.convCache.delete(id);
    return true;
  }

  // ---- Conversations ----
  #convFile(botId) {
    return path.join(this.convDir, botId.replace(/[^\w-]/g, "") + ".json");
  }
  #convs(botId) {
    if (!this.convCache.has(botId)) this.convCache.set(botId, this.#read(this.#convFile(botId), []));
    return this.convCache.get(botId);
  }
  // Save the latest state of a conversation (the widget sends the full history each time).
  saveConversation(botId, convId, messages, meta = {}, maxPerBot = 1000) {
    const list = this.#convs(botId);
    const now = new Date().toISOString();
    let conv = list.find((c) => c.id === convId);
    if (!conv) {
      conv = { id: convId, startedAt: now, page: meta.page || "", messages: [] };
      list.push(conv);
    }
    conv.messages = messages.map((m) => ({ role: m.role, content: m.content }));
    conv.updatedAt = now;
    if (list.length > maxPerBot) list.splice(0, list.length - maxPerBot);
    this.#write(this.#convFile(botId), list);
  }
  listConversations(botId) {
    return this.#convs(botId)
      .map((c) => ({
        id: c.id,
        startedAt: c.startedAt,
        updatedAt: c.updatedAt,
        page: c.page,
        messageCount: c.messages.length,
        preview: (c.messages.find((m) => m.role === "user")?.content || "").slice(0, 120),
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  getConversation(botId, convId) {
    return this.#convs(botId).find((c) => c.id === convId) || null;
  }
  stats(botId) {
    const list = this.#convs(botId);
    const dayAgo = Date.now() - 86_400_000;
    return {
      conversations: list.length,
      messages: list.reduce((n, c) => n + c.messages.length, 0),
      last24h: list.filter((c) => Date.parse(c.updatedAt) > dayAgo).length,
    };
  }
}
