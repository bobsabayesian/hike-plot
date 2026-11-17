import { describe, expect, it } from 'vitest';
import { distanceTicks, everyAlong, tickLabel, tickMark, tickMeters } from '../src/scene/routeMarks';
import { highPoint, resolveCustom } from '../src/features/custom';
import { buildScene, viewBBox } from '../src/scene/buildScene';
import { defaultProject, type Project } from '../src/scene/project';
import { latToPx, loadTerrain, lonToPx, TILE } from '../src/topo/terrain';
import { fromFile, toFile } from '../src/projectFile';
import { sampleTrack } from '../src/sample';
import type { PathPrim, TextPrim } from '../src/scene/types';

/** a track due north, one point every ~111 m (0.001° of latitude) */
const north = (n: number, ele = (i: number) => 1000 + i) => Array.from({ length: n }, (_, i) => ({ lat: 46 + i * 0.001, lon: -121, ele: ele(i) }));

describe('distance marks', () => {
  it('one mark every km along the track, numbered, not at the start', () => {
    const ticks = distanceTicks(north(50), 1000); // ~5.4 km
    expect(ticks.map((t) => t.n)).toEqual([1, 2, 3, 4, 5]);
    expect(ticks[0]!.lat).toBeCloseTo(46 + 1000 / 111195, 4);
  });
  it('miles or km, and half steps are written with a decimal', () => {
    expect(tickMeters(1, 'imperial')).toBeCloseTo(1609.344, 6);
    expect(tickMeters(2, 'metric')).toBe(2000);
    expect(tickLabel(3, 0.5)).toBe('1.5');
    expect(tickLabel(4, 0.5)).toBe('2');
  });
  it('a mark is square to the route and its number sits past one end', () => {
    const m = tickMark([10, 10], [0, 10], [20, 10], 2); // route heading right
    expect(m.line).toEqual([[10, 11], [10, 9]]);
    expect(m.label[0]).toBeCloseTo(10, 9);
    expect(m.label[1]).toBeLessThan(9); // above the route
  });
  it('points along a line, evenly spaced', () => {
    const pts = everyAlong([[0, 0], [10, 0]], 2);
    expect(pts.map((q) => q[0])).toEqual([1, 3, 5, 7, 9]);
  });
});

describe('the high point', () => {
  it('is the highest GPX point, and a landmark set there follows it', () => {
    const pts = north(20, (i) => 1000 + 50 * Math.sin(i / 3));
    const top = highPoint(pts)!;
    expect(top.ele).toBe(Math.max(...pts.map((q) => q.ele)));
    const [lm] = resolveCustom([{ id: 'custom-1', name: '1,234 ft', at: 'high' }], pts);
    expect(lm).toMatchObject({ lat: top.lat, lon: top.lon, name: '1,234 ft' });
  });
  it('is not there without elevations', () => {
    expect(highPoint([{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }])).toBeUndefined();
  });
});

const cone = async (z: number, tx: number, ty: number) => {
  const cx = lonToPx(-121.7, z);
  const cy = latToPx(46.82, z);
  const out = new Float32Array(TILE * TILE);
  const slope = 2000 / (2 ** z * TILE * 0.0008);
  for (let r = 0; r < TILE; r++) for (let c = 0; c < TILE; c++) out[r * TILE + c] = Math.max(0, 2000 - slope * Math.hypot(tx * TILE + c - cx, ty * TILE + r - cy));
  return out;
};
const project = (fn?: (p: Project) => void) => {
  const p = { ...defaultProject(), points: sampleTrack() };
  p.terrain.intervalM = 100; p.features.enabled = false;
  fn?.(p);
  return p;
};
const routePaths = (s: ReturnType<typeof buildScene>) => s.prims.filter((x): x is PathPrim => x.kind === 'path' && x.part === 'route');
const ys = (d: string) => [...d.matchAll(/[ML][-\d.]+ ([-\d.]+)/g)].map((m) => +m[1]!);

describe('route marks on the poster', () => {
  it('off by default; old projects open with marks off and the route on the ground', () => {
    const file = JSON.parse(JSON.stringify(toFile(defaultProject())));
    for (const k of ['ticks', 'tickEvery', 'tickSizePt', 'liftMm', 'dropMm']) delete file.project.route[k];
    const p = fromFile(file);
    expect(p.route).toMatchObject({ ticks: 'off', tickEvery: 1, liftMm: 0 });
  });
  it('mile marks with numbers: one mark per mile of the track, numbered 1, 2, 3...', async () => {
    const p = project((q) => { q.route.ticks = 'numbers'; });
    const s = buildScene(p, await loadTerrain(viewBBox(p)!, cone));
    const numbers = s.prims.filter((x): x is TextPrim => x.kind === 'text' && x.part === 'route').map((x) => x.text);
    expect(numbers.length).toBeGreaterThan(3);
    expect(numbers.slice(0, 3)).toEqual(['1', '2', '3']);
    expect(routePaths(s)).toHaveLength(2); // the route and its marks
  });
  it('raised in 3D, the route moves up the page and drop lines appear; on the flat map raising does nothing', async () => {
    const flat = project();
    const terrain = await loadTerrain(viewBBox(flat)!, cone);
    const on3d = (lift: number) => buildScene(project((q) => { q.relief.enabled = true; q.relief.tilt = 50; q.route.liftMm = lift; }), terrain);
    const ground = routePaths(on3d(0));
    const raised = routePaths(on3d(10));
    expect(ground).toHaveLength(1);
    expect(raised).toHaveLength(2);
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    expect(mean(ys(raised[0]!.d))).toBeLessThan(mean(ys(ground[0]!.d)));
    const flatRaised = routePaths(buildScene(project((q) => { q.route.liftMm = 10; }), terrain));
    expect(flatRaised).toHaveLength(1);
    expect(flatRaised[0]!.d).toBe(routePaths(buildScene(flat, terrain))[0]!.d);
  });
});
