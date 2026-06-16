/**
 * useAdminAuth — Admin authentication hook (env-var password gate).
 *
 * Security model (deliberately documented):
 *   - This is a UI-only gate. The password is baked into the JS bundle at
 *     build time via VITE_ADMIN_PASSWORD. A determined person with DevTools
 *     CAN bypass it. This is acceptable because:
 *       (a) The app URL is only shared with trusted colleagues.
 *       (b) The tools themselves have no destructive write operations.
 *       (c) The actual LLM API keys live in server-side env vars.
 *   - For a true security boundary, put the app behind an SSO / reverse-proxy
 *     auth (e.g. oauth2-proxy, Cloudflare Access).
 *
 * Storage: sessionStorage (not localStorage) so the session ends when the
 * browser tab closes — colleagues can't accidentally inherit an admin session
 * from a shared machine.
 */

import { createContext, useContext, useCallback, useState, useEffect } from 'react';

const STORAGE_KEY = 'zst.admin_session';

/** Read the compile-time admin password. Empty string → no password set. */
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD ?? '';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export const AdminAuthContext = createContext({
  isAdmin: false,
  login: (_pwd) => false,
  logout: () => {},
  /**
   * The admin password compiled into the bundle. Exposed so admin-only API
   * calls (e.g. /api/admin/tool-visibility) can authenticate against the
   * server without prompting the user a second time. Empty string when no
   * password is configured.
   */
  adminPassword: '',
});

// ---------------------------------------------------------------------------
// Provider (exported separately so main.jsx imports it cleanly)
// ---------------------------------------------------------------------------

export function useAdminAuthState() {
  const [isAdmin, setIsAdmin] = useState(() => {
    // Restore session from sessionStorage (same tab/window only)
    try {
      return sessionStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Keep sessionStorage in sync
  useEffect(() => {
    try {
      if (isAdmin) {
        sessionStorage.setItem(STORAGE_KEY, 'true');
      } else {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // sessionStorage may be blocked in private browsing — silently ignore
    }
  }, [isAdmin]);

  /**
   * Attempt login. Returns true on success, false on wrong password.
   * If no VITE_ADMIN_PASSWORD is set in the environment, login always fails
   * (prevents accidentally leaving the gate wide open during development).
   */
  const login = useCallback((pwd) => {
    if (!ADMIN_PASSWORD) {
      console.warn(
        '[AdminAuth] VITE_ADMIN_PASSWORD is not set. Admin login is disabled.'
      );
      return false;
    }
    if (pwd === ADMIN_PASSWORD) {
      setIsAdmin(true);
      return true;
    }
    return false;
  }, []);

  const logout = useCallback(() => {
    setIsAdmin(false);
  }, []);

  return { isAdmin, login, logout, adminPassword: ADMIN_PASSWORD };
}

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

export function useAdminAuth() {
  return useContext(AdminAuthContext);
}
