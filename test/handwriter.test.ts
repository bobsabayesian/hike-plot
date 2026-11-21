import { describe, expect, it } from 'vitest';
import { handleHandwriter, handleHandwriterAdmin, parseHost, upstreamQuery, type HwConfig, type HwStore } from '../worker/handwriter';
import { parseInkSvg } from '../src/handwriter/ink';

const store = (init: HwConfig | null = null): HwStore & { cur: HwConfig | null } => {
  const s = { cur: init, get: async () => s.cur, put: async (c: HwConfig) => { s.cur = c; }, del: async () => { s.cur = null; } };
  return s;
};
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20.00mm" height="8.00mm" viewBox="0 0 20 8"><g stroke="#000" fill="none" stroke-width="0.4"><path d="M1 1 L5 7"/><path d="M6 7 C7 1 9 1 10 7"/></g></svg>';
const svgFetcher = (calls: { url: string; auth: string }[] = []) => async (url: string, init: { headers: Record<string, string> }) => {
  calls.push({ url, auth: init.headers.authorization! });
  return new Response(SVG, { headers: { 'x-handwriter-missing': 'U+00DF' } });
};
const put = (body: unknown) => new Request('http://x/api/admin/handwriter', { method: 'PUT', headers: { 'x-admin-action': 'handwriter' }, body: JSON.stringify(body) });

describe('handwriting service: admin', () => {
  it('accepts a public https host and rejects the rest', () => {
    expect(parseHost('hw.example.com/')).toEqual({ host: 'https://hw.example.com' });
    for (const bad of ['http://hw.example.com', 'https://localhost:8080', 'https://10.0.0.1', 'https://intranet', '']) expect(parseHost(bad)).toHaveProperty('error');
  });
  it('saves, hides the token, keeps it when only the address changes, and needs the header', async () => {
    const s = store();
    expect((await handleHandwriterAdmin(new Request('http://x/api/admin/handwriter', { method: 'PUT', body: '{}' }), s))!.status).toBe(400);
    const r = await handleHandwriterAdmin(put({ host: 'hw.example.com', token: 'proj.secret1234' }), s);
    expect(await r!.json()).toEqual({ configured: true, host: 'https://hw.example.com', tokenHint: '…1234' });
    await handleHandwriterAdmin(put({ host: 'other.example.com', token: '' }), s);
    expect(s.cur).toEqual({ host: 'https://other.example.com', token: 'proj.secret1234' });
    const got = await (await handleHandwriterAdmin(new Request('http://x/api/admin/handwriter'), s))!.text();
    expect(got).not.toContain('secret');
    expect((await handleHandwriterAdmin(put({ host: 'a.example.com', token: 'has space' }), store()))!.status).toBe(400);
  });
  it('tests the saved service', async () => {
    const s = store({ host: 'https://hw.example.com', token: 't' });
    const out = await (await handleHandwriterAdmin(new Request('http://x/api/admin/handwriter/test', { method: 'POST' }), s, svgFetcher()))!.json();
    expect(out).toEqual({ ok: true, paths: 2 });
    const refused = await (await handleHandwriterAdmin(new Request('http://x/api/admin/handwriter/test', { method: 'POST' }), s, async () => new Response('{}', { status: 401 })))!.json();
    expect(refused.ok).toBe(false);
  });
});

describe('handwriting service: the app-facing proxy', () => {
  it('is off until set up', async () => {
    expect(await (await handleHandwriter(new Request('http://x/api/handwriter/status'), store()))!.json()).toEqual({ enabled: false });
    expect((await handleHandwriter(new Request('http://x/api/handwriter/text?text=Hi'), store()))!.status).toBe(404);
  });
  it('sends the token to the service, never to the app, with margin 0', async () => {
    const calls: { url: string; auth: string }[] = [];
    const r = await handleHandwriter(new Request('http://x/api/handwriter/text?text=Hi%20there&size=14&seed=3&font=serif&preset=neat&token=evil'), store({ host: 'https://hw.example.com', token: 'proj.sec' }), svgFetcher(calls));
    expect(r!.headers.get('content-type')).toBe('image/svg+xml');
    expect(r!.headers.get('x-handwriter-missing')).toBe('U+00DF');
    expect(calls[0]!.auth).toBe('Bearer proj.sec');
    expect(calls[0]!.url).toContain('margin=0');
    expect(calls[0]!.url).toContain('text=Hi+there');
    expect(calls[0]!.url).not.toContain('evil');
    expect(await r!.text()).not.toContain('proj.sec');
  });
  it('validates the query', () => {
    expect(upstreamQuery(new URLSearchParams('text='))).toHaveProperty('error');
    expect(upstreamQuery(new URLSearchParams('text=' + 'a'.repeat(301)))).toHaveProperty('error');
    expect(upstreamQuery(new URLSearchParams('text=a&size=999'))).toHaveProperty('error');
    expect((upstreamQuery(new URLSearchParams('text=a&font=nope&align=up')) as URLSearchParams).has('font')).toBe(false);
  });
  it('maps service errors to plain ones', async () => {
    const s = store({ host: 'https://hw.example.com', token: 't' });
    expect((await handleHandwriter(new Request('http://x/api/handwriter/text?text=a'), s, async () => new Response('', { status: 409 })))!.status).toBe(409);
    expect((await handleHandwriter(new Request('http://x/api/handwriter/text?text=a'), s, async () => { throw new Error('down'); }))!.status).toBe(502);
  });
});

describe('reading the service\'s SVG', () => {
  it('turns paths into strokes in mm from the ink corner', () => {
    const ink = parseInkSvg(SVG, 'U+00DF')!;
    expect(ink.widthMm).toBe(20);
    expect(ink.heightMm).toBe(8);
    expect(ink.strokes).toHaveLength(2);
    expect(ink.strokes[0]).toEqual([[1, 1], [5, 7]]);
    expect(ink.strokes[1]!.length).toBeGreaterThan(3); // the curve is flattened
    expect(ink.missing).toBe('U+00DF');
  });
  it('applies group transforms and the viewBox origin', () => {
    const ink = parseInkSvg('<svg viewBox="2 3 10 5"><g transform="translate(4 1)"><path d="M0 0 L2 2"/></g><path d="M5 5 L6 6"/></svg>')!;
    expect(ink.strokes[0]).toEqual([[2, -2], [4, 0]]);
    expect(ink.strokes[1]).toEqual([[3, 2], [4, 3]]);
  });
  it('gives nothing for a page without strokes', () => {
    expect(parseInkSvg('<svg viewBox="0 0 1 1"></svg>')).toBeUndefined();
    expect(parseInkSvg('<html></html>')).toBeUndefined();
  });
});
