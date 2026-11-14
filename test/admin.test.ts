import { describe, expect, it } from 'vitest';
import { handleAdmin, type AdminObject } from '../worker/admin';
import { summarize } from '../worker/projects';
import { teamDomain, tokenOf, verifyAccess } from '../worker/access';
import worker from '../worker/index';

const objs: AdminObject[] = [
  { key: 'hike/abcd2345.json', size: 2000, uploaded: Date.parse('2026-11-01T10:00:00Z'), meta: { name: 'Mount Massive', place: 'Colorado', distance: '9.3 mi', gain: '4,957 ft', size: '18 × 24 in', points: '420', waypoints: '2', savedAt: '2026-11-01T10:00:00Z' } },
  { key: 'hike/abcd2345.png', size: 900, uploaded: 0 },
  { key: 'hike/zzzz2222.json', size: 500, uploaded: Date.parse('2026-11-05T10:00:00Z') },
  { key: 'hike/notacode.json', size: 5, uploaded: 0 },
  { key: 'hike/sub/dir.json', size: 5, uploaded: 0 },
  { key: 'other/thing.json', size: 5, uploaded: 0 },
];
const thumbs: Record<string, ArrayBuffer> = { abcd2345: new Uint8Array([1, 2, 3]).buffer };
const store = { listObjects: async (prefix: string) => objs.filter((o) => o.key.startsWith(prefix)), getThumb: async (c: string) => thumbs[c] ?? null };
const get = (path: string) => new Request('https://x.test' + path);

describe('admin data', () => {
  it('lists saved projects newest first, with totals, and skips anything that is not a project file', async () => {
    const res = (await handleAdmin(get('/api/admin/summary'), store))!;
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { projects: { code: string; name: string; points: number; savedAt: string }[]; totals: { projects: number; bytes: number } };
    expect(body.projects.map((p) => p.code)).toEqual(['zzzz2222', 'abcd2345']);
    expect(body.projects[1]).toMatchObject({ name: 'Mount Massive', points: 420, distance: '9.3 mi', gain: '4,957 ft', size: '18 × 24 in', thumb: true });
    expect(body.projects[0]).toMatchObject({ thumb: false, distance: '' });
    expect(body.projects[0]!.name).toBe(''); // saved before names were stored: the date still shows
    expect(body.projects[0]!.savedAt).toBe('2026-11-05T10:00:00.000Z');
    expect(body.totals).toEqual({ projects: 2, bytes: 2500 });
  });
  it('serves a project\'s picture, and 404s when there is none or the code is malformed', async () => {
    const ok = (await handleAdmin(get('/api/admin/thumb/abcd2345'), store))!;
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect((await handleAdmin(get('/api/admin/thumb/zzzz2222'), store))!.status).toBe(404);
    expect((await handleAdmin(get('/api/admin/thumb/nope'), store))!.status).toBe(404);
  });
  it('is read-only, and ignores other paths', async () => {
    expect((await handleAdmin(new Request('https://x.test/api/admin/summary', { method: 'POST' }), store))!.status).toBe(405);
    expect((await handleAdmin(get('/api/admin/other'), store))!.status).toBe(404);
    expect(await handleAdmin(get('/api/project/abcd2345'), store)).toBeNull();
  });
  it('a saved project keeps a name, place and counts beside it', () => {
    const m = summarize({ points: [1, 2, 3], waypoints: [1], lookup: { peakName: 'Mount Massive', location: 'Lake County, Colorado' } });
    expect(m).toMatchObject({ name: 'Mount Massive', place: 'Lake County, Colorado', points: '3', waypoints: '1' });
    expect(summarize({ feature: { name: 'Grand Canyon' } }).name).toBe('Grand Canyon');
    expect(summarize({}).points).toBe('0');
  });
});

describe('the admin page is shut unless Access vouches for the request', () => {
  const env = (extra = {}) => ({ ASSETS: { fetch: async () => new Response('asset') }, ...extra });
  it('answers 503 until Access is set up', async () => {
    expect((await worker.fetch(get('/admin'), env())).status).toBe(503);
    expect((await worker.fetch(get('/api/admin/summary'), env({ ACCESS_TEAM_DOMAIN: 'team' }))).status).toBe(503);
  });
  it('answers 403 without a genuine token, even when set up', async () => {
    const e = env({ ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud' });
    expect((await worker.fetch(get('/admin'), e)).status).toBe(403);
    expect((await worker.fetch(new Request('https://x.test/api/admin/summary', { headers: { 'cf-access-jwt-assertion': 'a.b.c' } }), e)).status).toBe(403);
  });
  it('the public project routes are not behind Access', async () => {
    const res = await worker.fetch(get('/api/project/abcd2345'), env());
    expect(res.status).toBe(503); // "saving is not set up" (no bucket in this test), not 403
  });
  it('reads the token from the header or the cookie, and tidies a team name', async () => {
    expect(tokenOf(new Request('https://x.test', { headers: { 'cf-access-jwt-assertion': 'H' } }))).toBe('H');
    expect(tokenOf(new Request('https://x.test', { headers: { cookie: 'a=1; CF_Authorization=C; b=2' } }))).toBe('C');
    expect(tokenOf(get('/'))).toBeNull();
    expect(teamDomain('Acme')).toBe('acme.cloudflareaccess.com');
    expect(await verifyAccess(get('/'), { team: 'acme', aud: 'x' })).toBeNull();
  });
});
