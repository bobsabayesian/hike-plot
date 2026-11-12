import { describe, expect, it } from 'vitest';
import { sceneToSvg } from '../src/export/svg';
import { landmarkPrims } from '../src/features/draw';
import { defaultFeatures, type Landmark } from '../src/features/types';
import { fitBBox } from '../src/geo/project';
import { defaultPens } from '../src/scene/pens';

const frame = { x: 20, y: 20, w: 300, h: 400 };
const fit = fitBBox({ minLat: 46, maxLat: 46.2, minLon: -121.4, maxLon: -121 }, frame);
const peak: Landmark = { id: 'peak-1', name: 'Mount "Test" & Co', kind: 'peak', lat: 46.1, lon: -121.2, ele: 3000 };

describe('click to edit labels', () => {
  const pens = defaultPens();
  const out = landmarkPrims({
    landmarks: [peak], water: [], fit, frame, route: [], settings: defaultFeatures(), sizeMm: 4, markerR: 2,
    penFor: () => pens[0]!, fontFamily: 'x', fontKey: 'sans', trackingMm: 0,
  });
  const scene = { widthMm: 400, heightMm: 500, paper: '#fff', prims: out.prims } as never;
  it('landmark labels carry their landmark id', () => {
    expect(out.prims.some((p) => p.kind === 'text' && p.ref === 'peak-1')).toBe(true);
  });
  it('the preview tags labels, escaped, and exports leave the tag off', () => {
    expect(sceneToSvg(scene, { ids: true })).toContain('data-lm="peak-1"');
    expect(sceneToSvg(scene)).not.toContain('data-lm');
  });
});
