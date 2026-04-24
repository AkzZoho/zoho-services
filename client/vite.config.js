import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Zoho Code IDE preview only proxies port 8080 (HTTP) / 8443 (HTTPS),
// so the dev server binds to 8080. The API stays on 3001 and is reached
// through the /api and /health proxies below.
//
// --- Production (Catalyst web-client hosting) ---
// The SPA is deployed via `catalyst.json` client.source → client/dist.
// Catalyst serves the web client and the Advanced I/O function from the
// SAME origin (*.catalystapps.com).  The function is accessible at the
// path /server/ds-analyzer relative to that origin.
//
// http.js detects non-localhost hostnames at runtime and automatically
// prepends /server/ds-analyzer — no build-time env var needed for the
// standard Catalyst web-client hosting setup.
//
// --- Production (Catalyst Slate — cross-origin) ---
// If the SPA is hosted on Slate (*.onslate.in), the function is on a
// different origin.  Set VITE_API_BASE at Slate build time:
//   VITE_API_BASE=https://<project>.catalystapps.com/server/ds-analyzer
// http.js uses VITE_API_BASE when set, falling back to runtime detection.
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
