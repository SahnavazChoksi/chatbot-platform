# Chatbot Platform

Create AI chatbots for any number of websites or businesses, and add each one to a site with a single line of HTML. Every bot has its own look, knowledge, instructions and list of allowed websites, all managed from a web admin page. Replies come from Claude.

```
 Any website                         Your server (this repo)                  Anthropic
┌───────────────────────┐  chat     ┌──────────────────────────────┐  API    ┌────────┐
│ <script widget.js     │ ────────▶ │ /api/bots/<id>/chat          │ ──────▶ │ Claude │
│   data-bot-id="…">    │ ◀──────── │ holds the API key, knowledge │ ◀────── │        │
└───────────────────────┘ streamed  │ and settings for every bot   │         └────────┘
                                    │                              │
 You (the owner)                    │ /admin  create & edit bots,  │
 ───────────────────────────────▶   │         read conversations   │
                                    └──────────────────────────────┘
```

## Features

**For website owners and their visitors**
- One script tag works on any site: plain HTML, WordPress, Shopify, Wix, Squarespace, Webflow, React, Next.js, Vue.
- Replies stream in word by word, with simple formatting (bold, lists, links).
- Quick-reply buttons, a welcome message, custom brand colors, left or right placement.
- Full screen on phones. Styling is isolated (Shadow DOM), so it can't clash with the host site.
- Remembers the conversation while the visitor moves between pages.
- A chat API for mobile apps or custom interfaces that don't want the widget.

**For you, in the admin page (`/admin`)**
- Create as many chatbots as you like, one per website or business.
- Edit each bot's name, colors, welcome message and quick replies. Changes appear on live sites without touching their code.
- Paste a bot's knowledge (FAQ, prices, hours, policies). It answers from that and says when it isn't sure.
- Optional custom instructions to set each bot's personality.
- Choose the AI model and effort per bot (Opus for best answers, Sonnet or Haiku to save money).
- Lock each bot to its own websites so nobody else can use it on your bill.
- Turn a bot off instantly without removing its code.
- Read every conversation, with the page it happened on.
- Copy-paste install code and instructions for popular site builders.
- A test page for each bot.

**Safety built in**
- The API key and each bot's knowledge stay on the server. The browser only ever sees public settings.
- Per-bot website allow-lists, a per-visitor message limit, message length limits and a login attempt limit.
- Admin password login with a signed, HTTP-only cookie.
- If Claude declines a request, the server automatically retries on a fallback model.

## Run it on your computer

You need **Node.js 20.6 or newer** and an **Anthropic API key** from https://console.anthropic.com.

```bash
npm install
cp .env.example .env
# Open .env and fill in ANTHROPIC_API_KEY and ADMIN_PASSWORD
npm run start:env
```

Then open **http://localhost:3000/admin**, log in with your admin password, and click **Create your first chatbot**. Use **Open test page** to try it.

## Add a bot to a website

In the admin page, open the bot and go to the **Install** tab. Copy the line it shows and paste it just before `</body>` on the site:

```html
<script src="https://YOUR-SERVER/widget.js" data-bot-id="bot_xxxxxxxxxxxx" defer></script>
```

Before going live, add the site's address (for example `https://www.myshop.com`) under **Websites & model → Allowed websites**.

### Optional: override settings on one page

Anything set in the admin page can be overridden per page with `data-*` attributes or a config object:

```html
<script>
  window.ChatbotConfig = { botId: "bot_xxxxxxxxxxxx", openOnLoad: true, primaryColor: "#e11d48" };
</script>
<script src="https://YOUR-SERVER/widget.js" defer></script>
```

| Option | What it does |
|---|---|
| `botId` / `data-bot-id` | Which bot to load (required) |
| `openOnLoad` | Open the chat as soon as the page loads |
| `name`, `subtitle`, `welcomeMessage`, `placeholder` | Text overrides |
| `primaryColor`, `textOnPrimary` | Colors |
| `position` | `"right"` or `"left"` |
| `suggestions` | Quick-reply buttons (in `data-suggestions`, separate with `\|`) |
| `persist` | `false` to forget the conversation on every page load |
| `serverUrl` | Server address, if `widget.js` is hosted somewhere else |

### Control the widget from your page

```js
Chatbot.open();
Chatbot.close();
Chatbot.send("I'd like to book a table");  // opens the chat and sends as the visitor
Chatbot.reset();                           // starts a new conversation
```

## Use it from an app (no widget)

```bash
curl -N -X POST https://YOUR-SERVER/api/bots/bot_xxxxxxxxxxxx/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Hello"}], "conversationId":"any-unique-id-123"}'
```

Send the whole conversation each time, oldest first. The reply streams back as Server-Sent Events: `delta` events with `{"text": "..."}`, then `done`, or `error` with `{"error": "..."}`. Include a `conversationId` (8 to 64 letters, numbers, `-` or `_`) for the chat to show up in the admin page.

| Endpoint | Purpose |
|---|---|
| `GET /api/bots/:id/config` | A bot's public settings |
| `POST /api/bots/:id/chat` | Send a message, get a streamed reply |
| `GET /health` | Uptime check |

## Put it online

The server is a plain Node.js app with no database to set up: bots and conversations are saved as JSON files in `DATA_DIR`. **That folder must be on a persistent disk**, or your bots disappear on each redeploy.

### Option 1: Render (easiest)
1. Push this repo to GitHub.
2. On https://render.com choose **New → Blueprint** and pick the repo. It reads `render.yaml`.
3. Enter `ANTHROPIC_API_KEY` and `ADMIN_PASSWORD` when asked. A persistent disk and `SESSION_SECRET` are set up for you.
4. Open `https://<your-app>.onrender.com/admin`.

### Option 2: Docker (any VPS, Railway, Fly.io, DigitalOcean)
```bash
cp .env.example .env   # fill it in
docker compose up -d --build
```
Data is kept in the `chatbot-data` volume. Put it behind HTTPS (Caddy, nginx, or your host's proxy) and set `TRUST_PROXY=true`.

### Option 3: Any Node host
Set the start command to `npm start`, add the environment variables below in the host's settings, and point `DATA_DIR` at a persistent disk.

Use HTTPS in production so the widget can load on HTTPS websites.

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | (required) | Your Anthropic API key |
| `ADMIN_PASSWORD` | (required) | Password for `/admin`. The admin page stays locked without it. |
| `SESSION_SECRET` | random per start | Signs admin logins. Set it so you stay logged in across restarts (`openssl rand -hex 32`). |
| `PORT` | `3000` | Port to listen on |
| `DATA_DIR` | `./data` | Where bots and conversations are saved |
| `DEFAULT_MODEL` | `claude-opus-5-5` | Model for bots that don't choose one. Also `claude-sonnet-5-5`, `claude-haiku-5-5`. |
| `DEFAULT_EFFORT` | `low` | Thinking effort for bots that don't choose one: `low`, `medium`, `high` |
| `MAX_TOKENS` | `2048` | Longest reply allowed |
| `RATE_LIMIT_PER_MIN` | `20` | Messages per minute per visitor |
| `TRUST_PROXY` | `false` | `true` when behind a proxy or load balancer, so visitor IPs are read correctly |
| `SAVE_CONVERSATIONS` | `true` | `false` to stop saving chats |
| `MAX_CONVERSATIONS_PER_BOT` | `1000` | Oldest chats are removed beyond this |
| `NODE_ENV` | | `production` makes the admin cookie HTTPS-only |

Never commit `.env` or your API key. `.gitignore` already excludes them.

## Development

```bash
npm run dev     # restarts on file changes
npm test        # runs the tests (no API key needed; Claude is faked)
```

GitHub Actions runs the tests on every push and pull request (`.github/workflows/ci.yml`).

### Project layout

```
server/
  index.js        starts the server
  app.js          all HTTP routes (widget API, admin API, static files)
  store.js        saves bots and conversations (JSON files)
  auth.js         admin login
  config.js       reads environment variables
public/
  widget.js       the embeddable chat widget (no dependencies)
  demo.html       per-bot test page (/demo?bot=<id>)
admin/            the admin page (index.html, admin.js, admin.css)
test/             automated tests
Dockerfile, docker-compose.yml, render.yaml   deployment
```

## Limits of this version, and ideas for next

- **One admin login.** Everyone with the password manages every bot. Separate logins per business (so each client edits only their own bot) would be the next step for a SaaS.
- **JSON file storage** suits one server with modest traffic. For many servers or heavy traffic, replace `server/store.js` with Postgres or SQLite; nothing else needs to change.
- **Rate limits are in memory**, so they reset on restart and aren't shared between servers.
- Not included yet: billing, usage analytics charts, handing a chat to a human, file or website crawling for knowledge, email notifications.

## License

MIT. See `LICENSE`.
