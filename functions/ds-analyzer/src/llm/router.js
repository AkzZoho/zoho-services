/**
 * LLM Router — picks the best provider per task, with graceful fallback.
 *
 * Task types:
 *   - "extractChanges"  : structured JSON diff → prefers OpenAI (JSON mode)
 *   - "longDoc"         : long requirement doc → prefers Anthropic
 *   - "pmRewrite"       : short PM-friendly rewrite → prefers Zoho Zia
 *   - "any"             : general — first available from LLM_PREFERENCE
 *
 * Configure via env: OPENAI_API_KEY, ANTHROPIC_API_KEY, ZOHO_CATALYST_AI_TOKEN,
 * LLM_PREFERENCE (csv order).
 */
const openai = require('./providers/openai');
const anthropic = require('./providers/anthropic');
const zoho = require('./providers/zoho');
const stub = require('./providers/stub');

const PROVIDERS = { openai, anthropic, zoho, stub };

function getPreferenceOrder() {
  const raw = process.env.LLM_PREFERENCE || 'openai,anthropic,zoho,stub';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => PROVIDERS[s]);
}

function pickForTask(task) {
  const order = getPreferenceOrder();
  const taskPreference = {
    extractChanges: ['openai', 'anthropic', 'zoho', 'stub'],
    longDoc: ['anthropic', 'openai', 'zoho', 'stub'],
    pmRewrite: ['zoho', 'openai', 'anthropic', 'stub'],
    any: order,
  };
  const list = taskPreference[task] || order;
  // Filter by availability (provider says if it's configured).
  return list
    .map((k) => ({ key: k, provider: PROVIDERS[k] }))
    .filter(({ provider }) => provider && provider.isAvailable());
}

/**
 * Run a task through the best available provider, falling back on error.
 *
 * @param {string} task   e.g. "extractChanges"
 * @param {object} payload { system, user, schema? }
 * @returns {Promise<{ provider: string, data: any }>}
 */
async function run(task, payload) {
  const candidates = pickForTask(task);
  if (candidates.length === 0) {
    // Final safety net: stub is always available.
    return { provider: 'stub', data: await stub.run(task, payload) };
  }

  let lastErr;
  for (const { key, provider } of candidates) {
    try {
      const data = await provider.run(task, payload);
      return { provider: key, data };
    } catch (err) {
      lastErr = err;
      console.warn(`[llm-router] ${key} failed: ${err.message} — trying next`);
    }
  }
  throw lastErr || new Error('No LLM provider succeeded');
}

module.exports = { run, _internal: { pickForTask, getPreferenceOrder } };
