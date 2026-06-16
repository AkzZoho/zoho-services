/**
 * ProtectedRoute — guards a route so only admins can access it.
 *
 * For tool routes (ds-analyser, tech-scope):
 *   If the tool is private AND the user is not an admin → redirect to /
 *   with a toast notification.
 *
 * For admin-only routes (/admin):
 *   If not an admin → redirect to /login.
 *
 * Usage in main.jsx:
 *   <Route path="ds-analyser/*" element={
 *     <ToolRoute toolId="ds-analyser"><DSAnalyserApp /></ToolRoute>
 *   } />
 *
 *   <Route path="admin" element={
 *     <AdminRoute><AdminPanel /></AdminRoute>
 *   } />
 */

import { useEffect, useRef } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAdminAuth } from './useAdminAuth.js';
import { useToolVisibility } from './useToolVisibility.js';
import { useToast } from '../components/Toast.jsx';

// ---------------------------------------------------------------------------
// AdminRoute — /admin is only accessible when isAdmin === true
// ---------------------------------------------------------------------------

export function AdminRoute({ children }) {
  const { isAdmin } = useAdminAuth();
  if (!isAdmin) return <Navigate to="/login" replace />;
  return children;
}

// ---------------------------------------------------------------------------
// ToolRoute — tool routes gated by tool visibility + admin status
// ---------------------------------------------------------------------------

export function ToolRoute({ toolId, children }) {
  const { isAdmin } = useAdminAuth();
  const { visibility, loading } = useToolVisibility();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const toasted = useRef(false);

  const isPublic = visibility[toolId] ?? false;
  const canAccess = isAdmin || isPublic;

  useEffect(() => {
    if (!loading && !canAccess && !toasted.current) {
      toasted.current = true;
      showToast(
        'This tool is not available. Contact your administrator.',
        'warn',
        4000
      );
      navigate('/', { replace: true });
    }
  }, [loading, canAccess, navigate, showToast]);

  // While visibility is loading, render nothing (avoids flash of tool then redirect)
  if (loading) return null;

  // Not accessible — the useEffect above will redirect; render null meanwhile
  if (!canAccess) return null;

  return children;
}
