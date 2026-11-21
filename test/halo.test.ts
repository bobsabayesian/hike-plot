import { describe, expect, it } from 'vitest';
import { cutOutHalos } from '../src/features/halo';
import { placeLandmarks } from '../src/features/select';
import { defaultFeatures, type Landmark } from '../src/features/types';
import { fitBBox } from '../src/geo/project';
import type { XY } from '../src/geo/clip';

const box = { cx: 50, cy: 50, w: 20, h: 4, ang: 0 };
const len = (ls: XY[][]) => ls.reduce((n, l) => n + l.reduce((m, q, i) => m + (i ? Math.hypot(q[0] - l[i - 1]![0], q[1] - l[i - 1]![1]) : 0), 0), 0);

describe('clearing terrain lines around a label', () => {
  it('does nothing without halos', () => {
    const lines: XY[][] = [[[0, 0], [100, 100]]];
    expect(cutOutHalos(lines, [])).toBe(lines);
  });
  it('cuts the part of a line inside the box plus the margin, and keeps the rest', () => {
    const line: XY[][] = [[[0, 50], [100, 50]]];
    const out = cutOutHalos(line, [{ box, r: 5 }]);
    expect(out).toHaveLength(2);
    // box is 20 wide (+5 each side) so 30 mm are removed from 100
    expect(len(out)).toBeGreaterThan(69);
    expect(len(out)).toBeLessThan(71);
    expect(out[0]![out[0]!.length - 1]![0]).toBeLessThanOrEqual(35.3);
    expect(out[1]![0]![0]).toBeGreaterThanOrEqual(64.7);
  });
  it('a bigger radius clears more', () => {
    const line: XY[][] = [[[0, 50], [100, 50]]];
    expect(len(cutOutHalos(line, [{ box, r: 12 }]))).toBeLessThan(len(cutOutHalos(line, [{ box, r: 3 }])));
  });
  it('leaves lines that are far away exactly as they were', () => {
    const line: XY[][] = [[[0, 10], [100, 12], [100, 90]]];
    expect(cutOutHalos(line, [{ box, r: 5 }])).toEqual(line);
  });
  it('drops a line completely inside the zone', () => {
    expect(cutOutHalos([[[45, 49], [55, 51]]], [{ box, r: 1 }])).toEqual([]);
  });
});

describe('halos from placed labels', () => {
  const frame = { x: 20, y: 20, w: 300, h: 400 };
  const fit = fitBBox({ minLat: 46, maxLat: 46.2, minLon: -121.4, maxLon: -121 }, frame);
  const th: Landmark = { id: 'th', name: 'Bright Angel Trailhead', kind: 'trailhead', lat: 46.1, lon: -121.2 };
  const run = (over = {}, clearMm = 0) => placeLandmarks({
    landmarks: [th], water: [], fit, frame, route: [], settings: { ...defaultFeatures(), clearMm, ...over }, sizeMm: 4, markerR: 2,
  });
  it('none by default', () => { expect(run().halos).toEqual([]); });
  it('the general radius gives the label and its marker a zone', () => {
    const h = run({}, 6).halos;
    expect(h).toHaveLength(2);
    expect(h.every((z) => z.r === 6)).toBe(true);
  });
  it('a landmark\'s own radius wins, and 0 switches it off for that one', () => {
    expect(run({ overrides: { th: { clearMm: 10 } } }, 6).halos.every((z) => z.r === 10)).toBe(true);
    expect(run({ overrides: { th: { clearMm: 0 } } }, 6).halos).toEqual([]);
  });
});

import { cutNearRoute } from '../src/features/halo';

describe('clear paper beside the route', () => {
  const route: [number, number][] = [[0, 0], [100, 0]];
  const across: [number, number][] = [[50, -10], [50, 10]];
  const len = (ls: [number, number][][]) => ls.reduce((a, l) => a + l.slice(1).reduce((b, q, i) => b + Math.hypot(q[0] - l[i]![0], q[1] - l[i]![1]), 0), 0);
  it('does nothing when off or without a route', () => {
    expect(cutNearRoute([across], route, 0)).toEqual([across]);
    expect(cutNearRoute([across], [[0, 0]], 2)).toEqual([across]);
  });
  it('cuts a line crossing the route into two pieces with a gap of twice the radius', () => {
    const out = cutNearRoute([across], route, 2);
    expect(out).toHaveLength(2);
    expect(len(out)).toBeGreaterThan(15);
    expect(len(out)).toBeLessThan(16.5); // 20 long, 4 cut out
  });
  it('leaves a line that stays beyond the radius alone, and drops one that runs along the route inside it', () => {
    const far: [number, number][] = [[0, 5], [100, 5]];
    const kept = cutNearRoute([far], route, 2);
    expect(kept).toHaveLength(1);
    expect(len(kept)).toBeCloseTo(100, 6); // nothing removed (a long segment near the route is only re-sampled)
    expect(cutNearRoute([[[0, 1], [100, 1]]], route, 2)).toEqual([]);
  });
  it('a line starting inside the cleared strip begins where it leaves it', () => {
    const out = cutNearRoute([[[50, 0], [50, 10]]], route, 2);
    expect(out).toHaveLength(1);
    expect(out[0]![0]![1]).toBeGreaterThan(1.5);
  });
  it('is fast on a long, winding route and many lines', () => {
    const wind: [number, number][] = Array.from({ length: 5000 }, (_, i) => [i * 0.1, 30 + Math.sin(i / 50) * 20]);
    const lines: [number, number][][] = Array.from({ length: 300 }, (_, k) => Array.from({ length: 400 }, (_, i) => [i * 1.25, k * 0.5 + Math.cos(i / 30) * 5] as [number, number]));
    const t = performance.now();
    cutNearRoute(lines, wind, 1.5);
    expect(performance.now() - t).toBeLessThan(3000);
  });
});

describe('clean cuts around a label', () => {
  it('cut ends lie exactly on the zone\'s outline, not up to a sample short of it', () => {
    const out = cutOutHalos([[[0, 50.3], [100, 50.3]]], [{ box, r: 5 }]);
    expect(out[0]!.at(-1)![0]).toBeCloseTo(35, 2);
    expect(out[1]![0]![0]).toBeCloseTo(65, 2);
  });
  it('the corners are rounded: the same gap from the box all the way round', () => {
    // a diagonal line passing 2 mm from the box's corner (60, 52), inside the 3 mm margin there
    const c = 112 + 2 * Math.SQRT2;
    const out = cutOutHalos([[[50, c - 50], [70, c - 70]]], [{ box, r: 3 }]);
    expect(out).toHaveLength(2);
    const fromBox = ([x, y]: XY) => Math.hypot(Math.max(0, Math.abs(x - 50) - 10), Math.max(0, Math.abs(y - 50) - 2));
    for (const l of out) for (const p of l) expect(fromBox(p)).toBeGreaterThanOrEqual(3 - 1e-3);
    // and the line is kept right up to the rounded corner, not cut back to a square one
    const kept = out.flatMap((l) => l).map(fromBox);
    expect(Math.min(...kept)).toBeCloseTo(3, 2);
  });
  it('drops the stubs a cut leaves between two zones, but keeps short marks that were never cut', () => {
    const a = { cx: 40, cy: 50, w: 10, h: 4, ang: 0 };
    const b = { cx: 50.6, cy: 50, w: 10, h: 4, ang: 0 }; // 0.6 mm apart edge to edge, minus 2 × 0 margin
    const out = cutOutHalos([[[0, 50], [100, 50]], [[80, 80], [80.3, 80]]], [{ box: a, r: 0 }, { box: b, r: 0 }]);
    expect(out.some((l) => l[0]![0] > 45 && l.at(-1)![0] < 46)).toBe(false); // no stub between the two
    expect(out).toContainEqual([[80, 80], [80.3, 80]]); // a 0.3 mm mark far away stays
  });
  it('a line that only grazes a zone loses just that part', () => {
    const out = cutOutHalos([[[0, 54.5], [100, 54.5]]], [{ box, r: 3 }]); // 2.5 mm below the box, inside the 3 mm margin
    expect(out).toHaveLength(2);
    expect(len(out)).toBeGreaterThan(100 - 20 - 2 * Math.sqrt(9 - 6.25) - 0.01);
  });
});

describe('measured labels', () => {
  it('label boxes use the font\'s own widths: a wide name gets a wider box than a narrow one of the same length', async () => {
    const { textWidthMm } = await import('../src/features/measure');
    expect(textWidthMm('MWMW', 4)).toBeGreaterThan(textWidthMm('ilil', 4) * 2);
    expect(textWidthMm('Summit', 4, 'sans')).toBeCloseTo(4 * (0.632 + 0.583 + 0.884 + 0.884 + 0.241 + 0.351), 0);
  });
  it('river and lake names get a clear zone too', () => {
    const frame = { x: 20, y: 20, w: 300, h: 400 };
    const fit = fitBBox({ minLat: 46, maxLat: 46.2, minLon: -121.4, maxLon: -121 }, frame);
    const river = { id: 'r1', name: 'Long River', kind: 'river' as const, coords: Array.from({ length: 40 }, (_, i): [number, number] => [46.1, -121.38 + i * 0.009]) };
    const r = placeLandmarks({
      landmarks: [], water: [river], fit, frame, route: [], settings: { ...defaultFeatures(), waterLabels: true, clearMm: 1 }, sizeMm: 4, markerR: 2,
    });
    expect(r.labels.some((l) => l.kind === 'river')).toBe(true);
    expect(r.halos.length).toBeGreaterThanOrEqual(1);
  });
});

describe('labels moved by hand', () => {
  const frame = { x: 20, y: 20, w: 300, h: 400 };
  const fit = fitBBox({ minLat: 46, maxLat: 46.2, minLon: -121.4, maxLon: -121 }, frame);
  const peak: Landmark = { id: 'pk', name: 'Sunrise Cuddles', kind: 'peak', lat: 46.1, lon: -121.2 };
  const run = (ov = {}) => placeLandmarks({
    landmarks: [peak], water: [], fit, frame, route: [], settings: { ...defaultFeatures(), clearMm: 1.5, overrides: { pk: ov } }, sizeMm: 4, markerR: 2,
  });
  it('a label reports the side it went to', () => {
    const r = run();
    expect(r.entries[0]).toMatchObject({ id: 'pk', placed: true, side: 'right' });
    expect(r.entries[0]!.moved).toBeUndefined();
  });
  it('a moved label goes exactly where it was put, and its clear zone moves with it (the marker stays)', () => {
    const a = run();
    const b = run({ side: 'right', dx: 3, dy: -7.5 });
    expect(b.labels[0]!.x).toBeCloseTo(a.labels[0]!.x + 3, 6);
    expect(b.labels[0]!.y).toBeCloseTo(a.labels[0]!.y - 7.5, 6);
    expect(b.halos[0]!.box.cx).toBeCloseTo(a.halos[0]!.box.cx + 3, 6);
    expect(b.halos[0]!.box.cy).toBeCloseTo(a.halos[0]!.box.cy - 7.5, 6);
    expect(b.halos[1]).toEqual(a.halos[1]); // the marker's zone
    expect(b.entries[0]).toMatchObject({ moved: true, side: 'right' });
  });
  it('a moved label is drawn even where the automatic placement would not put it', () => {
    // dragged onto the frame's edge, past where labels may go
    const r = run({ side: 'right', dx: 200 });
    expect(r.labels).toHaveLength(1);
  });
});
