import type { BBox } from '../geo/project';

export const LANDMARK_KINDS = ['peak', 'pass', 'lake', 'hut', 'viewpoint', 'trailhead', 'waypoint'] as const;
export type LandmarkKind = (typeof LANDMARK_KINDS)[number];

export const KIND_LABELS: Record<LandmarkKind, string> = {
  peak: 'Peaks', pass: 'Passes', lake: 'Lakes', hut: 'Huts', viewpoint: 'Viewpoints',
  trailhead: 'Trailheads', waypoint: 'GPX waypoints',
};

export interface Landmark {
  /** stable id: OSM `n123` (node), or `wpt-0` for GPX waypoints */
  id: string;
  name: string;
  kind: LandmarkKind;
  lat: number;
  lon: number;
  /** meters */
  ele?: number;
}

export interface WaterLine {
  /** OSM `w123` */
  id: string;
  kind: 'river' | 'lake';
  name?: string;
  /** [lat, lon] pairs; lakes are closed rings */
  coords: [number, number][];
}

export interface OsmData {
  landmarks: Landmark[];
  water: WaterLine[];
  /** area this data was fetched for */
  covers: BBox;
  /** parts the server could not fetch this time */
  partial?: ('landmarks' | 'water')[];
  /** why the server could not fetch the missing parts (which Overpass servers said what) */
  reason?: string;
}

export type Side = 'auto' | 'right' | 'left' | 'above' | 'below';

export interface FeatureOverride { name?: string; hidden?: boolean; side?: Side }

export interface FeatureSettings {
  enabled: boolean;
  /** most labels drawn (hand-hidden ones don't count) */
  maxLabels: number;
  kinds: Record<LandmarkKind, boolean>;
  /** rivers, streams and lake outlines */
  water: boolean;
  sizePt: number;
  /** markers and labels */
  color: string;
  waterColor: string;
  waterWeightMm: number;
  overrides: Record<string, FeatureOverride>;
}

export const defaultFeatures = (): FeatureSettings => ({
  enabled: true,
  maxLabels: 8,
  kinds: { peak: true, pass: true, lake: true, hut: true, viewpoint: true, trailhead: true, waypoint: true },
  water: true,
  sizePt: 11,
  color: '#1f2a24',
  waterColor: '#1f2a24',
  waterWeightMm: 0.2,
  overrides: {},
});
