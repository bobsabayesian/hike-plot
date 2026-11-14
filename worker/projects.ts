/** Saved projects: one JSON file per project in the shared `project-files` bucket, under `hike/`. */

export const PREFIX = 'hike/';
export const MAX_BYTES = 4 * 1024 * 1024;
/** No 0/o, 1/l/i: a code read aloud or typed from a phone stays unambiguous. */
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const CODE_LEN = 8;
export const CODE_RE = new RegExp(`^[${ALPHABET}]{${CODE_LEN}}$`);

export const MAX_THUMB_BYTES = 300 * 1024;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

export interface Bucket {
  get(key: string): Promise<{ text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  head(key: string): Promise<unknown | null>;
  put(key: string, value: string | ArrayBuffer, opts?: { httpMetadata?: { contentType: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  list?(opts: { prefix: string; cursor?: string; include?: ('customMetadata')[] }): Promise<{
    objects: { key: string; size: number; uploaded: Date; customMetadata?: Record<string, string> }[]; truncated: boolean; cursor?: string;
  }>;
}

/** What the admin page shows about a project without opening its (large) file: stored with the object when it is saved. */
export function summarize(project: Record<string, any>, meta?: Record<string, any>): Record<string, string> {
  const points = Array.isArray(project.points) ? project.points.length : 0;
  const text = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback).slice(0, 120);
  // the title and place as printed on the poster come from the app; without them fall back to what the project itself holds
  const name = text(meta?.title) || text(project.lookup?.peakName) || text(project.feature?.name);
  const place = text(meta?.place) || text(project.lookup?.location);
  const waypoints = Array.isArray(project.waypoints) ? project.waypoints.length : 0;
  return {
    name, place, distance: text(meta?.distance), gain: text(meta?.gain), size: text(meta?.size),
    points: String(points), waypoints: String(waypoints), savedAt: new Date().toISOString(),
  };
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });

export function newCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  let out = '';
  // rejection sampling keeps every letter equally likely
  while (out.length < CODE_LEN) {
    for (const b of random(CODE_LEN * 2)) {
      if (b < 248 && out.length < CODE_LEN) out += ALPHABET[b % ALPHABET.length];
    }
  }
  return out;
}

/** Normalizes what a person typed or pasted: spaces and case are fine, and so is a whole link with `?p=code` in it. */
export const cleanCode = (s: string): string => {
  const t = s.trim().toLowerCase();
  const m = t.match(/[?&#]p=([^&#\s]+)/);
  const c = (m ? m[1]! : t).replace(/[\s-]/g, '');
  return CODE_RE.test(c) ? c : '';
};

/** The file a project is saved as: the settings, with the GPX track and waypoints inside, so one code restores everything. */
export async function handleProjects(req: Request, bucket: Bucket | undefined, url = new URL(req.url)): Promise<Response | null> {
  if (url.pathname !== '/api/project' && !url.pathname.startsWith('/api/project/')) return null;
  if (!bucket) return json({ error: 'saving is not set up on this server' }, 503);

  if (url.pathname === '/api/project') {
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    const declared = +(req.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) return json({ error: 'project too large' }, 413);
    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ error: 'project too large' }, 413);
    let doc: unknown;
    try { doc = JSON.parse(text); } catch { return json({ error: 'not valid JSON' }, 400); }
    const d = doc as { app?: unknown; version?: unknown; project?: unknown } | null;
    if (!d || d.app !== 'walk-of-frame' || typeof d.version !== 'number' || typeof d.project !== 'object' || d.project === null) {
      return json({ error: 'not a Walk of Frame project' }, 400);
    }
    // a new code every time: nobody can overwrite someone else's saved project
    for (let i = 0; i < 5; i++) {
      const code = newCode();
      if (await bucket.head(PREFIX + code + '.json')) continue;
      await bucket.put(PREFIX + code + '.json', text, { httpMetadata: { contentType: 'application/json' }, customMetadata: summarize(d.project as Record<string, any>, (d as { meta?: Record<string, any> }).meta) });
      return json({ code }, 201);
    }
    return json({ error: 'could not make a code, try again' }, 503);
  }

  // the small picture saved beside a project, for the admin page: written once, so it cannot be swapped afterwards
  const thumb = /^\/api\/project\/([^/]+)\/thumb$/.exec(url.pathname);
  if (thumb) {
    if (req.method !== 'PUT') return json({ error: 'method not allowed' }, 405);
    const c = decodeURIComponent(thumb[1]!);
    if (!CODE_RE.test(c)) return json({ error: 'not a project code' }, 400);
    if (!(await bucket.head(PREFIX + c + '.json'))) return json({ error: 'no project with that code' }, 404);
    if (await bucket.head(PREFIX + c + '.png')) return json({ error: 'already has a picture' }, 409);
    const bytes = await req.arrayBuffer();
    if (bytes.byteLength > MAX_THUMB_BYTES) return json({ error: 'picture too large' }, 413);
    const head = new Uint8Array(bytes.slice(0, 4));
    if (!PNG_MAGIC.every((b, i) => head[i] === b)) return json({ error: 'not a PNG' }, 400);
    await bucket.put(PREFIX + c + '.png', bytes, { httpMetadata: { contentType: 'image/png' } });
    return json({ ok: true }, 201);
  }

  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);
  const code = decodeURIComponent(url.pathname.slice('/api/project/'.length));
  if (!CODE_RE.test(code)) return json({ error: 'not a project code' }, 400);
  const obj = await bucket.get(PREFIX + code + '.json');
  if (!obj) return json({ error: 'no project with that code' }, 404);
  // a track can show where someone lives: keep it out of shared caches
  return new Response(await obj.text(), { headers: { 'content-type': 'application/json', 'cache-control': 'private, max-age=300' } });
}
