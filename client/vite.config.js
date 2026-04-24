import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Zoho Code IDE preview only proxies port 8080 (HTTP) / 8443 (HTTPS),
// so the dev server binds to 8080. The API stays on 3001 and is reached
// through the /api and /health proxies below.
export default defineConfig({
  plugins: [react()],
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
