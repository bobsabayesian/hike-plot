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
