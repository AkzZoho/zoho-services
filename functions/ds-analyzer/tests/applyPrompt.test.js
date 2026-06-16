/**
 * Tests for /api/apply-prompt and the applyPrompt LLM task.
 *
 * Covers:
 *   1. No LLM configured → 501 { useFallback: true }
 *   2. Successful translation → 200 { provider, commands[], explanation, confidence }
 *   3. Empty commands in response → still returns 200 with empty commands array
 *   4. Bad input → 400
 *   5. LLM fails (throws) → 502
 *   6. validateResponse helper normalises + clamps values
 *   7. buildScopeSummary produces compact output
 */
const request = require('supertest');

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */
const sampleScope = {
  forms: [
    {
      name: 'Customer', displayName: 'Customer',
      fields: [{ name: 'Name', displayName: 'Name', type: 'Single Line', required: true }],
    },
    {
      name: 'Invoice', displayName: 'Invoice',
      fields: [{ name: 'Amount', displayName: 'Amount', type: 'Decimal', required: true }],
    },
  ],
  lookups: [{ from: 'Invoice', field: 'customer_id', to: 'Customer', kind: 'single' }],
  reports: [{ name: 'All_Invoices', type: 'list', baseForm: 'Invoice' }],
  workflows: [], roles: [], profiles: [], pages: [],
  connections: [], customFunctions: [], blueprints: [],
  batchWorkflows: [], schedules: [], publicAPIs: [],
  nfrs: [], assumptions: [], outOfScope: [],
};

/* ------------------------------------------------------------------ */
/*  Route tests (HTTP layer)                                            */
/* ------------------------------------------------------------------ */
describe('POST /api/apply-prompt', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  test('returns 501 useFallback when no LLM is configured', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const app = require('../src/app');
    const res = await request(app)
      .post('/api/apply-prompt')
      .send({ instruction: 'add a Vendor form', stepId: 'step1', scope: sampleScope })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(501);
    expect(res.body.useFallback).toBe(true);
    expect(typeof res.body.reason).toBe('string');
  });

  test('returns 400 when instruction is missing', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const app = require('../src/app');

    const res = await request(app)
      .post('/api/apply-prompt')
      .send({ stepId: 'step1' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/instruction/i);
  });

  test('returns 400 when instruction is blank string', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const app = require('../src/app');

    const res = await request(app)
      .post('/api/apply-prompt')
      .send({ instruction: '   ', stepId: 'step2' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
  });

  test('returns 400 for invalid stepId', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const app = require('../src/app');

    const res = await request(app)
      .post('/api/apply-prompt')
      .send({ instruction: 'add form: X', stepId: 'step99' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stepId/i);
  });

  test('returns 200 with mocked LLM returning valid commands', async () => {
    // We cannot hit a real LLM in tests, so we mock the router module.
    jest.mock('../src/shared/llm/router', () => ({
      run: jest.fn().mockResolvedValue({
        provider: 'anthropic',
        data: {
          commands: ['add form: Vendor with fields: name, email'],
          explanation: 'Added Vendor form with basic fields.',
          confidence: 0.92,
        },
      }),
    }));

    const app = require('../src/app');
    const res = await request(app)
      .post('/api/apply-prompt')
      .send({ instruction: 'add a Vendor form', stepId: 'step1', scope: sampleScope })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('anthropic');
    expect(Array.isArray(res.body.commands)).toBe(true);
    expect(res.body.commands.length).toBeGreaterThan(0);
    expect(typeof res.body.explanation).toBe('string');
    expect(typeof res.body.confidence).toBe('number');
  });

  test('returns 502 when LLM throws an error', async () => {
    jest.mock('../src/shared/llm/router', () => ({
      run: jest.fn().mockRejectedValue(new Error('LLM upstream timeout')),
    }));

    const app = require('../src/app');
    const res = await request(app)
      .post('/api/apply-prompt')
      .send({ instruction: 'do something', stepId: 'step1' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(502);
    expect(typeof res.body.error).toBe('string');
  });
});

/* ------------------------------------------------------------------ */
/*  Unit tests: applyPrompt._internal helpers                          */
/* ------------------------------------------------------------------ */
describe('applyPrompt._internal', () => {
  const { _internal } = require('../src/tech-scope/llm/applyPrompt');
  const { validateResponse, buildScopeSummary } = _internal;

  describe('validateResponse', () => {
    test('extracts commands, explanation and confidence from valid response', () => {
      const result = validateResponse({
        commands: ['add form: Vendor', 'add role: Vendor Manager'],
        explanation: 'Added vendor-related entities.',
        confidence: 0.85,
      });
      expect(result.commands).toEqual(['add form: Vendor', 'add role: Vendor Manager']);
      expect(result.explanation).toBe('Added vendor-related entities.');
      expect(result.confidence).toBe(0.85);
    });

    test('clamps confidence to [0, 1]', () => {
      expect(validateResponse({ commands: [], confidence: 1.5 }).confidence).toBe(1);
      expect(validateResponse({ commands: [], confidence: -0.2 }).confidence).toBe(0);
    });

    test('filters empty / non-string commands', () => {
      const result = validateResponse({ commands: ['add form: X', '', null, 42, 'add role: Y'] });
      expect(result.commands).toEqual(['add form: X', 'add role: Y']);
    });

    test('throws when response is not an object', () => {
      expect(() => validateResponse('string')).toThrow();
      expect(() => validateResponse(null)).toThrow();
      expect(() => validateResponse(42)).toThrow();
    });

    test('returns defaults when optional fields are missing', () => {
      const result = validateResponse({ commands: ['add form: X'] });
      expect(result.explanation).toBe('');
      expect(result.confidence).toBe(0.5);
    });
  });

  describe('buildScopeSummary', () => {
    test('returns placeholder for null scope', () => {
      expect(buildScopeSummary(null)).toContain('no scope');
    });

    test('includes form names and field types', () => {
      const summary = buildScopeSummary(sampleScope);
      expect(summary).toContain('Customer');
      expect(summary).toContain('Invoice');
      expect(summary).toContain('Single Line');
    });

    test('includes lookup summary', () => {
      const summary = buildScopeSummary(sampleScope);
      expect(summary).toContain('Invoice.customer_id');
      expect(summary).toContain('Customer');
    });
  });
});
