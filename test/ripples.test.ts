import { describe, expect, it } from 'vitest';
import { lakeRipples, inside } from '../src/features/ripples';
import { distToPolyline } from '../src/features/select';
import type { XY } from '../src/geo/clip';

const circle = (cx: number, cy: number, r: number, n = 60): XY[] => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);
const frame = { x: 0, y: 0, w: 200, h: 200 };

describe('lake ripples', () => {
  it('draws rings inside the shore at the gap, one per ring', () => {
    const lake = circle(100, 100, 30);
    const lines = lakeRipples([lake], frame, { rings: 3, gapMm: 2, waves: false });
    expect(lines).toHaveLength(3);
    for (const l of lines) for (const p of l) { expect(inside(p, lake)).toBe(true); expect(distToPolyline(p, lake)).toBeGreaterThan(1.5); }
    const radii = lines.map((l) => Math.hypot(l[0]![0] - 100, l[0]![1] - 100)).sort((a, b) => b - a);
    expect(radii[0]).toBeCloseTo(28, 0);
    expect(radii[2]).toBeCloseTo(24, 0);
  });
  it('draws nothing when asked for nothing, and skips tiny lakes', () => {
    expect(lakeRipples([circle(100, 100, 30)], frame, { rings: 0, gapMm: 2, waves: false })).toEqual([]);
    expect(lakeRipples([circle(100, 100, 1)], frame, { rings: 2, gapMm: 1, waves: true })).toEqual([]);
  });
  it('a lake narrower than the rings gets only the rings that fit', () => {
    const thin: XY[] = [[50, 100], [150, 100], [150, 104], [50, 104], [50, 100]];
    const lines = lakeRipples([thin], frame, { rings: 4, gapMm: 1, waves: false });
    for (const l of lines) for (const p of l) expect(inside(p, thin)).toBe(true);
  });
  it('wave marks stay in the open water, the same every time', () => {
    const lake = circle(100, 100, 40);
    const o = { rings: 2, gapMm: 1.5, waves: true };
    const a = lakeRipples([lake], frame, o);
    expect(a.length).toBeGreaterThan(2 + 3);
    for (const l of a.slice(2)) for (const p of l) expect(inside(p, lake)).toBe(true);
    expect(lakeRipples([lake], frame, o)).toEqual(a);
  });
  it('clips to the page', () => {
    const lines = lakeRipples([circle(5, 100, 30)], frame, { rings: 2, gapMm: 2, waves: true });
    for (const l of lines) for (const p of l) expect(p[0]).toBeGreaterThanOrEqual(0);
  });
});

import { buildScene } from '../src/scene/buildScene';
import { defaultProject } from '../src/scene/project';
import { sampleTrack } from '../src/sample';
import type { PathPrim } from '../src/scene/types';

describe('ripples on the poster', () => {
  const lake = (cx: number, cy: number, r: number) => ({ id: 'w9', kind: 'lake' as const, coords: circle(cx, cy, r, 40) as [number, number][] });
  const strokes = (rings: number, waves: boolean) => {
    const p = { ...defaultProject(), points: sampleTrack() };
    p.features = { ...p.features, rippleRings: rings, waves };
    const osm = { landmarks: [], water: [lake(46.81, -121.7, 0.012)], covers: { minLat: 46, maxLat: 47, minLon: -122, maxLon: -121 } };
    const d = buildScene(p, undefined, osm).prims.filter((x) => x.part === 'water' && x.kind === 'path').map((x) => (x as PathPrim).d).join('');
    return (d.match(/M/g) ?? []).length;
  };
  it('adds ring and wave strokes to the water only when asked, and off keeps the poster as it was', () => {
    const base = strokes(0, false);
    expect(strokes(2, false)).toBeGreaterThan(base);
    expect(strokes(2, true)).toBeGreaterThan(strokes(2, false));
    expect(strokes(0, false)).toBe(base);
  });
});
