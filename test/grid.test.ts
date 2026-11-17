import { describe, expect, it } from 'vitest';
import { fitBBox } from '../src/geo/project';
import { toUtm } from '../src/geo/utm';
import { gridLayout, principalDigits, scaleLength } from '../src/scene/grid';
import { buildScene, composeScene } from '../src/scene/buildScene';
import { defaultProject, type Project } from '../src/scene/project';
import { sampleTrack, sampleWaypoints } from '../src/sample';
import type { PathPrim, Prim, TextPrim } from '../src/scene/types';

const frame = { x: 30, y: 40, w: 300, h: 400 };
const rainier = { minLat: 46.76, maxLat: 46.84, minLon: -121.80, maxLon: -121.66 };

const sample = (edit: (p: Project) => void = () => {}): Project => {
  const t = sampleTrack();
  const p: Project = { ...defaultProject(), points: t, waypoints: sampleWaypoints(t) };
  p.grid = { ...p.grid, enabled: true };
  edit(p);
  return p;
};
const gridPaths = (ps: Prim[]) => ps.filter((x): x is PathPrim => x.kind === 'path' && x.part === 'grid');
const gridTexts = (ps: Prim[]) => ps.filter((x): x is TextPrim => x.kind === 'text' && x.part === 'grid').map((x) => x.text);

describe('grid layout', () => {
  it('every line lies on its UTM value, within a meter', () => {
    const fit = fitBBox(rainier, frame);
    const g = gridLayout(fit, frame, 0);
    expect(g.zone).toBe(10);
    expect(g.spacingM).toBe(1000);
    expect(g.lines.length).toBeGreaterThan(8);
    for (const line of g.lines) for (const piece of line.pieces) for (const [x, y] of piece) {
      const [lat, lon] = fit.fromMm(x, y);
      const u = toUtm(lat, lon, g.zone);
      expect(Math.abs((line.axis === 'e' ? u.easting : u.northing) - line.value)).toBeLessThan(1);
    }
  });
  it('lines stay inside the map frame', () => {
    const g = gridLayout(fitBBox(rainier, frame), frame, 0);
    for (const line of g.lines) for (const piece of line.pieces) for (const [x, y] of piece) {
      expect(x).toBeGreaterThanOrEqual(frame.x - 1e-6); expect(x).toBeLessThanOrEqual(frame.x + frame.w + 1e-6);
      expect(y).toBeGreaterThanOrEqual(frame.y - 1e-6); expect(y).toBeLessThanOrEqual(frame.y + frame.h + 1e-6);
    }
  });
  it('the grid leans off true north away from the zone\'s central meridian (grid convergence)', () => {
    // Rainier is about 1.24° east of zone 10's central meridian (123° W): the lines lean by about 1.24 × sin(46.8°) ≈ 0.9°
    const fit = fitBBox(rainier, frame);
    const g = gridLayout(fit, frame, 0);
    const line = g.lines.find((l) => l.axis === 'e' && l.pieces.length)!;
    const piece = line.pieces[0]!;
    const [x0, y0] = piece[0]!, [x1, y1] = piece[piece.length - 1]!;
    const lean = (Math.atan(Math.abs(x1 - x0) / Math.abs(y1 - y0)) * 180) / Math.PI;
    expect(lean).toBeGreaterThan(0.8);
    expect(lean).toBeLessThan(1);
  });
  it('picks 10 km or 100 km lines for larger maps, and keeps a spacing that is asked for', () => {
    const wide = { minLat: 46, maxLat: 47.5, minLon: -122.5, maxLon: -120.5 };
    expect(gridLayout(fitBBox(wide, frame), frame, 0).spacingM).toBe(10000);
    const huge = { minLat: 40, maxLat: 50, minLon: -126, maxLon: -114 };
    expect(gridLayout(fitBBox(huge, frame), frame, 0).spacingM).toBe(100000);
    expect(gridLayout(fitBBox(rainier, frame), frame, 10000).spacingM).toBe(10000);
  });
  it('lists the 100 km squares the map covers', () => {
    const west = { minLat: 46.78, maxLat: 46.82, minLon: -121.82, maxLon: -121.78 };
    expect(gridLayout(fitBBox(west, frame), frame, 0).squares).toEqual(['ES']);
    const across = { minLat: 46.76, maxLat: 46.84, minLon: -121.75, maxLon: -121.62 };
    expect(gridLayout(fitBBox(across, frame), frame, 0).squares).toEqual(['ES', 'FS']);
  });
  it('finds where each line meets the edges, in order', () => {
    const g = gridLayout(fitBBox(rainier, frame), frame, 0);
    expect(g.edges.top.length).toBeGreaterThan(5);
    expect(g.edges.left.length).toBeGreaterThan(5);
    const xs = g.edges.top.map(([, x]) => x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });
});

describe('grid numbers', () => {
  it('prints the two kilometer digits that change', () => {
    expect(principalDigits(594000, 1000)).toBe('94');
    expect(principalDigits(5180000, 1000)).toBe('80');
    expect(principalDigits(5203000, 1000)).toBe('03');
    expect(principalDigits(600000, 100000)).toBe('6');
  });
  it('scale bars use round lengths that fit', () => {
    expect(scaleLength(1000, 20, 120)).toBe(2);
    expect(scaleLength(1000, 20, 99)).toBe(1);
    expect(scaleLength(1609.344, 20, 120)).toBe(1);
  });
});

describe('grid in the poster', () => {
  it('is off by default and changes nothing then', () => {
    expect(defaultProject().grid.enabled).toBe(false);
    const off = sample((p) => { p.grid.enabled = false; });
    const plain: Project = { ...defaultProject(), points: off.points, waypoints: off.waypoints };
    expect(buildScene(off).prims).toEqual(buildScene(plain).prims);
  });
  it('draws lines, a neat line, the grid numbers and the legend for the sample route (10T ES)', () => {
    const s = buildScene(sample()).prims;
    expect(gridPaths(s).length).toBeGreaterThanOrEqual(2);
    const texts = gridTexts(s);
    expect(texts).toContain('GRID ZONE DESIGNATION  10T');
    // the sample's view crosses the 600 km easting, from square ES into FS
    expect(texts).toContain('100,000 M SQUARE IDENTIFICATION  ES  FS');
    expect(texts.some((t) => t.startsWith('SCALE 1:'))).toBe(true);
    expect(texts).toContain('KILOMETERS');
    expect(texts).toContain('MILES');
    expect(texts).toContain('000m.E.');
    expect(texts).toContain('000m.N.');
    expect(texts.filter((t) => /^\d\d$/.test(t)).length).toBeGreaterThan(8);
  });
  it('keeps room around the map for the numbers, so the map gets a little smaller', () => {
    const on = composeScene(sample()).view!.frame;
    const off = composeScene(sample((p) => { p.grid.enabled = false; })).view!.frame;
    expect(on.y).toBeGreaterThan(off.y);
    expect(on.h).toBeLessThan(off.h);
  });
  it('labels, neat line and legend can each be turned off', () => {
    const s = buildScene(sample((p) => { p.grid = { ...p.grid, labels: false, legend: false, neatline: false }; })).prims;
    expect(gridTexts(s)).toEqual([]);
    expect(gridPaths(s).length).toBe(1);
  });
  it('is left out of the 3D view', () => {
    const s = buildScene(sample((p) => { p.relief = { ...p.relief, enabled: true }; })).prims;
    expect(s.filter((x) => x.part === 'grid')).toEqual([]);
  });
});

describe('map scale', () => {
  it('a fixed-scale map has that true scale at its middle, at any latitude', async () => {
    const { fitScale, groundMetersPerMm, haversine } = await import('../src/geo/project');
    for (const lat of [0, 30, 46.8, 64]) {
      const f = fitScale(lat, 10, frame, 50000);
      expect(groundMetersPerMm(f, frame)).toBeCloseTo(50, 1);
      // 1 km north of the center is 20 mm up the page
      const [, y0] = f.toMm(lat, 10);
      const dLat = (1000 / haversine(lat, 10, lat + 1, 10));
      const [, y1] = f.toMm(lat + dLat, 10);
      expect(y0 - y1).toBeCloseTo(20, 1);
    }
  });
  it('the poster is drawn at 1:50,000 and says so, with a kilometer that is 20 mm on the scale bar', () => {
    const c = composeScene(sample((p) => { p.mapScale = 50000; }));
    expect(c.view!.scale).toBe(50000);
    const texts = gridTexts(c.scene.prims);
    expect(texts).toContain('SCALE 1:50,000');
    const fills = gridPaths(c.scene.prims).find((x) => x.mode === 'fill')!;
    const first = fills.d.match(/^M[-\d.]+ [-\d.]+h([-\d.]+)/)!;
    // 5 km in 1 km segments, each 20 mm
    expect(texts).toEqual(expect.arrayContaining(['0', '1', '2', '3', '4', '5', 'KILOMETERS']));
    expect(+first[1]!).toBeCloseTo(20, 1);
  });
  it('a fitted map prints its true scale, not the Web Mercator one (regression)', async () => {
    const { groundMetersPerMm } = await import('../src/geo/project');
    const c = composeScene(sample());
    const ground = groundMetersPerMm(c.view!.fit, c.view!.frame) * 1000;
    const line = gridTexts(c.scene.prims).find((t) => t.startsWith('SCALE 1:'))!;
    const printed = +line.slice('SCALE 1:'.length).replace(/,/g, '');
    expect(Math.abs(printed - ground) / ground).toBeLessThan(0.01);
    // and well away from the Mercator figure, which at 46.8°N is about 1.46 times larger
    expect(Math.abs(printed - c.view!.fit.metersPerMm * 1000) / printed).toBeGreaterThan(0.3);
  });
  it('steps to the next standard scale when the whole route does not fit', () => {
    const c = composeScene(sample((p) => { p.sizeId = '8x10'; p.mapScale = 25000; }));
    // the route is about 7 km across and the 8x10 map is small: 1:50,000 is too big, 1:100,000 holds it
    expect(c.view!.scale).toBe(100000);
    const { fit, frame } = c.view!;
    for (const q of sampleTrack()) {
      const [x, y] = fit.toMm(q.lat, q.lon);
      expect(x).toBeGreaterThanOrEqual(frame.x - 1e-6); expect(x).toBeLessThanOrEqual(frame.x + frame.w + 1e-6);
      expect(y).toBeGreaterThanOrEqual(frame.y - 1e-6); expect(y).toBeLessThanOrEqual(frame.y + frame.h + 1e-6);
    }
  });
  it('0 keeps fitting the view as before', () => {
    expect(composeScene(sample()).view!.scale).toBeUndefined();
  });
});

describe('MGRS references', () => {
  it('the coordinates under the title can be an MGRS grid reference to 10 m', () => {
    const p = sample((q) => { q.grid.enabled = false; q.text.location.coordFormat = 'mgrs'; });
    const texts = buildScene(p).prims.filter((x): x is TextPrim => x.kind === 'text' && x.part === 'location').map((x) => x.text);
    expect(texts.some((t) => /^10T [A-Z]{2} \d{4} \d{4}$/.test(t))).toBe(true);
  });
  it('the legend gives the grid reference of the high point', () => {
    const texts = gridTexts(buildScene(sample()).prims);
    expect(texts.some((t) => /^GRID REFERENCE OF HIGH POINT {2}10T FS \d{4} \d{4}$/.test(t))).toBe(true);
  });
});
