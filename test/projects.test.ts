import { describe, expect, it } from 'vitest';
import { CODE_RE, MAX_BYTES, PREFIX, cleanCode, handleProjects, newCode, type Bucket } from '../worker/projects';
import { fromFile, mergeDefaults, toFile } from '../src/projectFile';
import { defaultProject } from '../src/scene/project';
import { sampleTrack, sampleWaypoints } from '../src/sample';

const fakeBucket = () => {
  const m = new Map<string, string>();
  const b: Bucket = {
    get: async (k) => (m.has(k) ? { text: async () => m.get(k)! } : null),
    head: async (k) => (m.has(k) ? {} : null),
    put: async (k, v) => { m.set(k, v); },
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
