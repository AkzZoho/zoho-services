/**
 * Regression tests for parseBRD.js.
 *
 * Background:
 *   The Tech Scope tool's BRD upload step lazy-imports `pdfjs-dist` and
 *   `mammoth`. When those deps are missing from package.json, Vite's
 *   import-analysis pass crashes the whole tool at load time (500 overlay).
 *   These tests pin down the public contract so the regression cannot recur:
 *
 *     1. Unsupported extensions return a structured `{ ok:false, error }` —
 *        never throw.
 *     2. .txt / .md / .markdown parsing works *without* any optional dep
 *        (proves the tool still loads if pdfjs-dist / mammoth break).
 *     3. Empty / whitespace-only files are rejected with a clear error.
 *     4. The exported ACCEPTED set covers every documented format.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBRD,
  ACCEPTED_BRD_EXTENSIONS,
} from '../parseBRD.js';

/**
 * Minimal File-like polyfill — node:test runs in Node, which lacks the
 * browser `File` global. parseBRD only touches `.name`, `.text()`, and
 * `.arrayBuffer()`, so we mock exactly those.
 */
function makeFile(name, body) {
  const buf = Buffer.from(body, 'utf8');
  return {
    name,
    text: async () => body,
    arrayBuffer: async () =>
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

describe('parseBRD — contract', () => {
  test('returns ok:false when no file is passed', async () => {
    const res = await parseBRD(null);
    assert.equal(res.ok, false);
    assert.match(res.error, /no file/i);
  });

  test('rejects unsupported extensions with a structured error', async () => {
    const res = await parseBRD(makeFile('virus.exe', 'mz...'));
    assert.equal(res.ok, false);
    assert.match(res.error, /unsupported file type/i);
    assert.match(res.error, /\.txt/);
    assert.match(res.error, /\.pdf/);
    assert.match(res.error, /\.docx/);
  });

  test('rejects files with no usable text content', async () => {
    const res = await parseBRD(makeFile('blank.txt', '   \n\n   '));
    assert.equal(res.ok, false);
    assert.match(res.error, /no extractable text/i);
  });

  test('rejects files with too-short content (< 20 chars)', async () => {
    const res = await parseBRD(makeFile('tiny.md', 'too short'));
    assert.equal(res.ok, false);
    assert.match(res.error, /no extractable text/i);
  });
});

describe('parseBRD — .txt / .md', () => {
  const SAMPLE =
    '# Requirement\n\nThe system shall onboard customers via a portal.';

  test('parses .txt successfully without any optional deps', async () => {
    const res = await parseBRD(makeFile('brd.txt', SAMPLE));
    assert.equal(res.ok, true);
    assert.equal(res.ext, 'txt');
    assert.equal(res.name, 'brd.txt');
    assert.ok(res.text.includes('onboard customers'));
  });

  test('parses .md successfully', async () => {
    const res = await parseBRD(makeFile('brd.md', SAMPLE));
    assert.equal(res.ok, true);
    assert.equal(res.ext, 'md');
  });

  test('parses .markdown alias successfully', async () => {
    const res = await parseBRD(makeFile('brd.markdown', SAMPLE));
    assert.equal(res.ok, true);
    assert.equal(res.ext, 'markdown');
  });

  test('normalises whitespace (CRLF → LF, collapses runs)', async () => {
    const messy = 'Line 1\r\n\r\n\r\n\r\nLine 2 with    trailing   \r\n';
    const padded = messy + 'A'.repeat(30); // ensure >= 20 chars
    const res = await parseBRD(makeFile('brd.txt', padded));
    assert.equal(res.ok, true);
    assert.ok(!res.text.includes('\r'), 'should strip CR');
    assert.ok(
      !/\n{3,}/.test(res.text),
      'should collapse 3+ blank lines',
    );
  });
});

describe('parseBRD — PDF / DOCX error paths (load-time regression guard)', () => {
  /**
   * These tests prove that a *runtime* failure inside the lazy-imported
   * PDF/DOCX parser is reported as a structured `{ ok:false, error }`
   * rather than a thrown exception — so the tool's UI stays alive even
   * when the user uploads a corrupted file.
   *
   * NOTE: `pdfjs-dist` requires browser globals (DOMMatrix, etc.) and
   * cannot import in Node — so in this test environment, the lazy import
   * will fail and surface the "not installed" message from the defensive
   * try/catch. That's expected. The key contract we *can* verify in Node
   * is that the function **never throws**.
   */
  test('corrupted .pdf produces a structured error, not a throw', async () => {
    const res = await parseBRD(makeFile('fake.pdf', 'NOT-A-REAL-PDF'));
    assert.equal(res.ok, false);
    assert.equal(typeof res.error, 'string');
    assert.ok(res.error.length > 0);
  });

  test('corrupted .docx produces a structured error, not a throw', async () => {
    const res = await parseBRD(makeFile('fake.docx', 'NOT-A-REAL-DOCX'));
    assert.equal(res.ok, false);
    assert.equal(typeof res.error, 'string');
    assert.ok(res.error.length > 0);
  });
});

describe('parseBRD — package.json declares optional deps', () => {
  /**
   * The most reliable cross-environment guard against the original
   * regression (`pdfjs-dist` / `mammoth` not in package.json) is to
   * read `package.json` and assert the deps are declared. This catches
   * the bug regardless of platform (Node vs browser).
   */
  test('client/package.json declares pdfjs-dist and mammoth', async () => {
    const fs = await import('node:fs/promises');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(here, '../../../../../package.json');
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
    assert.ok(
      pkg.dependencies?.['pdfjs-dist'],
      'pdfjs-dist must be listed in client/package.json dependencies',
    );
    assert.ok(
      pkg.dependencies?.['mammoth'],
      'mammoth must be listed in client/package.json dependencies',
    );
  });
});

describe('parseBRD — ACCEPTED set', () => {
  test('exports the complete list of accepted extensions', () => {
    assert.ok(ACCEPTED_BRD_EXTENSIONS instanceof Set);
    for (const ext of ['txt', 'md', 'markdown', 'pdf', 'docx']) {
      assert.ok(
        ACCEPTED_BRD_EXTENSIONS.has(ext),
        `ACCEPTED_BRD_EXTENSIONS missing "${ext}"`,
      );
    }
  });
});
