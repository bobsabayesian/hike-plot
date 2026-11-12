import { describe, expect, it } from 'vitest';
import { buildRelief, defaultRelief, liftContours, needsHiding, ridgeRowLines, ridgeRows } from '../src/relief/relief';
import { buildVisibility, visibleRuns, type P3 } from '../src/relief/visibility';
import { fitBBox, type BBox } from '../src/geo/project';
import { latToPx, lonToPx, type TerrainField } from '../src/topo/terrain';

const frame = { x: 20, y: 30, w: 300, h: 400 };
const box: BBox = { minLat: 46.835, maxLat: 46.865, minLon: -121.78, maxLon: -121.74 };

/** A flat plain with one tall east-west wall across the middle of the map. */
const wallField = (height = 1500): TerrainField => {
  const z = 12, w = 600, h = 600;
  const px0 = Math.floor(lonToPx(-121.8, z)) - 100;
  const py0 = Math.floor(latToPx(46.9, z)) - 100;
  const fit = fitBBox(box, frame);
  const [lat] = fit.fromMm(frame.x, frame.y + frame.h / 2);
  const wallRow = latToPx(lat, z) - py0;
  const data = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) data[r * w + q] = 1000 + height * Math.exp(-(((r - wallRow) / 6) ** 2));
  return { z, px0, py0, w, h, data, covers: { minLat: 46.7, maxLat: 47, minLon: -122, maxLon: -121.5 } };
};
const make = (over: Partial<ReturnType<typeof defaultRelief>> = {}) => {
  const fit = fitBBox(box, frame);
  return buildRelief(wallField(), fit, frame, { ...defaultRelief(), enabled: true, tilt: 65, perspective: 0, depth: 150, ...over });
};
const at = (r: ReturnType<typeof make>, x: number, y: number): P3 => [x, y, r.heightMm(r.surface.sample(x, y))];
const midX = frame.x + frame.w / 2;
const midY = frame.y + frame.h / 2;

describe('hidden-line removal', () => {
  it('sees every point of a flat, untilted map', () => {
    const r = make({ tilt: 0, perspective: 0 });
    const vis = buildVisibility(r);
    for (const [x, y] of [[40, 50], [midX, midY], [300, 410]] as const) expect(vis.isVisible(...at(r, x, y))).toBe(true);
  });
  it('hides ground behind a wall and shows ground in front of it and the crest itself', () => {
    const r = make();
    const vis = buildVisibility(r);
    expect(vis.isVisible(...at(r, midX, midY + 6))).toBe(true); // just over the crest, facing the viewer
    expect(vis.isVisible(...at(r, midX, frame.y + frame.h - 20))).toBe(true); // near side
    expect(vis.isVisible(...at(r, midX, midY - 25))).toBe(false); // just behind the wall
  });
  it('shows the far ground again once it rises above the wall line of sight (low tilt)', () => {
    const r = make({ tilt: 10 });
    const vis = buildVisibility(r);
    expect(vis.isVisible(...at(r, midX, frame.y + 5))).toBe(true);
  });
  it('a line crossing the wall comes out as pieces that avoid the hidden stretch', () => {
    const r = make();
    const vis = buildVisibility(r);
    const line: P3[] = [];
    for (let y = frame.y + 5; y <= frame.y + frame.h - 5; y += 1) line.push(at(r, midX, y));
    const runs = visibleRuns(r, vis, [line]);
    expect(runs.length).toBeGreaterThanOrEqual(1);
    // the stretch north of the wall is hidden, so the drawn part is shorter than the line seen from straight above
    const length = (rs: [number, number][][]) => rs.reduce((n, run) => n + run.reduce((m, q, i) => m + (i ? Math.hypot(q[0] - run[i - 1]![0], q[1] - run[i - 1]![1]) : 0), 0), 0);
    const full = [line.map(([x, y, z]) => r.camera.project(x, y, z))];
    expect(length(runs as never)).toBeGreaterThan(0);
    expect(length(runs as never)).toBeLessThan(length(full as never) * 0.75);
  });
  it('drops specks shorter than the minimum run', () => {
    const r = make();
    const vis = buildVisibility(r);
    const [x, y, z] = at(r, midX, midY - 25);
    expect(visibleRuns(r, vis, [[[x, y, z], [x + 0.1, y, z]]])).toEqual([]);
  });
  it('rows and contours lose lines behind the wall, and keep them all when hiding is off', () => {
    const r = make();
    const vis = buildVisibility(r);
    const count = (ls: { length: number }[][]) => ls.reduce((n, l) => n + l.reduce((m, p) => m + p.length, 0), 0);
    const rowsHidden = ridgeRows(r, 60, vis);
    const rowsAll = ridgeRows(r, 60);
    expect(count(rowsHidden as never)).toBeLessThan(count(rowsAll as never));
    expect(ridgeRowLines(r, 60).length).toBe(60);
    expect(liftContours(r, [], vis)).toEqual({ regular: [], index: [] });
  });
  it('is reused for the same view and rebuilt for another', () => {
    const r = make();
    expect(buildVisibility(r)).toBe(buildVisibility(r));
    const r2 = make({ tilt: 30 });
    expect(buildVisibility(r2)).not.toBe(buildVisibility(r));
  });
  it('needsHiding follows the setting and the angle', () => {
    expect(needsHiding({ tilt: 0, perspective: 0, hideHidden: true })).toBe(false);
    expect(needsHiding({ tilt: 40, perspective: 0, hideHidden: true })).toBe(true);
    expect(needsHiding({ tilt: 40, perspective: 0, hideHidden: false })).toBe(false);
  });
  it('is fast enough for a live preview', () => {
    const r = make();
    const t = performance.now();
    const vis = buildVisibility(r);
    ridgeRows(r, 70, vis);
    expect(performance.now() - t).toBeLessThan(2500);
  });
});
