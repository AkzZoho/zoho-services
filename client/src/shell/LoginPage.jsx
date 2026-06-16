/**
 * LoginPage — Admin login screen.
 *
 * Renders as a full-page centred card. On success, navigates to /admin.
 * The component is intentionally minimal — this is a soft gate, not a
 * hardened auth flow. See useAdminAuth.js for the security model notes.
 */

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icons.jsx';
import { useAdminAuth } from '../auth/useAdminAuth.js';
import { useToast } from '../components/Toast.jsx';

export default function LoginPage() {
  const { isAdmin, login } = useAdminAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [pwd, setPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  // Already logged in — bounce straight to admin panel
  useEffect(() => {
    if (isAdmin) navigate('/admin', { replace: true });
  }, [isAdmin, navigate]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Tiny artificial delay so the button doesn't flash immediately
    setTimeout(() => {
      const ok = login(pwd);
      setLoading(false);
      if (ok) {
        showToast('Welcome back, Admin!', 'success');
        navigate('/admin', { replace: true });
      } else {
        setError('Incorrect password. Please try again.');
        setPwd('');
        inputRef.current?.focus();
      }
    }, 300);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-slate-50 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        {/* Card */}
        <div className="card p-8 space-y-6 shadow-md">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="mx-auto w-12 h-12 rounded-full bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center">
              <Icon.ShieldCheck size={24} className="text-brand-600 dark:text-brand-400" />
            </div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              Admin Login
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Enter the admin password to manage tool visibility.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Password field */}
            <div className="space-y-1.5">
              <label
                htmlFor="admin-pwd"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Password
              </label>
              <div className="relative">
                <input
                  ref={inputRef}
                  id="admin-pwd"
                  type={showPwd ? 'text' : 'password'}
                  value={pwd}
                  onChange={(e) => {
                    setPwd(e.target.value);
                    if (error) setError('');
                  }}
                  className={[
                    'input pr-10',
                    error ? 'border-red-400 focus:ring-red-400 focus:border-red-400' : '',
                  ].join(' ')}
                  placeholder="Enter admin password"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition"
                  aria-label={showPwd ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPwd ? <Icon.EyeOff size={16} /> : <Icon.Eye size={16} />}
                </button>
              </div>

              {/* Inline error */}
              {error && (
                <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1 mt-1">
                  <Icon.Warning size={13} />
                  {error}
                </p>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !pwd}
              className="btn-primary w-full justify-center"
            >
              {loading ? (
                <>
                  <Icon.Spinner size={16} />
                  Verifying…
                </>
              ) : (
                <>
                  <Icon.Lock size={16} />
                  Sign in as Admin
                </>
              )}
            </button>
          </form>

          {/* Back link */}
          <div className="text-center">
            <a
              href="/"
              onClick={(e) => { e.preventDefault(); navigate('/'); }}
              className="text-xs text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 transition"
            >
              ← Back to tools
            </a>
          </div>
        </div>

        {/* Soft security note */}
        <p className="mt-4 text-center text-xs text-slate-400 dark:text-slate-600">
          This is a UI-only gate for internal team use.
        </p>
      </div>
    </div>
  );
}
