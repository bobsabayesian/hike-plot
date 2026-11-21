import { describe, expect, it } from 'vitest';
import { beneath, DEFAULT_GAP_MM, defaultLayers, LAYER_IDS, LAYERS, layerOfPart, MAX_GAP_MM, moveLayer, moveLayerTo, normalizeLayers, setCut, setGap, suggestCuts } from '../src/scene/layers';
import { fromFile, toFile } from '../src/projectFile';
import { defaultProject } from '../src/scene/project';
import type { Part } from '../src/scene/types';
import { existingClears } from '../src/ui/LayerSorter';

describe('layers', () => {
  it('cover every part of the scene exactly once', () => {
    const parts: Part[] = ['border', 'title', 'location', 'info', 'watermark', 'contours', 'relief', 'cover', 'water', 'profile', 'route', 'north', 'grid', 'landmarks'];
    for (const p of parts) expect(layerOfPart(p)).toBeDefined();
    const all = LAYERS.flatMap((l) => [...l.parts]);
    expect(new Set(all).size).toBe(all.length);
    expect(layerOfPart(undefined)).toBeUndefined();
    expect(layerOfPart('contours')).toBe('terrain');
    expect(layerOfPart('relief')).toBe('terrain');
  });
  it('start in the order the poster has always been drawn in, plotting by pen, with no cuts', () => {
    const s = defaultLayers();
    expect(s.order).toEqual(LAYER_IDS);
    expect(s.order.indexOf('terrain')).toBeLessThan(s.order.indexOf('route'));
    expect(s.byStack).toBe(false);
    expect(s.rules).toEqual({});
  });
});

describe('moving layers and setting cuts', () => {
  it('moves a layer one place, and not past the ends', () => {
    const s = defaultLayers();
    const up = moveLayer(s, 'route', -1);
    expect(up.order.indexOf('route')).toBe(s.order.indexOf('route') - 1);
    expect(moveLayer(s, s.order[0]!, -1)).toBe(s);
    expect(moveLayer(s, s.order[s.order.length - 1]!, 1)).toBe(s);
    expect(moveLayerTo(s, 'route', 0).order[0]).toBe('route');
    expect(moveLayerTo(s, 'route', 99).order.at(-1)).toBe('route');
  });
  it('a layer can only cut layers beneath it', () => {
    let s = defaultLayers();
    expect(setCut(s, 'terrain', 'route', true)).toBe(s); // the route is above the terrain
    s = setCut(s, 'route', 'terrain', true);
    expect(s.rules.route).toEqual({ cuts: ['terrain'], gapMm: DEFAULT_GAP_MM });
    s = setCut(setCut(s, 'route', 'water', true), 'route', 'terrain', false);
    expect(s.rules.route!.cuts).toEqual(['water']);
    expect(setCut(s, 'route', 'water', false).rules.route).toBeUndefined();
  });
  it('moving a layer beneath one it cut drops that cut, so order and cuts agree', () => {
    let s = setCut(defaultLayers(), 'route', 'terrain', true);
    s = moveLayerTo(s, 'terrain', LAYER_IDS.length - 1); // now above the route
    expect(s.rules.route).toBeUndefined();
    expect(beneath(s, 'terrain')).toContain('route');
  });
  it('the gap is kept in range, and does nothing for a layer that cuts nothing', () => {
    let s = setCut(defaultLayers(), 'route', 'terrain', true);
    expect(setGap(s, 'route', 1.5).rules.route!.gapMm).toBe(1.5);
    expect(setGap(s, 'route', 99).rules.route!.gapMm).toBe(MAX_GAP_MM);
    expect(setGap(s, 'route', -1).rules.route!.gapMm).toBe(0);
    expect(setGap(s, 'north', 2)).toBe(s);
  });
  it('the starter draws the ground first and makes what is over it clear what is under it', () => {
    const s = suggestCuts(defaultLayers());
    expect(s.order.indexOf('terrain')).toBeLessThan(s.order.indexOf('title'));
    expect(s.order.indexOf('water')).toBeLessThan(s.order.indexOf('route'));
    expect([...s.order].sort()).toEqual([...LAYER_IDS].sort());
    for (const up of ['route', 'landmarks', 'north', 'title', 'details'] as const) expect(s.rules[up]!.cuts).toEqual(expect.arrayContaining(['terrain']));
    expect(s.rules.terrain).toBeUndefined();
    expect(s.rules.route!.cuts).not.toContain('route');
  });
});

describe('settings read from a file', () => {
  it('are repaired: unknown and repeated layers dropped, missing ones added, cuts of layers above dropped, gaps in range', () => {
    const s = normalizeLayers({ order: ['route', 'nonsense', 'route', 'terrain'], byStack: true, rules: { route: { cuts: ['terrain', 'route', 'x'], gapMm: 99 }, terrain: { cuts: ['route'], gapMm: 1 }, water: 5 } });
    expect(s.order.slice(0, 2)).toEqual(['route', 'terrain']);
    expect([...s.order].sort()).toEqual([...LAYER_IDS].sort());
    expect(s.byStack).toBe(true);
    expect(s.rules.route).toBeUndefined(); // nothing is beneath the route now except what comes before it: 'terrain' is after
    expect(s.rules.terrain).toEqual({ cuts: ['route'], gapMm: 1 });
    expect(normalizeLayers(undefined)).toEqual(defaultLayers());
    expect(normalizeLayers('junk')).toEqual(defaultLayers());
  });
  it('a project saved without layers opens with the defaults, and one with them gets them back', () => {
    const p = defaultProject();
    const raw = JSON.parse(JSON.stringify(toFile(p)));
    delete raw.project.layers;
    expect(fromFile(raw).layers).toEqual(defaultLayers());
    p.layers = setCut(moveLayer(p.layers, 'north', -1), 'route', 'terrain', true);
    p.layers.byStack = true;
    expect(fromFile(JSON.parse(JSON.stringify(toFile(p)))).layers).toEqual(p.layers);
  });
});

describe('what the other settings already clear', () => {
  it('names the route, landmark and land cover clears, and nothing when they are off', () => {
    const p = defaultProject();
    for (const id of LAYER_IDS) expect(existingClears(p, id)).toEqual([]);
    p.route.clearMm = 1.5;
    p.features.clearMm = 3;
    p.cover.enabled = true;
    p.cover.classes.ice.on = true;
    expect(existingClears(p, 'route')[0]).toMatch(/1\.5 mm/);
    expect(existingClears(p, 'landmarks')[0]).toMatch(/labels/);
    expect(existingClears(p, 'cover')[0]).toMatch(/Glacier/);
  });
});
