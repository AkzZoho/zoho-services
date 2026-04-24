let OpenAI;
try {
  OpenAI = require('openai');
} catch {
  OpenAI = null;
}

function isAvailable() {
  return Boolean(OpenAI && process.env.OPENAI_API_KEY);
}

async function run(task, { system, user }) {
  if (!isAvailable()) throw new Error('OpenAI not configured');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const wantsJson = task === 'extractChanges';

  const resp = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    response_format: wantsJson ? { type: 'json_object' } : undefined,
  });

  const content = resp.choices?.[0]?.message?.content || '';
  return wantsJson ? JSON.parse(content) : content;
}

module.exports = { isAvailable, run };
