/**
 * A handwriting service of the owner's (another project that draws text as single-line SVG strokes, see README "Handwriting service").
 * The admin page stores its address and token in R2; the token never reaches a browser: the app asks this Worker, which asks the service.
 *
 *   GET/PUT/DELETE /api/admin/handwriter  (Access only)  read (token hidden), save { host, token }, remove
 *   POST /api/admin/handwriter/test       (Access only)  draw a word to check the address and token
 *   GET /api/handwriter/status            -> { enabled }
 *   GET /api/handwriter/text?text=&size=&font=&preset=&seed=&align=&width=  -> the SVG, margin 0
 */

export const CONFIG_KEY = 'hike/admin/handwriter.json';
export interface HwConfig { host: string; token: string }
export interface HwStore {
  get(): Promise<HwConfig | null>;
  put(c: HwConfig): Promise<void>;
  del(): Promise<void>;
}
type Fetcher = (url: string, init: { headers: Record<string, string> }) => Promise<Response>;

export const FONTS = ['handwriting', 'sans', 'sans-bold', 'serif', 'serif-italic', 'script', 'gothic'];
export const PRESETS = ['natural', 'neat', 'messy', 'cursive'];
export const MAX_TEXT = 300;

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });

/** The service's origin from what was typed ("https://hw.example.com/", "hw.example.com"), or an error. Public https hosts only. */
export function parseHost(input: string): { host: string } | { error: string } {
  let s = input.trim();
  if (!s) return { error: 'Enter the service address.' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try { u = new URL(s); } catch { return { error: 'That is not a web address.' }; }
  if (u.protocol !== 'https:') return { error: 'The address must start with https://.' };
  const h = u.hostname;
  if (!h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':') || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return { error: 'Use the service\'s public host name.' };
  return { host: u.origin };
}

const clean = (v: string | null, allowed: string[]) => (v && allowed.includes(v) ? v : undefined);

/** Validate the app's query and build the service's. Undefined means "not acceptable". */
export function upstreamQuery(q: URLSearchParams): URLSearchParams | { error: string } {
  const text = q.get('text') ?? '';
  if (!text.trim()) return { error: 'text is required' };
  if (text.length > MAX_TEXT) return { error: `text is limited to ${MAX_TEXT} characters` };
  const num = (k: string, lo: number, hi: number) => { const v = q.get(k); if (v === null || v === '') return undefined; const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : NaN; };
  const size = num('size', 1, 200), width = num('width', 5, 2000), seed = num('seed', -2147483648, 2147483647);
  if ([size, width, seed].some((n) => Number.isNaN(n))) return { error: 'bad size, width or seed' };
  const out = new URLSearchParams({ text, margin: '0' });
  if (size !== undefined) out.set('size', String(size));
  if (width !== undefined) out.set('width', String(width));
  if (seed !== undefined) out.set('seed', String(Math.trunc(seed)));
  const font = clean(q.get('font'), FONTS), preset = clean(q.get('preset'), PRESETS), align = clean(q.get('align'), ['left', 'center', 'right']);
  if (font) out.set('font', font);
  if (preset) out.set('preset', preset);
  if (align) out.set('align', align);
  return out;
}

async function ask(cfg: HwConfig, params: URLSearchParams, fetcher: Fetcher): Promise<Response> {
  try {
    return await fetcher(`${cfg.host}/api/v1/text.svg?${params}`, { headers: { authorization: `Bearer ${cfg.token}`, accept: 'image/svg+xml' } });
  } catch {
    return json(502, { error: 'The handwriting service could not be reached.' });
  }
}

export async function handleHandwriterAdmin(req: Request, store: HwStore, fetcher: Fetcher = (u, i) => fetch(u, i)): Promise<Response | null> {
  const path = new URL(req.url).pathname;
  if (path === '/api/admin/handwriter/test') {
    if (req.method !== 'POST') return json(405, { error: 'POST only' });
    const cfg = await store.get();
    if (!cfg) return json(404, { error: 'Nothing is saved yet.' });
    const r = await ask(cfg, new URLSearchParams({ text: 'Hello', size: '12', margin: '0' }), fetcher);
    const body = r.ok ? await r.text() : '';
    if (r.ok && body.includes('<svg')) return json(200, { ok: true, paths: (body.match(/<path\b/g) ?? []).length });
    return json(200, { ok: false, error: r.status === 401 ? 'The service did not accept the token.' : r.status === 409 ? 'That project has no handwriting yet.' : r.ok ? 'The reply was not an SVG.' : `The service answered ${r.status}.` });
  }
  if (path !== '/api/admin/handwriter') return null;
  if (req.method === 'GET') {
    const cfg = await store.get();
    return json(200, cfg ? { configured: true, host: cfg.host, tokenHint: `…${cfg.token.slice(-4)}` } : { configured: false });
  }
  // changes need the custom header: a page on another site cannot send it without a preflight, which this site never answers
  if (req.headers.get('x-admin-action') !== 'handwriter') return json(400, { error: 'missing confirmation header' });
  if (req.method === 'DELETE') { await store.del(); return json(200, { configured: false }); }
  if (req.method === 'PUT') {
    let body: { host?: unknown; token?: unknown };
    try { body = await req.json(); } catch { return json(400, { error: 'not JSON' }); }
    const host = parseHost(typeof body.host === 'string' ? body.host : '');
    if ('error' in host) return json(400, host);
    const prev = await store.get();
    // an empty token keeps the saved one, so the address can be changed without pasting the token again
    const token = typeof body.token === 'string' && body.token.trim() ? body.token.trim() : prev?.token;
    if (!token || token.length > 400 || /\s/.test(token)) return json(400, { error: 'Paste the token from the service.' });
    await store.put({ host: host.host, token });
    return json(200, { configured: true, host: host.host, tokenHint: `…${token.slice(-4)}` });
  }
  return json(405, { error: 'GET, PUT or DELETE only' });
}

export async function handleHandwriter(req: Request, store: HwStore | undefined, fetcher: Fetcher = (u, i) => fetch(u, i)): Promise<Response | null> {
  const url = new URL(req.url);
  if (url.pathname !== '/api/handwriter/status' && url.pathname !== '/api/handwriter/text') return null;
  if (req.method !== 'GET') return json(405, { error: 'GET only' });
  const cfg = store ? await store.get() : null;
  if (url.pathname === '/api/handwriter/status') return json(200, { enabled: !!cfg }, { 'cache-control': 'public, max-age=60' });
  if (!cfg) return json(404, { error: 'No handwriting service is set up.' });
  const q = upstreamQuery(url.searchParams);
  if ('error' in q) return json(400, q);
  const r = await ask(cfg, q, fetcher);
  if (r.status === 502 && r.headers.get('content-type')?.includes('json')) return r;
  if (!r.ok) return json(r.status === 409 ? 409 : 502, { error: r.status === 409 ? 'The handwriting project has no handwriting yet.' : r.status === 401 ? 'The service did not accept the saved token.' : `The service answered ${r.status}.` });
  const headers: Record<string, string> = { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600' };
  const missing = r.headers.get('x-handwriter-missing');
  if (missing) headers['x-handwriter-missing'] = missing;
  return new Response(await r.text(), { headers });
}
