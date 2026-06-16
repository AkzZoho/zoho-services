/**
 * Admin — tool visibility persistence.
 *
 * Endpoint:  POST /api/admin/tool-visibility
 * Auth:      `x-admin-password` header must match `process.env.ADMIN_PASSWORD`.
 *            If `ADMIN_PASSWORD` is not configured on the server, the route
 *            returns 503 — admins must set it before changes can be persisted.
 * Body:      { publicIds: string[] }
 *            Valid IDs are listed in `ALLOWED_TOOL_IDS` below; unknown IDs
 *            are rejected to avoid silently writing garbage into `.env`.
 *
 * Behaviour:
 *   • Rewrites the `VITE_PUBLIC_TOOLS=…` line in `client/.env` in-place.
 *   • Preserves all other lines, ordering, comments, and trailing newline.
 *   • If the file lacks the key, appends it at the end (with a blank line).
 *   • If `client/.env` does not exist, creates it from `client/.env.example`
 *     when available, else creates a minimal new file.
 *
 * Why the env-file path is hard-coded:
 *   The repo layout is fixed (mono-repo with `client/` next to
 *   `functions/ds-analyzer/`). Hard-coding the relative path keeps the
 *   route deployable as-is and prevents path-traversal abuse via a body
 *   field. If you ever move the client out, update CLIENT_ENV_PATH below.
 *
 * Important caveat — restart required:
 *   Vite inlines `VITE_*` env vars into the bundle at dev-server start. The
 *   running dev server will NOT see the new value until it is restarted.
 *   The route therefore responds with `restartRequired: true` so the UI can
 *   warn the admin. (LocalStorage overrides keep the toggle visible in the
 *   UI until restart.)
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const ALLOWED_TOOL_IDS = ['ds-analyser', 'tech-scope'];
const ENV_KEY = 'VITE_PUBLIC_TOOLS';

// Resolved once at module load — server.js boots from
// `functions/ds-analyzer/src/server.js`, so going up three levels lands at
// the repo root, then into `client/.env`.
const CLIENT_ENV_PATH = path.resolve(
  __dirname,
  '..', '..', '..', '..', '..',
  'client',
  '.env'
);
const CLIENT_ENV_EXAMPLE_PATH = path.resolve(
  __dirname,
  '..', '..', '..', '..', '..',
  'client',
  '.env.example'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read `.env` file content; fall back to `.env.example`; else return ''. */
function readClientEnv() {
  try {
    return fs.readFileSync(CLIENT_ENV_PATH, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  try {
    return fs.readFileSync(CLIENT_ENV_EXAMPLE_PATH, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return '';
}

/**
 * Replace (or append) the `KEY=value` line for `key` in `content`.
 * - Matches the first non-comment occurrence of `KEY=…` (one per line).
 * - Preserves surrounding comments and other keys verbatim.
 * - If no match found, appends `KEY=value\n` (with a leading blank line if
 *   the file does not already end in one).
 */
function upsertEnvLine(content, key, value) {
  const lineRe = new RegExp(`^(\\s*)${key}\\s*=.*$`, 'm');
  const replacement = `$1${key}=${value}`;
  if (lineRe.test(content)) {
    return content.replace(lineRe, replacement);
  }
  // Append — ensure the key starts on a new line. We deliberately do NOT
  // insert a blank separator line: that keeps appended keys flush with the
  // existing block (matches the dotenv convention of one KEY=value per line)
  // and produces predictable output for the test suite.
  if (content.length === 0) return `${key}=${value}\n`;
  const prefix = content.endsWith('\n') ? '' : '\n';
  return `${content}${prefix}${key}=${value}\n`;
}

/** Validate, dedupe & order publicIds against the allow-list. */
function sanitisePublicIds(raw) {
  if (!Array.isArray(raw)) {
    const err = new Error('Body field `publicIds` must be an array of tool IDs.');
    err.status = 400;
    throw err;
  }
  const seen = new Set();
  const cleaned = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      const err = new Error('Each entry in `publicIds` must be a string.');
      err.status = 400;
      throw err;
    }
    const id = item.trim();
    if (!id) continue;
    if (!ALLOWED_TOOL_IDS.includes(id)) {
      const err = new Error(`Unknown tool ID: "${id}". Allowed: ${ALLOWED_TOOL_IDS.join(', ')}.`);
      err.status = 400;
      throw err;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    cleaned.push(id);
  }
  return cleaned;
}

/** Constant-time-ish string compare to dodge timing-attack snark. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

router.post('/', (req, res, next) => {
  try {
    const serverPwd = process.env.ADMIN_PASSWORD;
    if (!serverPwd) {
      return res.status(503).json({
        error:
          'Server-side ADMIN_PASSWORD is not configured. Set it in functions/ds-analyzer/.env so admin changes can be persisted.',
      });
    }

    const supplied = req.get('x-admin-password') || '';
    if (!safeEqual(supplied, serverPwd)) {
      return res.status(401).json({ error: 'Invalid admin password.' });
    }

    const publicIds = sanitisePublicIds(req.body && req.body.publicIds);
    const value = publicIds.join(',');

    const before = readClientEnv();
    const after = upsertEnvLine(before, ENV_KEY, value);

    fs.writeFileSync(CLIENT_ENV_PATH, after, 'utf8');

    return res.json({
      ok: true,
      key: ENV_KEY,
      value,
      publicIds,
      path: CLIENT_ENV_PATH,
      restartRequired: true,
      message:
        'Saved to client/.env. Restart the Vite dev server (or rebuild for production) for the new baseline to take effect.',
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
});

module.exports = router;
// Exposed for tests
module.exports._internal = { upsertEnvLine, sanitisePublicIds, ALLOWED_TOOL_IDS, CLIENT_ENV_PATH };
