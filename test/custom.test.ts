import { describe, expect, it } from 'vitest';
import { parseLatLon, resolveCustom, newCustomId, type CustomLandmark } from '../src/features/custom';
import { placeLandmarks } from '../src/features/select';
import { defaultFeatures } from '../src/features/types';
import { fitBBox } from '../src/geo/project';
import { composeScene } from '../src/scene/buildScene';
import { defaultProject } from '../src/scene/project';
import { fromFile, toFile } from '../src/projectFile';
import { sampleTrack } from '../src/sample';

const pts = sampleTrack();

describe('custom landmarks', () => {
  it('start and end follow the track; lat/lon stands alone', () => {
    const items: CustomLandmark[] = [
      { id: 'custom-1', name: 'Start', at: 'start' }, { id: 'custom-2', name: 'Finish', at: 'end' },
      { id: 'custom-3', name: 'Camp', at: 'latlon', lat: 46.8, lon: -121.7 },
    ];
    const r = resolveCustom(items, pts);
    expect(r.map((x) => x.name)).toEqual(['Start', 'Finish', 'Camp']);
    expect([r[0]!.lat, r[0]!.lon]).toEqual([pts[0]!.lat, pts[0]!.lon]);
    expect([r[1]!.lat, r[1]!.lon]).toEqual([pts[pts.length - 1]!.lat, pts[pts.length - 1]!.lon]);
    expect(r.every((x) => x.custom)).toBe(true);
  });
  it('start and end are skipped without a track, and unnamed or out-of-range entries are skipped', () => {
    expect(resolveCustom([{ id: 'a', name: 'S', at: 'start' }, { id: 'b', name: 'E', at: 'end' }], [])).toEqual([]);
    expect(resolveCustom([{ id: 'a', name: ' ', at: 'latlon', lat: 1, lon: 1 }, { id: 'b', name: 'Far', at: 'latlon', lat: 99, lon: 1 }, { id: 'c', name: 'None', at: 'latlon' }], pts)).toEqual([]);
  });
  it('reads coordinates the ways people write them', () => {
    expect(parseLatLon('46.8523, -121.7603')).toEqual({ lat: 46.8523, lon: -121.7603 });
    expect(parseLatLon('46.8523 -121.7603')).toEqual({ lat: 46.8523, lon: -121.7603 });
    expect(parseLatLon('46.8523°N 121.7603°W')).toEqual({ lat: 46.8523, lon: -121.7603 });
    expect(parseLatLon('33.5 S, 151.2 E')).toEqual({ lat: -33.5, lon: 151.2 });
    expect(parseLatLon('hello')).toBeUndefined();
    expect(parseLatLon('120, 10')).toBeUndefined();
  });
  it('ids never repeat', () => {
    expect(newCustomId([])).toBe('custom-1');
    expect(newCustomId([{ id: 'custom-1', name: 'a', at: 'start' }, { id: 'custom-3', name: 'b', at: 'end' }])).toBe('custom-4');
  });

  it('is drawn even though GPX waypoints are switched off, and a hidden one is not', () => {
    const frame = { x: 20, y: 20, w: 300, h: 400 };
    const fit = fitBBox({ minLat: 46, maxLat: 46.2, minLon: -121.4, maxLon: -121 }, frame);
    const lm = resolveCustom([{ id: 'custom-1', name: 'Camp', at: 'latlon', lat: 46.1, lon: -121.2 }], pts);
    const run = (overrides = {}) => placeLandmarks({ landmarks: lm, water: [], fit, frame, route: [], settings: { ...defaultFeatures(), overrides }, sizeMm: 4, markerR: 2 }).labels;
    expect(defaultFeatures().kinds.waypoint).toBe(false);
    expect(run().map((l) => l.text)).toEqual(['Camp']);
    expect(run({ 'custom-1': { hidden: true } })).toEqual([]);
    expect(run({ 'custom-1': { name: 'Base camp' } }).map((l) => l.text)).toEqual(['Base camp']);
  });
  it('shows on the poster, and survives saving', () => {
    const p = defaultProject();
    p.points = pts;
    p.customLandmarks = [{ id: 'custom-1', name: 'Trail start', at: 'start' }];
    const { landmarks } = composeScene(p, undefined, undefined);
    expect(landmarks?.some((l) => l.id === 'custom-1' && l.placed)).toBe(true);
    expect(fromFile(JSON.parse(JSON.stringify(toFile(p)))).customLandmarks).toEqual(p.customLandmarks);
  });
  it('an older saved project without any gets an empty list', () => {
    const old = JSON.parse(JSON.stringify(toFile(defaultProject())));
    delete old.project.customLandmarks;
    expect(fromFile(old).customLandmarks).toEqual([]);
  });
});
