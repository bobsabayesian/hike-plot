import { describe, expect, it } from 'vitest';
import { applyHand, defaultHand, normalizeHand, wobbleLine, wobblePath } from '../src/scene/hand';
import { flattenPath } from '../src/export/offset';
import { fromFile, toFile } from '../src/projectFile';
import { buildScene } from '../src/scene/buildScene';
import { defaultProject } from '../src/scene/project';
import { sampleTrack } from '../src/sample';
import type { PathPrim, Prim, TextPrim } from '../src/scene/types';

type XY = [number, number];
const straight: XY[] = [[0, 0], [100, 0]];
const path = (part: PathPrim['part'], d: string, over: Partial<PathPrim> = {}): PathPrim => ({ kind: 'path', part, d, color: '#000000', mode: 'stroke', widthMm: 0.3, pen: 'ink', ...over });
const pts = (d: string) => flattenPath(d).flatMap((s) => s.pts as XY[]);

describe('a wandering line', () => {
  it('stays close to where it was, by about the amount asked for', () => {
    const out = wobbleLine(straight, false, 100, 7);
    const dev = Math.max(...out.map((q) => Math.abs(q[1])));
    expect(dev).toBeGreaterThan(0.1);
    expect(dev).toBeLessThanOrEqual(0.55);
    expect(Math.max(...wobbleLine(straight, false, 20, 7).map((q) => Math.abs(q[1])))).toBeLessThan(dev);
    expect(out[0]![0]).toBeGreaterThan(-0.55);
    expect(out.at(-1)![0]).toBeGreaterThan(99.4);
  });
  it('is repeatable, and a different seed wanders differently', () => {
    expect(wobbleLine(straight, false, 60, 3)).toEqual(wobbleLine(straight, false, 60, 3));
    expect(wobbleLine(straight, false, 60, 3)).not.toEqual(wobbleLine(straight, false, 60, 4));
  });
  it('does nothing at 0, and little to a tiny mark', () => {
    expect(wobbleLine(straight, false, 0, 1)).toBe(straight);
    const tiny: XY[] = [[0, 0], [2, 0]];
    expect(Math.max(...wobbleLine(tiny, false, 100, 1).map((q) => Math.abs(q[1])))).toBeLessThan(0.1);
  });
  it('is smooth: neighbouring points do not jump', () => {
    const out = wobbleLine(straight, false, 100, 5);
    for (let i = 1; i < out.length; i++) expect(Math.abs(out[i]![1] - out[i - 1]![1])).toBeLessThan(0.2);
  });
  it('closes a closed shape where it began', () => {
    const sq: XY[] = [[0, 0], [30, 0], [30, 30], [0, 30], [0, 0]];
    const out = wobbleLine(sq, true, 100, 2);
    expect(out[0]![0]).toBeCloseTo(out.at(-1)![0], 2);
    expect(out[0]![1]).toBeCloseTo(out.at(-1)![1], 2);
  });
});

describe('on the scene', () => {
  const text: TextPrim = { kind: 'text', part: 'title', text: 'X', x: 0, y: 0, anchor: 'start', sizeMm: 5, trackingMm: 0, fontFamily: 'x', fontKey: 'sans', color: '#000' };
  const prims: Prim[] = [path('contours', 'M0 0L100 0', { dash: [2, 1], color: '#123456' }), path('landmarks', 'M0 5L100 5'), path(undefined, 'M0 9L100 9'), text];
  it('wobbles the chosen layers only, keeps dash and colour, and leaves text, other layers and parts without a layer alone', () => {
    const out = applyHand(prims, { ...defaultHand(), amount: 80, layers: ['terrain'] });
    const c = out[0] as PathPrim;
    expect(c.d).not.toBe((prims[0] as PathPrim).d);
    expect(c).toMatchObject({ dash: [2, 1], color: '#123456', pen: 'ink', widthMm: 0.3 });
    expect(out[1]).toBe(prims[1]);
    expect(out[2]).toBe(prims[2]);
    expect(out[3]).toBe(text);
  });
  it('returns the same prims when off or when no layer is chosen', () => {
    expect(applyHand(prims, defaultHand())).toBe(prims);
    expect(applyHand(prims, { ...defaultHand(), amount: 50, layers: [] })).toBe(prims);
  });
  it('a line wanders the same whatever else is on the poster', () => {
    const a = wobblePath(path('contours', 'M10 10L60 10L90 40'), 70, 9);
    const b = applyHand([path('contours', 'M0 0L9 9'), path('contours', 'M10 10L60 10L90 40')], { ...defaultHand(), amount: 70, seed: 9, layers: ['terrain'] })[1] as PathPrim;
    expect(b.d).toBe(a.d);
  });
  it('makes a whole poster look hand drawn without losing any line, and off it is the same as before', () => {
    const p = { ...defaultProject(), points: sampleTrack() };
    const plain = buildScene(p);
    p.hand = { ...p.hand, amount: 60 };
    const wob = buildScene(p);
    expect(wob.prims).toHaveLength(plain.prims.length);
    const route = (s: typeof plain) => (s.prims.find((x) => x.kind === 'path' && x.part === 'route') as PathPrim).d;
    expect(route(wob)).not.toBe(route(plain));
    expect(pts(route(wob)).length).toBeGreaterThan(10);
    p.hand.amount = 0;
    expect(JSON.stringify(buildScene(p))).toBe(JSON.stringify(plain));
  });
});

describe('the setting', () => {
  it('is off by default, is repaired when read, and survives saving; an older file opens with it off', () => {
    expect(defaultHand().amount).toBe(0);
    expect(normalizeHand({ amount: 500, seed: 2.9, layers: ['route', 'nonsense', 'route'] })).toEqual({ amount: 100, seed: 2, layers: ['route'] });
    expect(normalizeHand('junk')).toEqual(defaultHand());
    const p = defaultProject();
    p.hand = { amount: 35, seed: 99, layers: ['route', 'water'] };
    const raw = JSON.parse(JSON.stringify(toFile(p)));
    expect(fromFile(raw).hand).toEqual(p.hand);
    delete raw.project.hand;
    expect(fromFile(raw).hand).toEqual(defaultHand());
  });
});
