import { describe, expect, it } from 'vitest';
import { hiddenLandmarks, unhide } from '../src/features/hidden';
import { composeScene, viewBBox } from '../src/scene/buildScene';
import { defaultProject } from '../src/scene/project';
import { latToPx, loadTerrain, lonToPx, TILE } from '../src/topo/terrain';
import { sampleTrack } from '../src/sample';

const known = [
  { id: 'n1', name: 'North Halfmoon Trailhead', kind: 'trailhead' as const },
  { id: 'n2', name: 'Mount Oklahoma', kind: 'peak' as const },
  { id: 'n3', name: 'Bear Lake', kind: 'lake' as const },
];

describe('the Hidden list', () => {
  it('lists every hidden landmark the main list does not show, by name and kind, named ones first in order', () => {
    const list = hiddenLandmarks({ n1: { hidden: true }, n2: { hidden: true }, n3: { hidden: false }, gone: { hidden: true } }, [], known);
    expect(list).toEqual([
      { id: 'n2', name: 'Mount Oklahoma', kind: 'peak' },
      { id: 'n1', name: 'North Halfmoon Trailhead', kind: 'trailhead' },
      { id: 'gone', name: undefined, kind: undefined },
    ]);
  });
  it('leaves out the ones already in the main list (they have their own Show box)', () => {
    expect(hiddenLandmarks({ n1: { hidden: true }, n2: { hidden: true } }, ['n1'], known).map((h) => h.id)).toEqual(['n2']);
  });
  it("uses the user's own name for it", () => {
    expect(hiddenLandmarks({ n2: { hidden: true, name: 'Okie' } }, [], known)[0]!.name).toBe('Okie');
  });
  it('is empty when nothing is hidden', () => {
    expect(hiddenLandmarks({ n1: { side: 'left' } }, [], known)).toEqual([]);
  });
  it('showing one again un-hides and pins it, and keeps its other edits', () => {
    expect(unhide({ hidden: true, name: 'Okie', icon: 'star' })).toEqual({ hidden: false, pinned: true, name: 'Okie', icon: 'star' });
    expect(unhide(undefined)).toEqual({ hidden: false, pinned: true });
  });
});

// a sharp cone of terrain with its summit at Mount Rainier
const cone = async (z: number, tx: number, ty: number) => {
  const cx = lonToPx(-121.7, z);
  const cy = latToPx(46.82, z);
  const out = new Float32Array(TILE * TILE);
  const slope = 2000 / (2 ** z * TILE * 0.0008);
  for (let r = 0; r < TILE; r++) for (let c = 0; c < TILE; c++) out[r * TILE + c] = Math.max(0, 2000 - slope * Math.hypot(tx * TILE + c - cx, ty * TILE + r - cy));
  return out;
};

describe('a summit in 3D', () => {
  it('a peak on the very top is never judged hidden behind its own crest', async () => {
    const base = { ...defaultProject(), points: sampleTrack() };
    const terrain = await loadTerrain(viewBBox(base)!, cone);
    const osm = { landmarks: [{ id: 'summit', name: 'Summit', kind: 'peak' as const, lat: 46.82, lon: -121.7, ele: 2000 }], water: [], covers: viewBBox(base)! };
    const missed: string[] = [];
    // steep views of a tall cone, where testing the summit right on the ground used to call it hidden
    for (const turn of [0, 45, 120, 135, 210, 285, 330]) {
      const p = { ...base, relief: { ...base.relief, enabled: true, style: 'rows' as const, tilt: 80, perspective: 90, depth: 400, turn } };
      const c = composeScene(p, terrain, osm);
      if (!c.landmarks?.some((l) => l.id === 'summit')) missed.push(`turn ${turn}`);
    }
    expect(missed).toEqual([]);
  });
});
