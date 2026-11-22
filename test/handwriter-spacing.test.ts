import { describe, expect, it } from 'vitest';
import { DEFAULT_SPACING, letterClusters, normalizeSpacing, spaceInk } from '../src/handwriter/spacing';
import type { Ink } from '../src/handwriter/ink';

type P = [number, number];
const box = (x0: number, x1: number): P[] => [[x0, 0], [x1, 0], [x1, 10]];
// "ab cd": letters 4 wide, 1 apart; a word gap of 5. The "b" has a dot that overlaps its x range.
const ink = (): Ink => ({ widthMm: 23, heightMm: 10, missing: '', strokes: [box(0, 4), box(5, 9), [[6, -2], [7, -2]], box(14, 18), box(19, 23)] });
const xs = (i: Ink): [number, number][] => letterClusters(i).map((c): [number, number] => [c.x0, c.x1]);
const at = (c: [number, number][], i: number) => c[i] as [number, number];

describe('spacing a handwritten line', () => {
  it('keeps a dot with its letter, and finds four letters', () => {
    expect(letterClusters(ink())).toHaveLength(4);
  });
  it('changes nothing at the defaults', () => {
    const r = spaceInk(ink(), 'ab cd', DEFAULT_SPACING);
    expect(r.ink.strokes).toEqual(ink().strokes);
    expect(r.letters).toBe(4);
    expect(r.words).toBe(2);
  });
  it('letter spacing widens every letter gap but not the word gap', () => {
    const r = spaceInk(ink(), 'ab cd', { tracking: 10 }).ink; // +1 mm (10% of 10 mm)
    const c = xs(r);
    expect(at(c, 1)[0] - at(c, 0)[1]).toBeCloseTo(2);
    expect(at(c, 2)[0] - at(c, 1)[1]).toBeCloseTo(5);
    expect(at(c, 3)[0] - at(c, 2)[1]).toBeCloseTo(2);
    expect(r.widthMm).toBeCloseTo(25);
  });
  it('even-out makes unequal letter gaps the same', () => {
    const uneven: Ink = { widthMm: 30, heightMm: 10, missing: '', strokes: [box(0, 4), box(5, 9), box(12, 16)] };
    const c = xs(spaceInk(uneven, 'abc', { even: 100 }).ink);
    expect(at(c, 1)[0] - at(c, 0)[1]).toBeCloseTo(at(c, 2)[0] - at(c, 1)[1]);
  });
  it('word gap closes or opens the space between words', () => {
    const c0 = xs(spaceInk(ink(), 'ab cd', { wordGap: 0 }).ink);
    expect(at(c0, 2)[0] - at(c0, 1)[1]).toBeCloseTo(0);
    const c3 = xs(spaceInk(ink(), 'ab cd', { wordGap: 300 }).ink);
    expect(at(c3, 2)[0] - at(c3, 1)[1]).toBeCloseTo(15);
  });
  it('scales the size as a whole', () => {
    const r = spaceInk(ink(), 'ab cd', { scale: 200 }).ink;
    expect(r.widthMm).toBe(46);
    expect(r.heightMm).toBe(20);
  });
  it('leaves joined writing alone and says so', () => {
    const joined: Ink = { widthMm: 20, heightMm: 10, missing: '', strokes: [box(0, 20)] };
    const r = spaceInk(joined, 'ab cd', { tracking: 50 });
    expect(r.separated).toBe(false);
    expect(r.ink.strokes).toEqual(joined.strokes);
  });
  it('keeps settings in range and falls back to the defaults', () => {
    expect(normalizeSpacing({ scale: 999, tracking: -99, even: NaN, wordGap: 'x' as never })).toEqual({ scale: 200, tracking: -20, even: 0, wordGap: 100 });
    expect(normalizeSpacing(undefined)).toEqual(DEFAULT_SPACING);
  });
});
