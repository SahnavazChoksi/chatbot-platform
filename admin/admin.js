// Admin page: create bots, edit their look, instructions and knowledge, get the embed code, read conversations.
(function () {
  "use strict";
  var app = document.getElementById("app");
  var state = { bots: [], meta: null, current: null, tab: "look", draft: null, dirty: false };

  // ---------- helpers ----------
  function h(tag, attrs) {
    var el = document.createElement(tag);
    var kids = Array.prototype.slice.call(arguments, 2);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") el.className = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else if (k === "checked") el.checked = v;
      else el.setAttribute(k, v === true ? "" : v);
    });
    kids.flat(Infinity).forEach(function (c) {
      if (c == null || c === false) return;
      el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return el;
  }
  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.status === 401 && url.indexOf("/login") < 0) { showLogin(); throw new Error("Please log in."); }
        if (!r.ok) throw new Error(data.error || "Request failed (" + r.status + ")");
        return data;
      });
    });
  }
  function fmtDate(s) { try { return new Date(s).toLocaleString(); } catch (e) { return s; } }
  function render(node) { app.innerHTML = ""; app.appendChild(node); }

  // ---------- login ----------
  function showLogin(adminEnabled) {
    var err = h("p", { class: "hint", style: "color:var(--danger)" });
    var pw = h("input", { type: "password", autocomplete: "current-password", placeholder: "Admin password" });
    var form = h("form", { class: "login", onsubmit: function (e) {
      e.preventDefault(); err.textContent = "";
      api("POST", "/api/admin/login", { password: pw.value }).then(start).catch(function (e) { err.textContent = e.message; });
    } },
      h("h1", null, "Chatbot admin"),
      h("p", { class: "hint" }, "Log in to manage your chatbots."),
      adminEnabled === false ? h("div", { class: "banner" }, "The admin page is locked. Set the ADMIN_PASSWORD environment variable on the server and restart it.") : null,
      h("label", null, "Password"), pw, h("button", { class: "primary", type: "submit" }, "Log in"), err);
    render(form);
    pw.focus();
  }

  // ---------- main ----------
  function start() {
    return Promise.all([api("GET", "/api/admin/meta"), api("GET", "/api/admin/bots")]).then(function (r) {
      state.meta = r[0]; state.bots = r[1].bots;
      var keep = state.current && state.bots.find(function (b) { return b.id === state.current; });
      state.current = keep ? keep.id : (state.bots[0] && state.bots[0].id) || null;
      state.draft = null;
      draw();
    });
  }

  function currentBot() { return state.bots.find(function (b) { return b.id === state.current; }); }

  function selectBot(id) {
    if (state.dirty && !confirm("You have unsaved changes. Leave without saving?")) return;
    state.current = id; state.draft = null; state.dirty = false; state.tab = "look"; state.conv = null;
    draw();
  }

  function newBot() {
    var name = prompt("Name for the new chatbot (for example, the business name):", "");
    if (!name || !name.trim()) return;
    api("POST", "/api/admin/bots", { name: name.trim() }).then(function (r) {
      state.current = r.bot.id; state.tab = "look";
      return start();
    }).catch(function (e) { alert(e.message); });
  }

  function draw() {
    var side = h("nav", { class: "side" },
      h("h2", null, "Chatbots"),
      state.bots.map(function (b) {
        return h("button", { class: "bot-link" + (b.id === state.current ? " active" : ""), onclick: function () { selectBot(b.id); } },
          h("span", { class: "dot", style: "background:" + b.primaryColor }, b.name.charAt(0).toUpperCase()),
          h("span", null, b.name, h("small", null, b.enabled ? b.stats.conversations + " conversations" : "Turned off")));
      }),
      h("button", { class: "primary", onclick: newBot, style: "margin-top:8px" }, "+ New chatbot"),
      h("div", { class: "spacer" }),
      h("button", { onclick: function () { api("POST", "/api/admin/logout", {}).then(function () { showLogin(); }); } }, "Log out"));

    var main = h("main", { class: "main" });
    if (state.meta && !state.meta.apiKeySet) {
      main.appendChild(h("div", { class: "banner" }, "ANTHROPIC_API_KEY is not set on the server, so bots can't reply yet. Add it to the server's environment variables and restart."));
    }
    var bot = currentBot();
    if (!bot) {
      main.appendChild(h("div", { class: "empty" },
        h("h2", null, "No chatbots yet"),
        h("p", null, "Create one for each website or business you want to add a chatbot to."),
        h("button", { class: "primary", onclick: newBot }, "+ Create your first chatbot")));
    } else {
      if (!state.draft) state.draft = JSON.parse(JSON.stringify(bot));
      main.appendChild(botView(bot));
    }
    render(h("div", { class: "layout" }, side, main));
  }

  // ---------- bot view ----------
  var TABS = [["look", "Look & feel"], ["brain", "Instructions & knowledge"], ["access", "Websites & model"], ["install", "Install"], ["convs", "Conversations"]];

  function botView(bot) {
    var d = state.draft;
    var wrap = h("div");
    wrap.appendChild(h("div", { class: "head" },
      h("button", { class: "menu-btn", onclick: function () { document.querySelector(".side").classList.toggle("open"); } }, "☰"),
      h("h1", { class: "grow" }, bot.name),
      h("a", { class: "btn", href: "/demo?bot=" + encodeURIComponent(bot.id), target: "_blank", rel: "noopener" }, "Open test page ↗")));
    wrap.appendChild(h("div", { class: "stats" },
      stat(bot.stats.conversations, "conversations"), stat(bot.stats.last24h, "active in last 24h"), stat(bot.stats.messages, "messages")));
    wrap.appendChild(h("div", { class: "tabs" }, TABS.map(function (t) {
      return h("button", { class: "tab" + (state.tab === t[0] ? " active" : ""), onclick: function () { state.tab = t[0]; state.conv = null; draw(); } }, t[1]);
    })));

    var body;
    if (state.tab === "look") body = lookTab(d);
    else if (state.tab === "brain") body = brainTab(d);
    else if (state.tab === "access") body = accessTab(d);
    else if (state.tab === "install") body = installTab(bot);
    else body = convTab(bot);
    wrap.appendChild(body);

    if (["look", "brain", "access"].indexOf(state.tab) >= 0) wrap.appendChild(saveBar(bot));
    return wrap;
  }

  function stat(n, label) { return h("div", { class: "stat" }, h("b", null, n), h("span", null, label)); }

  function bind(key, el, transform) {
    var ev = el.type === "checkbox" || el.tagName === "SELECT" || el.type === "color" ? "change" : "input";
    el.addEventListener(ev, function () {
      state.draft[key] = transform ? transform(el) : el.value;
      state.dirty = true;
      var s = document.querySelector(".status"); if (s) s.textContent = "Unsaved changes";
    });
    if (el.type === "color") el.addEventListener("input", function () { state.draft[key] = el.value; state.dirty = true; });
    return el;
  }
  function field(label, hint, el) { return [h("label", null, label), el, hint ? h("p", { class: "hint" }, hint) : null]; }

  function lookTab(d) {
    return h("div", null,
      h("div", { class: "card" },
        h("h3", null, "Header"),
        h("div", { class: "row" },
          h("div", null, field("Bot name", null, bind("name", h("input", { value: d.name, maxlength: 60 })))),
          h("div", null, field("Subtitle", null, bind("subtitle", h("input", { value: d.subtitle, maxlength: 100 })))))),
      h("div", { class: "card" },
        h("h3", null, "Messages"),
        field("Welcome message", "The first thing visitors see. Leave empty to hide.", bind("welcomeMessage", h("textarea", { value: d.welcomeMessage, rows: 2, maxlength: 500 }))),
        field("Quick-reply buttons", "One per line, up to 6. Visitors can tap these instead of typing.",
          bind("suggestions", h("textarea", { value: (d.suggestions || []).join("\n"), rows: 3 }), function (el) { return el.value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean); })),
        field("Input placeholder", null, bind("placeholder", h("input", { value: d.placeholder, maxlength: 100 })))),
      h("div", { class: "card" },
        h("h3", null, "Colors and position"),
        h("div", { class: "row" },
          h("div", null, field("Brand color", null, bind("primaryColor", h("input", { type: "color", value: d.primaryColor })))),
          h("div", null, field("Text on brand color", null, bind("textOnPrimary", h("input", { type: "color", value: d.textOnPrimary })))),
          h("div", null, field("Position", null, bind("position", h("select", null,
            h("option", { value: "right", selected: d.position === "right" }, "Bottom right"),
            h("option", { value: "left", selected: d.position === "left" }, "Bottom left"))))))));
  }

  function brainTab(d) {
    return h("div", null,
      h("div", { class: "card" },
        h("h3", null, "Knowledge"),
        h("p", { class: "hint" }, "Paste your FAQ, products, prices, opening hours, policies and contact details. The bot answers from this, and says it isn't sure when the answer isn't here."),
        bind("knowledge", h("textarea", { value: d.knowledge, rows: 14, placeholder: "## Shipping\nWe ship worldwide. Free over $50.\n\n## Returns\n30 days, full refund.", maxlength: 200000 })),
        h("p", { class: "hint" }, "Up to 200,000 characters.")),
      h("div", { class: "card" },
        h("h3", null, "Custom instructions (optional)"),
        h("p", { class: "hint" }, "Replaces the default personality. Example: \"You are Ava, the helpful assistant for Bean Coffee. Be warm and brief. Always suggest our loyalty card.\" Leave empty for a friendly default."),
        bind("systemPrompt", h("textarea", { value: d.systemPrompt, rows: 6, maxlength: 10000 }))));
  }

  function accessTab(d) {
    var models = (state.meta && state.meta.models) || [];
    var labels = { "claude-opus-5-5": "Claude Opus 5.5 (smartest)", "claude-sonnet-5-5": "Claude Sonnet 5.5 (balanced, cheaper)", "claude-haiku-5-5": "Claude Haiku 5.5 (fastest, cheapest)" };
    return h("div", null,
      h("div", { class: "card" },
        h("h3", null, "Allowed websites"),
        h("p", { class: "hint" }, "Only these sites can use this chatbot, so nobody else can run up your bill. One per line, like https://www.myshop.com. Leave empty to allow any site (fine while testing)."),
        (d.allowedOrigins || []).length ? null : h("div", { class: "banner" }, "Any website can use this chatbot right now. Add your site's address before going live."),
        bind("allowedOrigins", h("textarea", { value: (d.allowedOrigins || []).join("\n"), rows: 4, placeholder: "https://www.myshop.com\nhttps://myshop.com" }),
          function (el) { return el.value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean); })),
      h("div", { class: "card" },
        h("h3", null, "AI model"),
        h("div", { class: "row" },
          h("div", null, field("Model", null, bind("model", h("select", null,
            h("option", { value: "", selected: !d.model }, "Server default (" + (labels[state.meta.defaultModel] || state.meta.defaultModel) + ")"),
            models.map(function (m) { return h("option", { value: m, selected: d.model === m }, labels[m] || m); }))))),
          h("div", null, field("Thinking effort", "Low is fast and fine for most chat.", bind("effort", h("select", null,
            h("option", { value: "", selected: !d.effort }, "Server default (" + state.meta.defaultEffort + ")"),
            ["low", "medium", "high"].map(function (e) { return h("option", { value: e, selected: d.effort === e }, e); }))))))),
      h("div", { class: "card" },
        h("h3", null, "Status"),
        h("label", { style: "font-weight:400;display:flex;gap:8px;align-items:center" },
          bind("enabled", h("input", { type: "checkbox", checked: d.enabled }), function (el) { return el.checked; }),
          "Chatbot is on (turn off to hide it on every site without removing the code)")),
      h("div", { class: "card" },
        h("h3", null, "Delete chatbot"),
        h("p", { class: "hint" }, "Removes the bot and all its saved conversations. This can't be undone."),
        h("button", { class: "danger", style: "margin-top:10px", onclick: function () {
          var bot = currentBot();
          if (!confirm("Delete \"" + bot.name + "\" and all its conversations? This can't be undone.")) return;
          api("DELETE", "/api/admin/bots/" + bot.id, {}).then(function () { state.current = null; state.dirty = false; return start(); }).catch(function (e) { alert(e.message); });
        } }, "Delete this chatbot")));
  }

  function saveBar(bot) {
    var status = h("span", { class: "status" }, state.dirty ? "Unsaved changes" : "");
    var btn = h("button", { class: "primary", onclick: function () {
      btn.disabled = true; status.textContent = "Saving…";
      var d = state.draft;
      var payload = {};
      ["name", "subtitle", "welcomeMessage", "placeholder", "primaryColor", "textOnPrimary", "position", "suggestions", "systemPrompt", "knowledge", "allowedOrigins", "model", "effort", "enabled"]
        .forEach(function (k) { payload[k] = d[k]; });
      api("PUT", "/api/admin/bots/" + bot.id, payload).then(function () {
        state.dirty = false; return start();
      }).then(function () {
        var s = document.querySelector(".status"); if (s) s.textContent = "Saved ✓";
      }).catch(function (e) { btn.disabled = false; status.textContent = e.message; status.style.color = "var(--danger)"; });
    } }, "Save changes");
    var undo = h("button", { onclick: function () { state.draft = null; state.dirty = false; draw(); } }, "Discard");
    return h("div", { class: "actions" }, btn, undo, status);
  }

  function installTab(bot) {
    var origin = location.origin;
    var snippet = '<script src="' + origin + '/widget.js" data-bot-id="' + bot.id + '" defer></script>';
    function copyBtn(text) {
      var b = h("button", { onclick: function () {
        navigator.clipboard.writeText(text).then(function () { b.textContent = "Copied ✓"; setTimeout(function () { b.textContent = "Copy"; }, 1500); });
      } }, "Copy");
      return b;
    }
    var apiExample = "curl -N -X POST " + origin + "/api/bots/" + bot.id + "/chat \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}'";
    return h("div", null,
      h("div", { class: "card" },
        h("h3", null, "Add to any website"),
        h("p", { class: "hint" }, "Paste this just before </body> on every page where the chat bubble should appear. Changes you save here show up on the site automatically."),
        h("pre", { class: "code" }, snippet), copyBtn(snippet)),
      h("div", { class: "card" },
        h("h3", null, "Where to paste it"),
        h("ul", null,
          h("li", null, h("b", null, "WordPress: "), "Appearance → Theme File Editor → footer.php, or a plugin like \"WPCode\" (Footer section)."),
          h("li", null, h("b", null, "Shopify: "), "Online Store → Themes → Edit code → theme.liquid, before </body>."),
          h("li", null, h("b", null, "Wix / Squarespace / Webflow: "), "Settings → Custom code → Footer."),
          h("li", null, h("b", null, "React / Next.js / Vue: "), "add the script tag to your main HTML template, or load it once in your root component."))),
      h("div", { class: "card" },
        h("h3", null, "Use from an app (no widget)"),
        h("p", { class: "hint" }, "Mobile apps and custom UIs can call the chat API directly. The reply streams back as Server-Sent Events: delta events with text, then done."),
        h("pre", { class: "code" }, apiExample), copyBtn(apiExample)),
      allowedNote(bot));
  }
  function allowedNote(bot) {
    return (bot.allowedOrigins || []).length
      ? h("div", { class: "banner ok" }, "Allowed on: " + bot.allowedOrigins.join(", "))
      : h("div", { class: "banner" }, "Any website can use this chatbot. Add your site under \"Websites & model\" before going live.");
  }

  function convTab(bot) {
    var box = h("div", null, h("p", { class: "hint" }, "Loading…"));
    if (state.meta && !state.meta.saveConversations) {
      return h("div", { class: "banner" }, "Saving conversations is turned off on this server (SAVE_CONVERSATIONS=false).");
    }
    if (state.conv) {
      api("GET", "/api/admin/bots/" + bot.id + "/conversations/" + encodeURIComponent(state.conv)).then(function (r) {
        var c = r.conversation;
        box.innerHTML = "";
        box.appendChild(h("div", null,
          h("button", { onclick: function () { state.conv = null; draw(); }, style: "margin-bottom:12px" }, "← All conversations"),
          h("div", { class: "card" },
            h("p", { class: "hint" }, "Started " + fmtDate(c.startedAt) + (c.page ? " on " + c.page : "")),
            h("div", { class: "chat", style: "margin-top:10px" }, c.messages.map(function (m) { return h("div", { class: "bubble " + m.role }, m.content); })))));
      }).catch(function (e) { box.textContent = e.message; });
      return box;
    }
    api("GET", "/api/admin/bots/" + bot.id + "/conversations").then(function (r) {
      box.innerHTML = "";
      if (!r.conversations.length) { box.appendChild(h("div", { class: "empty" }, "No conversations yet. Try the test page to start one.")); return; }
      r.conversations.forEach(function (c) {
        box.appendChild(h("div", { class: "list-item", onclick: function () { state.conv = c.id; draw(); } },
          h("div", null, c.preview || "(empty)"),
          h("small", null, fmtDate(c.updatedAt) + " · " + c.messageCount + " messages" + (c.page ? " · " + c.page : ""))));
      });
    }).catch(function (e) { box.textContent = e.message; });
    return box;
  }

  window.addEventListener("beforeunload", function (e) { if (state.dirty) { e.preventDefault(); e.returnValue = ""; } });

  api("GET", "/api/admin/me").then(function (r) {
    if (r.loggedIn) return start();
    showLogin(r.adminEnabled);
  }).catch(function () { showLogin(); });
})();
