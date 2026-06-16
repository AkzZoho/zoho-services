/**
 * Tests for the /api/extract-scope path.
 *
 * Covers three branches:
 *   1. No LLM configured → 501 { useFallback: true }
 *   2. LLM returns valid scope → 200 with provider + scope
 *   3. LLM returns malformed scope → 502 (client falls back)
 */
const request = require('supertest');

describe('extract-scope', () => {
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
      .post('/api/extract-scope')
      .send({ brdText: 'Build a customer portal with invoices.' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(501);
    expect(res.body.useFallback).toBe(true);
    expect(typeof res.body.reason).toBe('string');
  });

  test('rejects empty brdText with 400', async () => {
    const app = require('../src/app');
    const res = await request(app)
      .post('/api/extract-scope')
      .send({ brdText: '   ' })
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(400);
  });

  test('returns 200 when router returns a valid scope (mocked provider)', async () => {
    // Mock the router to simulate Anthropic returning a well-formed scope.
    jest.doMock('../src/shared/llm/router', () => ({
      run: async () => ({
        provider: 'anthropic',
        data: {
          schemaVersion: 2,
          meta: { title: 'Test App' },
          application: { name: 'Test_App', edition: 'professional' },
          forms: [{
            name: 'Customer_Master',
            displayName: 'Customer Master',
            purpose: 'Stores customer records',
            fields: [
              { name: 'Customer_Name', displayName: 'Customer Name', type: 'Single Line', required: true },
              { name: 'Email', displayName: 'Email', type: 'Email' },
            ],
            actionEvents: ['on add', 'on edit'],
          }],
          reports: [], pages: [], workflows: [], lookups: [],
          roles: [], profiles: [], customFunctions: [], connections: [],
          blueprints: [], batchWorkflows: [], schedules: [], publicAPIs: [],
          nfrs: [], assumptions: [], outOfScope: [],
        },
      }),
    }));

    const app = require('../src/app');
    const res = await request(app)
      .post('/api/extract-scope')
      .send({ brdText: 'A customer master with name and email.' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('anthropic');
    expect(res.body.scope.forms).toHaveLength(1);
    expect(res.body.scope.forms[0].name).toBe('Customer_Master');
    expect(res.body.scope.forms[0].fields).toHaveLength(2);
    expect(Array.isArray(res.body.warnings)).toBe(true);
  });

  test('returns 502 when LLM emits zero forms (validation failure)', async () => {
    jest.doMock('../src/shared/llm/router', () => ({
      run: async () => ({
        provider: 'anthropic',
        data: { schemaVersion: 2, forms: [] }, // no forms → must reject
      }),
    }));

    const app = require('../src/app');
    const res = await request(app)
      .post('/api/extract-scope')
      .send({ brdText: 'Anything' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/fall(?:ing)?\s+back/i);
  });

  test('coerces unknown field types to Single Line and surfaces a warning', async () => {
    jest.doMock('../src/shared/llm/router', () => ({
      run: async () => ({
        provider: 'anthropic',
        data: {
          schemaVersion: 2,
          forms: [{
            name: 'Foo',
            displayName: 'Foo',
            fields: [{ name: 'bar', type: 'NotARealType' }],
            actionEvents: ['on add'],
          }],
        },
      }),
    }));

    const app = require('../src/app');
    const res = await request(app)
      .post('/api/extract-scope')
      .send({ brdText: 'foo bar' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.scope.forms[0].fields[0].type).toBe('Single Line');
    expect(res.body.warnings.some((w) => /unknown type/i.test(w))).toBe(true);
  });
});
