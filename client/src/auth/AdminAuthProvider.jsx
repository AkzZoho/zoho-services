/**
 * AdminAuthProvider — wraps the app with admin auth context.
 * Import this in main.jsx and wrap <BrowserRouter> with it.
 */
import { AdminAuthContext, useAdminAuthState } from './useAdminAuth.js';

export default function AdminAuthProvider({ children }) {
  const auth = useAdminAuthState();
  return (
    <AdminAuthContext.Provider value={auth}>
      {children}
    </AdminAuthContext.Provider>
  );
}
