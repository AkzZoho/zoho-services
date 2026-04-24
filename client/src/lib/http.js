/**
 * Defensive JSON response handling for the app's API calls.
 *
 * Why this exists:
 *   `await res.json()` throws a cryptic `SyntaxError: JSON.parse: unexpected
 *   character at line 1 column 1` whenever the server responds with anything
 *   that isn't valid JSON — HTML error pages from the dev-server proxy, an
 *   empty 204, a 502 from an upstream, plain-text stack traces, etc. Users
 *   then see that raw parse error instead of the real problem.
 *
 * What this does:
 *   - Reads the body as text exactly once (safe for all content-types).
 *   - Uses Content-Type as a hint but still tolerates mislabeled responses.
 *   - On parse failure, surfaces a useful message:
 *       • HTTP status + statusText when the response wasn't OK.
 *       • A short excerpt of the body so the problem is diagnosable.
 *       • A dedicated message for empty bodies.
 *   - Never leaks large HTML dumps into the UI (body is truncated).
 *
 * Security:
 *   - The returned error `message` is trimmed and length-capped, so a
 *     malicious upstream can't spray arbitrary markup into the UI via
 *     `<ErrorBanner>`. Consumers still render it as text only.
 */

const BODY_PREVIEW_LIMIT = 200;

function previewBody(text) {
  if (!text) return '';
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= BODY_PREVIEW_LIMIT) return collapsed;
  return `${collapsed.slice(0, BODY_PREVIEW_LIMIT)}…`;
}

/**
 * Parse a fetch Response as JSON with robust error handling.
 * @param {Response} res
 * @returns {Promise<any>} parsed JSON body (or {} for successful empty bodies)
 * @throws {Error} with a human-readable message when the body isn't valid JSON
 *                 or the HTTP status is not 2xx.
 */
export async function parseJsonResponse(res) {
  // Read once — Response bodies can only be consumed a single time.
  let text = '';
  try {
    text = await res.text();
  } catch (readErr) {
    throw new Error(
      `Could not read response from ${res.url || 'server'} (HTTP ${res.status}): ${readErr.message}`
    );
  }

  const trimmed = text.trim();
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const looksLikeJson =
    contentType.includes('application/json') ||
    contentType.includes('+json') ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('[');

  // Happy path: JSON body.
  if (trimmed && looksLikeJson) {
    let data;
    try {
      data = JSON.parse(trimmed);
    } catch (parseErr) {
      if (!res.ok) {
        throw new Error(
          `HTTP ${res.status} ${res.statusText || ''}`.trim() +
            ` — ${previewBody(trimmed)}`
        );
      }
      throw new Error(`Server returned invalid JSON: ${parseErr.message}`);
    }
    if (!res.ok) {
      const msg =
        (data && (data.error || data.message)) ||
        `HTTP ${res.status} ${res.statusText || ''}`.trim();
      throw new Error(msg);
    }
    return data;
  }

  // Empty body.
  if (!trimmed) {
    if (res.ok) return {};
    throw new Error(`HTTP ${res.status} ${res.statusText || 'Empty response'}`.trim());
  }

  // Non-JSON body (HTML error page, plain text, etc.). Never surface raw HTML.
  const looksLikeHtml = /^<!doctype html|^<html|^<\?xml/i.test(trimmed);
  const hint = looksLikeHtml
    ? 'server returned an HTML page instead of JSON (is the API route reachable?)'
    : previewBody(trimmed);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim() + ` — ${hint}`);
  }
  throw new Error(`Unexpected non-JSON response from ${res.url || 'server'}: ${hint}`);
}

/**
 * Resolve the correct API base URL for the current runtime.
 *
 * There are three environments:
 *
 *   1. Local dev (Vite at :8080)
 *      API_BASE = '' (empty string, i.e. same origin)
 *      Vite proxy forwards /api/* and /health to http://localhost:3001.
 *
 *   2. Catalyst web-client hosting (*.catalystapps.com/app/)
 *      The SPA and the function share the same origin.
 *      Catalyst STRIPS the /server/ds-analyzer prefix before calling the
 *      function handler, so from the SPA's perspective the API lives at
 *      /server/ds-analyzer/api/... (same-origin, path-relative).
 *      API_BASE = '/server/ds-analyzer'
 *
 *   3. Catalyst Slate (*.onslate.in) or any other cross-origin host
 *      The function URL must be supplied as a full absolute URL via the
 *      build-time env var VITE_API_BASE.
 *      e.g. VITE_API_BASE=https://<project>.catalystapps.com/server/ds-analyzer
 *      API_BASE = VITE_API_BASE (stripped of trailing slash)
 *
 * Priority: VITE_API_BASE (explicit) > runtime hostname detection > '' (dev).
 */
function resolveApiBase() {
  // 1. Explicit build-time override — highest priority.
  //    Set VITE_API_BASE in a .env file before running `npm run build`.
  //    Must be the full function URL including https:// scheme.
  //    e.g. VITE_API_BASE=https://ds-analyser.catalystserverless.com/server/ds-analyzer
  let buildTimeBase =
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    import.meta.env.VITE_API_BASE
      ? import.meta.env.VITE_API_BASE.replace(/\/+$/, '')
      : '';

  if (buildTimeBase) {
    // Auto-fix: if the env var was set without a scheme (e.g. just the
    // hostname), prepend https:// so the URL is always absolute.
    if (!/^https?:\/\//i.test(buildTimeBase)) {
      buildTimeBase = `https://${buildTimeBase}`;
    }
    return buildTimeBase;
  }

  // 2. Runtime detection — Catalyst web-client hosting.
  //    When running in a browser (not SSR / test) and not on localhost,
  //    assume Catalyst web-client hosting where both the SPA and the
  //    function share the same origin.  The function is reachable at
  //    /server/ds-analyzer relative to the current origin.
  if (
    typeof window !== 'undefined' &&
    window.location &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1' &&
    !/^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(window.location.hostname)
  ) {
    return '/server/ds-analyzer';
  }

  // 3. Local dev — Vite proxy handles /api and /health.
  return '';
}

const API_BASE = resolveApiBase();

/**
 * Small convenience wrapper mirroring the previous `api()` helper pattern
 * used across the client. Centralises network + parse error handling and
 * automatically prefixes API paths with the environment-correct base.
 */
export async function apiFetch(path, opts = {}) {
  // Absolute URLs are passed through unchanged; relative paths get the base.
  const url = /^https?:\/\//i.test(path) ? path : `${API_BASE}${path}`;
  let res;
  try {
    res = await fetch(url, opts);
  } catch (networkErr) {
    // TypeError: Failed to fetch / NetworkError — keep it short and actionable.
    throw new Error(`Network error contacting ${url}: ${networkErr.message}`);
  }
  return parseJsonResponse(res);
}
