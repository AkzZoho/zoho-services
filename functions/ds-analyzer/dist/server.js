/**
 * Local dev server. Catalyst uses src/index.js — this file is only for `npm run dev`.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });

const app = require('./app');

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 DS Analyzer API listening on http://localhost:${PORT}`);
  console.log(`   LLM preference: ${process.env.LLM_PREFERENCE || 'openai,anthropic,zoho,stub'}`);
});
