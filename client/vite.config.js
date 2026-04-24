import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Zoho Code IDE preview only proxies port 8080 (HTTP) / 8443 (HTTPS),
// so the dev server binds to 8080. The API stays on 3001 and is reached
// through the /api and /health proxies below.
//
// --- Production (Catalyst Slate) ---
// Slate serves the SPA from a separate domain (*.onslate.in).
// The Catalyst Advanced I/O function lives on *.catalystserverless.com.
// Because these are different origins, all API calls MUST use a fully
// qualified URL — relative paths like /api/inspect would hit the Slate
// CDN and return 404.
//
// Set VITE_API_BASE at Slate build time to the function's base URL:
//   VITE_API_BASE=https://<project>.catalystserverless.com/server/ds-analyzer
//
// In local dev, leave VITE_API_BASE unset; the Vite proxy forwards
// /api and /health to http://localhost:3001 automatically.
export default defineConfig({
  plugins: [react()],
  // base: './' makes asset paths in index.html relative (./assets/...)
  // instead of root-absolute (/assets/...).  Catalyst Slate's CDN serves
  // the bundle from its own origin so absolute paths would 404.
  base: './',
  server: {
    port: 8080,
    host: true,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:3001',
      '/health': 'http://localhost:3001',
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
