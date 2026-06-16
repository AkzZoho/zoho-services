/**
 * Regression tests for POST /api/suggest-changes.
 *
 * Originally captured a 413 (mis-reported as a 500) when uploading a large
 * .ds whose overview JSON exceeded the old 750 KB cap. The fix slims the
 * overview to only the keys the digest reader needs, then enforces a much
 * higher post-slim cap. These tests pin the behaviour.
 */
const request = require('supertest');
const app = require('../src/app');

function tinyOverview() {
  return {
    app: { name: 'Demo' },
    forms: [
      {
        name: 'Customers',
        displayName: 'Customers',
        fields: [
          { name: 'Email', type: 'EMAIL', required: true },
          { name: 'Phone', type: 'PHONE' },
        ],
      },
    ],
    reports: [],
    pages: [],
    workflows: [],
    customFunctions: [],
    roles: [],
    profiles: [],
  };
}

/**
 * Build an overview whose RAW size is ~`targetMB` MB by stuffing every
 * workflow with a large `script` blob (the prime cause of bloat in real
 * customer .ds exports). The slim path drops these blobs entirely, so the
 * digest input stays tiny.
 */
function bloatedOverview(targetMB) {
  const o = tinyOverview();
  const filler = 'x'.repeat(50_000); // 50 KB per workflow
  const workflowCount = Math.ceil((targetMB * 1024 * 1024) / filler.length);
  o.workflows = Array.from({ length: workflowCount }, (_, i) => ({
    name: `WF_${i}`,
    form: 'Customers',
    event: 'on add',
    actionKinds: ['email', 'fieldUpdate'],
    script: filler, // deliberately huge — not consumed by the digest
    rawXml: filler,
  }));
  return o;
}

describe('POST /api/suggest-changes', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  test('with stub LLM returns 501 useFallback (no 500)', async () => {
    const res = await request(app)
      .post('/api/suggest-changes')
      .send({ instruction: 'Add a phone field.', overview: tinyOverview() });

    expect(res.status).toBe(501);
    expect(res.body.useFallback).toBe(true);
  });

  test('rejects empty instruction with 400', async () => {
    const res = await request(app)
      .post('/api/suggest-changes')
      .send({ instruction: '', overview: tinyOverview() });
    expect(res.status).toBe(400);
  });

  test('rejects missing overview with 400', async () => {
    const res = await request(app)
      .post('/api/suggest-changes')
      .send({ instruction: 'do something useful' });
    expect(res.status).toBe(400);
  });

  test('accepts a 1.7 MB overview by slimming workflow source code', async () => {
    const big = bloatedOverview(1.7);
    const raw = Buffer.byteLength(JSON.stringify(big), 'utf8');
    expect(raw).toBeGreaterThan(1_500_000);

    const res = await request(app)
      .post('/api/suggest-changes')
      .send({ instruction: 'Add a phone field.', overview: big });

    // Stub provider → 501 useFallback. The important part: NOT 413, NOT 500.
    expect([200, 501]).toContain(res.status);
    if (res.status === 501) expect(res.body.useFallback).toBe(true);
  });

  test('audit mode accepts an empty instruction (no 400) and routes to LLM', async () => {
    // In 'audit' mode the server generates the prompt itself (AUDIT_INSTRUCTION),
    // so the consultant does not need to type anything. With no LLM configured
    // we expect the same 501 useFallback path — what matters is that we are
    // NOT rejected with a 400 "instruction is required".
    const res = await request(app)
      .post('/api/suggest-changes')
      .send({ instruction: '', overview: tinyOverview(), mode: 'audit' });

    expect(res.status).not.toBe(400);
    expect([200, 501]).toContain(res.status);
    if (res.status === 501) expect(res.body.useFallback).toBe(true);
  });

  test('still rejects a > 5 MB raw overview with a clear 413 message', async () => {
    const huge = bloatedOverview(6);
    const res = await request(app)
      .post('/api/suggest-changes')
      .send({ instruction: 'Add a phone field.', overview: huge });

    // Either body-parser rejects > 6 MB JSON outright (413/PayloadTooLargeError)
    // or our route hits the 5 MB raw cap. Both are acceptable; what we want
    // is a non-500, non-200 with an actionable message.
    expect([413]).toContain(res.status);
    expect(String(res.body.error || res.body.message || '')).toMatch(/too large/i);
  });
});
