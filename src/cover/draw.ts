import type { Rect, XY } from '../geo/clip';
import type { CoverShape, Pattern } from './types';

/** Where a kind of cover is, on the flat map (mm): a fine grid, filled from the areas as a union. */
export interface Mask {
  has(x: number, y: number): boolean;
  /** true if nothing of it is in the frame */
  empty: boolean;
}

/** Most grid cells one mask may take; a bigger frame gets coarser cells. */
const MAX_CELLS = 2_000_000;

/**
 * Fill the areas onto a grid over the frame. Each area is filled even-odd (its holes stay open), and areas are
 * joined as a union, so the copies the neighboring tiles carry of the same area do no harm.
 */
export function coverMask(shapes: CoverShape[], toMm: (lat: number, lon: number) => XY, frame: Rect, cellMm = 0.5): Mask {
  const cell = Math.max(cellMm, Math.sqrt((frame.w * frame.h) / MAX_CELLS));
  const cols = Math.max(1, Math.ceil(frame.w / cell));
  const rows = Math.max(1, Math.ceil(frame.h / cell));
  const grid = new Uint8Array(cols * rows);
  let any = false;
  for (const s of shapes) {
    const rings = s.rings.map((r) => r.map(([la, lo]) => toMm(la, lo)));
    let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
    for (const r of rings) for (const [x, y] of r) { if (y < y0) y0 = y; if (y > y1) y1 = y; if (x < x0) x0 = x; if (x > x1) x1 = x; }
    if (x1 < frame.x || x0 > frame.x + frame.w || y1 < frame.y || y0 > frame.y + frame.h) continue;
    const j0 = Math.max(0, Math.floor((y0 - frame.y) / cell));
    const j1 = Math.min(rows - 1, Math.ceil((y1 - frame.y) / cell));
    const xs: number[] = [];
    for (let j = j0; j <= j1; j++) {
      const yc = frame.y + (j + 0.5) * cell;
      xs.length = 0;
      for (const r of rings) {
        for (let k = 0, n = r.length; k < n; k++) {
          const a = r[k]!;
          const b = r[(k + 1) % n]!;
          if ((a[1] <= yc) !== (b[1] <= yc)) xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k]! - frame.x) / cell - 0.5));
        const i1 = Math.min(cols - 1, Math.floor((xs[k + 1]! - frame.x) / cell - 0.5));
        if (i1 >= i0) { grid.fill(1, j * cols + i0, j * cols + i1 + 1); any = true; }
      }
    }
  }
  return {
    empty: !any,
    has(x, y) {
      const i = Math.floor((x - frame.x) / cell);
      const j = Math.floor((y - frame.y) / cell);
      return i >= 0 && j >= 0 && i < cols && j < rows && grid[j * cols + i] === 1;
    },
  };
}

/** A steady pseudo-random number in [0, 1) for a grid position, so the pattern does not jump between redraws. */
export function rand(i: number, j: number, k: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * A pattern inside a mask, on the flat map. `lines` lie on the ground (hatching, scree dashes) and are draped over
 * the relief; `marks` are points where a small upright symbol is drawn on the page (trees, dots, tufts).
 */
export interface CoverMarks { lines: XY[][]; marks: XY[] }

/** Step between samples of a hatching line, mm: fine enough to follow the edge of an area and to drape over hills. */
const HATCH_STEP = 0.5;

export function patternMarks(mask: Mask, pattern: Pattern, spacingMm: number, frame: Rect, seed = 0): CoverMarks {
  const s = Math.max(0.5, spacingMm);
  const lines: XY[][] = [];
  const marks: XY[] = [];
  if (mask.empty || pattern === 'clear') return { lines, marks };
  if (pattern === 'hatch' || pattern === 'crosshatch') {
    for (const angle of pattern === 'hatch' ? [45] : [45, -45]) lines.push(...hatch(mask, frame, s, (angle * Math.PI) / 180));
    return { lines, marks };
  }
  // a staggered grid with some jitter, so the marks read as scattered rather than in rows
  const rowH = s * 0.866;
  const nj = Math.ceil(frame.h / rowH) + 1;
  const ni = Math.ceil(frame.w / s) + 1;
  for (let j = 0; j < nj; j++) {
    for (let i = 0; i < ni; i++) {
      const x = frame.x + (i + (j % 2) * 0.5 + (rand(i, j, seed) - 0.5) * 0.7) * s;
      const y = frame.y + (j + (rand(i, j, seed + 1) - 0.5) * 0.7) * rowH;
      if (!mask.has(x, y)) continue;
      if (pattern === 'dashes') {
        const a = rand(i, j, seed + 2) * Math.PI;
        const len = s * (0.3 + 0.25 * rand(i, j, seed + 3));
        const dx = (Math.cos(a) * len) / 2;
        const dy = (Math.sin(a) * len) / 2;
        lines.push([[x - dx, y - dy], [x + dx, y + dy]]);
      } else marks.push([x, y]);
    }
  }
  return { lines, marks };
}

/** Parallel lines at `angle` across the frame, `s` apart, kept where they are inside the mask. */
function hatch(mask: Mask, frame: Rect, s: number, angle: number): XY[][] {
  const out: XY[][] = [];
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  // lines run along (ux, uy) and are stepped along the normal (-uy, ux), from the frame's center
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const half = Math.hypot(frame.w, frame.h) / 2;
  for (let off = -half; off <= half; off += s) {
    let run: XY[] = [];
    for (let t = -half; t <= half; t += HATCH_STEP) {
      const x = cx + ux * t - uy * off;
      const y = cy + uy * t + ux * off;
      if (mask.has(x, y)) run.push([x, y]);
      else if (run.length) { if (run.length >= 2) out.push(run); run = []; }
    }
    if (run.length >= 2) out.push(run);
  }
  return out;
}

const f = (n: number) => +n.toFixed(2);

/** The small upright symbol drawn at a mark on the page; `size` is about its height, mm. */
export function markSymbol(pattern: Pattern, x: number, y: number, size: number): string {
  switch (pattern) {
    case 'trees': {
      // a trunk and a pointed crown
      const h = size;
      const w = h * 0.32;
      return `M${f(x)} ${f(y)}V${f(y - h * 0.3)}M${f(x - w)} ${f(y - h * 0.3)}L${f(x)} ${f(y - h)}L${f(x + w)} ${f(y - h * 0.3)}Z`;
    }
    case 'reeds': {
      const h = size * 0.7;
      return `M${f(x)} ${f(y)}l${f(-h * 0.35)} ${f(-h * 0.8)}M${f(x)} ${f(y)}V${f(y - h)}M${f(x)} ${f(y)}l${f(h * 0.35)} ${f(-h * 0.8)}`;
    }
    default:
      // a dot: the pen touches down (a tiny stroke with round ends)
      return `M${f(x)} ${f(y)}h0.05`;
  }
}
