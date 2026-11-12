import { describe, expect, it } from 'vitest';
import { northPrims } from '../src/scene/north';

const frame = { x: 20, y: 30, w: 300, h: 400 };
const base = { style: 'arrow' as const, corner: 'tr' as const, sizeMm: 20, color: '#000', weightMm: 0.3, fontFamily: 'x', fontKey: 'sans' as const };
const nums = (d: string) => [...d.matchAll(/-?\d+\.?\d*/g)].map(Number);

describe('north indicator turning with the map', () => {
  it('is unchanged without a turn', () => {
    expect(northPrims(frame, base)).toEqual(northPrims(frame, { ...base, rotateDeg: 0 }));
  });
  it('a 90 degree turn swings the arrow tip from the top to the right of the box, text stays upright', () => {
    const up = northPrims(frame, base).find((p) => p.kind === 'path' && p.mode === 'fill')!;
    const turned = northPrims(frame, { ...base, rotateDeg: 90 }).find((p) => p.kind === 'path' && p.mode === 'fill')!;
    if (up.kind !== 'path' || turned.kind !== 'path') throw new Error();
    const [ux, uy] = nums(up.d);
    const [tx, ty] = nums(turned.d);
    const cx = frame.x + frame.w - Math.max(3, 3) - 10, cy = frame.y + Math.max(3, 3) + 10;
    expect(ux).toBeCloseTo(cx, 1);
    expect(uy).toBeLessThan(cy);
    expect(ty).toBeCloseTo(cy, 1);
    expect(tx).toBeGreaterThan(cx);
    const text = northPrims(frame, { ...base, rotateDeg: 90 }).find((p) => p.kind === 'text')!;
    expect(text.kind === 'text' && text.x).toBeGreaterThan(cx);
  });
});
