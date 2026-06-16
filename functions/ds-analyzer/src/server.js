/**
 * Server entrypoint — boots the Express app on $PORT (default 3001).
 *
 * Env-file loading order (later files do NOT override earlier ones, per
 * dotenv defaults):
 *   1. functions/ds-analyzer/.env   — function-local secrets (LLM keys etc.)
 *   2. <repo-root>/.env             — repo-wide defaults
 *
 * The function-local file wins because it is loaded first.
 *
 * Hosting:
 *   This is a plain Node + Express server. It runs anywhere Node 18+ runs —
 *   `node src/server.js`, Render, Railway, Fly.io, Vercel (as a Node function),
 *   a VPS, Docker, etc. No platform SDK required.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const app = require('./app');
const llmRouter = require('./shared/llm/router');

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 DS Analyzer API listening on http://localhost:${PORT}`);
  console.log(`   LLM preference: ${process.env.LLM_PREFERENCE || 'openai,anthropic,stub'}`);

  // Show which providers are actually usable right now, so the operator can
  // see at a glance whether they are in "OpenAI mode", "no-AI (stub) mode",
  // or something else.
  const available = llmRouter._internal
    .pickForTask('any')
    .map((c) => c.key);
  if (available.length === 0 || (available.length === 1 && available[0] === 'stub')) {
    console.log('   Active LLM mode: 🛈 NO-AI (stub) — no provider keys configured. Endpoints will return deterministic placeholder data.');
  } else {
    console.log(`   Active LLM providers: ${available.join(', ')}`);
  }
});
