import type { Surface } from './surface';

/**
 * Light and shade drawn with pens: the slopes turned away from the sun get their lines drawn darker (a second pen,
 * or the same pen twice) and, optionally, extra lines in between, so the shaded side reads like hatching.
 */
export interface ShadeSettings {
  enabled: boolean;
  /** where the sun is, degrees clockwise from north (315 = northwest, the map maker's usual light) */
  sunAzimuth: number;
  /** how high the sun stands, degrees above the horizon */
  sunAltitude: number;
  /** share of the land counted as in shade, percent */
  amount: number;
  /** extra lines between each pair of lines, in the shade only: 0, 1 or 3 */
  extra: 0 | 1 | 3;
  /** draw the shaded parts of the lines darker */
  darken: boolean;
  /** the pen for the shade; unset = the terrain pen, drawn twice over */
  pen?: string;
}

export const defaultShade = (): ShadeSettings => ({ enabled: false, sunAzimuth: 315, sunAltitude: 35, amount: 40, extra: 1, darken: true });

/** Runs shorter than this (mm on the flat map) take their neighbors' side, so lines do not flicker in and out. */
const MIN_RUN_MM = 1.5;
/** How far the shade is smoothed, mm on the flat map. */
const SMOOTH_MM = 2;

/** Box blur in place, radius `r` nodes, rows then columns (edges use what is there). */
function boxBlur(a: Float32Array, cols: number, rows: number, r: number) {
  const tmp = new Float32Array(Math.max(cols, rows));
  const run = (n: number, get: (k: number) => number, put: (k: number, v: number) => void) => {
    for (let k = 0; k < n; k++) tmp[k] = get(k);
    let sum = 0;
    let lo = 0;
    let hi = -1;
    for (let k = 0; k < n; k++) {
      while (hi < Math.min(n - 1, k + r)) sum += tmp[++hi]!;
      while (lo < k - r) sum -= tmp[lo++]!;
      put(k, sum / (hi - lo + 1));
    }
  };
  for (let j = 0; j < rows; j++) run(cols, (i) => a[j * cols + i]!, (i, v) => { a[j * cols + i] = v; });
  for (let i = 0; i < cols; i++) run(rows, (j) => a[j * cols + i]!, (j, v) => { a[j * cols + i] = v; });
}

export interface ShadeMap {
  /** how dark the ground is here, 0 (fully lit) to 1; compare with `cut` */
  darkness(x: number, y: number): number;
  /** the darkness above which a place counts as in shade, for a share of the land (0..1) */
  cut(share: number): number;
}

/**
 * The darkness of every node of the surface under a sun at `azimuth`/`altitude` (degrees), with slopes at true
 * proportions. x runs east on the page, y runs south.
 */
export function buildShadeMap(surface: Surface, metersPerMm: number, azimuth: number, altitude: number): ShadeMap {
  const { cols, rows, elev, stepX, stepY, frame } = surface;
  const az = (azimuth * Math.PI) / 180;
  const alt = (altitude * Math.PI) / 180;
  // toward the sun: east = sin(az), north = cos(az) (north is -y on the page)
  const lx = Math.sin(az) * Math.cos(alt);
  const ly = -Math.cos(az) * Math.cos(alt);
  const lz = Math.sin(alt);
  const dx = stepX * metersPerMm;
  const dy = stepY * metersPerMm;
  const dark = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    const j0 = Math.max(0, j - 1);
    const j1 = Math.min(rows - 1, j + 1);
    for (let i = 0; i < cols; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(cols - 1, i + 1);
      const gx = (elev[j * cols + i1]! - elev[j * cols + i0]!) / ((i1 - i0) * dx);
      const gy = (elev[j1 * cols + i]! - elev[j0 * cols + i]!) / ((j1 - j0) * dy);
      // surface normal (-gx, -gy, 1), normalized
      const lit = (-gx * lx - gy * ly + lz) / Math.hypot(gx, gy, 1);
      dark[j * cols + i] = 1 - Math.max(0, lit);
    }
  }
  // a little blur, so the shade gathers into whole slopes instead of specks on every bump
  const r = Math.max(1, Math.round(SMOOTH_MM / Math.min(stepX, stepY)));
  for (let pass = 0; pass < 2; pass++) boxBlur(dark, cols, rows, r);
  const sorted = Float32Array.from(dark).sort();
  return {
    darkness(x, y) {
      const u = Math.min(cols - 1, Math.max(0, ((x - frame.x) / frame.w) * (cols - 1)));
      const v = Math.min(rows - 1, Math.max(0, ((y - frame.y) / frame.h) * (rows - 1)));
      const i0 = Math.min(cols - 2, Math.floor(u));
      const k0 = Math.min(rows - 2, Math.floor(v));
      const fx = u - i0;
      const fy = v - k0;
      const k = k0 * cols + i0;
      return dark[k]! * (1 - fx) * (1 - fy) + dark[k + 1]! * fx * (1 - fy) + dark[k + cols]! * (1 - fx) * fy + dark[k + cols + 1]! * fx * fy;
    },
    cut(share) {
      if (share <= 0) return Infinity;
      if (share >= 1) return -Infinity;
      return sorted[Math.min(sorted.length - 1, Math.floor((1 - share) * sorted.length))]!;
    },
  };
}

type Pt = readonly number[];

/**
 * Split lines into their parts in the light and in the shade. Points carry the flat-map position in [0] and [1]
 * (anything after is kept, e.g. a height). Where a line crosses over, both parts share the midpoint, so nothing
 * is left out.
 */
export function splitByShade<T extends Pt>(lines: T[][], inShade: (x: number, y: number) => boolean): { lit: T[][]; dark: T[][] } {
  const lit: T[][] = [];
  const dark: T[][] = [];
  for (const line of lines) {
    if (line.length < 2) continue;
    const cls = line.map((q) => inShade(q[0]!, q[1]!));
    smoothRuns(line, cls);
    let start = 0;
    let carry: T | undefined;
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && cls[i] === cls[start]) continue;
      const run = line.slice(start, i);
      if (carry) run.unshift(carry);
      carry = undefined;
      if (i < line.length) {
        const a = line[i - 1]!;
        const b = line[i]!;
        carry = a.map((v, k) => (v + b[k]!) / 2) as unknown as T;
        run.push(carry);
      }
      if (run.length >= 2) (cls[start] ? dark : lit).push(run);
      start = i;
    }
  }
  return { lit, dark };
}

/** Flip runs shorter than MIN_RUN_MM to the side around them. */
function smoothRuns(line: Pt[], cls: boolean[]) {
  for (let pass = 0; pass < 2; pass++) {
    let start = 0;
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && cls[i] === cls[start]) continue;
      let len = 0;
      for (let k = Math.max(1, start); k < i; k++) len += Math.hypot(line[k]![0]! - line[k - 1]![0]!, line[k]![1]! - line[k - 1]![1]!);
      // a short run in the middle of a line takes the other side; at the ends, only if the line goes on
      if (len < MIN_RUN_MM && (start > 0 || i < line.length)) for (let k = start; k < i; k++) cls[k] = !cls[k];
      start = i;
    }
  }
}

/**
 * Which share of the shade an in-between line is drawn in. With 1 extra line it covers the whole shade; with 3,
 * the middle one does and the quarter lines only the darker half, so the shade deepens in steps.
 */
export function extraShare(step: number, extra: number, amount: number): number {
  if (extra === 3 && step % 2 === 1) return amount / 2;
  return amount;
}
