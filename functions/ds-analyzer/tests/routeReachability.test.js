/**
 * Regression tests — guard against the "HTTP 404 — server returned HTML
 * instead of JSON" class of bug.
 *
 * These tests assert that every documented API route is:
 *   1. Reachable (no 404 when the path+method are correct).
 *   2. Always returns JSON (`application/json`), never HTML — even for
 *      validation errors, unknown paths, and unknown methods.
 *   3. Returns the *expected* status code for well-defined failure modes
 *      (missing file → 400, unknown route → 404, etc.).
 *
 * Root cause history: when the Catalyst/Express backend was down, the
 * Vite dev proxy fell through to the SPA's `index.html`, which the client
 * then tried to `JSON.parse()` — producing the "HTML instead of JSON"
 * error. These tests lock down the contract end-to-end against the
 * Express app directly (via supertest), so the server itself is never
 * the source of such a regression.
 */

const request = require('supertest');
const AdmZip = require('adm-zip');
const app = require('../src/app');

const JSON_CT = /application\/json/;

function buildMinimalDs() {
  const zip = new AdmZip();
  zip.addFile(
    'manifest.json',
    Buffer.from(
      JSON.stringify({
        application: { name: 'RouteTest' },
        forms: [{ name: 'Leads', fields: [{ name: 'Email', type: 'EMAIL' }] }],
      })
    )
  );
  return zip.toBuffer();
}

describe('Route reachability & JSON contract', () => {
  beforeAll(() => {
    // Force deterministic stub LLM path so tests never depend on network/keys.
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ZOHO_CATALYST_AI_TOKEN;
  });

  // ---- Health ----------------------------------------------------------

  test('GET /health is reachable and returns JSON 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(JSON_CT);
    expect(res.body).toEqual(expect.objectContaining({ status: 'ok' }));
  });

  // ---- /api/inspect ----------------------------------------------------

  test('POST /api/inspect is reachable (not 404) and returns JSON 400 when file is missing', async () => {
    const res = await request(app).post('/api/inspect');
    expect(res.status).toBe(400);
    expect(res.status).not.toBe(404); // critical: route must be mounted
    expect(res.headers['content-type']).toMatch(JSON_CT);
    expect(res.body).toEqual(
      expect.objectContaining({ error: expect.stringMatching(/ds/i) })
    );
  });

  test('POST /api/inspect returns JSON 200 with expected shape for a valid .ds', async () => {
    const res = await request(app)
      .post('/api/inspect')
      .attach('ds', buildMinimalDs(), 'app.ds');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(JSON_CT);
    expect(res.body.ok).toBe(true);
    expect(res.body).toHaveProperty('technicalScope');
    expect(Array.isArray(res.body.technicalScope.forms)).toBe(true);
  });

  test('POST /api/inspect rejects unsupported file extensions as JSON 400', async () => {
    const res = await request(app)
      .post('/api/inspect')
      .attach('ds', Buffer.from('hello'), 'notes.txt');

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(JSON_CT);
    expect(res.body.error).toMatch(/Unsupported file type/i);
  });

  // ---- Hardened allowlist: ONLY `.ds` is accepted on /api/inspect ------

  test.each([
    ['app.zip', 'zip archives'],
    ['app.pdf', 'pdf files'],
    ['app.docx', 'docx files'],
    ['app.exe', 'executables'],
    ['app.ds.exe', 'double-extension payloads'],
  ])('POST /api/inspect rejects %s (%s) as JSON 400', async (filename) => {
    const res = await request(app)
      .post('/api/inspect')
      .attach('ds', buildMinimalDs(), filename);

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(JSON_CT);
    expect(res.body.error).toMatch(/Unsupported file type|only \.ds/i);
  });

  test('POST /api/inspect accepts case-insensitive .DS extension', async () => {
    const res = await request(app)
      .post('/api/inspect')
      .attach('ds', buildMinimalDs(), 'Demo.DS');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(JSON_CT);
    expect(res.body.ok).toBe(true);
  });

  // Direct unit tests for the allowlist helper — these cover adversarial
  // filenames that the multipart/form-data layer in supertest silently
  // rewrites (e.g. strips `../`) before the request reaches the server.
  // The helper is the authoritative defence, so we pin it down directly.
  describe('inspect.isAllowedDs() allowlist', () => {
    const { isAllowedDs } = require('../src/routes/inspect')._internal;

    test.each([
      'app.ds',
      'Demo.DS',
      'my-app_v2.ds',
      'report (1).ds',
      'A.ds',
    ])('accepts %s', (name) => {
      expect(isAllowedDs(name)).toBe(true);
    });

    test.each([
      ['', 'empty string'],
      ['app.zip', 'zip'],
      ['app.pdf', 'pdf'],
      ['app.docx', 'docx'],
      ['app.exe', 'exe'],
      ['app.ds.exe', 'double-extension trojan'],
      ['payload.DS.zip', 'zip disguised with .ds token'],
      ['..\\evil.ds', 'Windows path traversal'],
      ['evil\u0000.ds', 'NUL-injected filename'],
      ['evil\u0001.ds', 'control-char filename'],
      ['a'.repeat(256) + '.ds', 'overlong filename'],
      ['no-extension', 'missing extension'],
      ['.ds', 'extension only'],
      ['file.dss', 'near-miss extension'],
      ['file.ds ', 'trailing space after extension'],
      [{ evil: true }, 'non-string input'],
      [null, 'null'],
      [undefined, 'undefined'],
    ])('rejects %p (%s)', (name) => {
      expect(isAllowedDs(name)).toBe(false);
    });

    // POSIX-style path components are neutralised via `path.basename` before
    // the extension check runs, so `../evil.ds` becomes `evil.ds` (a valid
    // name). Since we only ever use the basename (the in-memory buffer never
    // touches disk), this normalisation is safe — the original path cannot
    // escape any directory. We pin the behaviour here so future regressions
    // don't quietly re-introduce a path component in persisted filenames.
    test.each([
      ['../evil.ds', 'evil.ds'],
      ['/etc/passwd.ds', 'passwd.ds'],
      ['./nested/dir/app.ds', 'app.ds'],
    ])('normalises %p → basename %p and accepts it', (input, expectedBase) => {
      const path = require('path');
      expect(path.basename(input)).toBe(expectedBase);
      expect(isAllowedDs(input)).toBe(true);
    });
  });

  // ---- /api/analyze: `ds` field must also be `.ds` only ----------------

  test('POST /api/analyze rejects .zip for the ds field as JSON 400', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .attach('ds', buildMinimalDs(), 'app.zip')
      .attach('requirement', Buffer.from('spec'), 'spec.pdf');

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(JSON_CT);
    expect(res.body.error).toMatch(/Unsupported file type|only \.ds/i);
  });

  test('POST /api/analyze rejects .ds for the requirement field as JSON 400', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .attach('ds', buildMinimalDs(), 'app.ds')
      .attach('requirement', Buffer.from('spec'), 'spec.ds');

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(JSON_CT);
    expect(res.body.error).toMatch(/Unsupported file type|\.pdf|\.docx/i);
  });

  // ---- /api/analyze ----------------------------------------------------

  test('POST /api/analyze is reachable (not 404) and returns JSON 400 when files are missing', async () => {
    const res = await request(app).post('/api/analyze');
    expect(res.status).toBe(400);
    expect(res.status).not.toBe(404);
    expect(res.headers['content-type']).toMatch(JSON_CT);
    expect(res.body).toHaveProperty('error');
  });

  // ---- Wrong method / unknown route — must NOT serve HTML --------------

  test('GET /api/inspect (wrong method) returns JSON, never HTML', async () => {
    const res = await request(app).get('/api/inspect');
    // Express may return 404 (no GET handler mounted) or 405; either is fine
    // as long as the body is JSON, never the SPA's index.html.
    expect([404, 405]).toContain(res.status);
    expect(res.headers['content-type']).toMatch(JSON_CT);
    expect(res.text).not.toMatch(/<!doctype html>|<html/i);
  });

  test('Unknown route returns JSON 404 (not HTML)', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(JSON_CT);
    expect(res.body).toEqual(
      expect.objectContaining({ error: 'Not found', path: '/api/does-not-exist' })
    );
    expect(res.text).not.toMatch(/<!doctype html>|<html/i);
  });

  test('Root path / returns JSON 404 (no accidental static HTML fallback)', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(JSON_CT);
    expect(res.text).not.toMatch(/<!doctype html>|<html/i);
  });

  // ---- Catalyst Advanced I/O routing contract ----------------------------
  //
  // The Catalyst platform STRIPS the /server/<function-name> prefix before
  // invoking the Advanced I/O handler, so Express always receives paths
  // starting with /api/... or /health — never /server/ds-analyzer/...
  //
  // These tests confirm that the stripped paths are what the server handles,
  // and that no /server/ds-analyzer mount leaks unexpected behaviour.

  test('/server/ds-analyzer/anything returns JSON 404 (prefix is stripped by Catalyst before reaching Express)', async () => {
    const res = await request(app).get('/server/ds-analyzer/api/inspect');
    // Express receives /api/inspect (stripped) — a GET on /api/inspect
    // has no handler so it falls through to the 404 middleware.
    // The point is it never serves HTML, and the 404 is JSON.
    expect([404, 405]).toContain(res.status);
    expect(res.headers['content-type']).toMatch(JSON_CT);
    expect(res.text).not.toMatch(/<!doctype html>|<html/i);
  });

  // ---- Helmet / CORS security headers ------------------------------------
  //
  // Every response (success AND error) must carry the correct security
  // headers so Catalyst's CDN doesn't strip or override them in a way
  // that breaks the SPA. These are regression tests — any accidental
  // helmet mis-configuration will be caught here before it reaches prod.

  test('Success response includes X-Content-Type-Options: nosniff', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('Error response includes X-Content-Type-Options: nosniff', async () => {
    const res = await request(app).post('/api/inspect');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('CSP header is present and allows data: URIs for img-src', async () => {
    const res = await request(app).get('/health');
    const csp = res.headers['content-security-policy'] || '';
    expect(csp).toBeTruthy();
    // The inline SVG favicon uses a data: URI — must be whitelisted in img-src.
    expect(csp).toMatch(/img-src[^;]*data:/);
  });

  test('CORS header is present for cross-origin requests', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'https://ds-analyser-hhpiionw.onslate.in');
    // Access-Control-Allow-Origin should reflect the origin or be *.
    expect(res.headers['access-control-allow-origin']).toBeTruthy();
  });
});
