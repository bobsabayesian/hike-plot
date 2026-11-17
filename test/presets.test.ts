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
    expect(p.mapScale).toBe(50000);
    expect(p.text.location.coordFormat).toBe('mgrs');
    expect(p.text.location.showCoords).toBe(true);
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

import { applyRelief3d, currentLook, restoreCustom } from '../src/scene/presets';
import { useStore } from '../src/store';

describe('3D contours look', () => {
  it('lifts the contours into 3D on a solid base, with the flat-map extras off', () => {
    const p = sample();
    applyMilitary(p);
    applyRelief3d(p);
    expect(p.relief).toMatchObject({ enabled: true, style: 'contours', tilt: 55 });
    expect(p.relief.base.enabled).toBe(true);
    expect([p.grid.enabled, p.cover.enabled, p.mapScale]).toEqual([false, false, 0]);
    expect(p.terrain.pen).toBe('ink');
    expect(buildScene(p).prims.some((x) => x.part === 'grid')).toBe(false);
  });
});

describe('telling the looks apart', () => {
  it('a new poster is custom; each look is recognized once applied', () => {
    const p = sample();
    expect(currentLook(p)).toBe('custom');
    applyMilitary(p);
    expect(currentLook(p)).toBe('military');
    applyRelief3d(p);
    expect(currentLook(p)).toBe('relief3d');
  });
  it('any change of style makes it custom', () => {
    for (const change of [(q: Project) => { q.terrain.weightMm = 0.2; }, (q: Project) => { q.grid.enabled = false; }, (q: Project) => { q.mapScale = 0; }, (q: Project) => { q.paper = '#ffffff'; }]) {
      const p = sample();
      applyMilitary(p);
      change(p);
      expect(currentLook(p)).toBe('custom');
    }
  });
  it('what the poster shows is not a change of look: route, place, landmark edits, title text', () => {
    const p = sample();
    applyMilitary(p);
    p.points = p.points.slice(0, 100);
    p.text.title.value = 'Mount Rainier';
    p.features.overrides = { x: { hidden: true } } as Project['features']['overrides'];
    p.lookup = { location: 'Washington' };
    expect(currentLook(p)).toBe('military');
  });
  it('restoring custom brings back the old style but keeps the route and title text', () => {
    const before = sample();
    before.terrain.weightMm = 0.3;
    const now = structuredClone(before);
    applyMilitary(now);
    now.points = now.points.slice(0, 50);
    now.text.title.value = 'New title';
    const back = restoreCustom(now, before);
    expect(back.terrain.weightMm).toBe(0.3);
    expect(back.grid.enabled).toBe(false);
    expect(back.pens.length).toBe(before.pens.length);
    expect(back.points.length).toBe(50);
    expect(back.text.title.value).toBe('New title');
  });
});

describe('switching looks in the editor', () => {
  it('a look keeps the custom design, and Custom brings it back', () => {
    const custom = sample();
    custom.paper = '#ffeedd';
    useStore.getState().openProject(custom);
    useStore.getState().applyLook('military');
    expect(currentLook(useStore.getState().project)).toBe('military');
    useStore.getState().applyLook('relief3d'); // look to look: the custom design stays the one from before
    useStore.getState().restoreCustom();
    expect(useStore.getState().project.paper).toBe('#ffeedd');
    expect(currentLook(useStore.getState().project)).toBe('custom');
  });
  it('a change after a look is the new custom design', () => {
    useStore.getState().openProject(sample());
    useStore.getState().applyLook('military');
    useStore.getState().set((p) => { p.terrain.weightMm = 0.25; });
    expect(currentLook(useStore.getState().project)).toBe('custom');
    useStore.getState().applyLook('relief3d');
    useStore.getState().restoreCustom();
    const p = useStore.getState().project;
    expect(p.terrain.weightMm).toBe(0.25);
    expect(p.grid.enabled).toBe(true); // the tweaked military design
  });
  it('opening another poster forgets the kept design', () => {
    useStore.getState().openProject(sample());
    useStore.getState().applyLook('military');
    useStore.getState().openProject(sample());
    expect(useStore.getState().customStash).toBeUndefined();
  });
});
