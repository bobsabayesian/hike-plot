import { create } from 'zustand';
import { defaultProject, type Project } from './scene/project';
import type { TrackPoint } from './gpx/types';
import type { Landmark, OsmData, OsmRequest } from './features/types';
import type { TerrainField } from './topo/terrain';
import { geocodeFeature, type GeocodeHit, nearestPeakName, reverseLocation } from './lookup';
import { currentLook, LOOKS, restoreCustom, type LookId } from './scene/presets';

interface Store {
  project: Project;
  terrain?: TerrainField;
  terrainStatus: 'idle' | 'loading' | 'error';
  terrainError?: string;
  /** candidates from the last feature search */
  searchResults: GeocodeHit[];
  searchIndex: number;
  osm?: OsmData;
  osmStatus: 'idle' | 'loading' | 'error';
  osmError?: string;
  busy: string;
  notice: string;
  set: (fn: (p: Project) => void) => void;
  /** the design as it was before a look was chosen (the "Custom" one), so it can be brought back */
  customStash?: Project;
  /** switch to a look; if the poster is custom now, keep that design to come back to */
  applyLook: (id: LookId) => void;
  /** bring back the custom design kept when a look was chosen, with today's route, place and texts */
  restoreCustom: () => void;
  setTerrain: (t: TerrainField | undefined, status: Store['terrainStatus'], error?: string) => void;
  loadPoints: (pts: TrackPoint[], lookups?: boolean, waypoints?: Landmark[]) => void;
  loadOsm: (b: import('./geo/project').BBox, req: OsmRequest) => Promise<void>;
  retryOsm: () => void;
  /** replace everything with a saved project (its track and waypoints included) */
  openProject: (p: Project) => void;
  searchFeature: (q: string) => Promise<void>;
  chooseResult: (i: number) => void;
}

let loadId = 0;

export const useStore = create<Store>((setState, get) => ({
  project: defaultProject(),
  terrainStatus: 'idle',
  searchResults: [],
  searchIndex: 0,
  osmStatus: 'idle',
  busy: '',
  notice: '',
  set: (fn) =>
    setState((s) => {
      const project = structuredClone(s.project);
      fn(project);
      return { project };
    }),
  applyLook: (id) =>
    setState((s) => {
      const look = LOOKS.find((l) => l.id === id);
      if (!look) return {};
      const project = structuredClone(s.project);
      look.apply(project);
      return { project, ...(currentLook(s.project) === 'custom' ? { customStash: structuredClone(s.project) } : {}) };
    }),
  restoreCustom: () =>
    setState((s) => (s.customStash && currentLook(s.project) !== 'custom' ? { project: restoreCustom(s.project, s.customStash) } : {})),
  setTerrain: (terrain, terrainStatus, terrainError) => setState({ terrain, terrainStatus, terrainError }),

  loadOsm: async (b, req) => {
    setState({ osmStatus: 'loading', osmError: undefined });
    try {
      // the tile decoder is only loaded when landmarks are first needed
      const { loadFeatures } = await import('./features/hybrid');
      setState({ osm: await loadFeatures(b, req), osmStatus: 'idle' });
    } catch (e) {
      setState({ osm: undefined, osmStatus: 'error', osmError: e instanceof Error ? e.message : 'Landmarks failed' });
    }
  },

  retryOsm: () => setState({ osm: undefined, osmError: undefined }),

  openProject: (project) => {
    loadId++;
    setState({ project, customStash: undefined, terrain: undefined, terrainStatus: 'idle', terrainError: undefined, osm: undefined, osmStatus: 'idle', osmError: undefined, searchResults: [], searchIndex: 0, notice: '' });
  },

  loadPoints: (pts, lookups = true, waypoints = []) => {
    const id = ++loadId;
    get().set((p) => { p.points = pts; p.waypoints = waypoints; p.feature = undefined; p.routeSpanKm = undefined; p.lookup = {}; p.features.overrides = {}; });
    if (!lookups) return;
    // Fire-and-forget name lookups; the poster is complete without them. Ignore results if the track changed.
    const stale = () => id !== loadId;
    reverseLocation(pts).then((location) => { if (!stale()) get().set((p) => { p.lookup.location = location; }); }).catch(() => {});
    nearestPeakName(pts).then((peakName) => { if (!stale()) get().set((p) => { p.lookup.peakName = peakName; }); }).catch(() => {});
  },

  chooseResult: (i) => {
    const hit = get().searchResults[i];
    if (!hit) return;
    loadId++;
    get().set((p) => {
      p.points = [];
      p.routeSpanKm = undefined;
      p.waypoints = [];
      p.features.overrides = {};
      p.feature = { name: hit.name, bbox: hit.bbox, lat: hit.lat, lon: hit.lon, kind: hit.kind };
      p.lookup = { location: hit.location || undefined };
    });
    setState({ searchIndex: i, osm: undefined });
  },

  searchFeature: async (q) => {
    setState({ busy: 'Searching…', notice: '' });
    try {
      const results = await geocodeFeature(q);
      setState({ searchResults: results, busy: '' });
      get().chooseResult(0);
    } catch (e) {
      setState({ busy: '', notice: e instanceof Error ? `Search failed: ${e.message}` : 'Search failed' });
    }
  },
}));
