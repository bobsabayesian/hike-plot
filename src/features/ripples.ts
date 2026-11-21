import { clipPolyline, simplifyXY, type Rect, type XY } from '../geo/clip';
import { offsetPolyline } from '../export/offset';
import { distToPolyline } from './select';

export interface RippleOptions {
  /** concentric rings drawn inside each lake's shore (0 = none) */
  rings: number;
  /** distance between the shore and the rings, mm */
  gapMm: number;
  /** little wave marks over the open water */
  waves: boolean;
}

/** Is the point inside the ring? (even-odd) */
export function inside(p: XY, ring: XY[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const area = (r: XY[]) => { let a = 0; for (let i = 1; i < r.length; i++) a += r[i - 1]![0] * r[i]![1] - r[i]![0] * r[i - 1]![1]; return Math.abs(a) / 2; };

/** Runs of consecutive points that are really `d` inside the shore (a ring pushed in over a narrow neck folds over itself, and those points fail). */
function validRuns(ring: XY[], shore: XY[], d: number): XY[][] {
  const ok = ring.map((p) => inside(p, shore) && distToPolyline(p, shore) >= d * 0.85);
  const count = ok.filter(Boolean).length;
  if (count === ring.length) return [ring];
  const runs: XY[][] = [];
  let cur: XY[] = [];
  for (let i = 0; i < ring.length; i++) { if (ok[i]) cur.push(ring[i]!); else if (cur.length) { runs.push(cur); cur = []; } }
  if (cur.length) runs.push(cur);
  return runs;
}

const hash = (a: number, b: number) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/**
 * Ripples for lakes (closed rings in page mm): rings that follow the shore a little way in, and small wave marks over the open water.
 * Everything is returned as polylines, clipped to the frame.
 */
export function lakeRipples(lakes: XY[][], frame: Rect, o: RippleOptions): XY[][] {
  const out: XY[][] = [];
  const gap = Math.max(0.2, o.gapMm);
  for (const raw of lakes) {
    if (raw.length < 4) continue;
    const shore = simplifyXY(raw, 0.1);
    if (shore.length < 4 || area(shore) < Math.max(4, gap * gap * 6)) continue;
    for (let k = 1; k <= o.rings; k++) {
      const d = k * gap;
      // the offset has a side: take the one that stays inside the lake
      let best: XY[][] = [];
      let bestN = -1;
      for (const sign of [1, -1]) {
        const ring = offsetPolyline(shore, sign * d, true) as XY[];
        const runs = validRuns(ring, shore, d);
        const n = runs.reduce((t, r) => t + r.length, 0);
        if (n > bestN) { best = runs; bestN = n; }
      }
      for (const run of best) if (run.length >= 3) out.push(...clipPolyline(run, frame));
    }
    if (o.waves) {
      const xs = shore.map((p) => p[0]), ys = shore.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const step = 6;
      if (((x1 - x0) / step) * ((y1 - y0) / step) > 4000) continue;
      const from = o.rings * gap + 1.6;
      for (let gy = Math.floor(y0 / step); gy * step <= y1; gy++) {
        for (let gx = Math.floor(x0 / step); gx * step <= x1; gx++) {
          // jitter, so the marks do not stand in rows; the same lake always gets the same marks
          const c: XY = [(gx + 0.15 + hash(gx, gy) * 0.7) * step, (gy + 0.15 + hash(gy, gx + 99) * 0.7) * step + (gx % 2 ? step / 2 : 0)];
          if (!inside(c, shore) || distToPolyline(c, shore) < from) continue;
          const len = 2.6, amp = 0.35;
          const mark: XY[] = Array.from({ length: 9 }, (_, i) => [c[0] - len / 2 + (len * i) / 8, c[1] + Math.sin((i / 8) * Math.PI * 2) * amp]);
          out.push(...clipPolyline(mark, frame));
        }
      }
    }
  }
  return out;
}
