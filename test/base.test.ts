import { describe, expect, it } from 'vitest';
import { buildRelief, defaultRelief, type ReliefSettings } from '../src/relief/relief';
import { baseLines, defaultBase, floorZ, strataLevels } from '../src/relief/base';
import { latToPx, loadTerrain, lonToPx, TILE, type TerrainField } from '../src/topo/terrain';
import { fitBBox, type BBox } from '../src/geo/project';
import { buildScene, viewBBox } from '../src/scene/buildScene';
import { defaultProject, type Project } from '../src/scene/project';
import { addPen, penSlots } from '../src/scene/pens';
import { fromFile, toFile } from '../src/projectFile';
import { sampleTrack } from '../src/sample';
import type { PathPrim } from '../src/scene/types';

const frame = { x: 20, y: 30, w: 300, h: 400 };
/** a tilted plane: rises to the east and the south */
const planeField = (): TerrainField => {
  const z = 12;
  const w = 600, h = 600;
  const px0 = Math.floor(lonToPx(-121.8, z)) - 100;
  const py0 = Math.floor(latToPx(46.9, z)) - 100;
  const data = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) data[r * w + q] = 1000 + 0.5 * q + 0.25 * r;
  return { z, px0, py0, w, h, data, covers: { minLat: 46.7, maxLat: 47, minLon: -122, maxLon: -121.5 } };
};
const box: BBox = { minLat: 46.835, maxLat: 46.865, minLon: -121.78, maxLon: -121.74 };
const fit = fitBBox(box, frame);
const field = planeField();
const relief = (view: Partial<ReliefSettings>, base = { ...defaultBase(), enabled: true }) =>
  buildRelief(field, fit, frame, { ...defaultRelief(), enabled: true, perspective: 0, ...view, base });

describe('which walls show', () => {
  it('looking from the south (no turn) only the south wall shows: its profile, floor edge and two corners', () => {
    const r = relief({ turn: 0, tilt: 50 });
    const { outline } = baseLines(r, { ...defaultBase(), enabled: true, faces: 'plain' }, { turn: 0, tilt: 50 }, []);
    expect(outline).toHaveLength(4);
  });
  it('turned 45°, two walls show and share the corner between them', () => {
    const r = relief({ turn: 45, tilt: 50 });
    const { outline } = baseLines(r, { ...defaultBase(), enabled: true, faces: 'plain' }, { turn: 45, tilt: 50 }, []);
    expect(outline).toHaveLength(2 * 2 + 3);
  });
  it('seen from straight above there are no walls', () => {
    const r = relief({ turn: 0, tilt: 0 });
    expect(baseLines(r, { ...defaultBase(), enabled: true }, { turn: 0, tilt: 0 }, [1000]).outline).toHaveLength(0);
  });
});

describe('the walls', () => {
  const view = { turn: 0, tilt: 50 };
  const r = relief(view);
  const s = { ...defaultBase(), enabled: true };
  it('the floor sits the base depth below the lowest point', () => {
    expect(floorZ(r, 12)).toBeCloseTo(r.heightMm(r.surface.lo) - 12, 9);
  });
  it('strata start just above the floor and stop below the top; heavy strata are fewer', () => {
    const every = strataLevels(r, 12, 20);
    const heavy = strataLevels(r, 12, 100);
    expect(every[0]!).toBeLessThan(r.surface.lo); // they run down into the base
    expect(every.at(-1)!).toBeLessThan(r.surface.hi);
    expect(heavy.length).toBeLessThan(every.length);
    const lines = baseLines(r, { ...s, faces: 'strata' }, view, every).faces;
    expect(lines.length).toBeGreaterThan(0);
    // level lines on a straight wall are straight: two points each
    expect(lines.every((l) => l.length === 2)).toBe(true);
    // every strata line is between the floor edge and the profile on the page (higher up = smaller y)
    const floorY = r.camera.project(frame.x, frame.y + frame.h, floorZ(r, 12))[1];
    for (const l of lines) for (const [, y] of l) expect(y).toBeLessThanOrEqual(floorY + 1e-6);
  });
  it('hatching is upright lines about every hatchMm along the wall', () => {
    const lines = baseLines(r, { ...s, faces: 'hatch', hatchMm: 5 }, view, []).faces;
    expect(lines.length).toBeGreaterThan(frame.w / 5 - 3);
    expect(lines.length).toBeLessThan(frame.w / 5 + 1);
  });
  it('the floor fits in the frame', () => {
    const deep = relief(view, { ...defaultBase(), enabled: true, depthMm: 60 });
    const fz = floorZ(deep, 60);
    for (const [x, y] of [[frame.x, frame.y], [frame.x + frame.w, frame.y + frame.h]] as const) {
      const [, py] = deep.camera.project(x, y, fz);
      expect(py).toBeLessThanOrEqual(frame.y + frame.h + 1e-6);
    }
  });
});

// a cone of terrain around Mount Rainier
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
  p.relief.enabled = true; p.relief.tilt = 50; p.relief.turn = 30;
  fn?.(p);
  return p;
};

describe('the base on the poster', () => {
  it('off by default; old projects open with it off', () => {
    expect(defaultProject().relief.base.enabled).toBe(false);
    const file = JSON.parse(JSON.stringify(toFile(defaultProject())));
    delete file.project.relief.base;
    expect(fromFile(file).relief.base).toEqual(defaultBase());
  });
  it('draws a heavy outline (twice over in the contour pen) and its strata as relief lines', async () => {
    const off = project();
    const terrain = await loadTerrain(viewBBox(off)!, cone);
    const on = project((p) => { p.relief.base.enabled = true; });
    const relief = (s: ReturnType<typeof buildScene>) => s.prims.filter((x): x is PathPrim => x.kind === 'path' && x.part === 'relief');
    const a = relief(buildScene(off, terrain));
    const b = relief(buildScene(on, terrain));
    expect(b.length).toBe(a.length + 2);
    const outline = b.find((x) => x.minPasses === 2 && x.widthMm === on.terrain.indexWeightMm && !a.some((y) => y.d === x.d));
    expect(outline).toBeDefined();
  });
  it('a base pen is used and listed in the pens table', async () => {
    const p = project((q) => { q.relief.base.enabled = true; });
    const pen = addPen(p)!;
    p.relief.base.pen = pen.id;
    const terrain = await loadTerrain(viewBBox(p)!, cone);
    const mine = buildScene(p, terrain).prims.filter((x): x is PathPrim => x.kind === 'path' && x.pen === pen.id);
    expect(mine).toHaveLength(2);
    expect(mine.every((x) => x.minPasses === undefined)).toBe(true);
    expect(penSlots(p).find((s) => s.key === 'base')?.get(p)).toBe(pen.id);
  });
});
