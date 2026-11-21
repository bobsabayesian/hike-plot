import { describe, expect, it } from 'vitest';
import { thinUnder, THIN_PERIOD_MM } from '../src/cover/thin';
import { buildScene, viewBBox } from '../src/scene/buildScene';
import { latToPx, loadTerrain, lonToPx, TILE } from '../src/topo/terrain';
import { sampleTrack } from '../src/sample';
import type { OsmData } from '../src/features/types';
import type { PathPrim } from '../src/scene/types';
import type { Project } from '../src/scene/project';
import { defaultCover, COVER_CLASSES } from '../src/cover/types';
import { fromFile, toFile } from '../src/projectFile';
import { defaultProject } from '../src/scene/project';

type P = [number, number, number];
const line = (x0: number, x1: number, y = 0, z = 7): P[] => [[x0, y, z], [x1, y, z]];
const length = (ls: P[][]) => ls.reduce((a, l) => a + l.slice(1).reduce((b, q, i) => b + Math.hypot(q[0] - l[i]![0], q[1] - l[i]![1]), 0), 0);
const everywhere = (f: number) => () => f;

describe('thinning lines under a cover', () => {
  it('leaves lines alone at 0 and removes them at 1', () => {
    expect(length(thinUnder([line(0, 60)], everywhere(0)))).toBeCloseTo(60, 6);
    expect(thinUnder([line(0, 60)], everywhere(1))).toEqual([]);
  });
  it('clears about the share asked for, as dashes with gaps', () => {
    for (const f of [0.25, 0.5, 0.75]) {
      const out = thinUnder([line(0, 90)], everywhere(f));
      expect(length(out) / 90).toBeCloseTo(1 - f, 1);
      expect(out.length).toBeGreaterThan(20); // dashes, one per period
    }
  });
  it('more clearing never leaves more line', () => {
    let prev = Infinity;
    for (const f of [0, 0.1, 0.3, 0.5, 0.8, 0.95]) { const l = length(thinUnder([line(0, 90)], everywhere(f))); expect(l).toBeLessThanOrEqual(prev + 1e-9); prev = l; }
  });
  it('only touches the stretch inside the area, and keeps what is outside whole', () => {
    const inside = (x: number) => x >= 30 && x <= 60;
    const out = thinUnder([line(0, 90)], (x) => (inside(x) ? 0.5 : 0));
    // 60 mm outside is kept; of the 30 mm inside about half
    expect(length(out)).toBeGreaterThan(60 + 12);
    expect(length(out)).toBeLessThan(60 + 18);
    const first = out[0]!; // the line from 0 reaches the area before it is cut
    expect(first[0]![0]).toBe(0);
    expect(first[first.length - 1]![0]).toBeGreaterThanOrEqual(30 - 0.3);
    expect(out.flat().filter((q) => q[0] > 30.3 && q[0] < 59.7).length).toBeGreaterThan(0);
  });
  it('carries other coordinates (a height) through, interpolated, and does not change the input', () => {
    const src: P[][] = [[[0, 0, 0], [60, 0, 60]]];
    const copy = JSON.stringify(src);
    const out = thinUnder(src, everywhere(0.5));
    for (const l of out) for (const q of l) expect(q[2]).toBeCloseTo(q[0], 6);
    expect(JSON.stringify(src)).toBe(copy);
  });
  it('gives every line the same rhythm, and keeps the rhythm across the points of a bent line', () => {
    const a = thinUnder([line(0, 30, 0)], everywhere(0.5));
    const b = thinUnder([line(0, 30, 5)], everywhere(0.5));
    expect(a.map((l) => l.map((q) => [q[0], q[2]]))).toEqual(b.map((l) => l.map((q) => [q[0], q[2]])));
    // a line made of many short pieces thins the same as one long piece
    const many: P[] = Array.from({ length: 61 }, (_, i) => [i * 0.5, 0, 7]);
    expect(length(thinUnder([many], everywhere(0.5)))).toBeCloseTo(length(a), 0);
    // the first gap begins at the start of each period
    expect(a[0]![0]![0]).toBeGreaterThanOrEqual(THIN_PERIOD_MM * 0.5 - 0.3);
  });
  it('is fast on a lot of line with a small area', () => {
    const lines: P[][] = Array.from({ length: 300 }, (_, k) => Array.from({ length: 400 }, (_, i) => [i * 0.25, k * 0.3, 0] as P));
    const t = performance.now();
    thinUnder(lines, (x, y) => (x > 40 && x < 60 && y > 30 && y < 60 ? 0.4 : 0));
    expect(performance.now() - t).toBeLessThan(2000);
  });
});

describe('the setting', () => {
  it('is off for every kind by default, and a project saved without it opens with it off', () => {
    for (const c of COVER_CLASSES) expect(defaultCover().classes[c].clearPct).toBe(0);
    const p = defaultProject();
    const raw = JSON.parse(JSON.stringify(toFile(p)));
    for (const c of COVER_CLASSES) delete raw.project.cover.classes[c].clearPct;
    expect(fromFile(raw).cover.classes.wood.clearPct).toBe(0);
    p.cover.classes.wood.clearPct = 40;
    expect(fromFile(JSON.parse(JSON.stringify(toFile(p)))).cover.classes.wood.clearPct).toBe(40);
  });
});

// the poster: a forest over the bottom third of the map, with a cone of hills so there are contours across it
const cone = async (z: number, tx: number, ty: number) => {
  const cx = lonToPx(-121.7, z), cy = latToPx(46.82, z);
  const out = new Float32Array(TILE * TILE);
  const slope = 2000 / (2 ** z * TILE * 0.0008);
  for (let r = 0; r < TILE; r++) for (let c = 0; c < TILE; c++) out[r * TILE + c] = Math.max(0, 2000 - slope * Math.hypot(tx * TILE + c - cx, ty * TILE + r - cy));
  return out;
};
const project = (fn?: (p: Project) => void) => {
  const p = { ...defaultProject(), points: sampleTrack() };
  p.terrain.intervalM = 50; p.features.enabled = false; p.cover.enabled = true;
  p.cover.classes.rock.on = false;
  fn?.(p);
  return p;
};
const osmFor = (p: Project): OsmData => {
  const b = viewBBox(p)!;
  const ring: [number, number][] = [[b.minLat, b.minLon], [b.minLat, b.maxLon], [b.minLat + (b.maxLat - b.minLat) / 3, b.maxLon], [b.minLat + (b.maxLat - b.minLat) / 3, b.minLon]];
  return { landmarks: [], water: [], covers: b, cover: [{ cls: 'wood', rings: [ring] }] };
};
/** the total length of the contour (or relief) lines on the page, mm */
const inkLength = (s: ReturnType<typeof buildScene>, part: 'contours' | 'relief') => s.prims
  .filter((x): x is PathPrim => x.kind === 'path' && x.part === part)
  .reduce((n, x) => n + x.d.split('M').slice(1).reduce((m, seg) => { const pts = seg.split('L').map((q) => q.trim().split(/\s+/).map(Number)); return m + pts.slice(1).reduce((a, q, i) => a + Math.hypot(q[0]! - pts[i]![0]!, q[1]! - pts[i]![1]!), 0); }, 0), 0);

describe('the slider on the poster', () => {
  const lengthAt = async (pct: number, pattern: 'trees' | 'clear' = 'trees', relief = false) => {
    const p = project((q) => { q.cover.classes.wood.clearPct = pct; q.cover.classes.wood.pattern = pattern; if (relief) { q.relief.enabled = true; q.relief.tilt = 50; } });
    const terrain = await loadTerrain(viewBBox(p)!, cone);
    return inkLength(buildScene(p, terrain, osmFor(p)), relief ? 'relief' : 'contours');
  };
  it('at 0 the contours are as they were; more clearing leaves less of them; 100 matches clear paper', async () => {
    const none = await lengthAt(0);
    const some = await lengthAt(40);
    const most = await lengthAt(80);
    const all = await lengthAt(100);
    const clearPaper = await lengthAt(0, 'clear');
    expect(some).toBeLessThan(none);
    expect(most).toBeLessThan(some);
    expect(all).toBeLessThan(most);
    expect(Math.abs(all - clearPaper) / clearPaper).toBeLessThan(0.01); // the same, give or take where a cut falls
    // the cover is a third of the map, so even bare paper there leaves a good part of the lines
    expect(all).toBeGreaterThan(none * 0.3);
  });
  it('works in 3D, and does not touch the cover marks', async () => {
    expect(await lengthAt(60, 'trees', true)).toBeLessThan(await lengthAt(0, 'trees', true));
    const p = project((q) => { q.cover.classes.wood.clearPct = 70; });
    const terrain = await loadTerrain(viewBBox(p)!, cone);
    const base = project();
    const marks = (pp: Project) => buildScene(pp, terrain, osmFor(pp)).prims.filter((x) => x.kind === 'path' && x.part === 'cover').map((x) => (x as PathPrim).d);
    expect(marks(p)).toEqual(marks(base));
  });
  it('a kind that is switched off, or cover that is off, clears nothing', async () => {
    const off = project((q) => { q.cover.classes.wood.clearPct = 90; q.cover.classes.wood.on = false; });
    const terrain = await loadTerrain(viewBBox(off)!, cone);
    const base = project((q) => { q.cover.classes.wood.on = false; });
    expect(inkLength(buildScene(off, terrain, osmFor(off)), 'contours')).toBeCloseTo(inkLength(buildScene(base, terrain, osmFor(base)), 'contours'), 6);
  });
});
