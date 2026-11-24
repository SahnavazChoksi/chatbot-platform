// All settings come from environment variables. Never hard-code secrets.
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, "..");

function num(name, def) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
}

export const config = {
  port: num("PORT", 3000),
  // Where bots and conversations are saved. Point this at a persistent disk in production.
  dataDir: process.env.DATA_DIR || path.join(ROOT, "data"),
  adminPassword: process.env.ADMIN_PASSWORD || "",
  // Used to sign admin login cookies. Set a long random value in production.
  sessionSecret: process.env.SESSION_SECRET || "",
  defaultModel: process.env.DEFAULT_MODEL || "claude-opus-5-5",
  defaultEffort: process.env.DEFAULT_EFFORT || "low",
  maxTokens: num("MAX_TOKENS", 2048),
  rateLimitPerMin: num("RATE_LIMIT_PER_MIN", 20),
  // Set to "true" when running behind a proxy/load balancer (Render, Railway, Fly, nginx)
  // so the visitor's real IP is used for rate limiting.
  trustProxy: process.env.TRUST_PROXY === "true",
  // Set to "false" to stop saving conversations.
  saveConversations: process.env.SAVE_CONVERSATIONS !== "false",
  maxConversationsPerBot: num("MAX_CONVERSATIONS_PER_BOT", 1000),
  isProduction: process.env.NODE_ENV === "production",
};

export const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
export const EFFORTS = ["low", "medium", "high"];
