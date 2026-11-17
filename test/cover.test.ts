import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeTile } from '../src/topo/vector';
import { coverMask, markSymbol, patternMarks } from '../src/cover/draw';
import { defaultCover, inkedClasses, type CoverShape } from '../src/cover/types';
import { buildScene, viewBBox } from '../src/scene/buildScene';
import { defaultProject, type Project } from '../src/scene/project';
import { addPen, penSlots, removePen } from '../src/scene/pens';
import { latToPx, loadTerrain, lonToPx, TILE } from '../src/topo/terrain';
import { fromFile, toFile } from '../src/projectFile';
import { sampleTrack } from '../src/sample';
import type { OsmData } from '../src/features/types';
import type { PathPrim } from '../src/scene/types';

const tile = (z: number, x: number, y: number) => decodeTile(new Uint8Array(readFileSync(`test/fixtures/tiles/${z}-${x}-${y}.pbf`)), z, x, y);
const frame = { x: 0, y: 0, w: 100, h: 100 };
/** lat/lon used directly as mm, so shapes can be written in page units */
const ident = (lat: number, lon: number): [number, number] => [lon, lat];
const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[y0, x0], [y0, x1], [y1, x1], [y1, x0]];

describe('land cover from the tiles', () => {
  it('the summit tile has glaciers and scree; a forest tile has woods, meadow and wetland', () => {
    const summit = new Set(tile(14, 2650, 5772).cover.map((s) => s.cls));
    expect(summit).toEqual(new Set(['ice', 'rock']));
    const low = new Set(tile(14, 2651, 5776).cover.map((s) => s.cls));
    for (const c of ['wood', 'grass', 'rock', 'wetland']) expect(low.has(c as never)).toBe(true);
  });
  it('areas come as closed lat/lon rings', () => {
    for (const s of tile(14, 2650, 5772).cover) {
      for (const r of s.rings) {
        expect(r.length).toBeGreaterThanOrEqual(3);
        for (const [la, lo] of r) { expect(la).toBeGreaterThan(46); expect(la).toBeLessThan(47.5); expect(lo).toBeGreaterThan(-122.5); expect(lo).toBeLessThan(-121); }
      }
    }
  });
});

describe('cover mask', () => {
  const ring: CoverShape = { cls: 'wood', rings: [square(10, 10, 60, 60), square(30, 30, 40, 40)] };
  it('fills the area and leaves its hole open', () => {
    const m = coverMask([ring], ident, frame);
    expect(m.empty).toBe(false);
    expect(m.has(20, 20)).toBe(true);
    expect(m.has(35, 35)).toBe(false);
    expect(m.has(80, 80)).toBe(false);
  });
  it('the same area twice (from two tiles) is still filled, not cancelled', () => {
    const m = coverMask([ring, ring], ident, frame);
    expect(m.has(20, 20)).toBe(true);
    expect(m.has(35, 35)).toBe(false);
  });
  it('an area outside the frame leaves the mask empty', () => {
    expect(coverMask([{ cls: 'ice', rings: [square(200, 200, 300, 300)] }], ident, frame).empty).toBe(true);
  });
});

describe('patterns', () => {
  const m = coverMask([{ cls: 'wood', rings: [square(10, 10, 60, 60)] }], ident, frame);
  it('trees and dots are marks inside the area only, about one per spacing squared', () => {
    const { marks, lines } = patternMarks(m, 'trees', 3, frame);
    expect(lines).toHaveLength(0);
    expect(marks.every(([x, y]) => x >= 10 && x <= 60 && y >= 10 && y <= 60)).toBe(true);
    const expected = (50 * 50) / (3 * 3 * 0.866);
    expect(marks.length).toBeGreaterThan(expected * 0.8);
    expect(marks.length).toBeLessThan(expected * 1.2);
  });
  it('the pattern is the same every time (no jumping between redraws)', () => {
    expect(patternMarks(m, 'dots', 3, frame)).toEqual(patternMarks(m, 'dots', 3, frame));
  });
  it('hatching is lines inside the area; cross-hatching has twice as many', () => {
    const h = patternMarks(m, 'hatch', 3, frame).lines;
    const x = patternMarks(m, 'crosshatch', 3, frame).lines;
    expect(h.length).toBeGreaterThan(10);
    expect(x.length).toBeGreaterThan(h.length * 1.7);
    for (const l of h) for (const [px, py] of l) { expect(px).toBeGreaterThanOrEqual(9.5); expect(px).toBeLessThanOrEqual(60.5); expect(py).toBeGreaterThanOrEqual(9.5); }
  });
  it('scree dashes are short ground lines', () => {
    const { lines } = patternMarks(m, 'dashes', 2, frame);
    expect(lines.length).toBeGreaterThan(100);
    for (const l of lines) expect(Math.hypot(l[1]![0] - l[0]![0], l[1]![1] - l[0]![1])).toBeLessThanOrEqual(2 * 0.55 + 1e-9);
  });
  it('clear paper draws nothing', () => {
    expect(patternMarks(m, 'clear', 3, frame)).toEqual({ lines: [], marks: [] });
  });
  it('a tree stands up from its spot', () => {
    expect(markSymbol('trees', 10, 10, 2)).toMatch(/^M10 10V9\.4/);
  });
});

// a cone of terrain around Mount Rainier, with a forest ring around its foot and a glacier on top
const cone = async (z: number, tx: number, ty: number) => {
  const cx = lonToPx(-121.7, z);
  const cy = latToPx(46.82, z);
  const out = new Float32Array(TILE * TILE);
  const slope = 2000 / (2 ** z * TILE * 0.0008);
  for (let r = 0; r < TILE; r++) for (let c = 0; c < TILE; c++) out[r * TILE + c] = Math.max(0, 2000 - slope * Math.hypot(tx * TILE + c - cx, ty * TILE + r - cy));
  return out;
};
const box = (lat0: number, lon0: number, lat1: number, lon1: number): [number, number][] => [[lat0, lon0], [lat0, lon1], [lat1, lon1], [lat1, lon0]];
const project = (fn?: (p: Project) => void) => {
  const p = { ...defaultProject(), points: sampleTrack() };
  p.terrain.intervalM = 50; p.features.enabled = false; p.cover.enabled = true;
  fn?.(p);
  return p;
};
const osmFor = (p: Project): OsmData => {
  const b = viewBBox(p)!;
  const mid = (b.minLat + b.maxLat) / 2;
  const midLon = (b.minLon + b.maxLon) / 2;
  const dLat = (b.maxLat - b.minLat) / 6;
  const dLon = (b.maxLon - b.minLon) / 6;
  return {
    landmarks: [], water: [], covers: b,
    cover: [
      { cls: 'wood', rings: [box(b.minLat, b.minLon, b.minLat + 2 * dLat, b.maxLon)] },
      { cls: 'ice', rings: [box(mid - dLat, midLon - dLon, mid + dLat, midLon + dLon)] },
    ],
  };
};
const parts = (s: ReturnType<typeof buildScene>, part: string) => s.prims.filter((x): x is PathPrim => x.kind === 'path' && x.part === part);
const contourPoints = (s: ReturnType<typeof buildScene>) => parts(s, 'contours').reduce((n, pr) => n + (pr.d.match(/[ML]/g)?.length ?? 0), 0);

describe('land cover on the poster', () => {
  it('off by default, and old projects open with it off', () => {
    expect(defaultProject().cover.enabled).toBe(false);
    const file = JSON.parse(JSON.stringify(toFile(defaultProject())));
    delete file.project.cover;
    expect(fromFile(file).cover).toEqual(defaultCover());
  });
  it('forest draws trees in its pen; the glacier cuts the contours away (clear paper)', async () => {
    const p = project();
    const terrain = await loadTerrain(viewBBox(p)!, cone);
    const osm = osmFor(p);
    const on = buildScene(p, terrain, osm);
    const off = buildScene(project((q) => { q.cover.enabled = false; }), terrain, osm);
    const trees = parts(on, 'cover');
    expect(trees).toHaveLength(1);
    expect(trees[0]!.pen).toBe(p.cover.classes.wood.pen);
    expect(trees[0]!.d.match(/Z/g)!.length).toBeGreaterThan(50);
    expect(parts(off, 'cover')).toHaveLength(0);
    // the glacier takes contour points away
    const all = contourPoints(off);
    const kept = contourPoints(on);
    expect(kept).toBeLessThan(all);
  });
  it('in 3D the trees are drawn too, and the glacier still clears the relief lines', async () => {
    const p = project((q) => { q.relief.enabled = true; q.relief.tilt = 50; });
    const terrain = await loadTerrain(viewBBox(p)!, cone);
    const osm = osmFor(p);
    const on = buildScene(p, terrain, osm);
    const off = buildScene(project((q) => { q.relief.enabled = true; q.relief.tilt = 50; q.cover.enabled = false; }), terrain, osm);
    expect(parts(on, 'cover').length).toBe(1);
    const len = (s: ReturnType<typeof buildScene>) => parts(s, 'relief').reduce((a, x) => a + x.d.length, 0);
    expect(len(on)).toBeLessThan(len(off));
  });
  it('each inked kind is in the pens table, and removing its pen moves it to the first pen', () => {
    const p = project();
    const pen = addPen(p)!;
    p.cover.classes.wood.pen = pen.id;
    expect(inkedClasses(p.cover)).toEqual(['wood', 'rock']);
    const slot = penSlots(p).find((s) => s.key === 'cover-wood')!;
    expect(slot.section).toBe('Forest');
    expect(slot.get(p)).toBe(pen.id);
    removePen(p, pen.id);
    expect(p.cover.classes.wood.pen).toBe(p.pens[0]!.id);
  });
});
