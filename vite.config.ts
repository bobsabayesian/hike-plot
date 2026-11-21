import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { Readable } from 'node:stream';
import { resolve } from 'node:path';
import { handleApi } from './worker/api.ts';
import { handleAdmin } from './worker/admin.ts';
import { handleHandwriter, handleHandwriterAdmin, type HwConfig } from './worker/handwriter.ts';
import { handlePhoto, type PhotoBucket } from './worker/photo.ts';

// the phone relay under `npm run dev`: an in-memory bucket, so the QR flow can be tried without R2
const devPhotos = new Map<string, { text: string; uploaded: Date }>();
const devPhotoBucket: PhotoBucket = {
  get: async (k) => { const v = devPhotos.get(k); return v ? { text: async () => v.text, uploaded: v.uploaded } : null; },
  put: async (k, v) => { devPhotos.set(k, { text: String(v), uploaded: new Date() }); },
  delete: async (ks) => { for (const k of [ks].flat()) devPhotos.delete(k); },
};

// the handwriting service's setting under `npm run dev`: kept in memory (it lives in R2 when deployed)
let devHw: HwConfig | null = null;
const devHwStore = { get: async () => devHw, put: async (c: HwConfig) => { devHw = c; }, del: async () => { devHw = null; } };

/** Serve /api/* from the same handlers the Cloudflare Worker uses, so `npm run dev` needs no second process. */
const devApi = {
  name: 'dev-api',
  configureServer(server: import('vite').ViteDevServer) {
    server.middlewares.use(async (req, res, next) => {
      // the admin page under `npm run dev` only: no Access here (the dev server is on your own machine) and no saved projects (they live in R2)
      if (req.url === '/admin' || req.url === '/admin/') { req.url = '/admin.html'; return next(); }
      if (req.url === '/api/admin/me') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ email: 'local dev server' })); return; }
      if (req.url?.startsWith('/api/handwriter/') || req.url?.startsWith('/api/admin/handwriter')) {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const r = new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
        const out = (await handleHandwriterAdmin(r, devHwStore)) ?? (await handleHandwriter(r, devHwStore));
        if (out) { res.statusCode = out.status; out.headers.forEach((v, k) => res.setHeader(k, v)); res.end(await out.text()); return; }
      }
      if (req.url?.startsWith('/api/admin/')) {
        const out = await handleAdmin(new Request(`http://localhost${req.url}`), { listObjects: async () => [] });
        if (!out) return next();
        res.statusCode = out.status;
        out.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(await out.text());
        return;
      }
      if (req.url === '/phone' || req.url?.startsWith('/phone?')) { req.url = '/phone.html' + (req.url.slice(6) || ''); return next(); }
      if (req.url?.startsWith('/api/photo')) {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const out = await handlePhoto(new Request(`http://localhost${req.url}`, { method: req.method, headers: { 'content-type': 'application/json' }, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), devPhotoBucket);
        res.statusCode = out!.status;
        out!.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(await out!.text());
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
    rolldownOptions: { input: { main: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'admin.html'), phone: resolve(__dirname, 'phone.html') } },
  },
  test: { include: ['test/**/*.test.ts'] },
});
