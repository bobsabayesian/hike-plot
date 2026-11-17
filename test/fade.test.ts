import { describe, expect, it } from 'vitest';
import { band, defaultFade, depthOf, thinLine } from '../src/relief/fade';
import { buildRelief, defaultRelief } from '../src/relief/relief';
import { buildScene, viewBBox } from '../src/scene/buildScene';
import { defaultProject, type Project } from '../src/scene/project';
import { addPen, penSlots } from '../src/scene/pens';
import { latToPx, loadTerrain, lonToPx, TILE, type TerrainField } from '../src/topo/terrain';
import { fitBBox, type BBox } from '../src/geo/project';
import { fromFile, toFile } from '../src/projectFile';
import { sampleTrack } from '../src/sample';
import type { PathPrim } from '../src/scene/types';

describe('bands', () => {
  it('near until the start, then middle distance, then far for the back half of the rest', () => {
    expect(band(0.2, 40)).toBe(0);
    expect(band(0.5, 40)).toBe(1);
    expect(band(0.69, 40)).toBe(1);
    expect(band(0.71, 40)).toBe(2);
  });
  it('a line is kept near; in the middle only every 2nd; far only every 4th', () => {
    const line: [number, number][] = Array.from({ length: 31 }, (_, i) => [i, 0]);
    const bandAt = (x: number) => (x < 10 ? 0 : x < 20 ? 1 : 2) as 0 | 1 | 2;
    const reach = (ls: [number, number][][]) => Math.max(...ls.flatMap((l) => l.map((q) => q[0])));
    expect(thinLine(line, 4, bandAt)).toEqual([line]); // every 4th: kept all the way
    expect(reach(thinLine(line, 2, bandAt))).toBeCloseTo(19.5, 1); // every 2nd: up to the far band
    expect(reach(thinLine(line, 1, bandAt))).toBeCloseTo(9.5, 1); // the others: only near
  });
});

describe('depth', () => {
  it('seen from the south (no turn), the bottom of the map is near and the top is far', () => {
    const frame = { x: 20, y: 30, w: 300, h: 400 };
    const z = 12, w = 600, h = 600;
    const field: TerrainField = { z, px0: Math.floor(lonToPx(-121.8, z)) - 100, py0: Math.floor(latToPx(46.9, z)) - 100, w, h, data: new Float32Array(w * h).fill(1000), covers: { minLat: 46.7, maxLat: 47, minLon: -122, maxLon: -121.5 } };
    const box: BBox = { minLat: 46.835, maxLat: 46.865, minLon: -121.78, maxLon: -121.74 };
    const r = buildRelief(field, fitBBox(box, frame), frame, { ...defaultRelief(), enabled: true, turn: 0, tilt: 50, perspective: 0 });
    const t = depthOf(r);
    expect(t(170, 429)).toBeLessThan(0.02);
    expect(t(170, 31)).toBeGreaterThan(0.98);
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
  p.terrain.intervalM = 50; p.features.enabled = false;
  p.relief.enabled = true; p.relief.tilt = 55; p.relief.style = 'rowsAll'; p.relief.rows = 80;
  fn?.(p);
  return p;
};
const relief = (s: ReturnType<typeof buildScene>) => s.prims.filter((x): x is PathPrim => x.kind === 'path' && x.part === 'relief');
const ink = (ps: PathPrim[]) => ps.reduce((n, x) => n + (x.d.match(/L/g)?.length ?? 0), 0);

describe('fade on the poster', () => {
  it('off by default; old projects open with it off', () => {
    const file = JSON.parse(JSON.stringify(toFile(defaultProject())));
    delete file.project.relief.fade;
    expect(fromFile(file).relief.fade).toEqual(defaultFade());
  });
  it('fewer lines far away means less ink, and the near part is untouched', async () => {
    const off = project();
    const terrain = await loadTerrain(viewBBox(off)!, cone);
    const a = ink(relief(buildScene(off, terrain)));
    const b = ink(relief(buildScene(project((p) => { p.relief.fade.enabled = true; p.relief.fade.startPct = 30; }), terrain)));
    expect(b).toBeLessThan(a * 0.85);
    expect(b).toBeGreaterThan(a * 0.3);
  });
  it('a far pen draws the far part, and is listed in the pens table', async () => {
    const p = project((q) => { q.relief.fade.enabled = true; q.relief.fade.fewer = false; });
    const pen = addPen(p)!;
    p.relief.fade.pen = pen.id;
    const terrain = await loadTerrain(viewBBox(p)!, cone);
    const ps = relief(buildScene(p, terrain));
    expect(ps.some((x) => x.pen === pen.id)).toBe(true);
    expect(ps.some((x) => x.pen === p.terrain.pen)).toBe(true);
    expect(penSlots(p).find((s) => s.key === 'fade')?.get(p)).toBe(pen.id);
  });
});
