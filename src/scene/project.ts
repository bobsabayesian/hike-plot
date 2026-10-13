import type { TrackPoint } from '../gpx/types';
import type { BBox } from '../geo/project';
import { defaultFeatures, type FeatureSettings, type Landmark } from '../features/types';

export interface PrintSize {
  id: string;
  label: string;
  /** portrait inches */
  wIn: number;
  hIn: number;
}

export const PRINT_SIZES: PrintSize[] = [
  { id: '12x16', label: '12 × 16 in', wIn: 12, hIn: 16 },
  { id: '16x20', label: '16 × 20 in', wIn: 16, hIn: 20 },
  { id: '18x24', label: '18 × 24 in', wIn: 18, hIn: 24 },
  { id: '24x36', label: '24 × 36 in', wIn: 24, hIn: 36 },
  { id: 'a3', label: 'A3', wIn: 11.693, hIn: 16.535 },
  { id: 'a2', label: 'A2', wIn: 16.535, hIn: 23.386 },
];

export type Align = 'left' | 'center' | 'right';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export type FontKey = 'sans' | 'serif';
export type ProfilePosition = 'bottom' | 'corner';

export type Placement = 'top' | 'bottom';
export type InfoKey = 'distance' | 'gain' | 'maxEle' | 'duration' | 'date' | 'contour';
export type NorthStyle = 'arrow' | 'circle' | 'compass' | 'rose';
export type Corner = 'tl' | 'tr' | 'bl' | 'br';

export interface InfoItem {
  key: InfoKey;
  visible: boolean;
  label: string;
  /** user override; undefined = auto value from the GPX */
  value?: string;
}

export interface TitleBlock { visible: boolean; value?: string; sizePt: number; placement: Placement }
export interface LocationBlock extends TitleBlock { showCoords: boolean }
export interface InfoBlock {
  visible: boolean;
  sizePt: number;
  placement: Placement;
  layout: 'row' | 'column';
  items: InfoItem[];
}

export interface Feature {
  name: string;
  bbox: BBox;
  lat: number;
  lon: number;
  /** what OpenStreetMap calls it, e.g. "volcano" */
  kind?: string;
  /** view width/height in km; undefined = fit the feature's own extent (min ~6 km) */
  spanKm?: number;
}
export interface Lookup { peakName?: string; location?: string }

export interface Project {
  sizeId: string;
  landscape: boolean;
  paper: string;
  points: TrackPoint[];
  /** typed-in geographic feature; used for the map view when there is no GPX */
  feature?: Feature;
  /** named <wpt> entries from the GPX */
  waypoints: Landmark[];
  /** names found online for the loaded GPX */
  lookup: Lookup;
  features: FeatureSettings;
  units: 'imperial' | 'metric';
  route: { color: string; weightMm: number; style: StrokeStyle };
  terrain: {
    enabled: boolean;
    /** meters; 0 = automatic */
    intervalM: number;
    /** every Nth contour is drawn heavier; 0 = none */
    indexEvery: number;
    color: string;
    weightMm: number;
    indexWeightMm: number;
    opacity: number;
    /** elevation numbers written along the heavy contour lines */
    labels: {
      enabled: boolean;
      /** how far apart numbers on the same line are */
      density: 'sparse' | 'normal' | 'dense';
      /** label every Nth heavy line (1 = all of them) */
      every: number;
      /** leave a gap in the line behind the number (otherwise it sits just above the line) */
      gap: boolean;
      sizePt: number;
      color: string;
    };
  };
  profile: {
    enabled: boolean;
    position: ProfilePosition;
    fill: string;
    stroke: string;
    opacity: number;
    labels: {
      /** label the highest and lowest points */
      extremes: boolean;
      /** horizontal gridlines with elevation values */
      yTicks: boolean;
      /** distance ticks along the bottom */
      xTicks: boolean;
      sizePt: number;
    };
  };
  north: {
    enabled: boolean;
    style: NorthStyle;
    corner: Corner;
    sizeMm: number;
    color: string;
    weightMm: number;
  };
  text: {
    font: FontKey;
    color: string;
    trackingEm: number;
    align: Align;
    title: TitleBlock;
    location: LocationBlock;
    info: InfoBlock;
  };
  showWatermark: boolean;
}

export const defaultProject = (): Project => ({
  sizeId: '18x24',
  landscape: false,
  paper: '#f6f3ec',
  points: [],
  waypoints: [],
  lookup: {},
  features: defaultFeatures(),
  units: 'imperial',
  route: { color: '#b4441f', weightMm: 0.9, style: 'solid' },
  terrain: {
    enabled: true, intervalM: 0, indexEvery: 5,
    color: '#1f2a24', weightMm: 0.12, indexWeightMm: 0.25, opacity: 0.8,
    labels: { enabled: false, density: 'normal', every: 1, gap: true, sizePt: 8, color: '#1f2a24' },
  },
  profile: {
    enabled: true, position: 'bottom', fill: '#1f2a24', stroke: '#1f2a24', opacity: 0.12,
    labels: { extremes: false, yTicks: false, xTicks: false, sizePt: 9 },
  },
  north: { enabled: false, style: 'arrow', corner: 'tr', sizeMm: 22, color: '#1f2a24', weightMm: 0.35 },
  text: {
    font: 'sans',
    color: '#1f2a24',
    trackingEm: 0.12,
    align: 'left',
    title: { visible: true, sizePt: 60, placement: 'bottom' },
    location: { visible: true, sizePt: 18, placement: 'bottom', showCoords: true },
    info: {
      visible: true, sizePt: 22, placement: 'bottom', layout: 'row',
      items: [
        { key: 'distance', visible: true, label: 'Distance' },
        { key: 'gain', visible: true, label: 'Elevation gain' },
        { key: 'maxEle', visible: false, label: 'High point' },
        { key: 'duration', visible: false, label: 'Time' },
        { key: 'date', visible: true, label: 'Date' },
        { key: 'contour', visible: false, label: 'Contour interval' },
      ],
    },
  },
  showWatermark: true,
});

export function posterMm(p: Pick<Project, 'sizeId' | 'landscape'>): { w: number; h: number } {
  const s = PRINT_SIZES.find((x) => x.id === p.sizeId) ?? PRINT_SIZES[0]!;
  const [w, h] = [s.wIn * 25.4, s.hIn * 25.4];
  return p.landscape ? { w: h, h: w } : { w, h };
}
