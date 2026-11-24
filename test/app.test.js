// Run with: npm test   (uses Node's built-in test runner, no API key needed)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store, cleanBotInput } from "../server/store.js";
import { createAuth } from "../server/auth.js";
import { createApp, sanitizeMessages, buildSystemPrompt } from "../server/app.js";

// A stand-in for the Claude client that "streams" a fixed reply and records requests.
const calls = [];
const fakeAnthropic = {
  beta: {
    messages: {
      stream(params) {
        calls.push(params);
        const handlers = [];
        return {
          on(ev, fn) { if (ev === "text") handlers.push(fn); return this; },
          abort() {},
          async finalMessage() {
            for (const part of ["Hello ", "there!"]) handlers.forEach((fn) => fn(part));
            return { stop_reason: "end_turn" };
          },
        };
      },
    },
  },
};

let server, base, dir, store;
const config = {
  rateLimitPerMin: 100, defaultModel: "claude-opus-5-5", defaultEffort: "low", maxTokens: 512,
  saveConversations: true, maxConversationsPerBot: 3, trustProxy: false,
};

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "chatbot-test-"));
  store = new Store(dir);
  const auth = createAuth({ adminPassword: "secret-pw", sessionSecret: "s", isProduction: false });
  server = http.createServer(createApp({ store, auth, anthropic: fakeAnthropic, config }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function login() {
  const r = await fetch(base + "/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "secret-pw" }) });
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie").split(";")[0];
}
const jsonReq = (cookie, method, body) => ({ method, headers: { "Content-Type": "application/json", Cookie: cookie }, body: body && JSON.stringify(body) });

test("sanitizeMessages drops bad entries and requires a final user turn", () => {
  assert.equal(sanitizeMessages("nope"), null);
  assert.equal(sanitizeMessages([{ role: "assistant", content: "hi" }]), null);
  const out = sanitizeMessages([{ role: "assistant", content: "welcome" }, { role: "system", content: "x" }, { role: "user", content: "hi" }]);
  assert.deepEqual(out, [{ role: "user", content: "hi" }]);
});

test("cleanBotInput validates colors, websites and models", () => {
  assert.ok(cleanBotInput({ name: "A", primaryColor: "red" }).error);
  assert.ok(cleanBotInput({ name: "A", allowedOrigins: ["not a url"] }).error);
  assert.ok(cleanBotInput({ name: "A", model: "gpt-4" }).error);
  assert.deepEqual(cleanBotInput({ name: "A", allowedOrigins: ["https://shop.com/", "https://shop.com"] }).bot.allowedOrigins, ["https://shop.com"]);
});

test("system prompt includes knowledge only when set", () => {
  assert.ok(!buildSystemPrompt({ name: "A", knowledge: "" }).includes("<reference>"));
  assert.ok(buildSystemPrompt({ name: "A", knowledge: "We open at 9" }).includes("We open at 9"));
});

test("admin API needs login", async () => {
  assert.equal((await fetch(base + "/api/admin/bots")).status, 401);
  const bad = await fetch(base + "/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"password":"wrong"}' });
  assert.equal(bad.status, 401);
});

test("full flow: create bot, public config, chat, conversation saved", async () => {
  const cookie = await login();
  let r = await fetch(base + "/api/admin/bots", jsonReq(cookie, "POST", { name: "Shop Bot" }));
  assert.equal(r.status, 201);
  const { bot } = await r.json();
  r = await fetch(base + `/api/admin/bots/${bot.id}`, jsonReq(cookie, "PUT", { knowledge: "Secret pricing notes", primaryColor: "#ff0000", allowedOrigins: ["https://shop.example"] }));
  assert.equal(r.status, 200);

  // Public config never leaks knowledge or instructions
  r = await fetch(base + `/api/bots/${bot.id}/config`, { headers: { Origin: "https://shop.example" } });
  const pub = await r.json();
  assert.equal(pub.primaryColor, "#ff0000");
  assert.equal(pub.knowledge, undefined);
  assert.equal(pub.systemPrompt, undefined);
  assert.equal(r.headers.get("access-control-allow-origin"), "https://shop.example");

  // Other sites are blocked
  r = await fetch(base + `/api/bots/${bot.id}/config`, { headers: { Origin: "https://evil.example" } });
  assert.equal(r.status, 403);

  // Chat streams the reply
  r = await fetch(base + `/api/bots/${bot.id}/chat`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://shop.example" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }], conversationId: "conv-12345678", page: "https://shop.example/p" }),
  });
  const text = await r.text();
  assert.match(text, /event: delta\ndata: {"text":"Hello "}/);
  assert.match(text, /event: done/);
  const sent = calls.at(-1);
  assert.equal(sent.model, "claude-opus-5-5");
  assert.equal(sent.fallbacks, "default");
  assert.ok(sent.system.includes("Secret pricing notes"));

  // Conversation is saved and visible to the admin
  r = await fetch(base + `/api/admin/bots/${bot.id}/conversations`, { headers: { Cookie: cookie } });
  const { conversations } = await r.json();
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].messageCount, 2);
  r = await fetch(base + `/api/admin/bots/${bot.id}/conversations/conv-12345678`, { headers: { Cookie: cookie } });
  assert.equal((await r.json()).conversation.messages[1].content, "Hello there!");

  // Turning the bot off hides it
  await fetch(base + `/api/admin/bots/${bot.id}`, jsonReq(cookie, "PUT", { enabled: false }));
  assert.equal((await fetch(base + `/api/bots/${bot.id}/config`)).status, 404);

  // Deleting removes it
  assert.equal((await fetch(base + `/api/admin/bots/${bot.id}`, jsonReq(cookie, "DELETE", {}))).status, 200);
  assert.equal((await fetch(base + `/api/admin/bots/${bot.id}`, { headers: { Cookie: cookie } })).status, 404);
});

test("old conversations are trimmed to the per-bot limit", () => {
  const { bot } = store.createBot({ name: "Trim" });
  for (let i = 0; i < 5; i++) store.saveConversation(bot.id, "c" + i, [{ role: "user", content: "x" }], {}, 3);
  assert.equal(store.listConversations(bot.id).length, 3);
});

test("bots survive a restart", () => {
  const { bot } = store.createBot({ name: "Persist" });
  const again = new Store(dir);
  assert.equal(again.getBot(bot.id).name, "Persist");
});

test("forged admin cookie is rejected", async () => {
  const r = await fetch(base + "/api/admin/bots", { headers: { Cookie: "cb_admin=admin.9999999999.forged" } });
  assert.equal(r.status, 401);
});
