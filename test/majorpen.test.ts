import { describe, expect, it } from 'vitest';
import { buildScene, viewBBox } from '../src/scene/buildScene';
import { latToPx, loadTerrain, lonToPx, TILE } from '../src/topo/terrain';
import { defaultProject } from '../src/scene/project';
import { addPen, penSlots, penUsage, removePen } from '../src/scene/pens';
import { prepareScene, type FontSet } from '../src/export/outlines';
import { sceneToSvg } from '../src/export/svg';
import { fromFile, toFile } from '../src/projectFile';
import { sampleTrack } from '../src/sample';
import type { PathPrim, TextPrim } from '../src/scene/types';

const fake = { unitsPerEm: 1000, charToGlyph: () => ({ advanceWidth: 500, getPath: () => ({ toPathData: () => 'M0 0L1 1', commands: [{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 1, y: 1 }] }) }) };
const fonts = { sans: fake, serif: fake } as unknown as FontSet;

// a cone of terrain around Mount Rainier, so there are contours of several levels
const cone = async (z: number, tx: number, ty: number) => {
  const cx = lonToPx(-121.7, z);
  const cy = latToPx(46.82, z);
  const out = new Float32Array(TILE * TILE);
  const slope = 2000 / (2 ** z * TILE * 0.0008);
  for (let r = 0; r < TILE; r++) for (let c = 0; c < TILE; c++) out[r * TILE + c] = Math.max(0, 2000 - slope * Math.hypot(tx * TILE + c - cx, ty * TILE + r - cy));
  return out;
};

async function setup(withMajor: boolean) {
  const p = { ...defaultProject(), points: sampleTrack() };
  p.terrain.intervalM = 100; p.terrain.indexEvery = 2; p.features.enabled = false;
  p.terrain.labels.enabled = true;
  const major = addPen(p)!;
  if (withMajor) p.terrain.indexPen = major.id;
  const terrain = await loadTerrain(viewBBox(p)!, cone);
  return { p, major, scene: buildScene(p, terrain) };
}
type Setup = Awaited<ReturnType<typeof setup>>;
const contourPaths = (s: Setup['scene'], p: Setup['p']) => s.prims.filter((x): x is PathPrim => x.kind === 'path' && x.part === 'contours');

describe('a separate pen for the major contour lines', () => {
  it('by default the heavy lines use the contour pen, drawn twice over (unchanged)', async () => {
    const { p, scene } = await setup(false);
    const heavy = contourPaths(scene, p).filter((x) => x.widthMm === p.terrain.indexWeightMm);
    expect(heavy.length).toBeGreaterThan(0);
    expect(heavy.every((x) => x.pen === p.terrain.pen && x.minPasses === 2)).toBe(true);
  });
  it('with a major pen, heavy lines and their numbers use it, regular lines keep the contour pen, no forced second pass', async () => {
    const { p, major, scene } = await setup(true);
    const paths = contourPaths(scene, p);
    const heavy = paths.filter((x) => x.widthMm === p.terrain.indexWeightMm);
    const regular = paths.filter((x) => x.widthMm === p.terrain.weightMm);
    expect(heavy.length).toBeGreaterThan(0);
    expect(heavy.every((x) => x.pen === major.id && x.minPasses === undefined && x.color === major.color)).toBe(true);
    expect(regular.every((x) => x.pen === p.terrain.pen)).toBe(true);
    const numbers = scene.prims.filter((x): x is TextPrim => x.kind === 'text' && /^\d/.test(x.text) && x.pen === major.id);
    expect(numbers.length).toBeGreaterThan(0);
  });
  it('the plotter export puts the major lines on their own pen layer', async () => {
    const { p, major, scene } = await setup(true);
    const svg = sceneToSvg(prepareScene(scene, 'plotter', fonts, { pens: p.pens }), { layers: 'pen', pens: p.pens });
    expect(svg).toContain(`id="pen-${p.pens.indexOf(major) + 1}-${major.id}"`);
    const noMajor = await setup(false);
    expect(sceneToSvg(prepareScene(noMajor.scene, 'plotter', fonts, { pens: noMajor.p.pens }), { layers: 'pen', pens: noMajor.p.pens })).not.toContain(`id="pen-${noMajor.p.pens.indexOf(noMajor.major) + 1}-${noMajor.major.id}"`);
  });
  it('is a row in the pen table that follows the contour pen until set, and is listed in the usage', async () => {
    const { p, major } = await setup(false);
    const slot = penSlots(p).find((s) => s.key === 'terrainMajor')!;
    expect(slot.get(p)).toBeUndefined();
    expect(slot.base!(p).id).toBe(p.terrain.pen);
    expect(penUsage(p).find((u) => u.section === 'Major contour lines')?.penId).toBe(p.terrain.pen);
    slot.set(p, major.id);
    expect(p.terrain.indexPen).toBe(major.id);
    slot.set(p, p.terrain.pen); // choosing the contour pen is the same as no separate pen
    expect(p.terrain.indexPen).toBeUndefined();
    p.terrain.indexEvery = 0;
    expect(penSlots(p).some((s) => s.key === 'terrainMajor')).toBe(false);
  });
  it('removing the pen moves the major lines to the first pen, and it survives saving', async () => {
    const { p, major } = await setup(true);
    const back = fromFile(JSON.parse(JSON.stringify(toFile(p))));
    expect(back.terrain.indexPen).toBe(major.id);
    removePen(p, major.id);
    expect(p.terrain.indexPen).toBe(p.pens[0]!.id);
  });
});

describe('clear paper beside the route', () => {
  it('off by default: contours are untouched; on: fewer contour points near the route, and the route itself is not cut', async () => {
    const a = await setup(false);
    const b = await setup(false);
    b.p.route.clearMm = 1.5;
    const terrain = await loadTerrain(viewBBox(b.p)!, cone);
    const sb = buildScene(b.p, terrain);
    const pts = (s: Setup['scene']) => contourPaths(s, a.p).flatMap((x) => (x.d.match(/-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?/g) ?? []).map((t) => t.split(/\s+/).map(Number) as [number, number]));
    const routePts = a.scene.prims.filter((x): x is PathPrim => x.kind === 'path' && x.part === 'route').flatMap((x) => (x.d.match(/-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?/g) ?? []).map((t) => t.split(/\s+/).map(Number) as [number, number]));
    const nearest = (ps: [number, number][]) => Math.min(...ps.map((q) => Math.min(...routePts.map((r) => Math.hypot(q[0] - r[0], q[1] - r[1])))));
    expect(pts(sb).length).toBeGreaterThan(0);
    expect(nearest(pts(a.scene))).toBeLessThan(1); // contours do run right up to the route today
    // route vertices are sparse, so test against them with a generous allowance: the nearest contour point is farther away than before
    expect(nearest(pts(sb))).toBeGreaterThan(nearest(pts(a.scene)) + 0.5);
    const route = (s: Setup['scene']) => s.prims.filter((x) => x.kind === 'path' && x.part === 'route').map((x) => (x as PathPrim).d);
    expect(route(sb)).toEqual(route(a.scene));
    // the same poster with no clearing reproduces the original exactly
    b.p.route.clearMm = 0;
    expect(JSON.stringify(buildScene(b.p, terrain).prims)).toBe(JSON.stringify(a.scene.prims));
  });
});
