import { create } from 'zustand';
import { defaultProject, type Project } from './scene/project';
import type { TrackPoint } from './gpx/types';
import type { TerrainField } from './topo/terrain';
import { geocodeFeature, nearestPeakName, reverseLocation } from './lookup';

interface Store {
  project: Project;
  terrain?: TerrainField;
  terrainStatus: 'idle' | 'loading' | 'error';
  terrainError?: string;
  busy: string;
  notice: string;
  set: (fn: (p: Project) => void) => void;
  setTerrain: (t: TerrainField | undefined, status: Store['terrainStatus'], error?: string) => void;
  loadPoints: (pts: TrackPoint[], lookups?: boolean) => void;
  searchFeature: (q: string) => Promise<void>;
}

let loadId = 0;

export const useStore = create<Store>((setState, get) => ({
  project: defaultProject(),
  terrainStatus: 'idle',
  busy: '',
  notice: '',
  set: (fn) =>
    setState((s) => {
      const project = structuredClone(s.project);
      fn(project);
      return { project };
    }),
  setTerrain: (terrain, terrainStatus, terrainError) => setState({ terrain, terrainStatus, terrainError }),

  loadPoints: (pts, lookups = true) => {
    const id = ++loadId;
    get().set((p) => { p.points = pts; p.feature = undefined; p.lookup = {}; });
    if (!lookups) return;
    // Fire-and-forget name lookups; the poster is complete without them. Ignore results if the track changed.
    const stale = () => id !== loadId;
    reverseLocation(pts).then((location) => { if (!stale()) get().set((p) => { p.lookup.location = location; }); }).catch(() => {});
    nearestPeakName(pts).then((peakName) => { if (!stale()) get().set((p) => { p.lookup.peakName = peakName; }); }).catch(() => {});
  },

  searchFeature: async (q) => {
    setState({ busy: 'Searching…', notice: '' });
    try {
      const hit = await geocodeFeature(q);
      loadId++;
      get().set((p) => {
        p.points = [];
        p.feature = { name: hit.name, bbox: hit.bbox, lat: hit.lat, lon: hit.lon };
        p.lookup = { location: hit.location || undefined };
      });
      setState({ busy: '' });
    } catch (e) {
      setState({ busy: '', notice: e instanceof Error ? `Search failed: ${e.message}` : 'Search failed' });
    }
  },
}));
