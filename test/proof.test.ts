import { describe, expect, it } from 'vitest';
import { proofMarks } from '../src/export/png';

describe('proof text layout', () => {
  it('covers the whole picture, and only places words on or near it', () => {
    const { marks, angle } = proofMarks(1200, 1800, 80, 300);
    expect(marks.length).toBeGreaterThan(8);
    expect(angle).toBeLessThan(0);
    for (const m of marks) {
      expect(m.x).toBeGreaterThan(-300);
      expect(m.x).toBeLessThan(1500);
      expect(m.y).toBeGreaterThan(-80);
      expect(m.y).toBeLessThan(1880);
    }
    // every quarter of the picture holds some
    for (const [qx, qy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const)
      expect(marks.some((m) => (m.x >= 600) === !!qx && (m.y >= 900) === !!qy)).toBe(true);
  });
  it('is the same every time', () => {
    expect(proofMarks(500, 500, 40, 120)).toEqual(proofMarks(500, 500, 40, 120));
  });
});
