// HTTP routes. Kept free of global state so tests can create an app with a fake Claude client.

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { ROOT, MODELS } from "./config.js";

const MAX_HISTORY = 30;
const MAX_MESSAGE_CHARS = 4000;

const FILES = {
  "/widget.js": ["public/widget.js", "application/javascript; charset=utf-8", true],
  "/demo": ["public/demo.html", "text/html; charset=utf-8"],
  "/admin": ["admin/index.html", "text/html; charset=utf-8"],
  "/admin/": ["admin/index.html", "text/html; charset=utf-8"],
  "/admin/admin.js": ["admin/admin.js", "application/javascript; charset=utf-8"],
  "/admin/admin.css": ["admin/admin.css", "text/css; charset=utf-8"],
};

export function buildSystemPrompt(bot) {
  const base =
    bot.systemPrompt?.trim() ||
    `You are ${bot.name}, a friendly assistant in a website's chat widget. ` +
      "Keep answers short and clear, since they appear in a small chat window. " +
      "Use plain text or light Markdown (bold, lists, links). " +
      "If you don't know something about this business, say so and suggest how the visitor can get help.";
  const knowledge = bot.knowledge?.trim();
  if (!knowledge) return base;
  return (
    base +
    "\n\nAnswer questions about this business using the reference material below. " +
    "If the answer isn't in it, say you're not sure rather than guessing.\n\n" +
    `<reference>\n${knowledge}\n</reference>`
  );
}

export function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return null;
  const msgs = raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }))
    .filter((m) => m.content.trim())
    .slice(-MAX_HISTORY);
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return null;
  return msgs;
}

// Public settings the widget needs. Never includes the system prompt or knowledge.
function publicConfig(bot) {
  const { name, subtitle, welcomeMessage, placeholder, primaryColor, textOnPrimary, position, suggestions } = bot;
  return { id: bot.id, name, subtitle, welcomeMessage, placeholder, primaryColor, textOnPrimary, position, suggestions };
}

function makeLimiter(perMinute) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (!v.some((t) => now - t < 60_000)) hits.delete(k);
  }, 60_000).unref();
  return (key) => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < 60_000);
    recent.push(now);
    hits.set(key, recent);
    return recent.length > perMinute;
  };
}

export function createApp({ store, auth, anthropic, config }) {
  const chatLimited = makeLimiter(config.rateLimitPerMin);
  const loginLimited = makeLimiter(10);

  const clientIp = (req) =>
    (config.trustProxy && req.headers["x-forwarded-for"]?.split(",")[0].trim()) || req.socket.remoteAddress;

  const ownOrigin = (req) => {
    const proto = (config.trustProxy && req.headers["x-forwarded-proto"]?.split(",")[0]) || (req.socket.encrypted ? "https" : "http");
    return `${proto}://${req.headers.host}`;
  };

  function json(res, status, obj, headers = {}) {
    res.writeHead(status, { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(obj));
  }

  function readJson(req, limit = 400_000) {
    return new Promise((resolve, reject) => {
      let data = "";
      req.setEncoding("utf8");
      req.on("data", (c) => {
        data += c;
        if (data.length > limit) {
          reject(Object.assign(new Error("Request too large."), { status: 413 }));
          req.destroy();
        }
      });
      req.on("end", () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          reject(Object.assign(new Error("Invalid JSON."), { status: 400 }));
        }
      });
      req.on("error", reject);
    });
  }

  // Which sites may use a bot: its allow-list, plus this server itself (for the preview page).
  function corsFor(req, bot) {
    const origin = req.headers.origin;
    if (!origin) return { ok: true, headers: {} };
    const list = bot.allowedOrigins || [];
    const allowed = !list.length || list.includes("*") || list.includes(origin) || origin === ownOrigin(req);
    if (!allowed) return { ok: false, headers: {} };
    return { ok: true, headers: { "Access-Control-Allow-Origin": origin, Vary: "Origin" } };
  }

  async function handleChat(req, res, bot, cors) {
    if (chatLimited(clientIp(req))) return json(res, 429, { error: "Too many messages. Please wait a minute." }, cors);
    const body = await readJson(req);
    const messages = sanitizeMessages(body.messages);
    if (!messages) return json(res, 400, { error: "No message to answer." }, cors);
    const convId = typeof body.conversationId === "string" && /^[\w-]{8,64}$/.test(body.conversationId) ? body.conversationId : null;
    const page = typeof body.page === "string" ? body.page.slice(0, 300) : "";

    res.writeHead(200, { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    let reply = "";
    try {
      const stream = anthropic.beta.messages.stream({
        model: bot.model || config.defaultModel,
        max_tokens: config.maxTokens,
        system: buildSystemPrompt(bot),
        messages,
        output_config: { effort: bot.effort || config.defaultEffort },
        // If the model declines a request, the API retries it on a suitable fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      // Stop generating (and paying for) tokens if the visitor leaves mid-reply.
      res.on("close", () => {
        if (!res.writableEnded) stream.abort();
      });
      stream.on("text", (delta) => {
        reply += delta;
        send("delta", { text: delta });
      });
      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") {
        const sorry = "\n\nSorry, I can't help with that one.";
        reply += sorry;
        send("delta", { text: sorry });
      }
      send("done", { stop_reason: final.stop_reason });
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError) return;
      console.error(`[bot ${bot.id}] Claude API error:`, err?.status, err?.message);
      let msg = "Sorry, something went wrong. Please try again.";
      if (err instanceof Anthropic.RateLimitError) msg = "The assistant is busy right now. Please try again shortly.";
      else if (err instanceof Anthropic.AuthenticationError) msg = "The assistant isn't set up correctly yet.";
      send("error", { error: msg });
    }
    res.end();

    if (config.saveConversations && convId && reply) {
      try {
        store.saveConversation(bot.id, convId, [...messages, { role: "assistant", content: reply }], { page }, config.maxConversationsPerBot);
      } catch (e) {
        console.error("Could not save conversation:", e.message);
      }
    }
  }

  async function handleAdmin(req, res, parts) {
    // parts: ["api","admin", ...]
    const [, , section, id, sub, subId] = parts;
    const m = req.method;

    if (section === "login" && m === "POST") {
      if (!auth.enabled) return json(res, 503, { error: "Set the ADMIN_PASSWORD environment variable to enable the admin page." });
      if (loginLimited(clientIp(req))) return json(res, 429, { error: "Too many attempts. Wait a minute." });
      const { password } = await readJson(req, 10_000);
      if (!auth.checkPassword(password || "")) return json(res, 401, { error: "Wrong password." });
      return json(res, 200, { ok: true }, { "Set-Cookie": auth.makeCookie() });
    }
    if (section === "logout" && m === "POST") return json(res, 200, { ok: true }, { "Set-Cookie": auth.clearCookie() });
    if (section === "me" && m === "GET") {
      return json(res, 200, { loggedIn: auth.isLoggedIn(req), adminEnabled: auth.enabled });
    }

    if (!auth.isLoggedIn(req)) return json(res, 401, { error: "Please log in." });
    // Simple CSRF guard on top of SameSite cookies: writes must be JSON.
    if (m !== "GET" && !(req.headers["content-type"] || "").includes("application/json")) {
      return json(res, 415, { error: "Use JSON." });
    }

    if (section === "meta" && m === "GET") {
      return json(res, 200, {
        models: MODELS,
        defaultModel: config.defaultModel,
        defaultEffort: config.defaultEffort,
        apiKeySet: Boolean(process.env.ANTHROPIC_API_KEY),
        saveConversations: config.saveConversations,
      });
    }

    if (section !== "bots") return json(res, 404, { error: "Not found." });

    if (!id) {
      if (m === "GET") return json(res, 200, { bots: store.listBots().map((b) => ({ ...b, stats: store.stats(b.id) })) });
      if (m === "POST") {
        const r = store.createBot(await readJson(req));
        return r.error ? json(res, 400, { error: r.error }) : json(res, 201, { bot: r.bot });
      }
      return json(res, 405, { error: "Method not allowed." });
    }

    const bot = store.getBot(id);
    if (!bot) return json(res, 404, { error: "Bot not found." });

    if (!sub) {
      if (m === "GET") return json(res, 200, { bot: { ...bot, stats: store.stats(id) } });
      if (m === "PUT") {
        const r = store.updateBot(id, await readJson(req));
        return r.error ? json(res, r.status || 400, { error: r.error }) : json(res, 200, { bot: r.bot });
      }
      if (m === "DELETE") {
        store.deleteBot(id);
        return json(res, 200, { ok: true });
      }
      return json(res, 405, { error: "Method not allowed." });
    }

    if (sub === "conversations" && m === "GET") {
      if (!subId) return json(res, 200, { conversations: store.listConversations(id) });
      const conv = store.getConversation(id, subId);
      return conv ? json(res, 200, { conversation: conv }) : json(res, 404, { error: "Conversation not found." });
    }
    return json(res, 404, { error: "Not found." });
  }

  async function route(req, res) {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    const parts = p.split("/").filter(Boolean);

    // Security headers for every response
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

    if (p === "/health") return json(res, 200, { ok: true });
    if (p === "/") {
      res.writeHead(302, { Location: "/admin" });
      return res.end();
    }

    // ---- Public widget API: /api/bots/:id/config and /api/bots/:id/chat ----
    if (parts[0] === "api" && parts[1] === "bots" && parts[2]) {
      const bot = store.getBot(parts[2]);
      if (!bot || !bot.enabled) return json(res, 404, { error: "This chatbot is not available." }, { "Access-Control-Allow-Origin": "*" });
      const cors = corsFor(req, bot);
      if (!cors.ok) return json(res, 403, { error: "This website is not allowed to use this chatbot." });
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          ...cors.headers,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        });
        return res.end();
      }
      if (parts[3] === "config" && req.method === "GET") return json(res, 200, publicConfig(bot), cors.headers);
      if (parts[3] === "chat" && req.method === "POST") return handleChat(req, res, bot, cors.headers);
      return json(res, 404, { error: "Not found." }, cors.headers);
    }

    if (parts[0] === "api" && parts[1] === "admin") {
      // Admin pages are never framed by other sites.
      res.setHeader("X-Frame-Options", "DENY");
      return handleAdmin(req, res, parts);
    }

    const file = FILES[p];
    if (file && req.method === "GET") {
      const headers = { "Content-Type": file[1], "Cache-Control": file[2] ? "public, max-age=300" : "no-cache" };
      if (file[2]) headers["Access-Control-Allow-Origin"] = "*";
      else headers["X-Frame-Options"] = "SAMEORIGIN";
      res.writeHead(200, headers);
      return fs.createReadStream(path.join(ROOT, file[0])).pipe(res);
    }
    json(res, 404, { error: "Not found." });
  }

  return async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      if (!res.headersSent) json(res, err.status || 500, { error: err.status ? err.message : "Server error." });
      else res.end();
      if (!err.status) console.error(err);
    }
  };
}
