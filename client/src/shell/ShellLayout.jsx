/**
 * ShellLayout — top-level shell for the Zoho Services Tools workspace.
 *
 * Renders the persistent header (logo, contextual title, theme toggle,
 * admin controls) and a routed <Outlet> for the active tool.
 *
 * Admin controls in header:
 *   - Admin panel button (shown when isAdmin === true)
 *   - Sign out button (shown when isAdmin === true)
 *   - Admin login button (shown when isAdmin === false, on landing page only)
 */

import { Link, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';
import Icon from '../components/Icons.jsx';
import { useTheme } from '../theme/ThemeProvider.jsx';
import { useAdminAuth } from '../auth/useAdminAuth.js';
import { useToast } from '../components/Toast.jsx';

export default function ShellLayout() {
  const location = useLocation();
  const isLanding = location.pathname === '/' || location.pathname === '';

  return (
    <div className="min-h-screen">
      <ShellHeader isLanding={isLanding} />
      <main>
        <Outlet />
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Header                                                                     */
/* -------------------------------------------------------------------------- */

function ShellHeader({ isLanding }) {
  const { theme, toggle } = useTheme();
  const { isAdmin, logout } = useAdminAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const onDS = useMatch('/ds-analyser/*');
  const onTS = useMatch('/tech-scope/*');
  const onAdmin = useMatch('/admin');

  // Contextual sub-title — changes per active tool / route.
  let toolName = null;
  let toolTagline = null;

  if (onDS) {
    toolName = 'Creator DS Analyser';
    toolTagline = 'Upload a Creator .ds file to explore its structure, schema, and performance.';
  } else if (onTS) {
    toolName = 'Technical Scope Creator';
    toolTagline = 'Generate a structured technical scope for a new build.';
  } else if (onAdmin) {
    toolName = 'Admin Panel';
    toolTagline = 'Manage tool visibility for public users.';
  }

  function handleLogout() {
    logout();
    showToast('Signed out successfully.', 'info');
    navigate('/', { replace: true });
  }

  return (
    <header className="bg-white border-b border-slate-200 dark:bg-slate-900 dark:border-slate-800 sticky top-0 z-40 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:supports-[backdrop-filter]:bg-slate-900/80">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
        {/* Brand block — clicking the logo always returns to the landing page */}
        <Link
          to="/"
          className="flex items-center gap-3 min-w-0 hover:opacity-90 transition"
          title="Back to all tools"
        >
          <Icon.LogoMark size={32} />
          <div className="min-w-0">
            <h1 className="text-base md:text-lg font-semibold text-slate-900 dark:text-slate-100 truncate">
              {toolName || 'Zoho Services Tools'}
            </h1>
            <p className="hidden md:block text-xs text-slate-500 dark:text-slate-400">
              {toolTagline || 'A workspace of internal tools for the Zoho Services team.'}
            </p>
          </div>
        </Link>

        <nav className="flex items-center gap-1">
          {/* Back to all tools — shown inside a tool page */}
          {!isLanding && (
            <Link to="/" className="btn-ghost" title="Back to all tools">
              <Icon.ArrowLeft size={16} />
              <span className="hidden sm:inline">All tools</span>
            </Link>
          )}

          {/* ── Admin controls ─────────────────────────────────────── */}
          {isAdmin ? (
            <>
              {/* Admin panel shortcut — only show when NOT already on /admin */}
              {!onAdmin && (
                <Link
                  to="/admin"
                  className="btn-ghost"
                  title="Admin panel"
                >
                  <Icon.ShieldCheck size={16} />
                  <span className="hidden sm:inline">Admin</span>
                </Link>
              )}

              {/* Sign out */}
              <button
                onClick={handleLogout}
                className="btn-ghost"
                title="Sign out of admin"
              >
                <Icon.LogOut size={16} />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </>
          ) : (
            /* Admin login — subtle; shown on landing page only so public
               users who navigate into a tool aren't distracted by it */
            isLanding && (
              <Link
                to="/login"
                className="btn-ghost text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
                title="Admin login"
              >
                <Icon.Lock size={15} />
                <span className="hidden sm:inline text-xs">Admin</span>
              </Link>
            )
          )}
          {/* ─────────────────────────────────────────────────────── */}

          {/* Theme toggle */}
          <button
            onClick={toggle}
            className="btn-ghost ml-1"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Icon.Sun size={16} /> : <Icon.Moon size={16} />}
          </button>

          <span className="chip bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300 ml-1 font-medium">
            v0.5
          </span>
        </nav>
      </div>
    </header>
  );
}
