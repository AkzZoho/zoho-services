import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server binds to 8080 (Zoho Code IDE preview only proxies 8080 HTTP /
// 8443 HTTPS). The API stays on 3001 and is reached through the /api and
// /health proxies below.
//
// --- Production ---
// Build the SPA with `npm run build` (outputs to client/dist). Serve those
// static files from any host (Nginx, Vercel, Netlify, Cloudflare Pages, …)
// and route /api and /health to the Node API at functions/ds-analyzer.
//
// If the SPA and the API are on the SAME origin (preferred — same domain,
// reverse proxy splits paths), leave VITE_API_BASE empty.
//
// If they are on DIFFERENT origins, set VITE_API_BASE at build time to the
// absolute API URL, e.g.
//   VITE_API_BASE=https://api.example.com
// `client/src/tools/ds-analyser/lib/http.js` picks this up automatically.
export default defineConfig({
  plugins: [react()],
  // base: './' makes asset paths in index.html relative (./assets/...) which
  // is friendlier when serving the bundle from a CDN or sub-path.
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
