import { describe, expect, it } from 'vitest';
import { placeLandmarks, type PlaceInput } from '../src/features/select';
import { defaultFeatures, type Landmark, type WaterLine } from '../src/features/types';
import { markerPath } from '../src/features/draw';
import { fitBBox } from '../src/geo/project';
import { parseWaypoints } from '../src/gpx/parse';
import { normalizeFeatures } from '../worker/api';
import { buildScene, composeScene } from '../src/scene/buildScene';
import { defaultProject } from '../src/scene/project';
import { sampleTrack, sampleWaypoints } from '../src/sample';

const B = { minLat: 46, maxLat: 46.2, minLon: -121.4, maxLon: -121 };
const frame = { x: 20, y: 20, w: 300, h: 400 };
const fit = fitBBox(B, frame);
const lm = (id: string, name: string, kind: Landmark['kind'], lat: number, lon: number, ele?: number): Landmark => ({ id, name, kind, lat, lon, ele });
const input = (landmarks: Landmark[], over: Partial<PlaceInput> = {}): PlaceInput => ({
  landmarks, water: [], fit, frame, route: [], settings: defaultFeatures(), sizeMm: 4, markerR: 2, ...over,
});

const grid: Landmark[] = [];
for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++)
  grid.push(lm(`n${i}${j}`, `Peak ${i}${j}`, 'peak', 46.02 + i * 0.03, -121.35 + j * 0.06, 1000 + i * 100 + j * 10));

describe('placeLandmarks', () => {
  it('draws at most maxLabels, highest peaks first', () => {
    const s = defaultFeatures();
    s.maxLabels = 3;
    const { labels } = placeLandmarks(input(grid, { settings: s }));
    expect(labels).toHaveLength(3);
    expect(labels.map((l) => l.id)).toContain('n55'); // the tallest
  });
  it('GPX waypoints always outrank OSM features', () => {
    const wpt = lm('wpt-0', 'Camp', 'waypoint', 46.1, -121.2);
    const s = defaultFeatures();
    s.maxLabels = 1;
    expect(placeLandmarks(input([...grid, wpt], { settings: s })).labels[0]!.id).toBe('wpt-0');
  });
  it('never overlaps labels with each other', () => {
    const crowded = Array.from({ length: 12 }, (_, i) => lm(`n${i}`, `Crowded Peak ${i}`, 'peak', 46.1 + i * 0.0004, -121.2, 2000 + i));
    const s = defaultFeatures();
    s.maxLabels = 12;
    const { labels } = placeLandmarks(input(crowded, { settings: s }));
    const box = (l: (typeof labels)[number]) => {
      const w = l.text.length * 4 * 0.56;
      const x0 = l.anchor === 'start' ? l.x : l.anchor === 'end' ? l.x - w : l.x - w / 2;
      return [x0, l.y - 3.4, x0 + w, l.y + 0.6];
    };
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = box(labels[i]!); const b = box(labels[j]!);
      expect(a[0]! < b[2]! && a[2]! > b[0]! && a[1]! < b[3]! && a[3]! > b[1]!).toBe(false);
    }
    expect(labels.length).toBeLessThan(12); // some could not fit
  });
  it('moves a label off the route instead of drawing across it', () => {
    const p = lm('n1', 'Summit Peak', 'peak', 46.1, -121.2, 2000);
    const [x, y] = fit.toMm(46.1, -121.2);
    const route: [number, number][] = [[x + 8, y - 60], [x + 8, y + 60]]; // vertical line just right of the marker
    const { labels } = placeLandmarks(input([p], { route }));
    expect(labels[0]!.anchor).not.toBe('start');
  });
  it('hidden landmarks are listed but do not use a slot', () => {
    const s = defaultFeatures();
    s.maxLabels = 2;
    s.overrides['n55'] = { hidden: true };
    const { entries, labels } = placeLandmarks(input(grid, { settings: s }));
    expect(entries.find((e) => e.id === 'n55')).toMatchObject({ hidden: true, placed: false });
    expect(labels).toHaveLength(2);
    expect(labels.map((l) => l.id)).not.toContain('n55');
  });
  it('honors rename and a forced side', () => {
    const s = defaultFeatures();
    s.overrides['n1'] = { name: 'Renamed', side: 'left' };
    const { labels } = placeLandmarks(input([lm('n1', 'Old', 'peak', 46.1, -121.2)], { settings: s }));
    expect(labels[0]).toMatchObject({ text: 'Renamed', anchor: 'end' });
  });
  it('skips kinds that are switched off and landmarks outside the frame', () => {
    const s = defaultFeatures();
    s.kinds.hut = false;
    const out = lm('n9', 'Far Peak', 'peak', 50, -121.2);
    const hut = lm('n8', 'The Hut', 'hut', 46.1, -121.2);
    expect(placeLandmarks(input([out, hut], { settings: s })).labels).toHaveLength(0);
  });
  it('collapses duplicate names of the same kind', () => {
    const dup = [lm('n1', 'Mt Dup', 'peak', 46.1, -121.2, 2000), lm('n2', 'Mt Dup', 'peak', 46.1002, -121.2, 1900)];
    expect(placeLandmarks(input(dup)).labels).toHaveLength(1);
  });
  it('labels big named lakes at their center, with no marker; ignores tiny ones', () => {
    const ring = (lat: number, lon: number, r: number): [number, number][] =>
      [[lat - r, lon - r], [lat - r, lon + r], [lat + r, lon + r], [lat + r, lon - r], [lat - r, lon - r]];
    const water: WaterLine[] = [
      { id: 'w1', kind: 'lake', name: 'Big Lake', coords: ring(46.1, -121.2, 0.02) },
      { id: 'w2', kind: 'lake', name: 'Puddle', coords: ring(46.15, -121.3, 0.0002) },
    ];
    const { labels } = placeLandmarks(input([], { water }));
    expect(labels.map((l) => l.text)).toEqual(['Big Lake']);
    expect(labels[0]!.marker).toBeUndefined();
  });
});

describe('markers', () => {
  it('has a distinct outline for every kind', () => {
    const kinds = ['peak', 'pass', 'hut', 'viewpoint', 'trailhead', 'waypoint'] as const;
    const ds = kinds.map((k) => markerPath(k, 10, 10, 2));
    expect(new Set(ds).size).toBe(kinds.length);
    expect(ds.every((d) => d.startsWith('M'))).toBe(true);
  });
});

describe('gpx waypoints', () => {
  it('reads named wpt entries and skips unnamed ones', () => {
    const xml = `<gpx><wpt lat="46.1" lon="-121.2"><ele>2100</ele><name>Camp Muir</name></wpt><wpt lat="1" lon="2"/><wpt lat="46.2" lon="-121.1"><name>123</name></wpt></gpx>`;
    const w = parseWaypoints(xml);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatchObject({ name: 'Camp Muir', kind: 'waypoint', ele: 2100 });
    expect(w[1]!.name).toBe('123');
  });
  it('returns none when there are no waypoints', () => {
    expect(parseWaypoints('<gpx></gpx>')).toEqual([]);
  });
});

describe('overpass normalization', () => {
  it('maps tags to kinds and drops unnamed or unknown elements', () => {
    const out = normalizeFeatures([
      { type: 'node', id: 1, lat: 1, lon: 2, tags: { name: 'A', natural: 'peak', ele: '2000' } },
      { type: 'node', id: 2, lat: 1, lon: 2, tags: { name: 'B', natural: 'saddle' } },
      { type: 'node', id: 3, lat: 1, lon: 2, tags: { name: 'C', tourism: 'alpine_hut' } },
      { type: 'node', id: 4, lat: 1, lon: 2, tags: { name: 'D', highway: 'trailhead' } },
      { type: 'node', id: 5, lat: 1, lon: 2, tags: { natural: 'peak' } },
      { type: 'node', id: 6, lat: 1, lon: 2, tags: { name: 'E', amenity: 'cafe' } },
      { type: 'way', id: 7, tags: { name: 'L', natural: 'water' }, geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }] },
      { type: 'way', id: 8, tags: { name: 'R', waterway: 'river' }, geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }] },
      { type: 'way', id: 9, tags: { name: 'X', waterway: 'canal' }, geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }] },
    ]);
    expect(out.landmarks.map((l) => [l.id, l.kind])).toEqual([['n1', 'peak'], ['n2', 'pass'], ['n3', 'hut'], ['n4', 'trailhead']]);
    expect(out.landmarks[0]!.ele).toBe(2000);
    expect(out.water.map((w) => [w.id, w.kind])).toEqual([['w7', 'lake'], ['w8', 'river']]);
  });
});

describe('landmarks in the scene', () => {
  const base = () => {
    const pts = sampleTrack();
    return { ...defaultProject(), points: pts, waypoints: sampleWaypoints(pts) };
  };
  const names = (p = base(), osm?: Parameters<typeof buildScene>[2]) =>
    buildScene(p, undefined, osm).prims.flatMap((x) => (x.kind === 'text' ? [x.text] : []));

  it('draws GPX waypoint labels and markers with no network data', () => {
    expect(names()).toEqual(expect.arrayContaining(['Summit', 'Trailhead']));
    const c = composeScene(base());
    expect(c.landmarks!.map((e) => e.name)).toEqual(expect.arrayContaining(['Summit', 'Trailhead']));
  });
  it('can be switched off entirely', () => {
    const p = base();
    p.features.enabled = false;
    expect(names(p)).not.toContain('Summit');
  });
  it('adds OSM landmarks and water lines, with water under the route', () => {
    const p = base();
    const osm = {
      landmarks: [lm('n1', 'Little Tahoma', 'peak', 46.805, -121.69, 3000)],
      water: [{ id: 'w1', kind: 'river' as const, name: 'River', coords: [[46.79, -121.74], [46.83, -121.66]] as [number, number][] }],
      covers: B,
    };
    expect(names(p, osm)).toContain('Little Tahoma');
    const prims = buildScene(p, undefined, osm).prims;
    const iWater = prims.findIndex((x) => x.kind === 'path' && x.widthMm === p.features.waterWeightMm);
    const iRoute = prims.findIndex((x) => x.kind === 'path' && x.widthMm === p.route.weightMm);
    expect(iWater).toBeGreaterThanOrEqual(0);
    expect(iWater).toBeLessThan(iRoute);
    p.features.water = false;
    expect(buildScene(p, undefined, osm).prims.some((x) => x.kind === 'path' && x.widthMm === p.features.waterWeightMm)).toBe(false);
  });
  it('labels share the text color, so they add no extra pen layer', () => {
    const svgLayers = (p = base()) => new Set(buildScene(p).prims.map((x) => x.color)).size;
    const withLabels = svgLayers();
    const p = base();
    p.features.enabled = false;
    expect(withLabels).toBe(svgLayers(p));
  });
});
