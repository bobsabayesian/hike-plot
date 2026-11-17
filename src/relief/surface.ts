import { groundMetersPerMm, type Fit } from '../geo/project';
import type { Rect } from '../geo/clip';
import { blur } from '../topo/contours';
import { latToPx, lonToPx, TILE, type TerrainField } from '../topo/terrain';

/** The terrain as a regular mesh over the map frame: an elevation in meters at every node, in poster mm. */
export interface Surface {
  frame: Rect;
  cols: number;
  rows: number;
  /** mm between nodes */
  stepX: number;
  stepY: number;
  /** meters, row by row */
  elev: Float32Array;
  lo: number;
  hi: number;
  /** elevation (m) at a point of the flat map (mm), bilinear; clamped to the frame's edge */
  sample(x: number, y: number): number;
}

const smoothedCache = new WeakMap<TerrainField, Float32Array>();
/** The elevation grid with one blur pass: the same smoothing the contour lines use, so lines sit on the surface. */
export function smoothedGrid(field: TerrainField): Float32Array {
  let g = smoothedCache.get(field);
  if (!g) smoothedCache.set(field, (g = blur(field.data, field.w, field.h, 1)));
  return g;
}

/** Mesh spacing: about one elevation pixel, but never finer than this (mm) or the mesh gets huge. */
export const MIN_STEP_MM = 0.8;
export const MAX_STEP_MM = 3;
const MAX_NODES = 450_000;

let last: { key: string; field: TerrainField; surface: Surface } | undefined;

export function buildSurface(field: TerrainField, fit: Fit, frame: Rect): Surface {
  const [ox, oy] = fit.toMm(0, 0);
  const key = [fit.metersPerMm, ox, oy, frame.x, frame.y, frame.w, frame.h].join('|');
  if (last && last.field === field && last.key === key) return last.surface;

  // an elevation pixel in mm on the page: ground meters per world pixel at this latitude, over ground meters per mm
  const [midLat] = fit.fromMm(frame.x + frame.w / 2, frame.y + frame.h / 2);
  const mPerPx = (40075016.686 * Math.cos((midLat * Math.PI) / 180)) / (TILE * 2 ** field.z);
  let step = Math.min(MAX_STEP_MM, Math.max(MIN_STEP_MM, mPerPx / groundMetersPerMm(fit, frame)));
  while ((frame.w / step + 1) * (frame.h / step + 1) > MAX_NODES) step *= 1.1;
  const cols = Math.max(2, Math.round(frame.w / step) + 1);
  const rows = Math.max(2, Math.round(frame.h / step) + 1);

  const grid = smoothedGrid(field);
  const gridAt = (gx: number, gy: number) => {
    const x = Math.min(field.w - 1, Math.max(0, gx));
    const y = Math.min(field.h - 1, Math.max(0, gy));
    const x0 = Math.min(field.w - 2, Math.floor(x));
    const y0 = Math.min(field.h - 2, Math.floor(y));
    const fx = x - x0;
    const fy = y - y0;
    const i = y0 * field.w + x0;
    return grid[i]! * (1 - fx) * (1 - fy) + grid[i + 1]! * fx * (1 - fy) + grid[i + field.w]! * (1 - fx) * fy + grid[i + field.w + 1]! * fx * fy;
  };

  const elev = new Float32Array(cols * rows);
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j < rows; j++) {
    const y = frame.y + (j * frame.h) / (rows - 1);
    for (let i = 0; i < cols; i++) {
      const x = frame.x + (i * frame.w) / (cols - 1);
      const [lat, lon] = fit.fromMm(x, y);
      // a contour at grid index g sits at world pixel px0 + g + 0.5 (pixel centers), so undo that half pixel
      const v = gridAt(lonToPx(lon, field.z) - field.px0 - 0.5, latToPx(lat, field.z) - field.py0 - 0.5);
      elev[j * cols + i] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }

  const surface: Surface = {
    frame, cols, rows, stepX: frame.w / (cols - 1), stepY: frame.h / (rows - 1), elev, lo, hi,
    sample(x, y) {
      const u = Math.min(cols - 1, Math.max(0, ((x - frame.x) / frame.w) * (cols - 1)));
      const v = Math.min(rows - 1, Math.max(0, ((y - frame.y) / frame.h) * (rows - 1)));
      const i0 = Math.min(cols - 2, Math.floor(u));
      const j0 = Math.min(rows - 2, Math.floor(v));
      const fx = u - i0;
      const fy = v - j0;
      const k = j0 * cols + i0;
      return elev[k]! * (1 - fx) * (1 - fy) + elev[k + 1]! * fx * (1 - fy) + elev[k + cols]! * (1 - fx) * fy + elev[k + cols + 1]! * fx * fy;
    },
  };
  last = { key, field, surface };
  return surface;
}
