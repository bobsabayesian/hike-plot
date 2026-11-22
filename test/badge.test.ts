import { describe, expect, it } from 'vitest';
import { badgePrims, defaultBadge, normalizeBadge, MAX_BADGE_MM } from '../src/scene/badge';
import { buildScene } from '../src/scene/buildScene';
import { defaultProject } from '../src/scene/project';
import { fromFile, toFile } from '../src/projectFile';
import { sampleTrack } from '../src/sample';
import type { TextPrim } from '../src/scene/types';

const font = { fontFamily: 'x', fontKey: 'sans' as const, color: '#000', pen: 'ink' };
const words = { sizeMm: 40, top: 'Mount Rainier', middle: 'summit', bottom: '2026' };

describe('the stamp', () => {
  it('has three rings, a ring at each side, and a letter at a time round the top and bottom', () => {
    const prims = badgePrims(words, 100, 100, font);
    expect(prims.filter((x) => x.kind === 'path')).toHaveLength(5);
    const letters = prims.filter((x): x is TextPrim => x.kind === 'text' && x.text.length === 1);
    expect(letters).toHaveLength('MOUNTRAINIER'.length + 4);
    expect(prims.some((x) => x.kind === 'text' && x.text === 'SUMMIT')).toBe(true);
  });
  it('sets letters on the ring, the top ones above the middle and the bottom ones below, upright', () => {
    const prims = badgePrims(words, 100, 100, font);
    const top = prims.find((x): x is TextPrim => x.kind === 'text' && x.text === 'M')!;
    expect(top.y).toBeLessThan(100);
    expect(Math.hypot(top.x - 100, top.y - 100)).toBeCloseTo(20 * 0.66, 1);
    const bottom = prims.find((x): x is TextPrim => x.kind === 'text' && x.text === '2')!;
    expect(bottom.y).toBeGreaterThan(100);
    expect(Math.abs(((bottom.rotate! % 360) + 540) % 360 - 180)).toBeLessThan(40); // near upright
  });
  it('squeezes a long word instead of wrapping past the ring', () => {
    const long = badgePrims({ ...words, top: 'A VERY LONG NAME FOR A SMALL STAMP INDEED' }, 0, 0, font);
    const ls = long.filter((x): x is TextPrim => x.kind === 'text' && x.text.length === 1 && x.y < 0);
    const xs = ls.map((l) => l.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(20 * 0.66 * 2 + 0.1);
    expect(ls[0]!.sizeMm).toBeLessThan(20 * 0.17);
  });
  it('is repaired when read, and survives saving', () => {
    expect(normalizeBadge('junk', 'ink')).toEqual(defaultBadge('ink'));
    expect(normalizeBadge({ enabled: true, sizeMm: 999, align: 'x' }, 'ink')).toMatchObject({ enabled: true, sizeMm: MAX_BADGE_MM, align: 'left' });
    const p = defaultProject();
    p.badge = { ...p.badge, enabled: true, top: 'HI', middle: 'YO' };
    expect(fromFile(JSON.parse(JSON.stringify(toFile(p)))).badge).toEqual(p.badge);
  });
  it('joins the poster when on, with the title and date as words if none are typed', () => {
    const p = { ...defaultProject(), points: sampleTrack() };
    const none = buildScene(p).prims.filter((x) => x.part === 'badge');
    expect(none).toHaveLength(0);
    p.badge.enabled = true;
    const on = buildScene(p).prims.filter((x) => x.part === 'badge');
    expect(on.length).toBeGreaterThan(10);
  });
});
