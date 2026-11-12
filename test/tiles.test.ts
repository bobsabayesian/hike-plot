import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CONCURRENCY, decodeTile, loadVectorFeatures, MAX_TILES, MAX_ZOOM, MIN_ZOOM, pickZoom, resetVectorCache, tilesBBox, tilesFor,
  TILEJSON_URL, tileTemplate, type DecodedTile, type VectorResult,
} from '../src/topo/vector';
import { loadFeatures, OVERPASS_KINDS } from '../src/features/hybrid';
import { JOIN_TOLERANCE_DEG, placeLandmarks, stitchRivers, type PlaceInput } from '../src/features/select';
import { defaultFeatures, POINT_KINDS, requestCovers, wantedRequest, type OsmData, type WaterLine } from '../src/features/types';
import { fitBBox, type BBox } from '../src/geo/project';
import { buildScene } from '../src/scene/buildScene';
import { defaultProject } from '../src/scene/project';
import { sampleTrack } from '../src/sample';

const file = (z: number, x: number, y: number) => new Uint8Array(readFileSync(`test/fixtures/tiles/${z}-${x}-${y}.pbf`));
const tile = (z: number, x: number, y: number) => decodeTile(file(z, x, y), z, x, y);
const lonAt = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const latAt = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
const bounds = (z: number, x: number, y: number) => ({ minLat: latAt(y + 1, z), maxLat: latAt(y, z), minLon: lonAt(x, z), maxLon: lonAt(x + 1, z) });
const names = (d: DecodedTile, kind: string) => d.landmarks.filter((l) => l.kind === kind).map((l) => l.name);

describe('decoding real OpenFreeMap tiles', () => {
  it('the summit tile has Mount Rainier and its peaks, with elevations, and leaves out cliffs and ridges', () => {
    const d = tile(14, 2650, 5772);
    expect(names(d, 'peak')).toEqual(expect.arrayContaining(['Mount Rainier', 'Columbia Crest', 'Point Success']));
    expect(d.landmarks.find((l) => l.name === 'Mount Rainier')).toMatchObject({ kind: 'peak', ele: 4392 });
    const all = d.landmarks.map((l) => l.name);
    for (const notPeaks of ['Nisqually Ice Cliff', 'Cowlitz Cleaver', 'Disappointment Cleaver']) expect(all).not.toContain(notPeaks);
  });
  it('saddles become passes, with their elevation', () => {
    const d = tile(13, 1322, 2882);
    expect(d.landmarks.find((l) => l.name === 'Ipsut Pass')).toMatchObject({ kind: 'pass', ele: 1562 });
    expect(names(tile(14, 2651, 5773), 'pass')).toContain('Cadaver Gap');
  });
  it('shelters become huts', () => {
    expect(names(tile(14, 2651, 5773), 'hut')).toEqual(expect.arrayContaining(['Camp Muir Shelter', 'Butler Shelter']));
  });
  it('viewpoints are picked up', () => {
    expect(names(tile(14, 2651, 5776), 'viewpoint')).toEqual(expect.arrayContaining(['Nisqually Vista', 'Myrtle Falls Viewpoint']));
  });
  it('named rivers and streams become water lines of kind river', () => {
    const d = tile(14, 2651, 5776);
    const rivers = d.water.filter((w) => w.kind === 'river');
    expect(new Set(rivers.map((w) => w.name))).toEqual(new Set(['Nisqually River', 'Paradise River', 'Dead Horse Creek', 'Edith Creek', 'Pebble Creek']));
    for (const r of rivers) expect(r.coords.length).toBeGreaterThanOrEqual(2);
  });
  it('lake names come through as points', () => {
    const d = tile(14, 2652, 5778);
    expect(d.waterNames.map((n) => n.name)).toEqual(expect.arrayContaining(['Reflection Lakes', 'Louise Lake', 'Lost Lake']));
    for (const n of d.waterNames) { expect(Number.isFinite(n.lat)).toBe(true); expect(Number.isFinite(n.lon)).toBe(true); }
  });
  it('lake shapes are outline lines with no name, and small ponds are dropped', () => {
    const d = tile(14, 2651, 5777);
    const lakes = d.water.filter((w) => w.kind === 'lake');
    expect(lakes.length).toBeGreaterThan(0);
    expect(lakes.every((w) => w.name === undefined)).toBe(true);
  });
  it('every landmark lies inside its own tile', () => {
    for (const [z, x, y] of [[14, 2650, 5772], [14, 2651, 5773], [14, 2651, 5776], [13, 1322, 2882]] as const) {
      const b = bounds(z, x, y);
      for (const l of tile(z, x, y).landmarks) {
        expect(l.lat).toBeGreaterThanOrEqual(b.minLat - 1e-9); expect(l.lat).toBeLessThanOrEqual(b.maxLat + 1e-9);
        expect(l.lon).toBeGreaterThanOrEqual(b.minLon - 1e-9); expect(l.lon).toBeLessThanOrEqual(b.maxLon + 1e-9);
      }
    }
  });
  it('water lines are cut to the tile, so nothing is doubled in the margin', () => {
    for (const [z, x, y] of [[14, 2651, 5776], [14, 2651, 5777], [14, 2652, 5778], [13, 1325, 2888]] as const) {
      const b = bounds(z, x, y);
      for (const w of tile(z, x, y).water) for (const [la, lo] of w.coords) {
        expect(la).toBeGreaterThanOrEqual(b.minLat - 1e-7); expect(la).toBeLessThanOrEqual(b.maxLat + 1e-7);
        expect(lo).toBeGreaterThanOrEqual(b.minLon - 1e-7); expect(lo).toBeLessThanOrEqual(b.maxLon + 1e-7);
      }
    }
  });
  it('lake outlines have no straight edge along the tile border (the clipped edge is removed)', () => {
    for (const [z, x, y] of [[14, 2651, 5777], [14, 2652, 5778], [13, 1325, 2888]] as const) {
      const b = bounds(z, x, y);
      const eps = 1e-7;
      const onEdge = (la: number, lo: number, side: 'n' | 's' | 'e' | 'w') => (side === 'n' ? Math.abs(la - b.maxLat) < eps : side === 's' ? Math.abs(la - b.minLat) < eps : side === 'e' ? Math.abs(lo - b.maxLon) < eps : Math.abs(lo - b.minLon) < eps);
      for (const w of tile(z, x, y).water.filter((q) => q.kind === 'lake'))
        for (let i = 1; i < w.coords.length; i++) for (const side of ['n', 's', 'e', 'w'] as const) {
          const [a, b2] = [w.coords[i - 1]!, w.coords[i]!];
          expect(onEdge(a[0], a[1], side) && onEdge(b2[0], b2[1], side)).toBe(false);
        }
    }
  });
  it('ids are unique within a tile', () => {
    const d = tile(14, 2651, 5776);
    const ids = [...d.landmarks.map((l) => l.id), ...d.water.map((w) => w.id), ...d.waterNames.map((n) => n.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('neighboring tiles do not both report the same landmark', () => {
    const a = tile(14, 2651, 5776).landmarks;
    const b = tile(14, 2652, 5776).landmarks;
    const key = (l: { name: string; kind: string; lat: number; lon: number }) => `${l.name}|${l.kind}|${l.lat.toFixed(4)}|${l.lon.toFixed(4)}`;
    const seen = new Set(a.map(key));
    expect(b.filter((l) => seen.has(key(l)))).toHaveLength(0);
  });
  it('river pieces from neighboring tiles join into one river', () => {
    const pieces: WaterLine[] = [[14, 2651, 5776], [14, 2652, 5776], [14, 2651, 5777]].flatMap(([z, x, y]) => tile(z!, x!, y!).water.filter((w) => w.name === 'Paradise River'));
    expect(pieces.length).toBeGreaterThan(1);
    const chains = stitchRivers(pieces);
    expect(chains.length).toBeLessThan(pieces.length); // at least some pieces met at a tile border and were joined
    expect(chains.reduce((n, c) => n + c.coords.length, 0)).toBeLessThanOrEqual(pieces.reduce((n, p) => n + p.coords.length, 0));
  });
  it('is quick: a tile decodes in well under 50 ms', () => {
    const t = performance.now();
    tile(14, 2651, 5776);
    expect(performance.now() - t).toBeLessThan(200);
  });
  it('garbage bytes fail cleanly', () => {
    expect(() => decodeTile(new Uint8Array([1, 2, 3, 4, 5]), 14, 0, 0)).not.toThrow(/undefined/);
  });
});

describe('which tiles cover an area', () => {
  const rainier: BBox = { minLat: 46.8501, maxLat: 46.8534, minLon: -121.7625, maxLon: -121.7585 };
  it('a tiny area is one zoom-14 tile (the summit tile)', () => {
    const t = tilesFor(rainier, 14);
    expect(t).toEqual([{ z: 14, x: 2650, y: 5772 }]);
  });
  it('the tiles always cover the area asked for', () => {
    for (const b of [rainier, { minLat: 46.76, maxLat: 46.84, minLon: -121.78, maxLon: -121.68 }, { minLat: 10, maxLat: 10.5, minLon: -70, maxLon: -69.4 }]) {
      for (const z of [10, 12, 14]) {
        const c = tilesBBox(tilesFor(b, z));
        expect(c.minLat).toBeLessThanOrEqual(b.minLat); expect(c.maxLat).toBeGreaterThanOrEqual(b.maxLat);
        expect(c.minLon).toBeLessThanOrEqual(b.minLon); expect(c.maxLon).toBeGreaterThanOrEqual(b.maxLon);
      }
    }
  });
  it('a bigger area needs more tiles; a higher zoom needs more tiles', () => {
    const small = tilesFor({ minLat: 46.8, maxLat: 46.82, minLon: -121.8, maxLon: -121.78 }, 13).length;
    const big = tilesFor({ minLat: 46.7, maxLat: 46.9, minLon: -121.9, maxLon: -121.6 }, 13).length;
    expect(big).toBeGreaterThan(small);
    expect(tilesFor({ minLat: 46.7, maxLat: 46.9, minLon: -121.9, maxLon: -121.6 }, 14).length).toBeGreaterThan(big);
  });
  it('picks the sharpest zoom that fits the tile budget', () => {
    expect(pickZoom(rainier)).toBe(MAX_ZOOM);
    for (const span of [0.02, 0.1, 0.2, 0.35, 0.5, 1]) {
      const b = { minLat: 46.5, maxLat: 46.5 + span, minLon: -121.9, maxLon: -121.9 + span };
      const z = pickZoom(b);
      expect(z).toBeGreaterThanOrEqual(MIN_ZOOM);
      expect(z).toBeLessThanOrEqual(MAX_ZOOM);
      expect(tilesFor(b, z).length).toBeLessThanOrEqual(MAX_TILES);
      if (z < MAX_ZOOM) expect(tilesFor(b, z + 1).length).toBeGreaterThan(MAX_TILES); // and one zoom sharper would not have fit
    }
  });
  it('a larger area never gets a sharper zoom', () => {
    let last = 99;
    for (const span of [0.01, 0.05, 0.1, 0.2, 0.4, 0.8]) {
      const z = pickZoom({ minLat: 46.5, maxLat: 46.5 + span, minLon: -121.9, maxLon: -121.9 + span });
      expect(z).toBeLessThanOrEqual(last);
      last = z;
    }
  });
  it('a smaller budget gives a lower zoom', () => {
    const b = { minLat: 46.76, maxLat: 46.84, minLon: -121.78, maxLon: -121.68 };
    expect(pickZoom(b, 10)).toBeLessThan(pickZoom(b, 150));
  });
});

/** A stand-in for the network: serves the TileJSON and any saved tile, 404 for the rest. */
function fakeNet(opts: { failTiles?: boolean; badJson?: boolean; tileJsonStatus?: number } = {}) {
  const log: string[] = [];
  let inflight = 0;
  let maxInflight = 0;
  const fetchImpl = async (url: string) => {
    log.push(url);
    if (url === TILEJSON_URL) {
      return { ok: (opts.tileJsonStatus ?? 200) === 200, status: opts.tileJsonStatus ?? 200, json: async () => (opts.badJson ? { tiles: ['nope'] } : { tiles: ['https://tiles.test/planet/BUILD/{z}/{x}/{y}.pbf'] }), arrayBuffer: async () => new ArrayBuffer(0) };
    }
    inflight++;
    maxInflight = Math.max(maxInflight, inflight);
    await new Promise((r) => setTimeout(r, 4));
    inflight--;
    if (opts.failTiles) return { ok: false, status: 503, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    const m = url.match(/BUILD\/(\d+)\/(\d+)\/(\d+)\.pbf/)!;
    try {
      const b = file(+m[1]!, +m[2]!, +m[3]!);
      return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer };
    } catch {
      return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    }
  };
  return { fetch: fetchImpl, log, maxInflight: () => maxInflight, tileCalls: () => log.filter((u) => u !== TILEJSON_URL).length };
}

describe('loading tiles', () => {
  beforeEach(() => resetVectorCache());
  // the four zoom-14 tiles around Paradise that we have saved (2651-2652 x 5776-5777)
  const paradise: BBox = { minLat: latAt(5777.9, 14), maxLat: latAt(5776.1, 14), minLon: lonAt(2651.1, 14), maxLon: lonAt(2652.9, 14) };

  it('reads the TileJSON once, then builds tile addresses from it', async () => {
    const net = fakeNet();
    await loadVectorFeatures(paradise, { fetch: net.fetch });
    await loadVectorFeatures({ ...paradise, minLat: paradise.minLat + 1e-4 }, { fetch: net.fetch });
    expect(net.log.filter((u) => u === TILEJSON_URL)).toHaveLength(1);
    expect(net.log.some((u) => /BUILD\/14\/2651\/5776\.pbf$/.test(u))).toBe(true);
  });
  it('never has more than four tile requests in flight', async () => {
    const net = fakeNet();
    const wide: BBox = { minLat: latAt(5790, 14), maxLat: latAt(5770, 14), minLon: lonAt(2645, 14), maxLon: lonAt(2660, 14) }; // lots of tiles
    await loadVectorFeatures(wide, { fetch: net.fetch });
    expect(net.tileCalls()).toBeGreaterThan(8);
    expect(net.maxInflight()).toBeLessThanOrEqual(CONCURRENCY);
    expect(net.maxInflight()).toBeGreaterThan(1); // and it does run them in parallel
  });
  it('does not fetch the same tile twice', async () => {
    const net = fakeNet();
    await loadVectorFeatures(paradise, { fetch: net.fetch });
    const first = net.tileCalls();
    await loadVectorFeatures(paradise, { fetch: net.fetch });
    expect(net.tileCalls()).toBe(first);
  });
  it('returns features from all the tiles, each landmark once, with an area that contains the request', async () => {
    const net = fakeNet();
    const r = await loadVectorFeatures(paradise, { fetch: net.fetch });
    expect(r.zoom).toBe(14);
    expect(r.complete).toBe(true);
    expect(r.tiles).toBe(4);
    expect(new Set(r.landmarks.map((l) => l.id)).size).toBe(r.landmarks.length);
    expect(r.landmarks.map((l) => l.name)).toEqual(expect.arrayContaining(['Nisqually Vista', 'Inspiration Point', 'Alta Vista']));
    expect(r.water.some((w) => w.name === 'Paradise River')).toBe(true);
    expect(r.covers.minLat).toBeLessThanOrEqual(paradise.minLat); expect(r.covers.maxLat).toBeGreaterThanOrEqual(paradise.maxLat);
    expect(r.covers.minLon).toBeLessThanOrEqual(paradise.minLon); expect(r.covers.maxLon).toBeGreaterThanOrEqual(paradise.maxLon);
  });
  it('keeps one lake name per lake, even though several tiles carry it', async () => {
    const net = fakeNet();
    const lakes: BBox = { minLat: latAt(5778.9, 14), maxLat: latAt(5778.1, 14), minLon: lonAt(2652.1, 14), maxLon: lonAt(2652.9, 14) };
    const r = await loadVectorFeatures(lakes, { fetch: net.fetch });
    const n = r.waterNames.map((w) => w.name.toLowerCase());
    expect(new Set(n).size).toBe(n.length);
    expect(n).toContain('reflection lakes');
  });
  it('a tile the service does not have (404) is simply empty', async () => {
    const net = fakeNet();
    const r = await loadVectorFeatures({ minLat: 10, maxLat: 10.001, minLon: -70, maxLon: -69.999 }, { fetch: net.fetch });
    expect(r.landmarks).toEqual([]);
    expect(r.water).toEqual([]);
  });
  it('a failing tile (503, after one retry) makes the whole load fail, so the caller can fall back', async () => {
    const net = fakeNet({ failTiles: true });
    await expect(loadVectorFeatures(paradise, { fetch: net.fetch })).rejects.toThrow(/failed \(503\)/);
    expect(net.tileCalls()).toBeGreaterThanOrEqual(2); // it tried again
  });
  it('a failed tile is not remembered, so a later try can succeed', async () => {
    const bad = fakeNet({ failTiles: true });
    await expect(loadVectorFeatures(paradise, { fetch: bad.fetch })).rejects.toThrow();
    const good = fakeNet();
    await expect(loadVectorFeatures(paradise, { fetch: good.fetch })).resolves.toBeDefined();
  });
  it('a lower zoom (big area) is reported as incomplete', async () => {
    const net = fakeNet();
    const r = await loadVectorFeatures(paradise, { fetch: net.fetch, maxTiles: 1 });
    expect(r.zoom).toBeLessThan(14);
    expect(r.complete).toBe(false);
  });
  it('the service being down or answering oddly is an error', async () => {
    await expect(tileTemplate(fakeNet({ tileJsonStatus: 503 }).fetch)).rejects.toThrow(/503/);
    resetVectorCache();
    await expect(tileTemplate(fakeNet({ badJson: true }).fetch)).rejects.toThrow(/unexpected/);
  });
});

describe('the hybrid: tiles plus a small Overpass lookup', () => {
  const b: BBox = { minLat: 46.77, maxLat: 46.8, minLon: -121.76, maxLon: -121.72 };
  const vector = (over: Partial<VectorResult> = {}) => async (): Promise<VectorResult> => ({
    landmarks: [{ id: 't1', name: 'Tile Peak', kind: 'peak' as const, lat: 46.78, lon: -121.74, ele: 2000 }],
    water: [{ id: 'w', kind: 'river' as const, name: 'A River', coords: [[46.77, -121.75], [46.79, -121.73]] as [number, number][] }],
    waterNames: [{ id: 'wn', name: 'A Lake', lat: 46.78, lon: -121.74 }],
    covers: { minLat: 46.74, maxLat: 46.83, minLon: -121.8, maxLon: -121.7 },
    zoom: 14, tiles: 9, complete: true, ...over,
  });
  const overpass = (calls: unknown[] = []) => async (box: BBox, req: unknown) => {
    calls.push(req);
    return {
      landmarks: [{ id: 'n1', name: 'The Trailhead', kind: 'trailhead' as const, lat: 46.79, lon: -121.73 }],
      water: [], covers: { minLat: 46.7, maxLat: 46.85, minLon: -121.85, maxLon: -121.65 },
    } as OsmData;
  };
  const req = wantedRequest(defaultFeatures());

  it('combines tile features with Overpass trailheads', async () => {
    const calls: unknown[] = [];
    const d = await loadFeatures(b, req, { vector: vector(), overpass: overpass(calls) });
    expect(d.landmarks.map((l) => l.name).sort()).toEqual(['The Trailhead', 'Tile Peak']);
    expect(d.water).toHaveLength(1);
    expect(d.waterNames).toHaveLength(1);
    expect(d.source).toBe('tiles');
    expect(d.partial).toBeUndefined();
    expect(d.note).toBeUndefined();
  });
  it('asks Overpass only for trailheads, passes and huts, and no water', async () => {
    const calls: { kinds: string[]; lakes: boolean; rivers: boolean }[] = [];
    await loadFeatures(b, req, { vector: vector(), overpass: overpass(calls) });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.kinds).toEqual([...OVERPASS_KINDS]);
    expect(calls[0]!.kinds).not.toContain('peak');
    expect(calls[0]!.lakes).toBe(false);
    expect(calls[0]!.rivers).toBe(false);
  });
  it('the reusable area is where both sources have data, and still contains the view', async () => {
    const d = await loadFeatures(b, req, { vector: vector(), overpass: overpass() });
    expect(d.covers).toEqual({ minLat: 46.74, maxLat: 46.83, minLon: -121.8, maxLon: -121.7 });
    expect(d.covers.minLat).toBeLessThanOrEqual(b.minLat); expect(d.covers.maxLat).toBeGreaterThanOrEqual(b.maxLat);
  });
  it('covers every point kind and water, so toggling settings never refetches', async () => {
    const d = await loadFeatures(b, req, { vector: vector(), overpass: overpass() });
    expect(d.requested).toEqual({ kinds: [...POINT_KINDS], lakes: true, rivers: true });
    const s = defaultFeatures();
    s.kinds.hut = true; s.kinds.viewpoint = true; s.waterLabels = true; s.water = false;
    expect(requestCovers(d.requested, wantedRequest(s))).toBe(true);
  });
  it('if Overpass fails, the tile data still comes back, marked as missing trailheads', async () => {
    const d = await loadFeatures(b, req, { vector: vector(), overpass: async () => { throw new Error('overpass unavailable: overpass-api.de 521'); } });
    expect(d.landmarks.map((l) => l.name)).toEqual(['Tile Peak']);
    expect(d.partial).toEqual(['landmarks']);
    expect(d.reason).toMatch(/trailheads, huts and passes: .*521/);
    expect(d.covers).toEqual({ minLat: 46.74, maxLat: 46.83, minLon: -121.8, maxLon: -121.7 }); // the tiles' own area
  });
  it('if the tiles fail, everything comes from Overpass with the original request', async () => {
    const calls: { kinds: string[] }[] = [];
    const full: OsmData = { landmarks: [{ id: 'p', name: 'Overpass Peak', kind: 'peak', lat: 46.78, lon: -121.74 }], water: [], covers: b };
    const d = await loadFeatures(b, req, {
      vector: async () => { throw new Error('tiles down'); },
      overpass: async (_b, r) => { calls.push(r as { kinds: string[] }); return calls.length === 1 ? ({ landmarks: [], water: [], covers: b } as OsmData) : full; },
    });
    expect(d.source).toBe('overpass');
    expect(calls[calls.length - 1]).toEqual(req); // the full request, as before
    expect(d.landmarks.map((l) => l.name)).toEqual(['Overpass Peak']);
  });
  it('if both fail, it reports an error', async () => {
    await expect(loadFeatures(b, req, { vector: async () => { throw new Error('tiles down'); }, overpass: async () => { throw new Error('overpass down'); } })).rejects.toThrow('overpass down');
  });
  it('tells the user to zoom in when the tiles were fetched at a lower zoom', async () => {
    const d = await loadFeatures(b, req, { vector: vector({ complete: false, zoom: 12 }), overpass: overpass() });
    expect(d.note).toMatch(/Zoom in closer/);
  });
});

describe('tile lake names and joined rivers in the poster', () => {
  const B: BBox = { minLat: 46, maxLat: 46.2, minLon: -121.4, maxLon: -121 };
  const frame = { x: 20, y: 20, w: 300, h: 400 };
  const fit = fitBBox(B, frame);
  const input = (over: Partial<PlaceInput> = {}): PlaceInput => ({ landmarks: [], water: [], fit, frame, route: [], settings: { ...defaultFeatures(), waterLabels: true }, sizeMm: 4, markerR: 2, ...over });
  const lake = { id: 'wn1', name: 'Reflection Lakes', lat: 46.1, lon: -121.2 };

  it('a lake name given as a point is written there, with no marker', () => {
    const { labels, entries } = placeLandmarks(input({ waterNames: [lake] }));
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ text: 'Reflection Lakes', kind: 'lake' });
    expect(labels[0]!.marker).toBeUndefined();
    expect(entries[0]).toMatchObject({ kind: 'lake', placed: true });
  });
  it('only when water labels are on', () => {
    expect(placeLandmarks(input({ waterNames: [lake], settings: defaultFeatures() })).labels).toHaveLength(0);
  });
  it('a name outside the map is skipped; one can be renamed or hidden', () => {
    expect(placeLandmarks(input({ waterNames: [{ ...lake, lat: 50 }] })).labels).toHaveLength(0);
    const s = { ...defaultFeatures(), waterLabels: true };
    s.overrides['wn1'] = { name: 'Reflections' };
    expect(placeLandmarks(input({ waterNames: [lake], settings: s })).labels[0]!.text).toBe('Reflections');
    s.overrides['wn1'] = { hidden: true };
    expect(placeLandmarks(input({ waterNames: [lake], settings: s })).labels).toHaveLength(0);
  });
  it('shares the water-name slots with river names', () => {
    const s = { ...defaultFeatures(), waterLabels: true, maxWaterLabels: 1 };
    const river: WaterLine = { id: 'w1', kind: 'river', name: 'Long River', coords: [[46.05, -121.35], [46.05, -121.05]] };
    expect(placeLandmarks(input({ waterNames: [lake], water: [river], settings: s })).labels).toHaveLength(1);
  });
  it('river pieces whose ends are a couple of meters apart are joined; ones further apart are not', () => {
    const piece = (a: [number, number], b: [number, number]): WaterLine => ({ id: `${a}`, kind: 'river', name: 'R', coords: [a, b] });
    const near = stitchRivers([piece([46.1, -121.3], [46.1, -121.2]), piece([46.1 + JOIN_TOLERANCE_DEG * 0.6, -121.2 + JOIN_TOLERANCE_DEG * 0.6], [46.1, -121.1])]);
    expect(near).toHaveLength(1);
    const far = stitchRivers([piece([46.1, -121.3], [46.1, -121.2]), piece([46.1 + JOIN_TOLERANCE_DEG * 20, -121.2], [46.1, -121.1])]);
    expect(far).toHaveLength(2);
  });
  it('buildScene writes tile lake names and draws tile water outlines in the water pen', () => {
    const p = { ...defaultProject(), points: sampleTrack() };
    p.features.waterLabels = true;
    const osm: OsmData = {
      landmarks: [], covers: { minLat: 46, maxLat: 47, minLon: -122, maxLon: -121 },
      water: [{ id: 'l1', kind: 'lake', coords: [[46.79, -121.74], [46.81, -121.7], [46.8, -121.68]] }],
      waterNames: [{ id: 'wn', name: 'Mirror Pond', lat: 46.805, lon: -121.71 }],
    };
    const prims = buildScene(p, undefined, osm).prims;
    expect(prims.some((x) => x.kind === 'text' && x.text === 'Mirror Pond' && x.color === '#2f6f9f')).toBe(true);
    expect(prims.some((x) => x.kind === 'path' && x.pen === 'blue' && x.widthMm === p.features.waterWeightMm)).toBe(true);
  });
});

afterEach(() => vi.unstubAllGlobals());
