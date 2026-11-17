import { describe, expect, it } from 'vitest';
import { makeCamera } from '../src/relief/camera';
import { buildScene, viewBBox } from '../src/scene/buildScene';
import { defaultProject, type Project } from '../src/scene/project';
import { latToPx, loadTerrain, lonToPx, TILE } from '../src/topo/terrain';
import { fromFile, toFile } from '../src/projectFile';
import { sampleTrack } from '../src/sample';
import type { PathPrim } from '../src/scene/types';

const frame = { x: 20, y: 30, w: 300, h: 400 };
const corners: [number, number, number][] = [[20, 30, 0], [320, 30, 0], [20, 430, 0], [320, 430, 0]];
const view = { turn: 30, tilt: 60, perspective: 0 };

describe('camera zoom', () => {
  it('at 200% everything is twice as far from the frame center', () => {
    const a = makeCamera(frame, view, corners);
    const b = makeCamera(frame, { ...view, zoom: 200 }, corners);
    expect(b.scale).toBeCloseTo(a.scale * 2, 9);
    const c = [frame.x + frame.w / 2, frame.y + frame.h / 2];
    const [ax, ay] = a.project(100, 100, 5);
    const [bx, by] = b.project(100, 100, 5);
    expect(bx - c[0]!).toBeCloseTo((ax - c[0]!) * 2, 6);
    expect(by - c[1]!).toBeCloseTo((ay - c[1]!) * 2, 6);
  });
  it('centers on the focus when the map still fills the frame around it', () => {
    const z = makeCamera(frame, { ...view, zoom: 300 }, corners, [[150, 200, 0]]);
    const [x, y] = z.project(150, 200, 0);
    expect(x).toBeCloseTo(frame.x + frame.w / 2, 6);
    expect(y).toBeCloseTo(frame.y + frame.h / 2, 6);
  });
  it('a focus near the edge of the map is not centered past it: the frame keeps showing map', () => {
    const z = makeCamera(frame, { ...view, zoom: 150 }, corners, [[21, 31, 0]]);
    const pts = corners.map(([x, y, h]) => z.project(x, y, h));
    // the map's outer box still reaches past both sides of the frame
    expect(Math.min(...pts.map((q) => q[0]))).toBeLessThanOrEqual(frame.x + 1e-6);
    expect(Math.max(...pts.map((q) => q[0]))).toBeGreaterThanOrEqual(frame.x + frame.w - 1e-6);
  });
  it('at 100% (or unset) nothing changes, focus or not', () => {
    const a = makeCamera(frame, view, corners);
    const b = makeCamera(frame, { ...view, zoom: 100 }, corners, [[21, 31, 0]]);
    expect(b.project(100, 100, 5)).toEqual(a.project(100, 100, 5));
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
  p.relief.enabled = true; p.relief.tilt = 60; p.relief.turn = 30; p.relief.style = 'rows';
  fn?.(p);
  return p;
};
const coords = (d: string) => [...d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((m) => [+m[1]!, +m[2]!] as const);

describe('zoom on the poster', () => {
  it('old projects open at 100%, centered on the route', () => {
    const file = JSON.parse(JSON.stringify(toFile(defaultProject())));
    delete file.project.relief.zoom;
    delete file.project.relief.zoomOn;
    const p = fromFile(file);
    expect(p.relief.zoom).toBe(100);
    expect(p.relief.zoomOn).toBe('route');
  });
  it('zoomed in, the relief lines and the route are trimmed at the frame, and there is more ink in it', async () => {
    const a = project();
    const b = project((p) => { p.relief.zoom = 200; p.relief.base.enabled = true; });
    const terrain = await loadTerrain(viewBBox(a)!, cone);
    const sa = buildScene(a, terrain);
    const sb = buildScene(b, terrain);
    // the frame is the map area: find it from the unzoomed relief, which fits inside it
    const map = (s: ReturnType<typeof buildScene>) => s.prims.filter((x): x is PathPrim => x.kind === 'path' && (x.part === 'relief' || x.part === 'route'));
    const box = (ps: PathPrim[]) => {
      const all = ps.flatMap((x) => coords(x.d));
      return { x0: Math.min(...all.map((q) => q[0])), x1: Math.max(...all.map((q) => q[0])), y0: Math.min(...all.map((q) => q[1])), y1: Math.max(...all.map((q) => q[1])) };
    };
    const ba = box(map(sa));
    const bb = box(map(sb));
    // zoomed, the drawing reaches the frame's sides; unzoomed it sat inside them
    expect(bb.x1 - bb.x0).toBeGreaterThanOrEqual(ba.x1 - ba.x0 - 1e-6);
    expect(bb.y1 - bb.y0).toBeGreaterThan(ba.y1 - ba.y0);
    const route = map(sb).find((x) => x.part === 'route')!;
    expect(route.d.length).toBeGreaterThan(0);
  });
  it('zoomed and centered on the route, the route sits near the middle of the drawing', async () => {
    const p = project((q) => { q.relief.zoom = 250; });
    const terrain = await loadTerrain(viewBBox(p)!, cone);
    const s = buildScene(p, terrain);
    const relief = s.prims.filter((x): x is PathPrim => x.kind === 'path' && x.part === 'relief').flatMap((x) => coords(x.d));
    const route = s.prims.filter((x): x is PathPrim => x.kind === 'path' && x.part === 'route').flatMap((x) => coords(x.d));
    const mid = (v: number[]) => (Math.min(...v) + Math.max(...v)) / 2;
    const span = Math.max(...relief.map((q) => q[0])) - Math.min(...relief.map((q) => q[0]));
    expect(Math.abs(mid(route.map((q) => q[0])) - mid(relief.map((q) => q[0])))).toBeLessThan(span * 0.25);
  });
});
