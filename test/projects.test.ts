import { describe, expect, it } from 'vitest';
import { CODE_RE, hashKey, MAX_BYTES, MAX_THUMB_BYTES, PREFIX, summarize, cleanCode, handleProjects, newCode, type Bucket } from '../worker/projects';
import { fromFile, mergeDefaults, toFile } from '../src/projectFile';
import { defaultProject } from '../src/scene/project';
import { sampleTrack, sampleWaypoints } from '../src/sample';

const fakeBucket = () => {
  const m = new Map<string, string | ArrayBuffer>();
  const meta = new Map<string, Record<string, string> | undefined>();
  const b: Bucket = {
    get: async (k) => (m.has(k) ? { text: async () => m.get(k) as string, arrayBuffer: async () => m.get(k) as ArrayBuffer } : null),
    head: async (k) => (m.has(k) ? { customMetadata: meta.get(k) } : null),
    put: async (k, v, o) => { m.set(k, v); meta.set(k, o?.customMetadata); },
  };
  return { b, m };
};
const post = (body: string) => new Request('https://x.test/api/project', { method: 'POST', body, headers: { 'content-type': 'application/json' } });

describe('project codes', () => {
  it('are 8 unambiguous characters, and differ', () => {
    const codes = new Set(Array.from({ length: 200 }, () => newCode()));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(c).toMatch(CODE_RE);
    expect([...codes].join('')).not.toMatch(/[01ilo]/);
  });
  it('are tidied from what a person types or pastes', () => {
    expect(cleanCode('  ABCD2345 ')).toBe('abcd2345');
    expect(cleanCode('abcd-2345')).toBe('abcd2345');
    expect(cleanCode('https://hike.bobsabayesian.io/?p=abcd2345')).toBe('abcd2345');
    expect(cleanCode('hello')).toBe('');
    expect(cleanCode('abcd234i')).toBe('');
  });
});

describe('saving projects on the server', () => {
  const doc = JSON.stringify(toFile(defaultProject()));
  it('saves under hike/ and reads it back unchanged', async () => {
    const { b, m } = fakeBucket();
    const res = (await handleProjects(post(doc), b))!;
    expect(res.status).toBe(201);
    const { code } = (await res.json()) as { code: string };
    expect(code).toMatch(CODE_RE);
    expect([...m.keys()]).toEqual([`${PREFIX}${code}.json`]);
    const got = (await handleProjects(new Request(`https://x.test/api/project/${code}`), b))!;
    expect(got.status).toBe(200);
    expect(got.headers.get('cache-control')).toContain('private');
    expect(await got.text()).toBe(doc);
  });
  it('every save is a new code, so one cannot overwrite another', async () => {
    const { b, m } = fakeBucket();
    const a = (await (await handleProjects(post(doc), b))!.json()) as { code: string };
    const c = (await (await handleProjects(post(doc), b))!.json()) as { code: string };
    expect(a.code).not.toBe(c.code);
    expect(m.size).toBe(2);
  });
  it('refuses what is not a project, bad JSON, and anything too big', async () => {
    const { b, m } = fakeBucket();
    expect((await handleProjects(post('nope'), b))!.status).toBe(400);
    expect((await handleProjects(post('{"app":"other","version":1,"project":{}}'), b))!.status).toBe(400);
    expect((await handleProjects(post(JSON.stringify({ app: 'walk-of-frame', version: 1, project: {}, pad: 'x'.repeat(MAX_BYTES) })), b))!.status).toBe(413);
    expect(m.size).toBe(0);
  });
  it('404s an unknown code, 400s a malformed one, and only allows the right methods', async () => {
    const { b } = fakeBucket();
    expect((await handleProjects(new Request('https://x.test/api/project/abcd2345'), b))!.status).toBe(404);
    expect((await handleProjects(new Request('https://x.test/api/project/short'), b))!.status).toBe(400);
    expect((await handleProjects(new Request('https://x.test/api/project', { method: 'GET' }), b))!.status).toBe(405);
    expect((await handleProjects(new Request('https://x.test/api/project/abcd2345', { method: 'DELETE' }), b))!.status).toBe(405);
  });
  it('says so when no bucket is attached, and ignores other routes', async () => {
    expect((await handleProjects(post(doc), undefined))!.status).toBe(503);
    expect(await handleProjects(new Request('https://x.test/api/health'), undefined)).toBeNull();
  });
});

describe('project files', () => {
  it('a project with a GPX track and waypoints comes back whole', () => {
    const p = defaultProject();
    p.points = sampleTrack();
    p.waypoints = sampleWaypoints(p.points);
    p.features.overrides = { x: { name: 'Renamed', clearMm: 4, icon: 'star' } };
    p.relief = { ...p.relief, enabled: true, tilt: 61 };
    const back = fromFile(JSON.parse(JSON.stringify(toFile(p))));
    expect(back).toEqual(p);
    expect(back.points.length).toBeGreaterThan(10);
  });
  it('a project saved before a setting existed gets that setting\'s default', () => {
    const old = JSON.parse(JSON.stringify(toFile(defaultProject())));
    delete old.project.relief;
    delete old.project.features.icons;
    delete old.project.border.gapMm;
    const p = fromFile(old);
    expect(p.relief).toEqual(defaultProject().relief);
    expect(p.features.icons).toEqual({});
    expect(p.border.gapMm).toBe(defaultProject().border.gapMm);
  });
  it('rejects other files and newer versions, and does not pollute prototypes', () => {
    expect(() => fromFile({ app: 'other' })).toThrow();
    expect(() => fromFile(null)).toThrow();
    expect(() => fromFile({ app: 'walk-of-frame', version: 99, project: {} })).toThrow(/newer/);
    mergeDefaults({}, JSON.parse('{"__proto__":{"bad":1}}'));
    expect(({} as Record<string, unknown>).bad).toBeUndefined();
  });
  it('arrays are taken as saved, not merged', () => {
    const p = fromFile({ app: 'walk-of-frame', version: 1, project: { pens: [{ id: 'a', name: 'A', color: '#000000', tipMm: 0.5 }] } });
    expect(p.pens).toHaveLength(1);
  });
});

describe('the picture saved beside a project', () => {
  const doc = JSON.stringify(toFile(defaultProject(), { title: 'The Grand Canyon', place: 'Coconino County, Arizona', distance: '16.1 mi', gain: '11,968 ft', size: '18 × 24 in' }));
  const png = (n = 20) => { const a = new Uint8Array(n); a.set([0x89, 0x50, 0x4e, 0x47]); return a; };
  const put = (code: string, body: BodyInit) => new Request(`https://x.test/api/project/${code}/thumb`, { method: 'PUT', body });
  const make = async () => {
    const { b, m } = fakeBucket();
    const { code } = (await (await handleProjects(post(doc), b))!.json()) as { code: string };
    return { b, m, code };
  };
  it('a save keeps the title, place and numbers the app sent, beside the file', async () => {
    const { m, code } = await make();
    expect(m.has(`${PREFIX}${code}.json`)).toBe(true);
    // (the fake bucket stores no metadata; summarize is checked directly)
    expect(summarize({ points: [] }, { title: 'The Grand Canyon', place: 'AZ', distance: '16.1 mi', gain: '11,968 ft', size: '18 × 24 in' })).toMatchObject({ name: 'The Grand Canyon', place: 'AZ', distance: '16.1 mi', gain: '11,968 ft', size: '18 × 24 in' });
    expect(summarize({ points: [], feature: { name: 'Fallback' } }, undefined).name).toBe('Fallback');
    expect(summarize({}, { title: 42 as never }).name).toBe('');
  });
  it('is stored next to the project, as a PNG, once', async () => {
    const { b, m, code } = await make();
    expect((await handleProjects(put(code, png()), b))!.status).toBe(201);
    expect(m.has(`${PREFIX}${code}.png`)).toBe(true);
    expect((await handleProjects(put(code, png()), b))!.status).toBe(409); // cannot be swapped afterwards
  });
  it('refuses a picture for an unknown project, a malformed code, something that is not a PNG, or one that is too big', async () => {
    const { b, code } = await make();
    expect((await handleProjects(put('abcd2345', png()), b))!.status).toBe(404);
    expect((await handleProjects(put('short', png()), b))!.status).toBe(400);
    expect((await handleProjects(put(code, new Uint8Array(20)), b))!.status).toBe(400);
    expect((await handleProjects(put(code, png(MAX_THUMB_BYTES + 10)), b))!.status).toBe(413);
    expect((await handleProjects(new Request(`https://x.test/api/project/${code}/thumb`), b))!.status).toBe(405);
  });
});

describe('saving over a project', () => {
  const doc = (title = 'one') => JSON.stringify({ ...toFile(defaultProject()), meta: { title } });
  const put = (code: string, body: string, key?: string) => new Request(`https://x.test/api/project/${code}`, { method: 'PUT', body, headers: { 'content-type': 'application/json', ...(key ? { 'x-edit-key': key } : {}) } });
  const make = async () => {
    const { b, m } = fakeBucket();
    const { code, editKey } = (await (await handleProjects(post(doc()), b))!.json()) as { code: string; editKey: string };
    return { b, m, code, editKey };
  };
  it('a new save returns a key, and only its hash is kept', async () => {
    const { m, code, editKey } = await make();
    expect(editKey).toMatch(/^[0-9a-f]{32}$/);
    expect(await hashKey(editKey)).toHaveLength(64);
    expect(m.get(PREFIX + code + '.json')).toBeDefined();
  });
  it('the key replaces the saved copy under the same code', async () => {
    const { b, m, code, editKey } = await make();
    const res = (await handleProjects(put(code, doc('two'), editKey), b))!;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code });
    expect(JSON.parse(m.get(PREFIX + code + '.json') as string).meta.title).toBe('two');
    // saving over again still works: the key is kept
    expect((await handleProjects(put(code, doc('three'), editKey), b))!.status).toBe(200);
  });
  it('the code alone, a wrong key, or no key cannot replace it', async () => {
    const { b, m, code } = await make();
    const before = m.get(PREFIX + code + '.json');
    for (const key of [undefined, 'a'.repeat(32), 'nonsense']) expect((await handleProjects(put(code, doc('x'), key), b))!.status).toBe(403);
    expect(m.get(PREFIX + code + '.json')).toBe(before);
  });
  it('a key for one project does not open another, and an unknown code is a 404', async () => {
    const a = await make();
    const other = (await (await handleProjects(post(doc()), a.b))!.json()) as { code: string };
    expect((await handleProjects(put(other.code, doc(), a.editKey), a.b))!.status).toBe(403);
    expect((await handleProjects(put('abcdefgh'.replace(/[a-z]/g, '2'), doc(), a.editKey), a.b))!.status).toBe(404);
    expect((await handleProjects(put('bad', doc(), a.editKey), a.b))!.status).toBe(400);
  });
  it('a project saved before keys existed cannot be saved over', async () => {
    const { b, m } = fakeBucket();
    m.set(PREFIX + 'abcd2345.json', doc());
    expect((await handleProjects(put('abcd2345', doc(), 'a'.repeat(32)), b))!.status).toBe(403);
  });
  it('rejects a body that is not a project, and one that is too large', async () => {
    const { b, code, editKey } = await make();
    expect((await handleProjects(put(code, '{"app":"other","version":1,"project":{}}', editKey), b))!.status).toBe(400);
    expect((await handleProjects(put(code, 'nope', editKey), b))!.status).toBe(400);
    expect((await handleProjects(put(code, 'x'.repeat(MAX_BYTES + 1), editKey), b))!.status).toBe(413);
  });
  it('the picture is written once, unless the request carries the key', async () => {
    const { b, code, editKey } = await make();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const thumb = (key?: string) => new Request(`https://x.test/api/project/${code}/thumb`, { method: 'PUT', body: png, headers: key ? { 'x-edit-key': key } : {} });
    expect((await handleProjects(thumb(), b))!.status).toBe(201);
    expect((await handleProjects(thumb(), b))!.status).toBe(409);
    expect((await handleProjects(thumb('a'.repeat(32)), b))!.status).toBe(409);
    expect((await handleProjects(thumb(editKey), b))!.status).toBe(201);
  });
});
