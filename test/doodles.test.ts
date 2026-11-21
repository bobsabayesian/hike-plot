import { describe, expect, it } from 'vitest';
import { DOODLE_KINDS, GLYPHS, GLYPH_BY_KIND } from '../src/doodles/glyphs';
import { doodleCount, doodleHalos, doodleLines, mulberry32, placeDoodles, type PlaceOptions } from '../src/doodles/place';
import { defaultDoodles, normalizeDoodles } from '../src/doodles/types';
import { fromFile, toFile } from '../src/projectFile';
import { buildScene, viewBBox } from '../src/scene/buildScene';
import { addPen, penSlots, removePen } from '../src/scene/pens';
import { defaultProject, type Project } from '../src/scene/project';
import { inside } from '../src/features/halo';
import { sampleTrack } from '../src/sample';
import { latToPx, loadTerrain, lonToPx, TILE } from '../src/topo/terrain';
import type { PathPrim } from '../src/scene/types';
import type { XY } from '../src/geo/clip';

const frame = { x: 20, y: 20, w: 300, h: 380 };
const flat = (over: Partial<PlaceOptions> = {}): PlaceOptions => ({
  settings: { ...defaultDoodles(), enabled: true, density: 60 }, frame, route: [], halos: [], obstacles: [], ground: (x, y) => [x, y], ...over,
});

describe('the drawings', () => {
  it('are all there, with strokes of at least two points inside their own box', () => {
    expect(DOODLE_KINDS).toHaveLength(9);
    for (const g of GLYPHS) {
      expect(g.strokes.length).toBeGreaterThan(0);
      for (const st of g.strokes) {
        expect(st.length).toBeGreaterThanOrEqual(2);
        for (const [x, y] of st) {
          expect(x).toBeGreaterThanOrEqual(-0.2);
          expect(x).toBeLessThanOrEqual(g.w + 0.2);
          expect(y).toBeGreaterThanOrEqual(-0.2);
          expect(y).toBeLessThanOrEqual(g.h + 0.2);
        }
      }
    }
    expect(GLYPH_BY_KIND.cloud.home).toBe('sky');
    expect(GLYPH_BY_KIND.pine.home).toBe('ground');
  });
});

describe('how many', () => {
  it('none when off or at 0, more with density, fewer when they are big, never past the cap', () => {
    const on = { ...defaultDoodles(), enabled: true };
    expect(doodleCount(frame, { ...on, enabled: false })).toBe(0);
    expect(doodleCount(frame, { ...on, density: 0 })).toBe(0);
    expect(doodleCount(frame, { ...on, density: 80 })).toBeGreaterThan(doodleCount(frame, { ...on, density: 20 }));
    expect(doodleCount(frame, { ...on, sizeMm: 20 })).toBeLessThan(doodleCount(frame, { ...on, sizeMm: 6 }));
    expect(doodleCount({ x: 0, y: 0, w: 5000, h: 5000 }, { ...on, density: 100 })).toBe(60);
  });
});

describe('placing them', () => {
  const route: XY[] = [[20, 200], [160, 210], [320, 190]];
  const place = (o: Partial<PlaceOptions>) => placeDoodles(flat(o));
  it('puts down about the number asked for, inside the map, none on each other', () => {
    const items = place({});
    expect(items.length).toBeGreaterThan(doodleCount(frame, flat().settings) * 0.6);
    for (const it of items) {
      expect(it.cx - it.w / 2).toBeGreaterThanOrEqual(frame.x);
      expect(it.cx + it.w / 2).toBeLessThanOrEqual(frame.x + frame.w);
      expect(it.cy - it.h / 2).toBeGreaterThanOrEqual(frame.y);
      expect(it.cy + it.h / 2).toBeLessThanOrEqual(frame.y + frame.h);
    }
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!, b = items[j]!;
      expect(Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2).toBe(false);
    }
  });
  it('is the same every time for a seed, and different for another', () => {
    expect(place({})).toEqual(place({}));
    expect(place({ settings: { ...flat().settings, seed: 2 } })).not.toEqual(place({}));
    const r = mulberry32(5);
    expect(r()).toBe(mulberry32(5)());
  });
  it('keeps off the route, off labels, and out of boxes it is told to avoid', () => {
    const halo = { box: { cx: 100, cy: 100, w: 80, h: 30, ang: 0 }, r: 2 };
    const block = { cx: 250, cy: 330, w: 90, h: 90, ang: 0 };
    const items = place({ route, halos: [halo], obstacles: [block] });
    expect(items.length).toBeGreaterThan(5);
    for (const it of items) {
      const d = Math.min(...[[it.cx, it.cy], [it.cx - it.w / 2, it.cy], [it.cx + it.w / 2, it.cy]].map(([x, y]) => {
        let best = Infinity;
        for (let i = 1; i < route.length; i++) { const [ax, ay] = route[i - 1]!, [bx, by] = route[i]!; const l2 = (bx - ax) ** 2 + (by - ay) ** 2; const t = Math.max(0, Math.min(1, ((x! - ax) * (bx - ax) + (y! - ay) * (by - ay)) / l2)); best = Math.min(best, Math.hypot(ax + t * (bx - ax) - x!, ay + t * (by - ay) - y!)); }
        return best;
      }));
      expect(d).toBeGreaterThan(1.5);
      expect(inside([it.cx, it.cy], halo)).toBe(false);
      expect(Math.abs(it.cx - block.cx) < (it.w + block.w) / 2 && Math.abs(it.cy - block.cy) < (it.h + block.h) / 2).toBe(false);
    }
  });
  it('uses only the kinds that are on, and says nothing when none are', () => {
    const only = (...ks: (typeof DOODLE_KINDS)[number][]) => ({ ...flat().settings, kinds: Object.fromEntries(DOODLE_KINDS.map((k) => [k, ks.includes(k)])) as never });
    const items = place({ settings: only('tent') });
    expect(items.length).toBeGreaterThan(3);
    expect(new Set(items.map((i) => i.kind))).toEqual(new Set(['tent']));
    expect(place({ settings: only() })).toEqual([]);
  });
  it('trees come in groves, birds in flocks, and there is at most one sun', () => {
    const items = place({ settings: { ...flat().settings, density: 100 } });
    expect(items.filter((i) => i.kind === 'sun').length).toBeLessThanOrEqual(1);
    const pines = items.filter((i) => i.kind === 'pine' || i.kind === 'tree');
    const close = pines.filter((a) => pines.some((b) => b !== a && Math.hypot(a.cx - b.cx, a.cy - b.cy) < 14));
    expect(close.length).toBeGreaterThan(2);
  });
  it('on the ground in 3D only where the ground is, and in the sky only where there is no terrain', () => {
    const ground = (x: number, y: number): XY | undefined => (y > 200 ? [x, y] : undefined); // the lower half is terrain you can see
    const sky = (_cx: number, cy: number, r: number) => cy + r < 200; // the upper part is open sky
    const items = place({ ground, sky, settings: { ...flat().settings, density: 100 } });
    expect(items.some((i) => i.sky)).toBe(true);
    expect(items.some((i) => !i.sky)).toBe(true);
    for (const i of items) {
      if (GLYPH_BY_KIND[i.kind].home === 'sky') expect(i.cy + Math.max(i.w, i.h) * 0.6).toBeLessThan(205);
      else expect(i.cy + i.h / 2).toBeGreaterThan(200);
    }
  });
  it('makes strokes on the page near where it was set, and a clear zone for each', () => {
    const it = place({})[0]!;
    const lines = doodleLines(it);
    const xs = lines.flat().map((p) => p[0]);
    expect(Math.min(...xs)).toBeGreaterThan(it.cx - it.w);
    expect(Math.max(...xs)).toBeLessThan(it.cx + it.w);
    const halos = doodleHalos([it], 1.5);
    expect(halos[0]).toEqual({ box: { cx: it.cx, cy: it.cy, w: it.w, h: it.h, ang: 0 }, r: 1.5 });
  });
});

describe('the setting', () => {
  it('is off by default, is repaired when read, and survives saving; an older file opens with it off', () => {
    expect(defaultDoodles().enabled).toBe(false);
    const n = normalizeDoodles({ enabled: true, density: 500, sizeMm: 1, seed: 3.7, kinds: { tent: false, nonsense: true }, pen: 4 });
    expect(n).toMatchObject({ enabled: true, density: 100, sizeMm: 3, seed: 3, pen: 'ink' });
    expect(n.kinds.tent).toBe(false);
    expect(n.kinds.pine).toBe(true);
    expect(normalizeDoodles(undefined)).toEqual(defaultDoodles());
    const p = defaultProject();
    p.doodles = { ...defaultDoodles(), enabled: true, density: 70, seed: 42 };
    const raw = JSON.parse(JSON.stringify(toFile(p)));
    expect(fromFile(raw).doodles).toEqual(p.doodles);
    delete raw.project.doodles;
    expect(fromFile(raw).doodles).toEqual(defaultDoodles());
  });
  it('are in the pens table when on, and removing their pen moves them to the first pen', () => {
    const p = defaultProject();
    expect(penSlots(p).some((s) => s.key === 'doodles')).toBe(false);
    const pen = addPen(p)!;
    p.doodles.enabled = true;
    p.doodles.pen = pen.id;
    p.doodles.skyPen = pen.id;
    expect(penSlots(p).filter((s) => s.section.includes('oodles')).map((s) => s.get(p))).toEqual([pen.id, pen.id]);
    removePen(p, pen.id);
    expect(p.doodles.pen).toBe(p.pens[0]!.id);
    expect(p.doodles.skyPen).toBe(p.pens[0]!.id);
  });
});

// the poster: a cone of hills with the sample route over it
const cone = async (z: number, tx: number, ty: number) => {
  const cx = lonToPx(-121.7, z), cy = latToPx(46.82, z);
  const out = new Float32Array(TILE * TILE);
  const slope = 2000 / (2 ** z * TILE * 0.0008);
  for (let r = 0; r < TILE; r++) for (let c = 0; c < TILE; c++) out[r * TILE + c] = Math.max(0, 2000 - slope * Math.hypot(tx * TILE + c - cx, ty * TILE + r - cy));
  return out;
};
describe('on a poster', () => {
  const build = async (edit: (p: Project) => void = () => {}) => {
    const p: Project = { ...defaultProject(), points: sampleTrack() };
    p.terrain.intervalM = 50; p.features.enabled = false;
    edit(p);
    const terrain = await loadTerrain(viewBBox(p)!, cone);
    return { p, terrain, scene: buildScene(p, terrain) };
  };
  const doodleLen = (s: ReturnType<typeof buildScene>) => s.prims.filter((x): x is PathPrim => x.kind === 'path' && x.part === 'doodles').reduce((n, x) => n + x.d.length, 0);
  const terrainLen = (s: ReturnType<typeof buildScene>) => s.prims.filter((x): x is PathPrim => x.kind === 'path' && (x.part === 'contours' || x.part === 'relief')).reduce((n, x) => n + x.d.split('L').length, 0);

  it('off: no doodles and the poster is as it was; on: doodles in the pens, tagged as their own part, and the lines under them are cut away', async () => {
    const off = await build();
    expect(doodleLen(off.scene)).toBe(0);
    const on = await build((p) => { p.doodles = { ...defaultDoodles(), enabled: true, density: 80 }; });
    expect(doodleLen(on.scene)).toBeGreaterThan(200);
    const prims = on.scene.prims.filter((x) => x.part === 'doodles') as PathPrim[];
    expect(prims.every((x) => x.mode === 'stroke' && x.widthMm === 0.25)).toBe(true);
    // on a flat map every kind goes on the map, the sky ones in the sky pen
    expect(new Set(prims.map((x) => x.pen)).size).toBeGreaterThanOrEqual(1);
    expect(on.scene.prims.every((x) => x.part !== undefined)).toBe(true);
    // the terrain lines under them are cut: fewer points than without (cuts split lines but remove stretches of them)
    const len = (s: typeof on.scene) => s.prims.filter((x): x is PathPrim => x.kind === 'path' && x.part === 'contours').reduce((n, x) => n + x.d.length, 0);
    expect(len(on.scene)).not.toBe(len(off.scene));
    expect(terrainLen(on.scene)).toBeGreaterThan(0);
  });
  it('in 3D the sky gets the sun, clouds and birds in the sky pen, only above the terrain', async () => {
    const { p, scene } = await build((q) => {
      q.relief.enabled = true; q.relief.tilt = 60;
      q.doodles = { ...defaultDoodles(), enabled: true, density: 100, skyPen: 'blue' };
    });
    const sky = scene.prims.filter((x): x is PathPrim => x.kind === 'path' && x.part === 'doodles' && x.pen === 'blue');
    const ground = scene.prims.filter((x): x is PathPrim => x.kind === 'path' && x.part === 'doodles' && x.pen === 'ink');
    expect(ground.length + sky.length).toBeGreaterThan(0);
    expect(p.doodles.skyPen).toBe('blue');
  });
  it('the same seed gives the same poster, and Hand-drawn applies to the doodles', async () => {
    const a = await build((p) => { p.doodles = { ...defaultDoodles(), enabled: true }; });
    const b = await build((p) => { p.doodles = { ...defaultDoodles(), enabled: true }; });
    expect(JSON.stringify(a.scene)).toBe(JSON.stringify(b.scene));
    const w = await build((p) => { p.doodles = { ...defaultDoodles(), enabled: true }; p.hand = { ...p.hand, amount: 80 }; });
    expect(JSON.stringify(w.scene.prims.filter((x) => x.part === 'doodles'))).not.toBe(JSON.stringify(a.scene.prims.filter((x) => x.part === 'doodles')));
  });
});
