import { describe, expect, it } from 'vitest';
import { cutNearPolylines, cutNearRoute } from '../src/features/halo';
import { applyCuts } from '../src/export/cuts';
import { preparePlotter, plotterLayout } from '../src/export/plotter';
import { prepareScene, type FontSet } from '../src/export/outlines';
import { plotRuns, sceneToSvg } from '../src/export/svg';
import { flattenPath } from '../src/export/offset';
import { buildScene, viewBBox } from '../src/scene/buildScene';
import { defaultLayers, moveLayerTo, setCut, setGap, type LayerSettings } from '../src/scene/layers';
import { addPen } from '../src/scene/pens';
import { defaultProject, type Project } from '../src/scene/project';
import type { Part, PathPrim, Scene, TextPrim } from '../src/scene/types';
import { latToPx, loadTerrain, lonToPx, TILE } from '../src/topo/terrain';
import { sampleTrack } from '../src/sample';

type XY = [number, number];
const path = (part: Part | undefined, d: string, over: Partial<PathPrim> = {}): PathPrim => ({ kind: 'path', part, d, color: '#000000', mode: 'stroke', widthMm: 0.4, pen: 'ink', ...over });
const scene = (prims: PathPrim[]): Scene => ({ widthMm: 100, heightMm: 100, paper: '#ffffff', prims });
const lines = (d: string) => flattenPath(d).map((s) => s.pts as XY[]);
const len = (d: string) => lines(d).reduce((a, l) => a + l.slice(1).reduce((b, q, i) => b + Math.hypot(q[0] - l[i]![0], q[1] - l[i]![1]), 0), 0);
const totalLen = (s: Scene, part: Part) => s.prims.filter((p): p is PathPrim => p.kind === 'path' && p.part === part).reduce((a, p) => a + len(p.d), 0);
const withRule = (upper: Parameters<typeof setCut>[1], lower: Parameters<typeof setCut>[2], gap = 0.4, base: LayerSettings = defaultLayers()) => setGap(setCut(base, upper, lower, true), upper, gap);

// terrain is a horizontal line across the page; the route crosses it
const contour = path('contours', 'M0 50L100 50');
const route = path('route', 'M50 0L50 100', { widthMm: 0.8, pen: 'red' });

describe('cutting between polylines', () => {
  const across: XY[] = [[50, -10], [50, 10]];
  it('cuts near any of several polylines, and for one polyline is the same as the route cut', () => {
    const a: XY[] = [[0, 0], [100, 0]];
    const b: XY[] = [[0, 20], [100, 20]];
    const line: XY[] = [[50, -10], [50, 30]];
    const out = cutNearPolylines([line], [a, b], 2);
    expect(out).toHaveLength(3); // cut at y=0 and y=20
    expect(cutNearRoute([across], a, 2)).toEqual(cutNearPolylines([across], [a], 2));
    expect(cutNearPolylines([across], [], 2)).toEqual([across]);
    expect(cutNearPolylines([across], [a], 0)).toEqual([across]);
  });
});

describe('applying the cuts', () => {
  it('with no rules the scene is returned as it is', () => {
    const s = scene([contour, route]);
    expect(applyCuts(s, defaultLayers())).toBe(s);
  });
  it('the layer above cuts the layer it lists, by half its line plus the gap', () => {
    const out = applyCuts(scene([contour, route]), withRule('route', 'terrain', 0.5));
    // half the route line is 0.4, plus 0.5 gap: 0.9 each side of x = 50
    expect(totalLen(out, 'contours')).toBeGreaterThan(97.5); // cut ends are found by sampling every 0.25 mm
    expect(totalLen(out, 'contours')).toBeLessThan(98.4);
    expect(totalLen(out, 'route')).toBeCloseTo(100, 6); // the cutter is not cut
    const xs = out.prims.filter((p) => p.part === 'contours').flatMap((p) => lines((p as PathPrim).d).flat().map((q) => q[0]));
    expect(xs.some((x) => x > 49.2 && x < 50.8)).toBe(false);
  });
  it('a cut straight line is two short pieces, not hundreds of sampled points', () => {
    const out = applyCuts(scene([contour, route]), withRule('route', 'terrain'));
    const pts = out.prims.filter((p) => p.part === 'contours').reduce((n, p) => n + lines((p as PathPrim).d).reduce((m, l) => m + l.length, 0), 0);
    expect(pts).toBeLessThan(8);
  });
  it('a wider gap leaves a wider opening', () => {
    const l = (g: number) => totalLen(applyCuts(scene([contour, route]), withRule('route', 'terrain', g)), 'contours');
    expect(l(2)).toBeLessThan(l(0.5));
    expect(l(0)).toBeLessThan(100);
  });
  it('layers the rule does not list are left alone, and so is everything when the cut points the wrong way', () => {
    const water = path('water', 'M0 60L100 60');
    const out = applyCuts(scene([contour, water, route]), withRule('route', 'terrain'));
    expect(totalLen(out, 'water')).toBeCloseTo(100, 6);
    // the terrain is beneath the route in the default order; put it above and a (hand-made, unnormalized) cut is ignored
    const flipped = { ...moveLayerTo(defaultLayers(), 'terrain', 99), rules: { route: { cuts: ['terrain' as const], gapMm: 0.4 } } };
    expect(applyCuts(scene([contour, route]), flipped).prims.length).toBe(2);
    expect(totalLen(applyCuts(scene([contour, route]), flipped), 'contours')).toBeCloseTo(100, 6);
  });
  it('is worked from the top down: a layer cut from above cuts the ones below only where it remains', () => {
    // north (top) cuts the route; the route cuts the terrain. The part of the route the north arrow removed no longer clears terrain.
    const northBit = path('north', 'M45 0L55 0', { widthMm: 0.3 });
    const s = scene([contour, route, northBit]);
    let rules = setCut(setCut(defaultLayers(), 'route', 'terrain', true), 'north', 'route', true);
    rules = setGap(setGap(rules, 'route', 0), 'north', 5);
    const out = applyCuts(s, rules);
    expect(totalLen(out, 'route')).toBeLessThan(100); // cut near the arrow at the top
    // the route still crosses the terrain at y = 50, so the terrain is still cut there
    expect(totalLen(out, 'contours')).toBeLessThan(100);
    // but if the north arrow removes the stretch that crosses the terrain, the terrain stays whole
    const big = path('north', 'M50 50L50 51', { widthMm: 0.3 });
    const out2 = applyCuts(scene([contour, route, big]), setGap(setCut(setGap(setCut(defaultLayers(), 'route', 'terrain', true), 'route', 0), 'north', 'route', true), 'north', 8));
    expect(totalLen(out2, 'contours')).toBeCloseTo(100, 6);
  });
  it('drops a path that is cut to nothing, keeps its other fields, and leaves prims with no part alone', () => {
    const short = path('contours', 'M49.8 50L50.2 50', { color: '#112233', dash: [1, 1] });
    const stray = path(undefined, 'M0 50L100 50');
    const out = applyCuts(scene([short, stray, contour, route]), withRule('route', 'terrain'));
    expect(out.prims.filter((p) => p.part === 'contours')).toHaveLength(1);
    expect(out.prims.find((p) => p.part === undefined)).toBe(stray);
    const kept = out.prims.find((p) => p.part === 'contours') as PathPrim;
    expect(kept.color).toBe('#000000');
  });
  it('keeps the dash, colour and pen of a path it cuts, and handles a closed shape', () => {
    const ring = path('contours', 'M40 40L60 40L60 60L40 60Z', { dash: [2, 1], color: '#abcdef', pen: 'blue' });
    const out = applyCuts(scene([ring, route]), withRule('route', 'terrain', 0.2));
    const p = out.prims.find((x) => x.part === 'contours') as PathPrim;
    expect(p).toMatchObject({ dash: [2, 1], color: '#abcdef', pen: 'blue' });
    expect(len(p.d)).toBeLessThan(80);
    expect(len(p.d)).toBeGreaterThan(76);
  });
  it('is fast on many long lines against a long cutter', () => {
    const terrain = Array.from({ length: 200 }, (_, k) => path('contours', `M0 ${k * 0.5}` + Array.from({ length: 400 }, (_, i) => `L${(i + 1) * 0.25} ${k * 0.5 + Math.sin(i / 10)}`).join('')));
    const wind = path('route', 'M0 10' + Array.from({ length: 1500 }, (_, i) => `L${(i + 1) * 0.07} ${10 + Math.sin(i / 40) * 8}`).join(''));
    const t = performance.now();
    const out = applyCuts(scene([...terrain, wind]), withRule('route', 'terrain'));
    expect(performance.now() - t).toBeLessThan(3000);
    expect(totalLen(out, 'contours')).toBeLessThan(totalLen(scene(terrain), 'contours'));
  });
});

describe('parts survive preparing the scene for the plotter', () => {
  const fake = { unitsPerEm: 1000, charToGlyph: () => ({ advanceWidth: 500, getPath: (x: number, y: number) => ({ toPathData: () => `M${x} ${y}L${x + 4} ${y}L${x + 4} ${y - 4}L${x} ${y - 4}`, commands: [] }) }) };
  const fonts = { sans: fake, serif: fake } as unknown as FontSet;
  const text = (over: Partial<TextPrim> = {}): TextPrim => ({ kind: 'text', part: 'title', text: 'HI', x: 10, y: 20, anchor: 'start', sizeMm: 8, trackingMm: 0, fontFamily: 'x', fontKey: 'sans', color: '#000', pen: 'ink', ...over });
  it('text, hatched text, single strokes, outlined text and hatched fills all keep their part', () => {
    const prims = [text(), text({ hatch: 'light' }), text({ sizeMm: 3 }), text({ mode: 'stroke', strokeMm: 0.3 }), path('cover', 'M0 0L9 0L9 9L0 9Z', { mode: 'fill', hatch: 'medium' })];
    for (const plotterText of ['outline', 'single', 'auto'] as const) {
      const out = prepareScene(scene(prims as PathPrim[]), 'plotter', fonts, { pens: defaultProject().pens, plotterText });
      expect(out.prims.length).toBeGreaterThan(5);
      expect(out.prims.every((p) => p.part !== undefined)).toBe(true);
    }
  });
});

describe('the file follows the stack', () => {
  const pens = (() => { const p = defaultProject(); addPen(p); return p.pens; })();
  const prims = [path('border', 'M0 0L1 1', { pen: 'ink' }), path('contours', 'M0 0L1 1', { pen: 'ink' }), path('cover', 'M0 0L1 1', { pen: pens[3]!.id }), path('route', 'M0 0L1 1', { pen: 'red' }), path('landmarks', 'M0 0L1 1', { pen: 'ink' })];
  const stacked = (s: LayerSettings) => sceneToSvg(scene(prims), { layers: 'pen', pens, stack: { ...s, byStack: true } });
  it('with the stack off the file is one layer per pen in the pens order, as before', () => {
    const svg = sceneToSvg(scene(prims), { layers: 'pen', pens, stack: defaultLayers() });
    expect((svg.match(/inkscape:groupmode="layer"/g) ?? []).length).toBe(3);
    expect(svg.indexOf('pen-1-ink')).toBeLessThan(svg.indexOf('pen-2-red'));
    expect(svg).toBe(sceneToSvg(scene(prims), { layers: 'pen', pens }));
  });
  it('with it on there is a layer for each run of one pen, in the stack order, named after its pen and parts', () => {
    const runs = plotRuns(prims, pens, { ...defaultLayers(), byStack: true });
    // border and terrain (ink), cover (the new pen), route (red), landmarks (ink)
    expect(runs.map((r) => r.pen)).toEqual(['ink', pens[3]!.id, 'red', 'ink']);
    expect(runs[0]!.layers).toEqual(['border', 'terrain']);
    const svg = stacked(defaultLayers());
    expect((svg.match(/inkscape:groupmode="layer"/g) ?? []).length).toBe(4);
    expect(svg).toMatch(/inkscape:label="Pen 1: Ink[^"]*· Border, Terrain lines"/);
    const ids = [...svg.matchAll(/<g id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('moving a layer changes the order the pens are used in, and the number of pen changes', () => {
    const swapped = moveLayerTo(defaultLayers(), 'landmarks', 0); // landmarks first: ink, ink, ... then the others
    const runs = plotRuns(prims, pens, { ...swapped, byStack: true });
    expect(runs.map((r) => r.pen)).toEqual(['ink', pens[3]!.id, 'red']);
    expect(runs[0]!.layers).toEqual(['landmarks', 'border', 'terrain']);
  });
  it('tags paths with their layer for the preview only when asked', () => {
    expect(sceneToSvg(scene(prims), { tagLayers: true })).toContain('data-layer="route"');
    expect(sceneToSvg(scene(prims))).not.toContain('data-layer');
  });
});

// the poster: a cone of hills, the sample route over it
const cone = async (z: number, tx: number, ty: number) => {
  const cx = lonToPx(-121.7, z), cy = latToPx(46.82, z);
  const out = new Float32Array(TILE * TILE);
  const slope = 2000 / (2 ** z * TILE * 0.0008);
  for (let r = 0; r < TILE; r++) for (let c = 0; c < TILE; c++) out[r * TILE + c] = Math.max(0, 2000 - slope * Math.hypot(tx * TILE + c - cx, ty * TILE + r - cy));
  return out;
};
describe('on a poster', () => {
  const fake = { unitsPerEm: 1000, charToGlyph: () => ({ advanceWidth: 500, getPath: (x: number, y: number) => ({ toPathData: () => `M${x} ${y}L${x + 1} ${y}L${x + 1} ${y - 1}L${x} ${y - 1}`, commands: [] }) }) };
  const fonts = { sans: fake, serif: fake } as unknown as FontSet;
  const build = async (relief: boolean) => {
    const p: Project = { ...defaultProject(), points: sampleTrack() };
    p.terrain.intervalM = 50; p.features.enabled = false;
    if (relief) { p.relief.enabled = true; p.relief.tilt = 50; }
    const terrain = await loadTerrain(viewBBox(p)!, cone);
    return { p, sc: buildScene(p, terrain) };
  };
  for (const relief of [false, true]) {
    it(`the route cuts the terrain lines ${relief ? 'in 3D' : 'on the flat map'}, and with no rules the plot is unchanged`, async () => {
      const { p, sc } = await build(relief);
      const base = preparePlotter(sc, p, fonts, 'outline');
      const part: Part = relief ? 'relief' : 'contours';
      expect(JSON.stringify(base)).toBe(JSON.stringify(prepareScene(sc, 'plotter', fonts, { pens: p.pens, plotterText: 'outline' })));
      p.layers = withRule('route', 'terrain', 0.6);
      const cut = preparePlotter(sc, p, fonts, 'outline');
      expect(totalLen(cut, part)).toBeLessThan(totalLen(base, part));
      expect(totalLen(cut, 'route')).toBeCloseTo(totalLen(base, 'route'), 3);
      expect(plotterLayout(p).stack).toBe(p.layers);
    });
  }
  it('every primitive of a poster has a part, so every one can be placed in a layer', async () => {
    const { p, sc } = await build(false);
    expect(sc.prims.every((x) => x.part !== undefined)).toBe(true);
    const out = preparePlotter(sc, p, fonts, 'auto');
    expect(out.prims.every((x) => x.part !== undefined)).toBe(true);
  });
});

describe('the north arrow in the plotter file', () => {
  it('its filled parts are hatched in the pen, not just outlined', async () => {
    const { northPrims } = await import('../src/scene/north');
    const fake = { unitsPerEm: 1000, charToGlyph: () => ({ advanceWidth: 500, getPath: (x: number, y: number) => ({ toPathData: () => `M${x} ${y}L${x + 1} ${y}L${x + 1} ${y - 1}L${x} ${y - 1}`, commands: [] }) }) };
    const fonts = { sans: fake, serif: fake } as unknown as FontSet;
    for (const style of ['arrow', 'circle', 'compass', 'rose'] as const) {
      const prims = northPrims({ x: 0, y: 0, w: 200, h: 200 }, { style, corner: 'tl', sizeMm: 24, weightMm: 0.3, color: '#000000', pen: 'ink', fontFamily: 'x', fontKey: 'sans' } as never);
      const fills = prims.filter((p): p is PathPrim => p.kind === 'path' && p.mode === 'fill');
      if (style === 'rose') continue;
      expect(fills.length).toBeGreaterThan(0);
      expect(fills.every((p) => p.hatch === 'solid')).toBe(true);
      const plot = prepareScene({ widthMm: 200, heightMm: 200, paper: '#fff', prims: fills }, 'plotter', fonts, { pens: defaultProject().pens }).prims as PathPrim[];
      // the outline and the hatch lines: more than the outline alone, all strokes in the pen
      expect(plot.length).toBeGreaterThanOrEqual(fills.length * 2);
      expect(plot.every((p) => p.mode === 'stroke' && p.pen === 'ink' && p.part === 'north')).toBe(true);
    }
  });
});
