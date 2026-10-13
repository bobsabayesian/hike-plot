import type { TrackPoint } from '../gpx/types';
import type { BBox } from '../geo/project';

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
export type InfoKey = 'distance' | 'gain' | 'maxEle' | 'duration' | 'date';

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

export interface Feature { name: string; bbox: BBox; lat: number; lon: number }
export interface Lookup { peakName?: string; location?: string }

export interface Project {
  sizeId: string;
  landscape: boolean;
  paper: string;
  points: TrackPoint[];
  /** typed-in geographic feature; used for the map view when there is no GPX */
  feature?: Feature;
  /** names found online for the loaded GPX */
  lookup: Lookup;
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
  };
  profile: {
    enabled: boolean;
    position: ProfilePosition;
    fill: string;
    stroke: string;
    opacity: number;
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
  lookup: {},
  units: 'imperial',
  route: { color: '#b4441f', weightMm: 0.9, style: 'solid' },
  terrain: {
    enabled: true, intervalM: 0, indexEvery: 5,
    color: '#1f2a24', weightMm: 0.12, indexWeightMm: 0.25, opacity: 0.8,
  },
  profile: { enabled: true, position: 'bottom', fill: '#1f2a24', stroke: '#1f2a24', opacity: 0.12 },
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
