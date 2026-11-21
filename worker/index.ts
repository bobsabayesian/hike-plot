import { handleApi } from './api';
import { handleProjects, type Bucket } from './projects';
import { handleAdmin } from './admin';
import { handleShare, type ShareBucket } from './share';
import { handlePhoto, type PhotoBucket } from './photo';
import { verifyAccess } from './access';
import { handleHandwriter, handleHandwriterAdmin, CONFIG_KEY, type HwStore } from './handwriter';

/** the handwriting service's address and token, kept in the bucket beside the projects */
const hwStore = (b?: Bucket & ShareBucket): HwStore | undefined => b && {
  get: async () => { const o = await b.get(CONFIG_KEY); try { return o ? JSON.parse(await o.text()) : null; } catch { return null; } },
  put: async (c) => { await b.put(CONFIG_KEY, JSON.stringify(c), { httpMetadata: { contentType: 'application/json' } }); },
  del: async () => { await (b as unknown as { delete(k: string): Promise<void> }).delete(CONFIG_KEY); },
};

interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  PROJECTS?: Bucket & ShareBucket;
  /** the Cloudflare Access (Zero Trust) application that protects /admin: the team name and the application's AUD tag. Both must be set, or the admin page stays shut. */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/')) {
      // the admin page lists everyone's saved projects: only a request with a genuine Access token for this application gets in
      const headers = { 'cache-control': 'no-store' };
      if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return new Response('The admin page is switched off: set ACCESS_TEAM_DOMAIN and ACCESS_AUD (see the README).', { status: 503, headers });
      const user = await verifyAccess(req, { team: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD });
      if (!user) return new Response('Not signed in through Cloudflare Access.', { status: 403, headers });
      if (path === '/api/admin/me') return new Response(JSON.stringify({ email: user.email }), { headers: { 'content-type': 'application/json', ...headers } });
      const bucket = env.PROJECTS;
      const hw = hwStore(bucket);
      const hwApi = hw && (await handleHandwriterAdmin(req, hw));
      if (hwApi) return hwApi;
      const api = await handleAdmin(req, {
        listObjects: async (prefix) => {
          const out: { key: string; size: number; uploaded: number; meta?: Record<string, string> }[] = [];
          let cursor: string | undefined;
          do {
            const r = await bucket!.list!({ prefix, cursor, include: ['customMetadata'] });
            out.push(...r.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded.getTime(), meta: o.customMetadata })));
            cursor = r.truncated ? r.cursor : undefined;
          } while (cursor);
          return out;
        },
        deleteProject: async (code) => { await bucket!.delete([`hike/${code}.json`, `hike/${code}.png`]); },
        getThumb: async (code) => { const o = await bucket!.get(`hike/${code}.png`); return o ? o.arrayBuffer() : null; },
      });
      if (api) return api;
      const page = await env.ASSETS.fetch(req);
      return new Response(page.body, { status: page.status, headers: { ...Object.fromEntries(page.headers), ...headers } });
    }
    return (await handleHandwriter(req, hwStore(env.PROJECTS))) ?? (await handlePhoto(req, env.PROJECTS as unknown as PhotoBucket)) ?? (await handleShare(req, env.PROJECTS)) ?? (await handleProjects(req, env.PROJECTS)) ?? (await handleApi(req)) ?? env.ASSETS.fetch(req);
  },
};
