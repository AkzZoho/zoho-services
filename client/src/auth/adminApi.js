/**
 * Admin API client — wraps the server endpoints that back the Admin Panel.
 *
 * Currently the only endpoint is POST /api/admin/tool-visibility, which
 * persists the comma-separated `VITE_PUBLIC_TOOLS` list into `client/.env`.
 * The admin password (the same value the user types at the login gate) is
 * sent in the `x-admin-password` header.
 *
 * Why a thin wrapper:
 *   • Keeps fetch / header / error-shape concerns out of the UI components.
 *   • Re-uses the existing `apiFetch` helper so the API base URL and JSON-
 *     parse error handling stay consistent with the rest of the app.
 *
 * Failure handling philosophy:
 *   The persistence step is a "best effort" companion to the localStorage
 *   override — never block the UI on it. Callers should `await` the promise
 *   only when they need to surface the outcome (e.g. show a toast), and
 *   should always swallow / report the error rather than rolling back the
 *   optimistic local change. (Rolling back would leave the admin with a
 *   visibly stale UI and no clear path to retry.)
 */

import { apiFetch } from '../tools/ds-analyser/lib/http.js';

const ENDPOINT = '/api/admin/tool-visibility';

/**
 * Persist the given list of public tool IDs into `client/.env` on the server.
 *
 * @param {object} args
 * @param {string[]} args.publicIds  Tool IDs that should be public. Order is
 *                                   preserved; duplicates / unknown IDs are
 *                                   rejected by the server.
 * @param {string} args.password     The admin password — same value baked
 *                                   into VITE_ADMIN_PASSWORD on the client.
 * @returns {Promise<{
 *   ok: true,
 *   key: string,
 *   value: string,
 *   publicIds: string[],
 *   path: string,
 *   restartRequired: boolean,
 *   message: string,
 * }>}
 * @throws {Error} when the server rejects the request (401 wrong password,
 *                 503 ADMIN_PASSWORD not configured, 400 invalid body, 5xx).
 */
export async function persistToolVisibility({ publicIds, password }) {
  if (!password) {
    // Avoid sending an empty header — the server would 401, which is
    // technically correct but unhelpful as the underlying problem is a
    // missing client-side admin session.
    throw new Error('Admin session has no password to authenticate with.');
  }
  return apiFetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': password,
    },
    body: JSON.stringify({ publicIds }),
  });
}
