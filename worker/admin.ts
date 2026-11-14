import { CODE_RE, PREFIX } from './projects';

/**
 * The admin page's data: every saved project, read-only. Reached at /admin (the page) and /api/admin/* (its data), both behind
 * Cloudflare Access and checked again in the Worker (see access.ts): index.ts lets a request in here only once its Access token is verified.
 */

export interface AdminObject { key: string; size: number; uploaded: number; meta?: Record<string, string> }
export interface AdminStore {
  listObjects(prefix: string): Promise<AdminObject[]>;
  /** the picture saved beside a project, if there is one */
  getThumb?(code: string): Promise<ArrayBuffer | null>;
}

export interface ProjectSummary {
  code: string; name: string; place: string; savedAt: string; bytes: number; points: number; waypoints: number;
  distance: string; gain: string; size: string; thumb: boolean;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/**
 *   GET /api/admin/thumb/<code> -> the project's small picture (PNG)
 *   GET /api/admin/summary -> { projects: [{ code, name, place, savedAt, bytes, points, waypoints }], totals: { projects, bytes } }, newest first
 * The name, place and counts were stored with each file when it was saved; a file saved before that shows only its code and date.
 */
export async function handleAdmin(req: Request, store: AdminStore): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith('/api/admin/')) return null;
  if (req.method !== 'GET') return json(405, { error: 'GET only' });
  const t = /^\/api\/admin\/thumb\/([^/]+)$/.exec(url.pathname);
  if (t) {
    const code = decodeURIComponent(t[1]!);
    const img = CODE_RE.test(code) ? await store.getThumb?.(code) : null;
    return img ? new Response(img, { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=3600' } }) : json(404, { error: 'no picture' });
  }
  if (url.pathname !== '/api/admin/summary') return json(404, { error: 'not found' });

  const objects = await store.listObjects(PREFIX);
  const withThumb = new Set(objects.map((o) => /^hike\/([^/]+)\.png$/.exec(o.key)?.[1]).filter((c): c is string => !!c));
  const projects: ProjectSummary[] = [];
  for (const o of objects) {
    const m = /^hike\/([^/]+)\.json$/.exec(o.key);
    if (!m || !CODE_RE.test(m[1]!)) continue;
    const meta = o.meta ?? {};
    projects.push({
      code: m[1]!, name: meta.name ?? '', place: meta.place ?? '', savedAt: meta.savedAt ?? new Date(o.uploaded).toISOString(),
      bytes: o.size, points: +(meta.points ?? 0) || 0, waypoints: +(meta.waypoints ?? 0) || 0,
      distance: meta.distance ?? '', gain: meta.gain ?? '', size: meta.size ?? '', thumb: withThumb.has(m[1]!),
    });
  }
  projects.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  return json(200, { projects, totals: { projects: projects.length, bytes: projects.reduce((t, p) => t + p.bytes, 0) } });
}
