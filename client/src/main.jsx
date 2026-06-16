import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import { ThemeProvider } from './theme/ThemeProvider.jsx';
import AdminAuthProvider from './auth/AdminAuthProvider.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { AdminRoute, ToolRoute } from './auth/ProtectedRoute.jsx';

import ShellLayout from './shell/ShellLayout.jsx';
import LandingPage from './shell/LandingPage.jsx';
import LoginPage from './shell/LoginPage.jsx';
import AdminPanel from './shell/AdminPanel.jsx';
import DSAnalyserApp from './tools/ds-analyser/DSAnalyserApp.jsx';
import TechScopeApp from './tools/tech-scope/TechScopeApp.jsx';

import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      {/*
        AdminAuthProvider must be OUTSIDE BrowserRouter so useAdminAuthState
        initialises before any route guard reads it.
        ToastProvider must wrap everything so toasts work inside route guards.
      */}
      <AdminAuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              {/* Shell wraps all routes that show the top navigation bar */}
              <Route element={<ShellLayout />}>
                <Route index element={<LandingPage />} />

                {/* Tool routes — gated by tool visibility */}
                <Route
                  path="ds-analyser/*"
                  element={
                    <ToolRoute toolId="ds-analyser">
                      <DSAnalyserApp />
                    </ToolRoute>
                  }
                />
                <Route
                  path="tech-scope/*"
                  element={
                    <ToolRoute toolId="tech-scope">
                      <TechScopeApp />
                    </ToolRoute>
                  }
                />

                {/* Admin panel — only visible to admins */}
                <Route
                  path="admin"
                  element={
                    <AdminRoute>
                      <AdminPanel />
                    </AdminRoute>
                  }
                />

                {/* Catch-all */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>

              {/*
                Login page lives OUTSIDE ShellLayout — it has its own
                full-page layout with no top navigation bar.
              */}
              <Route path="login" element={<LoginPage />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </AdminAuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);
