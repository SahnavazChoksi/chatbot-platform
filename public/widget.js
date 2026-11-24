/*!
 * Drop-in chatbot widget. No dependencies.
 *
 * Usage (get the snippet for each bot from the admin page):
 *   <script src="https://YOUR-SERVER/widget.js" data-bot-id="bot_xxxxx" defer></script>
 *
 * Optional overrides, either as data-* attributes on the script tag
 * (data-primary-color="#e11d48", data-open-on-load="true") or in a config object:
 *   <script>window.ChatbotConfig = { botId: "bot_xxxxx", openOnLoad: true };</script>
 * Settings saved in the admin page are loaded from the server; overrides win.
 */
(function () {
  "use strict";
  if (window.__chatbotWidgetLoaded) return;
  window.__chatbotWidgetLoaded = true;

  var script = document.currentScript || document.querySelector('script[src*="widget.js"]');
  var scriptOrigin = "";
  try { scriptOrigin = new URL(script.src, location.href).origin; } catch (e) {}

  // ---- Config: server settings < data-* attributes < window.ChatbotConfig ----
  var defaults = {
    serverUrl: scriptOrigin,
    botId: "",
    name: "Assistant",
    subtitle: "Typically replies instantly",
    welcomeMessage: "Hi! 👋 How can I help you today?",
    placeholder: "Type your message…",
    primaryColor: "#4f46e5",
    textOnPrimary: "#ffffff",
    position: "right", // "right" or "left"
    openOnLoad: false,
    suggestions: [], // quick-reply buttons shown under the welcome message
    persist: true, // keep the conversation while the visitor browses (sessionStorage)
    zIndex: 2147483000,
  };
  var overrides = {};
  if (script && script.dataset) {
    Object.keys(script.dataset).forEach(function (k) {
      var v = script.dataset[k];
      if (v === "true") v = true;
      else if (v === "false") v = false;
      else if (k === "suggestions") v = v.split("|");
      overrides[k] = v;
    });
  }
  Object.assign(overrides, window.ChatbotConfig || {});
  var cfg = Object.assign({}, defaults, overrides);
  if (!cfg.botId) { console.error("[chatbot] Missing data-bot-id on the widget script tag."); return; }
  var base = String(cfg.serverUrl).replace(/\/+$/, "") + "/api/bots/" + encodeURIComponent(cfg.botId);
  cfg.apiUrl = base + "/chat";
  var STORE_KEY = "chatbot-widget:" + cfg.botId;

  // ---- State ----
  var messages = []; // {role, content}
  var conversationId = "";
  var busy = false;
  function newConvId() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
  }
  function load() {
    if (!cfg.persist) return;
    try {
      var saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || "{}");
      messages = Array.isArray(saved.messages) ? saved.messages : [];
      conversationId = saved.conversationId || "";
    } catch (e) { messages = []; }
  }
  function save() {
    if (!cfg.persist) return;
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify({ conversationId: conversationId, messages: messages.slice(-30) })); } catch (e) {}
  }
  load();
  if (!conversationId) conversationId = newConvId();

  // ---- DOM (inside a shadow root so the host site's CSS can't break it) ----
  var host = document.createElement("div");
  host.id = "chatbot-widget-host";
  host.style.cssText = "position:fixed;bottom:0;right:0;z-index:" + cfg.zIndex + ";";
  var root = host.attachShadow({ mode: "open" });

  root.innerHTML =
    "<style>" +
    ":host{all:initial}" +
    "*{box-sizing:border-box;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}" +
    ".launcher{position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;border:0;cursor:pointer;" +
    "background:var(--p);color:var(--tp);box-shadow:0 6px 24px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;transition:transform .15s}" +
    ".launcher:hover{transform:scale(1.06)}.launcher svg{width:28px;height:28px}" +
    ".panel{position:fixed;bottom:92px;right:20px;width:370px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 120px);" +
    "background:#fff;color:#111;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.22);display:flex;flex-direction:column;overflow:hidden;" +
    "opacity:0;transform:translateY(12px);pointer-events:none;transition:opacity .18s,transform .18s}" +
    ".panel.open{opacity:1;transform:none;pointer-events:auto}" +
    ".head{background:var(--p);color:var(--tp);padding:14px 16px;display:flex;align-items:center;gap:10px}" +
    ".avatar{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;font-weight:600}" +
    ".title{flex:1;min-width:0}.title b{display:block;font-size:15px}.title span{font-size:12px;opacity:.85}" +
    ".icon-btn{background:transparent;border:0;color:inherit;cursor:pointer;padding:6px;border-radius:8px;opacity:.85}.icon-btn:hover{opacity:1;background:rgba(255,255,255,.15)}" +
    ".icon-btn svg{width:18px;height:18px;display:block}" +
    ".body{flex:1;overflow-y:auto;padding:16px;background:#f7f7f9;display:flex;flex-direction:column;gap:10px}" +
    ".msg{max-width:85%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.45;word-wrap:break-word;white-space:normal}" +
    ".bot{background:#fff;border:1px solid #e6e6ea;align-self:flex-start;border-bottom-left-radius:4px}" +
    ".user{background:var(--p);color:var(--tp);align-self:flex-end;border-bottom-right-radius:4px;white-space:pre-wrap}" +
    ".err{background:#fdecec;color:#9b1c1c;border:1px solid #f5c2c2;align-self:flex-start}" +
    ".msg p{margin:0 0 6px}.msg p:last-child{margin:0}.msg ul,.msg ol{margin:4px 0;padding-left:20px}" +
    ".msg code{background:#f0f0f3;padding:1px 4px;border-radius:4px;font-family:ui-monospace,monospace;font-size:13px}" +
    ".msg a{color:var(--p)}.user a{color:inherit}" +
    ".chips{display:flex;flex-wrap:wrap;gap:6px}" +
    ".chip{border:1px solid var(--p);color:var(--p);background:#fff;border-radius:999px;padding:6px 11px;font-size:13px;cursor:pointer}" +
    ".chip:hover{background:var(--p);color:var(--tp)}" +
    ".typing{display:inline-flex;gap:4px}.typing i{width:6px;height:6px;border-radius:50%;background:#999;animation:b 1s infinite}" +
    ".typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}" +
    "@keyframes b{0%,60%,100%{opacity:.3;transform:none}30%{opacity:1;transform:translateY(-3px)}}" +
    ".foot{display:flex;gap:8px;padding:10px;border-top:1px solid #eee;background:#fff}" +
    "textarea{flex:1;resize:none;border:1px solid #ddd;border-radius:10px;padding:9px 11px;font-size:14px;max-height:110px;outline:none;color:#111;background:#fff}" +
    "textarea:focus{border-color:var(--p)}" +
    ".send{border:0;border-radius:10px;background:var(--p);color:var(--tp);width:42px;cursor:pointer}.send:disabled{opacity:.5;cursor:default}" +
    ".send svg{width:18px;height:18px}" +
    ":host(.left) .launcher,:host(.left) .panel{right:auto;left:20px}" +
    "@media (max-width:480px){.panel,:host(.left) .panel{bottom:0;left:0;right:0;width:100vw;max-width:100vw;height:100%;max-height:100%;border-radius:0}.panel.open~.launcher{display:none}}" +
    "</style>" +
    '<div class="panel" role="dialog" aria-label="Chat">' +
    '<div class="head"><div class="avatar"></div><div class="title"><b></b><span></span></div>' +
    '<button class="icon-btn reset" title="New conversation" aria-label="New conversation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg></button>' +
    '<button class="icon-btn close" title="Close" aria-label="Close chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>' +
    '<div class="body" aria-live="polite"></div>' +
    '<form class="foot"><textarea rows="1"></textarea>' +
    '<button class="send" type="submit" aria-label="Send"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 21 23 12 2 3v7l15 2-15 2z"/></svg></button></form>' +
    "</div>" +
    '<button class="launcher" aria-label="Open chat"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C6.5 3 2 6.9 2 11.7c0 2.4 1.1 4.6 3 6.2L4 22l4.6-2.3c1.1.3 2.2.5 3.4.5 5.5 0 10-3.9 10-8.7S17.5 3 12 3z"/></svg></button>';

  var $ = function (s) { return root.querySelector(s); };
  var panel = $(".panel"), body = $(".body"), form = $(".foot"), input = $("textarea"), sendBtn = $(".send");
  function applySettings() {
    host.style.setProperty("--p", cfg.primaryColor);
    host.style.setProperty("--tp", cfg.textOnPrimary);
    host.style.left = cfg.position === "left" ? "0" : "";
    host.style.right = cfg.position === "left" ? "" : "0";
    root.host.classList.toggle("left", cfg.position === "left");
    $(".title b").textContent = cfg.name;
    $(".title span").textContent = cfg.subtitle;
    $(".avatar").textContent = (cfg.name || "?").charAt(0).toUpperCase();
    input.placeholder = cfg.placeholder;
  }

  // ---- Minimal, safe Markdown (escape first, then format) ----
  function esc(s) {
    return s.replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  }
  function md(text) {
    var lines = esc(text).split("\n"), out = [], list = null, para = [];
    function flushPara() { if (para.length) { out.push("<p>" + para.map(inline).join("<br>") + "</p>"); para = []; } }
    function flushList() { if (list) { out.push("<" + list.t + ">" + list.items.map(function (i) { return "<li>" + inline(i) + "</li>"; }).join("") + "</" + list.t + ">"); list = null; } }
    lines.forEach(function (l) {
      var ul = l.match(/^\s*[-*•]\s+(.*)/), ol = l.match(/^\s*\d+[.)]\s+(.*)/), h = l.match(/^#{1,6}\s+(.*)/);
      if (ul || ol) {
        flushPara();
        var t = ul ? "ul" : "ol";
        if (!list || list.t !== t) { flushList(); list = { t: t, items: [] }; }
        list.items.push((ul || ol)[1]);
      } else if (!l.trim()) { flushPara(); flushList(); }
      else { flushList(); para.push(h ? "**" + h[1] + "**" : l); }
    });
    flushPara(); flushList();
    return out.join("");
  }

  function scroll() { body.scrollTop = body.scrollHeight; }
  function bubble(role, text) {
    var el = document.createElement("div");
    el.className = "msg " + (role === "user" ? "user" : role === "error" ? "err" : "bot");
    if (role === "user" || role === "error") el.textContent = text;
    else el.innerHTML = md(text);
    body.appendChild(el);
    scroll();
    return el;
  }
  function render() {
    body.innerHTML = "";
    if (cfg.welcomeMessage) bubble("assistant", cfg.welcomeMessage);
    if (!messages.length && cfg.suggestions && cfg.suggestions.length) {
      var chips = document.createElement("div");
      chips.className = "chips";
      cfg.suggestions.forEach(function (s) {
        var c = document.createElement("button");
        c.className = "chip"; c.type = "button"; c.textContent = s;
        c.onclick = function () { chips.remove(); send(s); };
        chips.appendChild(c);
      });
      body.appendChild(chips);
    }
    messages.forEach(function (m) { bubble(m.role, m.content); });
  }

  function setBusy(b) { busy = b; sendBtn.disabled = b; }

  async function send(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    var chips = root.querySelector(".chips"); if (chips) chips.remove();
    messages.push({ role: "user", content: text });
    save();
    bubble("user", text);
    setBusy(true);

    var el = bubble("assistant", "");
    el.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    var reply = "";
    try {
      var res = await fetch(cfg.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: messages, conversationId: conversationId, page: location.href }),
      });
      if (!res.ok || !res.body) {
        var errMsg = "Sorry, I couldn't reach the assistant.";
        try { errMsg = (await res.json()).error || errMsg; } catch (e) {}
        throw new Error(errMsg);
      }
      var reader = res.body.getReader(), decoder = new TextDecoder(), buf = "";
      while (true) {
        var r = await reader.read();
        if (r.done) break;
        buf += decoder.decode(r.value, { stream: true });
        var parts = buf.split("\n\n");
        buf = parts.pop();
        parts.forEach(function (chunk) {
          var ev = (chunk.match(/^event: (.*)$/m) || [])[1];
          var dataLine = (chunk.match(/^data: (.*)$/m) || [])[1];
          if (!dataLine) return;
          var data = JSON.parse(dataLine);
          if (ev === "delta") { reply += data.text; el.innerHTML = md(reply); scroll(); }
          else if (ev === "error") throw new Error(data.error);
        });
      }
      if (!reply) throw new Error("Sorry, I didn't get a reply. Please try again.");
      messages.push({ role: "assistant", content: reply });
      save();
    } catch (err) {
      el.remove();
      if (reply) { messages.push({ role: "assistant", content: reply }); save(); bubble("assistant", reply); }
      else { messages.pop(); save(); }
      bubble("error", err.message || "Something went wrong.");
    } finally {
      setBusy(false);
      input.focus();
    }
  }

  function open() { panel.classList.add("open"); setTimeout(function () { input.focus(); }, 50); scroll(); }
  function close() { panel.classList.remove("open"); }
  function toggle() { panel.classList.contains("open") ? close() : open(); }

  $(".launcher").onclick = toggle;
  $(".close").onclick = close;
  function reset() { messages = []; conversationId = newConvId(); save(); render(); }
  $(".reset").onclick = reset;
  form.onsubmit = function (e) { e.preventDefault(); var t = input.value; input.value = ""; input.style.height = ""; send(t); };
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.onsubmit(e); }
  });
  input.addEventListener("input", function () { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 110) + "px"; });

  function mount() {
    // Load the bot's saved settings, then apply page overrides on top.
    fetch(base + "/config")
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (serverCfg) {
        cfg = Object.assign({}, defaults, serverCfg, overrides);
        cfg.apiUrl = base + "/chat";
        applySettings();
        document.body.appendChild(host);
        render();
        if (cfg.openOnLoad) open();
      })
      .catch(function (e) { console.error("[chatbot] Could not load bot " + cfg.botId + " (" + e.message + "). Check data-bot-id and that this website is allowed in the admin page."); });
  }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);

  // Small public API so the host page can control the widget.
  window.Chatbot = { open: open, close: close, toggle: toggle, send: function (t) { open(); send(t); }, reset: reset };
})();
