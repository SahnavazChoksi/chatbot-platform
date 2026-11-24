// Admin login: one password (ADMIN_PASSWORD) and a signed, HTTP-only session cookie.

import crypto from "node:crypto";

const COOKIE = "cb_admin";
const MAX_AGE_S = 7 * 24 * 3600;

export function createAuth({ adminPassword, sessionSecret, isProduction }) {
  // Without SESSION_SECRET, sessions last until the server restarts.
  const secret = sessionSecret || crypto.randomBytes(32).toString("hex");

  const sign = (payload) => crypto.createHmac("sha256", secret).update(payload).digest("base64url");

  function safeEqual(a, b) {
    const ha = crypto.createHash("sha256").update(String(a)).digest();
    const hb = crypto.createHash("sha256").update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
  }

  function checkPassword(pw) {
    return Boolean(adminPassword) && safeEqual(pw, adminPassword);
  }

  function makeCookie() {
    const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
    const payload = `admin.${exp}`;
    const value = `${payload}.${sign(payload)}`;
    return `${COOKIE}=${value}; HttpOnly; Path=/; Max-Age=${MAX_AGE_S}; SameSite=Strict${isProduction ? "; Secure" : ""}`;
  }

  function clearCookie() {
    return `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict`;
  }

  function isLoggedIn(req) {
    const raw = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(COOKIE + "="));
    if (!raw) return false;
    const value = raw.slice(COOKIE.length + 1);
    const i = value.lastIndexOf(".");
    if (i < 0) return false;
    const payload = value.slice(0, i);
    const sig = value.slice(i + 1);
    if (!safeEqual(sig, sign(payload))) return false;
    const exp = Number(payload.split(".")[1]);
    return Number.isFinite(exp) && exp > Date.now() / 1000;
  }

  return { checkPassword, makeCookie, clearCookie, isLoggedIn, enabled: Boolean(adminPassword) };
}
