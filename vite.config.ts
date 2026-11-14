import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { Readable } from 'node:stream';
import { resolve } from 'node:path';
import { handleApi } from './worker/api.ts';
import { handleAdmin } from './worker/admin.ts';

/** Serve /api/* from the same handlers the Cloudflare Worker uses, so `npm run dev` needs no second process. */
const devApi = {
  name: 'dev-api',
  configureServer(server: import('vite').ViteDevServer) {
    server.middlewares.use(async (req, res, next) => {
      // the admin page under `npm run dev` only: no Access here (the dev server is on your own machine) and no saved projects (they live in R2)
      if (req.url === '/admin' || req.url === '/admin/') { req.url = '/admin.html'; return next(); }
      if (req.url === '/api/admin/me') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ email: 'local dev server' })); return; }
      if (req.url?.startsWith('/api/admin/')) {
        const out = await handleAdmin(new Request(`http://localhost${req.url}`), { listObjects: async () => [] });
        if (!out) return next();
        res.statusCode = out.status;
        out.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(await out.text());
        return;
      }
      if (!req.url?.startsWith('/api/')) return next();
      const out = await handleApi(new Request(`http://localhost${req.url}`, { method: req.method }));
      if (!out) return next();
      res.statusCode = out.status;
      out.headers.forEach((v, k) => res.setHeader(k, v));
      Readable.fromWeb(out.body as any).pipe(res);
    });
  },
};

export default defineConfig({
  plugins: [react(), devApi],
  build: {
    // two pages: the app, and the admin page (behind Access)
    rolldownOptions: { input: { main: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'admin.html') } },
  },
  test: { include: ['test/**/*.test.ts'] },
});
