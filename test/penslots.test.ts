import { describe, expect, it } from 'vitest';
import { defaultProject } from '../src/scene/project';
import { addPen, penSlots, penUsage } from '../src/scene/pens';
import { sampleTrack } from '../src/sample';

// The Pens panel's table: every part that draws with a pen, and changing its pen from there.
const base = () => ({ ...defaultProject(), points: sampleTrack() });

describe('pen slots', () => {
  it('lists the same parts as the pen usage, and only parts that are on', () => {
    const p = base();
    expect(penSlots(p).map((s) => s.section)).toEqual(penUsage(p).map((u) => u.section));
    p.north.enabled = false;
    expect(penSlots(p).some((s) => s.key === 'north')).toBe(false);
    p.north.enabled = true;
    expect(penSlots(p).find((s) => s.key === 'north')?.group).toBe('north');
  });
  it('changes a part\'s pen', () => {
    const p = base();
    const pen = addPen(p)!;
    penSlots(p).find((s) => s.key === 'route')!.set(p, pen.id);
    expect(p.route.pen).toBe(pen.id);
  });
  it('a landmark kind can go back to the landmarks\' pen, and the landmarks\' pen absorbs equal overrides', () => {
    const p = base();
    const pen = addPen(p)!;
    p.features.pens.overrides.peak = pen.id;
    const peak = penSlots(p).find((s) => s.key === 'landmarks-peak')!;
    expect(peak.inherits).toBe(true);
    peak.set(p, undefined);
    expect(p.features.pens.overrides.peak).toBeUndefined();
    p.features.pens.overrides.peak = pen.id;
    penSlots(p).find((s) => s.key === 'landmarks')!.set(p, pen.id);
    expect(p.features.pens.default).toBe(pen.id);
    expect(p.features.pens.overrides.peak).toBeUndefined();
  });
  it('3D relief lines use the contours pen', () => {
    const p = base();
    p.terrain.enabled = false;
    p.relief.enabled = true;
    expect(penSlots(p).find((s) => s.key === 'terrain')?.section).toBe('3D relief lines');
  });
});
