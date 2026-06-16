let OpenAI;
try {
  OpenAI = require('openai');
} catch {
  OpenAI = null;
}

function isAvailable() {
  const key = (process.env.OPENAI_API_KEY || '').trim();
  return Boolean(OpenAI && key);
}

async function run(task, { system, user }) {
  if (!isAvailable()) throw new Error('OpenAI not configured');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  // Tasks that need strict JSON output.
  const wantsJson =
    task === 'extractChanges' ||
    task === 'extractScope' ||
    task === 'applyPrompt' ||
    task === 'suggestChanges';

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
