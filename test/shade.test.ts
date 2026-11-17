import { describe, expect, it } from 'vitest';
import { buildScene, viewBBox } from '../src/scene/buildScene';
import { latToPx, loadTerrain, lonToPx, TILE } from '../src/topo/terrain';
import { defaultProject, type Project } from '../src/scene/project';
import { addPen, penSlots } from '../src/scene/pens';
import { buildSurface } from '../src/relief/surface';
import { buildShadeMap, splitByShade } from '../src/relief/shade';
import { fromFile, toFile } from '../src/projectFile';
import { sampleTrack } from '../src/sample';
import type { PathPrim } from '../src/scene/types';

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
  p.terrain.intervalM = 100; p.terrain.indexEvery = 5; p.features.enabled = false;
  fn?.(p);
  return p;
};
const terrainFor = (p: Project) => loadTerrain(viewBBox(p)!, cone);
const paths = (s: ReturnType<typeof buildScene>, part: string) => s.prims.filter((x): x is PathPrim => x.kind === 'path' && x.part === part);
/** total drawn length, mm */
const inkLength = (ps: PathPrim[]) => {
  let len = 0;
  for (const pr of ps) {
    let last: [number, number] | undefined;
    for (const m of pr.d.matchAll(/([ML])([-\d.]+) ([-\d.]+)/g)) {
      const q: [number, number] = [+m[2]!, +m[3]!];
      if (m[1] === 'L' && last) len += Math.hypot(q[0] - last[0], q[1] - last[1]);
      last = q;
    }
  }
  return len;
};

describe('shade map', () => {
  it('with the sun in the northwest, the southeast side of a cone is the dark one, and the cut takes the asked-for share', async () => {
    const p = project();
    const terrain = await terrainFor(p);
    const scene = buildScene(p, terrain);
    expect(scene.prims.length).toBeGreaterThan(0);
    // a flat fit over a square frame around the peak
    const { fitBBox, groundMetersPerMm } = await import('../src/geo/project');
    const frame = { x: 0, y: 0, w: 200, h: 200 };
    const fit = fitBBox(viewBBox(p)!, frame);
    const surface = buildSurface(terrain, fit, frame);
    const map = buildShadeMap(surface, groundMetersPerMm(fit, frame), 315, 35);
    const [px, py] = fit.toMm(46.82, -121.7);
    const nw = map.darkness(px - 15, py - 15);
    const se = map.darkness(px + 15, py + 15);
    expect(se).toBeGreaterThan(nw);
    const cut = map.cut(0.4);
    let n = 0;
    let dark = 0;
    for (let y = 1; y < 200; y += 3) for (let x = 1; x < 200; x += 3) { n++; if (map.darkness(x, y) > cut) dark++; }
    expect(dark / n).toBeGreaterThan(0.3);
    expect(dark / n).toBeLessThan(0.5);
  });
});

describe('shade map at a high latitude', () => {
  it('a plane rising east at 30° gets the darkness of a true 30° slope at 64°N', async () => {
    const { fitBBox, groundMetersPerMm } = await import('../src/geo/project');
    const z = 12, w = 400, h = 400, lat = 64.1, lon = -21.9;
    const px0 = Math.floor(lonToPx(lon, z)) - w / 2;
    const py0 = Math.floor(latToPx(lat, z)) - h / 2;
    // rise per pixel = tan(30°) × ground meters per pixel at this latitude
    const rise = Math.tan(Math.PI / 6) * (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (TILE * 2 ** z);
    const data = new Float32Array(w * h);
    for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) data[r * w + q] = 500 + rise * q;
    const field = { z, px0, py0, w, h, data, covers: { minLat: lat - 0.3, maxLat: lat + 0.3, minLon: lon - 0.6, maxLon: lon + 0.6 } };
    const frame = { x: 0, y: 0, w: 200, h: 200 };
    const fit = fitBBox({ minLat: lat - 0.01, maxLat: lat + 0.01, minLon: lon - 0.02, maxLon: lon + 0.02 }, frame);
    const surface = buildSurface(field, fit, frame);
    // sun in the west at 30°: a 30° slope facing west gets lit = sin(60°)
    const map = buildShadeMap(surface, groundMetersPerMm(fit, frame), 270, 30);
    expect(map.darkness(100, 100)).toBeCloseTo(1 - Math.sin(Math.PI / 3), 2);
    // with Mercator meters per mm the slope reads as only ~14° (far too lit)
    const wrong = buildShadeMap(surface, fit.metersPerMm, 270, 30);
    expect(wrong.darkness(100, 100)).toBeGreaterThan(1 - Math.sin(Math.PI / 3) + 0.05);
  });
});

describe('splitting lines by shade', () => {
  const line = Array.from({ length: 41 }, (_, i): [number, number] => [i, 0]);
  it('splits where the shade starts; both parts share the crossing point', () => {
    const { lit, dark } = splitByShade([line], (x) => x > 20.2);
    expect(lit).toHaveLength(1);
    expect(dark).toHaveLength(1);
    expect(lit[0]!.at(-1)).toEqual(dark[0]![0]);
    expect(dark[0]!.at(-1)).toEqual([40, 0]);
  });
  it('a speck of shade shorter than 1.5 mm is ignored', () => {
    const { lit, dark } = splitByShade([line], (x) => x === 10);
    expect(dark).toHaveLength(0);
    expect(lit).toHaveLength(1);
    expect(lit[0]).toHaveLength(41);
  });
  it('keeps extra coordinates (heights) and averages them at the crossing', () => {
    const l3 = line.map(([x, y]): [number, number, number] => [x, y, x * 2]);
    const { dark } = splitByShade([l3], (x) => x > 20.2);
    expect(dark[0]![0]).toEqual([20.5, 0, 41]);
  });
});

describe('shading on the poster', () => {
  it('off by default, and the contours are just as before', async () => {
    const p = project();
    expect(p.shade.enabled).toBe(false);
    const terrain = await terrainFor(p);
    const before = paths(buildScene(p, terrain), 'contours');
    expect(before.every((x) => x.minPasses === undefined || x.widthMm === p.terrain.indexWeightMm)).toBe(true);
  });
  it('flat contours: shaded parts are drawn twice in the contour pen, extra lines go in between, and only in the shade', async () => {
    const off = project();
    const terrain = await terrainFor(off);
    const on = project((p) => { p.shade.enabled = true; p.shade.extra = 0; });
    const extra = project((p) => { p.shade.enabled = true; p.shade.extra = 1; });
    const sOff = paths(buildScene(off, terrain), 'contours');
    const sOn = paths(buildScene(on, terrain), 'contours');
    const sExtra = paths(buildScene(extra, terrain), 'contours');
    const darkPrims = sOn.filter((x) => x.minPasses === 2 && x.widthMm === on.terrain.weightMm * 1.6);
    expect(darkPrims).toHaveLength(1);
    // splitting moves ink from one path to another; it adds none
    expect(inkLength(sOn)).toBeCloseTo(inkLength(sOff), -1);
    // one extra line between each pair, in the shade only: more ink, but well under twice as much
    expect(inkLength(sExtra)).toBeGreaterThan(inkLength(sOff) * 1.15);
    expect(inkLength(sExtra)).toBeLessThan(inkLength(sOff) * 1.9);
  });
  it('a shade pen draws the shaded parts and extra lines, and is listed in the pens table', async () => {
    const p = project((q) => { q.shade.enabled = true; });
    const pen = addPen(p)!;
    p.shade.pen = pen.id;
    const terrain = await terrainFor(p);
    const shaded = paths(buildScene(p, terrain), 'contours').filter((x) => x.pen === pen.id);
    expect(shaded.length).toBe(2);
    expect(shaded.every((x) => x.minPasses === undefined && x.color === pen.color)).toBe(true);
    const slot = penSlots(p).find((s) => s.key === 'shade')!;
    expect(slot.get(p)).toBe(pen.id);
    slot.set(p, p.terrain.pen);
    expect(p.shade.pen).toBeUndefined();
  });
  it('3D relief contours and rows are shaded too, with extra rows in the shade', async () => {
    for (const style of ['contours', 'rows'] as const) {
      const off = project((q) => { q.relief.enabled = true; q.relief.style = style; q.relief.tilt = 50; });
      const on = project((q) => { q.relief.enabled = true; q.relief.style = style; q.relief.tilt = 50; q.shade.enabled = true; q.shade.extra = 3; });
      const terrain = await terrainFor(off);
      const a = paths(buildScene(off, terrain), 'relief');
      const b = paths(buildScene(on, terrain), 'relief');
      expect(b.some((x) => x.minPasses === 2)).toBe(true);
      expect(inkLength(b)).toBeGreaterThan(inkLength(a) * 1.2);
    }
  });
  it('a project saved before shading existed opens with it off', () => {
    const file = JSON.parse(JSON.stringify(toFile(project())));
    delete file.project.shade;
    const opened = fromFile(file);
    expect(opened.shade.enabled).toBe(false);
    expect(opened.shade.sunAzimuth).toBe(315);
  });
});
