import type { BBox } from '../geo/project';
import { fetchFeatures } from '../lookup';
import { loadVectorFeatures, type VectorResult } from '../topo/vector';
import { POINT_KINDS, type OsmData, type OsmRequest } from './types';

/** What Overpass is still asked for: trailheads (not in the map tiles), plus huts and passes the tiles can miss. */
export const OVERPASS_KINDS = ['trailhead', 'pass', 'hut'] as const;

export interface HybridDeps {
  vector?: (b: BBox) => Promise<VectorResult>;
  overpass?: (b: BBox, req: OsmRequest) => Promise<OsmData>;
}

const intersect = (a: BBox, b: BBox): BBox => ({
  minLat: Math.max(a.minLat, b.minLat), maxLat: Math.min(a.maxLat, b.maxLat),
  minLon: Math.max(a.minLon, b.minLon), maxLon: Math.min(a.maxLon, b.maxLon),
});

const message = (e: unknown) => (e instanceof Error ? e.message : 'failed');

/**
 * Peaks, water, viewpoints and shelters come from the OpenFreeMap vector tiles, which are fast and steady. Trailheads
 * are not in those tiles, so one small Overpass lookup adds them. If the tiles cannot be fetched at all, everything
 * comes from Overpass as it did before.
 */
export async function loadFeatures(b: BBox, req: OsmRequest, deps: HybridDeps = {}): Promise<OsmData> {
  const vector = deps.vector ?? ((box) => loadVectorFeatures(box));
  const overpass = deps.overpass ?? fetchFeatures;

  const [tiles, extra] = await Promise.allSettled([
    vector(b),
    overpass(b, { kinds: [...OVERPASS_KINDS], lakes: false, rivers: false }),
  ]);

  if (tiles.status === 'rejected') {
    // fall back to the complete Overpass lookup
    return { ...(await overpass(b, req)), source: 'overpass' };
  }

  const v = tiles.value;
  const ok = extra.status === 'fulfilled';
  const note = v.complete ? undefined : 'Zoom in closer (to about 10 km across) to see small lakes, viewpoints and shelters.';
  return {
    landmarks: [...v.landmarks, ...(ok ? extra.value.landmarks : [])],
    water: v.water,
    waterNames: v.waterNames,
    cover: v.cover,
    source: 'tiles',
    note,
    // trailheads only cover what Overpass covered, so reuse is limited to the overlap
    covers: ok ? intersect(v.covers, extra.value.covers) : v.covers,
    // the tiles always bring peaks and water, so no setting needs another fetch
    requested: { kinds: [...POINT_KINDS], lakes: true, rivers: true },
    ...(ok ? {} : { partial: ['landmarks' as const], reason: `trailheads, huts and passes: ${message((extra as PromiseRejectedResult).reason)}` }),
  };
}
