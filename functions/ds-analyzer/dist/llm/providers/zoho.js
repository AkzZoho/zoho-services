/**
 * Zoho Catalyst AI / Zia provider.
 *
 * NOTE: Catalyst's AI endpoints vary per org (ZiaLabs, Catalyst AI, Smart Browse, etc.).
 * We leave the exact endpoint configurable via env until you confirm which one you have.
 *
 * Required env:
 *   ZOHO_CATALYST_AI_TOKEN  — bearer / oauth token
 *   ZOHO_CATALYST_AI_URL    — full POST endpoint (defaults to a placeholder)
 */
const axios = require('axios');

function isAvailable() {
  return Boolean(process.env.ZOHO_CATALYST_AI_TOKEN && process.env.ZOHO_CATALYST_AI_URL);
}

async function run(task, { system, user }) {
  if (!isAvailable()) throw new Error('Zoho Catalyst AI not configured');

  const url = process.env.ZOHO_CATALYST_AI_URL;
  const token = process.env.ZOHO_CATALYST_AI_TOKEN;

  const resp = await axios.post(
    url,
    {
      // Generic shape — adjust once Catalyst AI API contract is confirmed.
      system,
      prompt: user,
      task,
      temperature: 0.2,
    },
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    }
  );

  const text = resp.data?.response || resp.data?.text || resp.data?.output || '';
  if (task === 'extractChanges') {
    const cleaned = String(text).replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    return JSON.parse(cleaned);
  }
  return text;
}

module.exports = { isAvailable, run };
