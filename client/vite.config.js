import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During development the React app runs on :5173 and proxies all /api
// requests to the Express server on :4000 — so the browser only ever
// talks to one origin and there are no CORS surprises.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The prompt rules are imported from ../shared (also used by the server),
    // which sits outside the Vite root — allow serving from the repo root.
    fs: {
      allow: [fileURLToPath(new URL('..', import.meta.url))],
    },
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
