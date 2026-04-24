let Anthropic;
try {
  Anthropic = require('@anthropic-ai/sdk');
} catch {
  Anthropic = null;
}

function isAvailable() {
  return Boolean(Anthropic && process.env.ANTHROPIC_API_KEY);
}

async function run(task, { system, user }) {
  if (!isAvailable()) throw new Error('Anthropic not configured');
  const Client = Anthropic.default || Anthropic;
  const client = new Client({ apiKey: process.env.ANTHROPIC_API_KEY });

  const model = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20240620';

  const resp = await client.messages.create({
    model,
    max_tokens: 4096,
    temperature: 0.2,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const text = (resp.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  if (task === 'extractChanges') {
    // Claude sometimes wraps JSON in markdown fences — strip them.
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    return JSON.parse(cleaned);
  }
  return text;
}

module.exports = { isAvailable, run };
