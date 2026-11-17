import type { Relief } from './relief';
import { splitByShade } from './shade';

/**
 * Lighter lines in the distance (3D only): past a point, the far part of the map gets fewer lines (every 2nd, then
 * every 4th row or contour) and, if a pen is set, is drawn in that lighter pen. The near slopes come forward.
 */
export interface FadeSettings {
  enabled: boolean;
  /** where the fade starts, percent of the way from the nearest edge of the map to the farthest */
  startPct: number;
  /** drop lines far away: every 2nd, then every 4th */
  fewer: boolean;
  /** a lighter pen for the far part; unset = the same pen */
  pen?: string;
}

export const defaultFade = (): FadeSettings => ({ enabled: false, startPct: 45, fewer: true });

/**
 * How far back each place of the flat map is: 0 at the nearest point of the map, 1 at the farthest, measured on the
 * ground as the camera sees it.
 */
export function depthOf(r: Relief): (x: number, y: number) => number {
  const { surface, frame, camera } = r;
  const at = (x: number, y: number) => camera.depth(x, y, r.heightMm(surface.sample(x, y)));
  let near = -Infinity;
  let far = Infinity;
  const n = 24;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const d = at(frame.x + (i / n) * frame.w, frame.y + (j / n) * frame.h);
    if (d > near) near = d;
    if (d < far) far = d;
  }
  const span = near - far || 1;
  return (x, y) => Math.min(1, Math.max(0, (near - at(x, y)) / span));
}

/** 0 = near (every line), 1 = middle distance (every 2nd), 2 = far (every 4th). */
export function band(t: number, startPct: number): 0 | 1 | 2 {
  const s = Math.min(0.95, Math.max(0, startPct / 100));
  if (t < s) return 0;
  return t < s + (1 - s) / 2 ? 1 : 2;
}

const STRIDE = [1, 2, 4] as const;

/**
 * Line number `index` (a row, or a contour counted by its level) kept only where its band allows it: everywhere
 * near, every 2nd line in the middle distance, every 4th far away.
 */
export function thinLine<T extends readonly number[]>(line: T[], index: number, bandAt: (x: number, y: number) => 0 | 1 | 2): T[][] {
  const keep = (b: 0 | 1 | 2) => index % STRIDE[b] === 0;
  if (keep(2)) return [line];
  return splitByShade([line], (x, y) => !keep(bandAt(x, y))).lit;
}

/** Lines split into their near part and the part past the fade's start. */
export function splitFar<T extends readonly number[]>(lines: T[][], bandAt: (x: number, y: number) => 0 | 1 | 2): { near: T[][]; far: T[][] } {
  const { lit, dark } = splitByShade(lines, (x, y) => bandAt(x, y) > 0);
  return { near: lit, far: dark };
}
