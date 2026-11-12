import { simplifyXY, type Rect, type XY } from '../geo/clip';
import type { Fit } from '../geo/project';
import type { ContourPiece } from '../topo/contours';
import type { TerrainField } from '../topo/terrain';
import { makeCamera, type Camera, type ViewSettings } from './camera';
import { buildSurface, type Surface } from './surface';
import { visibleRuns, type P3, type Visibility } from './visibility';

export type ReliefStyle = 'contours' | 'rows' | 'both';

export interface ReliefSettings extends ViewSettings {
  enabled: boolean;
  style: ReliefStyle;
  /** how many slices across the terrain in "rows" style */
  rows: number;
  /** vertical exaggeration, percent (100 = true proportions) */
  depth: number;
  /** line weight of the rows, mm */
  rowWeightMm: number;
  /** cut away the parts of lines that are behind a hill */
  hideHidden: boolean;
}

export const defaultRelief = (): ReliefSettings => ({
  enabled: false, style: 'contours', rows: 70, turn: 0, tilt: 55, perspective: 35, depth: 130, rowWeightMm: 0.18, hideHidden: true,
});

export interface Relief {
  camera: Camera;
  surface: Surface;
  /** height above the middle elevation, mm, for an elevation in meters */
  heightMm(elevM: number): number;
  /** a map fit whose positions follow the terrain: lat/lon -> where the point lands on the tilted page */
  fit: Fit;
  frame: Rect;
}

/** Build the 3D view of `field` for the map frame. The flat `fit` says where each place is on the flat map. */
export function buildRelief(field: TerrainField, flat: Fit, frame: Rect, s: ReliefSettings): Relief {
  const surface = buildSurface(field, flat, frame);
  const mid = (surface.lo + surface.hi) / 2;
  const mmPerM = (1 / flat.metersPerMm) * (s.depth / 100);
  const heightMm = (e: number) => (e - mid) * mmPerM;

  // the surface's own nodes decide how big the tilted map is (a sparse sample is enough for its outline)
  const corners: [number, number, number][] = [];
  const skipI = Math.max(1, Math.floor(surface.cols / 80));
  const skipJ = Math.max(1, Math.floor(surface.rows / 80));
  for (let j = 0; j < surface.rows; j += skipJ) for (let i = 0; i < surface.cols; i += skipI) corners.push([frame.x + i * surface.stepX, frame.y + j * surface.stepY, heightMm(surface.elev[j * surface.cols + i]!)]);
  for (const [i, j] of [[0, 0], [surface.cols - 1, 0], [0, surface.rows - 1], [surface.cols - 1, surface.rows - 1]] as const) corners.push([frame.x + i * surface.stepX, frame.y + j * surface.stepY, heightMm(surface.elev[j * surface.cols + i]!)]);
  const camera = makeCamera(frame, s, corners);

  const onSurface = (x: number, y: number): XY => camera.project(x, y, heightMm(surface.sample(x, y)));
  const fit: Fit = {
    metersPerMm: flat.metersPerMm,
    toMm: (lat, lon) => { const [x, y] = flat.toMm(lat, lon); return onSurface(x, y); },
    mercToMm: (mx, my) => { const [x, y] = flat.mercToMm(mx, my); return onSurface(x, y); },
    fromMm: flat.fromMm, // a position on the page does not map back to one place once the map is tilted
  };
  return { camera, surface, heightMm, fit, frame };
}

/** Hidden-line removal only does anything when the map is seen at an angle or with perspective. */
export const needsHiding = (s: Pick<ReliefSettings, 'tilt' | 'perspective' | 'hideHidden'>) => s.hideHidden && (s.tilt > 0 || s.perspective > 0);

/** The 3D points of evenly spaced slices across the terrain (west to east), each following the surface. */
export function ridgeRowLines(r: Relief, count: number): P3[][] {
  const { surface, frame } = r;
  const n = Math.max(2, Math.round(count));
  const out: P3[][] = [];
  for (let k = 0; k < n; k++) {
    const y = frame.y + (k / (n - 1)) * frame.h;
    const line: P3[] = [];
    for (let i = 0; i < surface.cols; i++) {
      const x = frame.x + i * surface.stepX;
      line.push([x, y, r.heightMm(surface.sample(x, y))]);
    }
    out.push(line);
  }
  return out;
}

/** Evenly spaced slices across the terrain as page lines; with `vis`, the parts behind hills are cut away. */
export function ridgeRows(r: Relief, count: number, vis?: Visibility): XY[][] {
  const lines = ridgeRowLines(r, count);
  if (vis) return visibleRuns(r, vis, lines);
  return lines.map((line) => simplifyXY(line.map(([x, y, z]) => r.camera.project(x, y, z)), 0.04));
}

/** Contour pieces lifted to their elevation (3D points), regular and heavy apart. */
export function contourLines(r: Relief, pieces: ContourPiece[]): { regular: P3[][]; index: P3[][] } {
  const regular: P3[][] = [];
  const index: P3[][] = [];
  for (const pc of pieces) {
    const z = r.heightMm(pc.level);
    (pc.heavy ? index : regular).push(pc.pts.map(([x, y]): P3 => [x, y, z]));
  }
  return { regular, index };
}

/** Contour pieces as page lines; with `vis`, the parts behind hills are cut away. */
export function liftContours(r: Relief, pieces: ContourPiece[], vis?: Visibility): { regular: XY[][]; index: XY[][] } {
  const lines = contourLines(r, pieces);
  const flat = (ls: P3[][]) => ls.map((l) => l.map(([x, y, z]) => r.camera.project(x, y, z)));
  if (vis) return { regular: visibleRuns(r, vis, lines.regular), index: visibleRuns(r, vis, lines.index) };
  return { regular: flat(lines.regular), index: flat(lines.index) };
}
