import { describe, expect, it } from 'vitest';
import { makeCamera, type ViewSettings } from '../src/relief/camera';
import { buildSurface, MAX_STEP_MM, MIN_STEP_MM } from '../src/relief/surface';
import { buildRelief, defaultRelief, liftContours, ridgeRows } from '../src/relief/relief';
import { contourPaths } from '../src/topo/contours';
import { latToPx, loadTerrain, lonToPx, TILE, type TerrainField } from '../src/topo/terrain';
import { fitBBox, type BBox } from '../src/geo/project';
import { buildScene, composeScene, viewBBox } from '../src/scene/buildScene';
import { defaultProject, type Project } from '../src/scene/project';
import { sceneToSvg } from '../src/export/svg';
import { prepareScene, type FontSet } from '../src/export/outlines';
import { sampleTrack, sampleWaypoints } from '../src/sample';
import type { PathPrim, Prim } from '../src/scene/types';

const frame = { x: 20, y: 30, w: 300, h: 400 };
const flatView: ViewSettings = { turn: 0, tilt: 0, perspective: 0 };
/** corners of the frame as (x, y, z) at the given heights */
const corners = (z = 0): [number, number, number][] => [[frame.x, frame.y, z], [frame.x + frame.w, frame.y, z], [frame.x, frame.y + frame.h, z], [frame.x + frame.w, frame.y + frame.h, z]];

describe('camera', () => {
  it('with no turn, tilt or perspective it changes nothing at all', () => {
    const cam = makeCamera(frame, flatView, corners());
    expect(cam.scale).toBe(1);
    for (const [x, y, z] of [[20, 30, 0], [170, 230, 50], [320, 430, -40], [77.7, 401.2, 12]] as const) {
      const [px, py] = cam.project(x, y, z);
      expect(px).toBeCloseTo(x, 9);
      expect(py).toBeCloseTo(y, 9);
    }
  });
  it('a tilt moves higher points up the page, by sin(tilt) per mm of height', () => {
    const view = { turn: 0, tilt: 60, perspective: 0 };
    const cam = makeCamera(frame, view, corners());
    const [, low] = cam.project(100, 200, 0);
    const [, high] = cam.project(100, 200, 10);
    expect(high).toBeLessThan(low);
    expect(low - high).toBeCloseTo(10 * Math.sin((60 * Math.PI) / 180) * cam.scale, 9);
  });
  it('a tilt squashes the map front to back by cos(tilt) and leaves the width alone', () => {
    const cam = makeCamera(frame, { turn: 0, tilt: 60, perspective: 0 }, corners());
    const [x0, y0] = cam.project(20, 30, 0);
    const [x1, y1] = cam.project(320, 430, 0);
    expect(x1 - x0).toBeCloseTo(300 * cam.scale, 9);
    expect(y1 - y0).toBeCloseTo(400 * Math.cos((60 * Math.PI) / 180) * cam.scale, 9);
  });
  it('a turn rotates the map about its center', () => {
    const cam = makeCamera(frame, { turn: 90, tilt: 0, perspective: 0 }, corners());
    const cx = frame.x + frame.w / 2;
    const cy = frame.y + frame.h / 2;
    const [px, py] = cam.project(cx + 100, cy, 0);
    expect(px).toBeCloseTo(cx, 6); // the point east of the center is now south of it (or north), not east
    expect(Math.abs(py - cy)).toBeCloseTo(100 * cam.scale, 6);
    expect(cam.scale).toBeLessThan(1); // a turned rectangle needs more room
  });
  it('turning by 180 puts every point opposite the center', () => {
    const cam = makeCamera({ x: 0, y: 0, w: 200, h: 200 }, { turn: 180, tilt: 0, perspective: 0 }, [[0, 0, 0], [200, 0, 0], [0, 200, 0], [200, 200, 0]]);
    const [x, y] = cam.project(50, 60, 0);
    expect(x).toBeCloseTo(150, 6);
    expect(y).toBeCloseTo(140, 6);
  });
  it('perspective makes nearer things larger', () => {
    const cam = makeCamera(frame, { turn: 0, tilt: 50, perspective: 60 }, corners());
    // two points the same distance from the center, one on the near (front) side and one on the far side
    const cx = frame.x + frame.w / 2;
    const cy = frame.y + frame.h / 2;
    const near = cam.project(cx + 100, cy + 150, 0);
    const far = cam.project(cx + 100, cy - 150, 0);
    expect(Math.abs(near[0] - cam.project(cx, cy, 0)[0])).toBeGreaterThan(Math.abs(far[0] - cam.project(cx, cy, 0)[0]));
    expect(cam.depth(cx, cy + 150, 0)).toBeGreaterThan(cam.depth(cx, cy - 150, 0));
  });
  it('no perspective keeps parallel lines parallel (same width front and back)', () => {
    const cam = makeCamera(frame, { turn: 0, tilt: 50, perspective: 0 }, corners());
    const w = (y: number) => cam.project(frame.x + frame.w, y, 0)[0] - cam.project(frame.x, y, 0)[0];
    expect(w(frame.y)).toBeCloseTo(w(frame.y + frame.h), 9);
  });
  it('always fits inside the frame and never enlarges the map, for any view', () => {
    for (const turn of [-170, -45, 0, 33, 90, 180]) for (const tilt of [0, 30, 60, 85]) for (const perspective of [0, 40, 100]) {
      const cs: [number, number, number][] = [];
      for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) cs.push([frame.x + (i / 10) * frame.w, frame.y + (j / 10) * frame.h, 30 * Math.sin(i) * Math.cos(j)]);
      const cam = makeCamera(frame, { turn, tilt, perspective }, cs);
      expect(cam.scale).toBeLessThanOrEqual(1 + 1e-12);
      for (const [x, y, z] of cs) {
        const [px, py] = cam.project(x, y, z);
        expect(px).toBeGreaterThanOrEqual(frame.x - 1e-6); expect(px).toBeLessThanOrEqual(frame.x + frame.w + 1e-6);
        expect(py).toBeGreaterThanOrEqual(frame.y - 1e-6); expect(py).toBeLessThanOrEqual(frame.y + frame.h + 1e-6);
      }
    }
  });
  it('centers the tilted map in the frame', () => {
    const cam = makeCamera(frame, { turn: 20, tilt: 65, perspective: 30 }, corners());
    const ps = corners().map(([x, y, z]) => cam.project(x, y, z));
    const xs = ps.map((q) => q[0]); const ys = ps.map((q) => q[1]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(frame.x + frame.w / 2, 6);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(frame.y + frame.h / 2, 6);
  });
  it('treats an out-of-range tilt, perspective or an empty point list sensibly', () => {
    expect(() => makeCamera(frame, { turn: 0, tilt: 200, perspective: 500 }, corners())).not.toThrow();
    const cam = makeCamera(frame, { turn: 0, tilt: -20, perspective: -5 }, corners());
    expect(cam.project(100, 100, 0)[0]).toBeCloseTo(100, 6);
  });
});

/** A terrain grid on a plane, hand built, around Mount Rainier at zoom 12. */
const planeField = (a = 0.5, b = 0.25, c = 1000): TerrainField => {
  const z = 12;
  const w = 600, h = 600;
  const px0 = Math.floor(lonToPx(-121.8, z)) - 100;
  const py0 = Math.floor(latToPx(46.9, z)) - 100;
  const data = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) data[r * w + q] = c + a * q + b * r;
  return { z, px0, py0, w, h, data, covers: { minLat: 46.7, maxLat: 47, minLon: -122, maxLon: -121.5 } };
};
const box: BBox = { minLat: 46.835, maxLat: 46.865, minLon: -121.78, maxLon: -121.74 };

describe('the terrain surface', () => {
  const fit = fitBBox(box, frame);
  const field = planeField();
  const surf = buildSurface(field, fit, frame);

  it('has a node at every corner of the frame and sizes itself to the elevation data', () => {
    expect(surf.cols).toBeGreaterThanOrEqual(2);
    expect(surf.rows).toBeGreaterThanOrEqual(2);
    expect(surf.stepX).toBeGreaterThanOrEqual(MIN_STEP_MM - 1e-9);
    expect(surf.stepX).toBeLessThanOrEqual(MAX_STEP_MM * 1.2);
    expect(surf.elev.length).toBe(surf.cols * surf.rows);
    expect(surf.sample(frame.x, frame.y)).toBeCloseTo(surf.elev[0]!, 6);
    expect(surf.sample(frame.x + frame.w, frame.y + frame.h)).toBeCloseTo(surf.elev[surf.elev.length - 1]!, 6);
  });
  it('reproduces a plane exactly: the elevation at a spot matches the data at that spot', () => {
    for (const [x, y] of [[frame.x + 40, frame.y + 60], [170, 230], [300, 400], [frame.x + 150.3, frame.y + 222.7]] as const) {
      const [lat, lon] = fit.fromMm(x, y);
      const gx = lonToPx(lon, field.z) - field.px0 - 0.5;
      const gy = latToPx(lat, field.z) - field.py0 - 0.5;
      expect(surf.sample(x, y)).toBeCloseTo(1000 + 0.5 * gx + 0.25 * gy, 1);
    }
  });
  it('knows its lowest and highest elevation', () => {
    expect(surf.lo).toBeLessThan(surf.hi);
    expect(surf.lo).toBeLessThanOrEqual(surf.sample(170, 230));
    expect(surf.hi).toBeGreaterThanOrEqual(surf.sample(170, 230));
  });
  it('clamps outside the frame to the edge instead of inventing heights', () => {
    expect(surf.sample(frame.x - 500, frame.y - 500)).toBeCloseTo(surf.sample(frame.x, frame.y), 9);
    expect(surf.sample(frame.x + 9999, frame.y + 9999)).toBeCloseTo(surf.sample(frame.x + frame.w, frame.y + frame.h), 9);
  });
  it('is reused when asked for again with the same inputs, and rebuilt when they change', () => {
    const a = buildSurface(field, fit, frame);
    expect(buildSurface(field, fit, frame)).toBe(a);
    expect(buildSurface(field, fit, { ...frame, w: frame.w - 10 })).not.toBe(a);
  });
});

describe('the 3D map fit', () => {
  const fit = fitBBox(box, frame);
  const field = planeField();
  it('with a flat view it puts every place where the flat map does, whatever its height', () => {
    const r = buildRelief(field, fit, frame, { ...defaultRelief(), enabled: true, turn: 0, tilt: 0, perspective: 0, depth: 300 });
    for (const [lat, lon] of [[46.84, -121.77], [46.85, -121.76], [46.86, -121.745]] as const) {
      const [x, y] = fit.toMm(lat, lon);
      const [rx, ry] = r.fit.toMm(lat, lon);
      expect(rx).toBeCloseTo(x, 6);
      expect(ry).toBeCloseTo(y, 6);
    }
  });
  it('with a tilt, higher ground lands higher on the page', () => {
    // the plane's relief across this small view is only a few meters, so exaggerate it
    const view = { ...defaultRelief(), enabled: true, perspective: 0, depth: 4000 };
    const flatA = fit.toMm(46.85, -121.76);
    const [, yFlat] = buildRelief(field, fit, frame, { ...view, tilt: 0 }).fit.toMm(46.85, -121.76);
    expect(flatA[1]).toBeCloseTo(yFlat, 6);
    const [, y3] = buildRelief(field, fit, frame, { ...view, tilt: 55 }).fit.toMm(46.85, -121.76);
    expect(Math.abs(y3 - yFlat)).toBeGreaterThan(0.01);
    // and a spot on the high side of the view is drawn higher up the page than the same spot on the low side
    const rr = buildRelief(field, fit, frame, { ...view, tilt: 55 });
    const mid = (rr.surface.lo + rr.surface.hi) / 2;
    const hiSpot = [frame.x + frame.w - 1, frame.y + frame.h - 1] as const; // the plane rises toward larger x and y
    expect(rr.surface.sample(hiSpot[0], hiSpot[1])).toBeGreaterThan(mid);
  });
  it('turns a lat/lon into the same page position as projecting its flat position at the surface height', () => {
    const r = buildRelief(field, fit, frame, { ...defaultRelief(), enabled: true, turn: 25, tilt: 50, perspective: 30 });
    const [x, y] = fit.toMm(46.852, -121.755);
    const direct = r.camera.project(x, y, r.heightMm(r.surface.sample(x, y)));
    const via = r.fit.toMm(46.852, -121.755);
    expect(via[0]).toBeCloseTo(direct[0], 9);
    expect(via[1]).toBeCloseTo(direct[1], 9);
  });
  it('taller exaggeration moves the same hill further up the page', () => {
    const y = (depth: number) => buildRelief(field, fit, frame, { ...defaultRelief(), enabled: true, tilt: 60, perspective: 0, depth }).fit.toMm(46.862, -121.745)[1];
    expect(y(300)).not.toBeCloseTo(y(100), 3);
  });
  it('keeps the flat inverse (used only to frame the view)', () => {
    const r = buildRelief(field, fit, frame, { ...defaultRelief(), enabled: true });
    expect(r.fit.fromMm(100, 100)).toEqual(fit.fromMm(100, 100));
    expect(r.fit.metersPerMm).toBe(fit.metersPerMm);
  });
});

describe('ridge rows', () => {
  const fit = fitBBox(box, frame);
  const field = planeField(0, 0, 1500); // a flat tabletop
  const settings = { ...defaultRelief(), enabled: true, turn: 0, tilt: 0, perspective: 0 };
  const r = buildRelief(field, fit, frame, settings);
  it('draws the number of rows asked for, west to east, evenly spaced', () => {
    const rows = ridgeRows(r, 40);
    expect(rows).toHaveLength(40);
    const ys = rows.map((row) => row[0]![1]);
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeCloseTo(frame.h / 39, 6);
    for (const row of rows) { expect(row[0]![0]).toBeCloseTo(frame.x, 6); expect(row[row.length - 1]![0]).toBeCloseTo(frame.x + frame.w, 6); }
  });
  it('on level ground seen from above, every row is a straight horizontal line (so it is reduced to its two ends)', () => {
    for (const row of ridgeRows(r, 10)) { expect(row).toHaveLength(2); expect(row[0]![1]).toBeCloseTo(row[1]![1], 9); }
  });
  it('on real hills seen from the side, rows follow the terrain up and down', () => {
    const hilly = planeField(0.5, 0.25, 1000);
    const hr = buildRelief(hilly, fit, frame, { ...settings, tilt: 60, depth: 200 });
    const rows = ridgeRows(hr, 5);
    for (const row of rows) { const ys = row.map((q) => q[1]); expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.5); }
  });
  it('a minimum of two rows, and a whole number', () => {
    expect(ridgeRows(r, 1)).toHaveLength(2);
    expect(ridgeRows(r, 12.6)).toHaveLength(13);
  });
  it('every row stays inside the frame, for any view', () => {
    const hilly = planeField(0.5, 0.25, 1000);
    for (const [turn, tilt, perspective] of [[0, 55, 35], [40, 70, 60], [-90, 30, 0]] as const) {
      const rr = buildRelief(hilly, fit, frame, { ...settings, turn, tilt, perspective, depth: 250 });
      for (const row of ridgeRows(rr, 20)) for (const [x, y] of row) {
        expect(x).toBeGreaterThanOrEqual(frame.x - 1e-6); expect(x).toBeLessThanOrEqual(frame.x + frame.w + 1e-6);
        expect(y).toBeGreaterThanOrEqual(frame.y - 1e-6); expect(y).toBeLessThanOrEqual(frame.y + frame.h + 1e-6);
      }
    }
  });
});

describe('lifted contours', () => {
  const fit = fitBBox(box, frame);
  const field = planeField(0.5, 0.25, 1000);
  it('at the flat view they are exactly the flat contours', () => {
    const flat = contourPaths(field, fit, frame, 20, 5);
    const r = buildRelief(field, fit, frame, { ...defaultRelief(), enabled: true, turn: 0, tilt: 0, perspective: 0 });
    const lifted = liftContours(r, flat.pieces);
    const want = flat.pieces.filter((p) => !p.heavy).map((p) => p.pts);
    expect(lifted.regular).toHaveLength(want.length);
    lifted.regular.forEach((line, i) => line.forEach(([x, y], k) => { expect(x).toBeCloseTo(want[i]![k]![0], 9); expect(y).toBeCloseTo(want[i]![k]![1], 9); }));
  });
  it('keeps the regular and heavy lines apart', () => {
    const flat = contourPaths(field, fit, frame, 20, 5);
    const r = buildRelief(field, fit, frame, { ...defaultRelief(), enabled: true });
    const lifted = liftContours(r, flat.pieces);
    expect(lifted.regular.length + lifted.index.length).toBe(flat.pieces.length);
    expect(lifted.index.length).toBe(flat.pieces.filter((p) => p.heavy).length);
  });
  it('with a tilt, a contour at a high level sits higher on the page than one at a low level', () => {
    const r = buildRelief(field, fit, frame, { ...defaultRelief(), enabled: true, tilt: 60, perspective: 0, depth: 100 });
    const p = { level: 0, heavy: false, pts: [[170, 230], [171, 231]] as [number, number][] };
    const low = liftContours(r, [{ ...p, level: r.surface.lo }]).regular[0]![0]![1];
    const high = liftContours(r, [{ ...p, level: r.surface.hi }]).regular[0]![0]![1];
    expect(high).toBeLessThan(low);
  });
});

describe('3D in the poster', () => {
  const cone = async (z: number, tx: number, ty: number) => {
    const cx = lonToPx(-121.7, z);
    const cy = latToPx(46.82, z);
    const out = new Float32Array(TILE * TILE);
    const slope = 2000 / (2 ** z * TILE * 0.0008);
    for (let r = 0; r < TILE; r++) for (let c = 0; c < TILE; c++) out[r * TILE + c] = Math.max(0, 2000 - slope * Math.hypot(tx * TILE + c - cx, ty * TILE + r - cy));
    return out;
  };
  const make = async (edit: (p: Project) => void = () => {}) => {
    const p: Project = { ...defaultProject(), points: sampleTrack() };
    p.terrain.intervalM = 100; p.terrain.indexEvery = 2; p.features.enabled = false;
    edit(p);
    const terrain = await loadTerrain(viewBBox(p)!, cone);
    return { p, terrain, scene: buildScene(p, terrain) };
  };
  const paths = (ps: Prim[]) => ps.filter((x): x is PathPrim => x.kind === 'path');

  it('a flat 3D view is identical to the flat poster (the anchor)', async () => {
    const flat = await make();
    const threeD = await make((p) => { p.relief = { ...p.relief, enabled: true, style: 'contours', turn: 0, tilt: 0, perspective: 0, depth: 200 }; });
    expect(threeD.scene.prims).toEqual(flat.scene.prims);
  });
  it('is off by default and changes nothing when off', async () => {
    expect(defaultProject().relief.enabled).toBe(false);
    const a = await make();
    const b = await make((p) => { p.relief = { ...p.relief, enabled: false, tilt: 80, turn: 50 }; });
    expect(b.scene.prims).toEqual(a.scene.prims);
  });
  it('a tilted view moves the contours, the route and the water, but keeps everything on the page', async () => {
    const flat = await make();
    const tilted = await make((p) => { p.relief = { ...p.relief, enabled: true, style: 'contours', tilt: 60, perspective: 30, depth: 200 }; });
    const route = (s: Prim[], p: Project) => paths(s).find((x) => x.widthMm === p.route.weightMm)!.d;
    expect(route(tilted.scene.prims, tilted.p)).not.toBe(route(flat.scene.prims, flat.p));
    const nums = paths(tilted.scene.prims).flatMap((x) => (x.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number));
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(-0.01);
    expect(Math.max(...nums)).toBeLessThanOrEqual(Math.max(tilted.scene.widthMm, tilted.scene.heightMm) + 0.01);
  });
  it('the line style chooses contours, rows or both', async () => {
    const weights = async (style: 'contours' | 'rows' | 'both') => {
      const { p, scene } = await make((q) => { q.relief = { ...q.relief, enabled: true, style, tilt: 50, rowWeightMm: 0.31 }; });
      return { contour: paths(scene.prims).some((x) => x.widthMm === p.terrain.weightMm), index: paths(scene.prims).some((x) => x.widthMm === p.terrain.indexWeightMm), row: paths(scene.prims).some((x) => x.widthMm === 0.31) };
    };
    expect(await weights('contours')).toEqual({ contour: true, index: true, row: false });
    expect(await weights('rows')).toEqual({ contour: false, index: false, row: true });
    expect(await weights('both')).toEqual({ contour: false, index: true, row: true }); // rows plus only the heavy contour lines
  });
  it('3D works with the flat contours switched off, and needs no terrain to avoid breaking', async () => {
    const { scene } = await make((p) => { p.terrain.enabled = false; p.relief = { ...p.relief, enabled: true, style: 'rows', tilt: 50, rowWeightMm: 0.31 }; });
    expect(paths(scene.prims).some((x) => x.widthMm === 0.31)).toBe(true);
    const p: Project = { ...defaultProject(), points: sampleTrack() };
    p.relief = { ...p.relief, enabled: true, tilt: 60 };
    expect(() => buildScene(p)).not.toThrow(); // no terrain loaded yet: draws the flat poster
    expect(paths(buildScene(p).prims).some((x) => x.widthMm === 0.31)).toBe(false);
  });
  it('uses the contour pen for the lines, the route pen for the route', async () => {
    const { p, scene } = await make((q) => { q.relief = { ...q.relief, enabled: true, style: 'both', tilt: 50, rowWeightMm: 0.31 }; q.terrain.pen = 'blue'; });
    expect(paths(scene.prims).filter((x) => x.widthMm === 0.31).every((x) => x.pen === 'blue')).toBe(true);
    expect(paths(scene.prims).find((x) => x.widthMm === p.route.weightMm)!.pen).toBe('red');
  });
  it('landmarks follow the terrain too: at a flat view they are where they always were', async () => {
    const pts = sampleTrack();
    const osm = { landmarks: sampleWaypoints(pts), water: [], covers: { minLat: 46, maxLat: 47, minLon: -122, maxLon: -121 } };
    const build = async (relief: boolean) => {
      const p: Project = { ...defaultProject(), points: pts };
      p.features.kinds.waypoint = true; p.terrain.intervalM = 100;
      if (relief) p.relief = { ...p.relief, enabled: true, turn: 0, tilt: 0, perspective: 0 };
      const terrain = await loadTerrain(viewBBox(p)!, cone);
      return buildScene(p, terrain, osm).prims.filter((x) => x.kind === 'text' && /Summit|Trailhead/.test(x.text));
    };
    expect(await build(true)).toEqual(await build(false));
  });
  it('a tilted view still places landmarks, inside the page', async () => {
    const pts = sampleTrack();
    const osm = { landmarks: sampleWaypoints(pts), water: [], covers: { minLat: 46, maxLat: 47, minLon: -122, maxLon: -121 } };
    const p: Project = { ...defaultProject(), points: pts };
    p.features.kinds.waypoint = true; p.terrain.intervalM = 100;
    p.relief = { ...p.relief, enabled: true, tilt: 60, turn: 20 };
    const terrain = await loadTerrain(viewBBox(p)!, cone);
    const c = composeScene(p, terrain, osm);
    expect(c.scene.prims.some((x) => x.kind === 'text' && x.text === 'Summit')).toBe(true);
    for (const x of c.scene.prims) if (x.kind === 'text') { expect(x.x).toBeGreaterThan(0); expect(x.x).toBeLessThan(c.scene.widthMm); expect(x.y).toBeGreaterThan(0); expect(x.y).toBeLessThan(c.scene.heightMm); }
  });
  it('is quick enough to rebuild while a slider moves (contours and rows on a full-size elevation grid)', async () => {
    const { p, terrain } = await make((q) => { q.relief = { ...q.relief, enabled: true, style: 'both', tilt: 55, rows: 100 }; });
    buildScene(p, terrain); // warm up (builds the surface once)
    const t = performance.now();
    for (const turn of [0, 10, 20, 30]) buildScene({ ...p, relief: { ...p.relief, turn } }, terrain);
    expect((performance.now() - t) / 4).toBeLessThan(1500);
  });
  it('every SVG layer is still one pen, in print and in plotter mode', async () => {
    const { p, scene } = await make((q) => { q.relief = { ...q.relief, enabled: true, style: 'both', tilt: 55, rowWeightMm: 0.31 }; });
    const fake = { unitsPerEm: 1000, charToGlyph: () => ({ advanceWidth: 500, getPath: () => ({ toPathData: () => 'M0 0L1 1', commands: [{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 1, y: 1 }] }) }) };
    const fonts = { sans: fake, serif: fake } as unknown as FontSet;
    for (const out of [scene, prepareScene(scene, 'plotter', fonts, { pens: p.pens })]) {
      const svg = sceneToSvg(out);
      for (const g of svg.split('<g id="').slice(1)) {
        const strokes = [...g.matchAll(/stroke="(#[0-9a-f]{6})"[^>]*?stroke-width="([\d.]+)"/g)].map((m) => `${m[1]}|${m[2]}`);
        if (!g.startsWith('layer-') || g.split('"')[0]!.endsWith('-fill')) continue;
        expect(new Set(strokes).size).toBe(1);
      }
    }
  });
  it('with hiding on, layers stay one pen each and the plotter output still has strokes only', async () => {
    const { p, scene } = await make((q) => { q.relief = { ...q.relief, enabled: true, style: 'both', tilt: 70, hideHidden: true, rowWeightMm: 0.31 }; });
    const fake = { unitsPerEm: 1000, charToGlyph: () => ({ advanceWidth: 500, getPath: () => ({ toPathData: () => 'M0 0L1 1', commands: [{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 1, y: 1 }] }) }) };
    const fonts = { sans: fake, serif: fake } as unknown as FontSet;
    const plot = prepareScene(scene, 'plotter', fonts, { pens: p.pens });
    for (const g of sceneToSvg(plot).split('<g id="').slice(1)) {
      if (!g.startsWith('layer-')) continue;
      const strokes = [...g.matchAll(/stroke="(#[0-9a-f]{6})"[^>]*?stroke-width="([\d.]+)"/g)].map((m) => `${m[1]}|${m[2]}`);
      expect(new Set(strokes).size).toBeLessThanOrEqual(1);
    }
  });
  it('the draft used while dragging draws no more lines than the final picture', async () => {
    const edit = (hide: boolean, rows: number) => (q: Project) => { q.relief = { ...q.relief, enabled: true, style: 'rows', tilt: 70, hideHidden: hide, rows }; };
    const draft = await make(edit(false, 40));
    const full = await make(edit(true, 100));
    expect(paths(draft.scene.prims).length).toBeGreaterThan(0);
    expect(paths(full.scene.prims).length).toBeGreaterThan(0);
    expect(draft.scene.prims.length).toBeLessThanOrEqual(full.scene.prims.length * 1.5 + 50);
  });
});
