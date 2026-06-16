/**
 * /api/admin/tool-visibility — persistence into client/.env.
 *
 * The route writes to a fixed path resolved at module load
 * (`functions/ds-analyzer/../../client/.env`). To avoid mutating the
 * developer's real env file during a test run, we monkey-patch `fs.readFileSync`
 * + `fs.writeFileSync` so the route operates on an in-memory virtual file
 * scoped to that path. This keeps the route's hard-coded path intact (which
 * is desirable for security — see the route header) while still giving us a
 * deterministic, side-effect-free test bed.
 */

const fs = require('fs');
const request = require('supertest');

// Require the route module first so we can read its CLIENT_ENV_PATH constant
// without booting the whole app.
const { _internal: routeInternals } = require('../src/admin/routes/toolVisibility');
const TARGET_PATH = routeInternals.CLIENT_ENV_PATH;

const app = require('../src/app');

// ---- Virtual FS (only intercepts the one path the route touches) ----------

let virtualEnv = '';
const origRead = fs.readFileSync;
const origWrite = fs.writeFileSync;

function mockFs(initialContent) {
  virtualEnv = initialContent;
  fs.readFileSync = (file, ...rest) => {
    if (file === TARGET_PATH) return virtualEnv;
    return origRead(file, ...rest);
  };
  fs.writeFileSync = (file, data, ...rest) => {
    if (file === TARGET_PATH) {
      virtualEnv = data;
      return;
    }
    return origWrite(file, data, ...rest);
  };
}

function restoreFs() {
  fs.readFileSync = origRead;
  fs.writeFileSync = origWrite;
}

// ---- Tests ----------------------------------------------------------------

describe('POST /api/admin/tool-visibility', () => {
  const ORIGINAL_PWD = process.env.ADMIN_PASSWORD;

  beforeEach(() => {
    process.env.ADMIN_PASSWORD = 'test-secret';
    mockFs(
      [
        '# example header',
        'VITE_ADMIN_PASSWORD=Zoho@610',
        '',
        'VITE_PUBLIC_TOOLS=tech-scope',
        '',
      ].join('\n')
    );
  });

  afterEach(() => {
    restoreFs();
    if (ORIGINAL_PWD === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = ORIGINAL_PWD;
  });

  test('rejects request without x-admin-password header', async () => {
    const res = await request(app)
      .post('/api/admin/tool-visibility')
      .send({ publicIds: ['ds-analyser'] });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid admin password/i);
  });

  test('rejects request with wrong password', async () => {
    const res = await request(app)
      .post('/api/admin/tool-visibility')
      .set('x-admin-password', 'wrong')
      .send({ publicIds: ['ds-analyser'] });
    expect(res.status).toBe(401);
  });

  test('returns 503 when server has no ADMIN_PASSWORD configured', async () => {
    delete process.env.ADMIN_PASSWORD;
    const res = await request(app)
      .post('/api/admin/tool-visibility')
      .set('x-admin-password', 'whatever')
      .send({ publicIds: ['ds-analyser'] });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/ADMIN_PASSWORD is not configured/);
  });

  test('rejects non-array publicIds', async () => {
    const res = await request(app)
      .post('/api/admin/tool-visibility')
      .set('x-admin-password', 'test-secret')
      .send({ publicIds: 'tech-scope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must be an array/);
  });

  test('rejects unknown tool IDs', async () => {
    const res = await request(app)
      .post('/api/admin/tool-visibility')
      .set('x-admin-password', 'test-secret')
      .send({ publicIds: ['tech-scope', 'evil-tool'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown tool ID/);
  });

  test('updates the VITE_PUBLIC_TOOLS line in place, preserves others', async () => {
    const res = await request(app)
      .post('/api/admin/tool-visibility')
      .set('x-admin-password', 'test-secret')
      .send({ publicIds: ['tech-scope', 'ds-analyser'] });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.value).toBe('tech-scope,ds-analyser');
    expect(res.body.restartRequired).toBe(true);

    // The other lines must be untouched
    expect(virtualEnv).toContain('# example header');
    expect(virtualEnv).toContain('VITE_ADMIN_PASSWORD=Zoho@610');
    expect(virtualEnv).toMatch(/^VITE_PUBLIC_TOOLS=tech-scope,ds-analyser$/m);
  });

  test('writes empty value for empty publicIds (admin-only mode)', async () => {
    const res = await request(app)
      .post('/api/admin/tool-visibility')
      .set('x-admin-password', 'test-secret')
      .send({ publicIds: [] });
    expect(res.status).toBe(200);
    expect(res.body.value).toBe('');
    expect(virtualEnv).toMatch(/^VITE_PUBLIC_TOOLS=$/m);
  });

  test('appends VITE_PUBLIC_TOOLS when key is absent', async () => {
    mockFs('VITE_ADMIN_PASSWORD=Zoho@610\n');
    const res = await request(app)
      .post('/api/admin/tool-visibility')
      .set('x-admin-password', 'test-secret')
      .send({ publicIds: ['tech-scope'] });
    expect(res.status).toBe(200);
    expect(virtualEnv).toMatch(/VITE_PUBLIC_TOOLS=tech-scope/);
    expect(virtualEnv).toMatch(/VITE_ADMIN_PASSWORD=Zoho@610/);
  });

  test('deduplicates publicIds', async () => {
    const res = await request(app)
      .post('/api/admin/tool-visibility')
      .set('x-admin-password', 'test-secret')
      .send({ publicIds: ['tech-scope', 'tech-scope', 'ds-analyser'] });
    expect(res.status).toBe(200);
    expect(res.body.publicIds).toEqual(['tech-scope', 'ds-analyser']);
  });
});

describe('upsertEnvLine helper', () => {
  const { upsertEnvLine } = routeInternals;

  test('replaces an existing key without touching neighbours', () => {
    const input = 'FOO=1\nBAR=2\nBAZ=3\n';
    const out = upsertEnvLine(input, 'BAR', '99');
    expect(out).toBe('FOO=1\nBAR=99\nBAZ=3\n');
  });

  test('handles leading whitespace', () => {
    const input = '  FOO=1\n';
    const out = upsertEnvLine(input, 'FOO', '2');
    expect(out).toBe('  FOO=2\n');
  });

  test('appends key when missing', () => {
    const input = 'FOO=1\n';
    const out = upsertEnvLine(input, 'BAR', '2');
    expect(out).toBe('FOO=1\nBAR=2\n');
  });

  test('appends key when file is empty', () => {
    const out = upsertEnvLine('', 'FOO', '1');
    expect(out).toBe('FOO=1\n');
  });

  test('does not touch commented occurrences after a real assignment', () => {
    const input = 'FOO=old\n# FOO=ignored\n';
    const out = upsertEnvLine(input, 'FOO', 'new');
    expect(out).toBe('FOO=new\n# FOO=ignored\n');
  });
});
