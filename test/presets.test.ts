import { describe, expect, it } from 'vitest';
import { applyMilitary, MILITARY_COLORS } from '../src/scene/presets';
import { buildScene } from '../src/scene/buildScene';
import { defaultProject, type Project } from '../src/scene/project';
import { addPen, MAX_PENS, penFor } from '../src/scene/pens';
import { sampleTrack, sampleWaypoints } from '../src/sample';

const sample = (): Project => { const t = sampleTrack(); return { ...defaultProject(), points: t, waypoints: sampleWaypoints(t) }; };

describe('military map preset', () => {
  it('sets the military look: brown contours, green woods, blue water, a black grid, flat map', () => {
    const p = sample();
    p.relief.enabled = true;
    applyMilitary(p);
    expect(p.relief.enabled).toBe(false);
    expect(penFor(p.pens, p.terrain.pen).color).toBe(MILITARY_COLORS.brown);
    expect(penFor(p.pens, p.cover.classes.wood.pen).color).toBe(MILITARY_COLORS.green);
    expect(p.cover.enabled).toBe(true);
    expect(p.features.pens.overrides.waterOutline).toBe('blue');
    expect(p.grid.enabled).toBe(true);
    expect(p.grid.pen).toBe('ink');
    expect(p.terrain.labels.enabled).toBe(true);
    expect(p.terrain.intervalM).toBe(40);
    expect(p.terrain.indexEvery).toBe(5);
    expect(p.text.title.placement).toBe('top');
  });
  it('applying it twice adds no more pens', () => {
    const p = sample();
    applyMilitary(p);
    const n = p.pens.length;
    applyMilitary(p);
    expect(p.pens.length).toBe(n);
    expect(n).toBe(5); // ink, red, blue, plus brown and green
  });
  it('reuses a pen of nearly the same color, and falls back to ink when the palette is full', () => {
    const p = sample();
    p.pens.push({ id: 'mine', name: 'My brown', color: '#8b5b2c', tipMm: 0.3 });
    applyMilitary(p);
    expect(p.terrain.pen).toBe('mine');

    const full = sample();
    while (full.pens.length < MAX_PENS) addPen(full);
    for (const pen of full.pens.slice(3)) pen.color = '#ff00ff';
    applyMilitary(full);
    expect(full.pens.length).toBe(MAX_PENS);
    expect(full.terrain.pen).toBe('ink');
  });
  it('leaves the page alone', () => {
    const p = sample();
    p.sizeId = 'a3'; p.landscape = true; p.border.enabled = true; p.units = 'metric';
    applyMilitary(p);
    expect([p.sizeId, p.landscape, p.border.enabled, p.units]).toEqual(['a3', true, true, 'metric']);
  });
  it('the poster draws the grid', () => {
    const p = sample();
    applyMilitary(p);
    expect(buildScene(p).prims.some((x) => x.part === 'grid')).toBe(true);
  });
});
