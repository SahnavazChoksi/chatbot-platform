import http from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { Store } from "./store.js";
import { createAuth } from "./auth.js";
import { createApp } from "./app.js";

const store = new Store(config.dataDir);
const auth = createAuth(config);
const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

const server = http.createServer(createApp({ store, auth, anthropic, config }));
server.listen(config.port, () => {
  console.log(`Chatbot platform running on http://localhost:${config.port}`);
  console.log(`  Admin page: http://localhost:${config.port}/admin`);
  console.log(`  Data folder: ${config.dataDir}`);
  if (!process.env.ANTHROPIC_API_KEY) console.warn("  Warning: ANTHROPIC_API_KEY is not set, so bots can't reply.");
  if (!config.adminPassword) console.warn("  Warning: ADMIN_PASSWORD is not set, so the admin page is locked.");
  if (config.isProduction && !config.sessionSecret) console.warn("  Warning: set SESSION_SECRET so admin logins survive restarts.");
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
