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
 * Resolve the API base URL for the current runtime.
 *
 *   • If VITE_API_BASE is set at build time → use it verbatim (after stripping
 *     trailing slashes; auto-prepends https:// if no scheme).
 *   • Otherwise → empty string (same-origin). In dev the Vite proxy forwards
 *     /api/* and /health to http://localhost:3001. In production place the
 *     SPA and the API behind the same reverse proxy / domain, or set
 *     VITE_API_BASE to the absolute API URL.
 */
function resolveApiBase() {
  let buildTimeBase =
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    import.meta.env.VITE_API_BASE
      ? String(import.meta.env.VITE_API_BASE).replace(/\/+$/, '')
      : '';

  if (!buildTimeBase) return '';

  // Auto-fix: if the env var was set without a scheme (e.g. just the
  // hostname), prepend https:// so the URL is always absolute.
  if (!/^https?:\/\//i.test(buildTimeBase)) {
    buildTimeBase = `https://${buildTimeBase}`;
  }
  return buildTimeBase;
}

const API_BASE = resolveApiBase();

/**
 * Returns the resolved API base URL for the current runtime environment.
 * Useful for modules outside the ds-analyser tool that need to call the
 * same backend (e.g. tool-visibility endpoint, tech-scope routes).
 */
export function apiBase() {
  return API_BASE;
}

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
