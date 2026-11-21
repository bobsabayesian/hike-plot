import type { XY } from '../geo/clip';
import type { Box } from './select';

/** A clear zone: the box, plus `r` mm of margin on every side. */
export interface Halo { box: Box; r: number }

/**
 * How far a point is outside a halo's box (0 inside the box), in mm. The clear zone is everything within `r` of the
 * box: a rectangle with rounded corners, so the gap around a label is the same all the way round.
 */
const outsideBy = (p: XY, h: Halo): number => {
  const c = Math.cos(h.box.ang), s = Math.sin(h.box.ang);
  const dx = p[0] - h.box.cx, dy = p[1] - h.box.cy;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  return Math.hypot(Math.max(0, Math.abs(lx) - h.box.w / 2), Math.max(0, Math.abs(ly) - h.box.h / 2));
};
const inside = (p: XY, h: Halo): boolean => outsideBy(p, h) <= h.r;

const STEP_MM = 0.25;
/** A piece a cut leaves shorter than this, mm, is dropped: it would only be a speck or a stub poking at the text. */
export const MIN_STUB_MM = 0.6;

const lerp = (a: XY, b: XY, t: number): XY => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const length = (l: XY[]) => { let n = 0; for (let i = 1; i < l.length; i++) n += Math.hypot(l[i]![0] - l[i - 1]![0], l[i]![1] - l[i - 1]![1]); return n; };

/**
 * Cut lines away wherever `probe` says so. For each segment `probe` gives a test of whether a point must be cleared,
 * or nothing if the whole segment is clear of every zone (it is then copied as it is). Near a zone the segment is
 * sampled finely; where it goes in or out, the exact edge is found by halving, so cut ends lie on the zone's outline
 * rather than up to a sample short of it. Pieces a cut leaves shorter than MIN_STUB_MM are dropped; lines that are
 * never cut are kept whatever their length (pattern marks are short).
 */
function cutLines(lines: XY[][], probe: (a: XY, b: XY) => ((p: XY) => boolean) | undefined): XY[][] {
  const out: XY[][] = [];
  for (const line of lines) {
    let run: XY[] = [];
    let cutAtStart = false;
    let touched = false;
    const flush = (cutAtEnd: boolean) => {
      if (run.length > 1 && (!(cutAtStart || cutAtEnd) || length(run) >= MIN_STUB_MM)) out.push(run);
      run = [];
    };
    const first = line[0];
    if (!first) continue;
    const firstTest = line.length > 1 ? probe(first, line[1]!) : probe(first, first);
    let wasIn = !!firstTest?.(first);
    if (!wasIn) run.push(first); else { touched = true; }
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!, b = line[i]!;
      const test = probe(a, b);
      if (!test) { if (wasIn) { wasIn = false; cutAtStart = true; run = [a]; } run.push(b); continue; }
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / STEP_MM));
      let tPrev = 0;
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const isIn = test(lerp(a, b, t));
        if (isIn !== wasIn) {
          // the edge lies between tPrev and t: halve until it is found to a few microns
          let lo = tPrev, hi = t;
          for (let it = 0; it < 14; it++) { const m = (lo + hi) / 2; if (test(lerp(a, b, m)) === wasIn) lo = m; else hi = m; }
          const edge = lerp(a, b, wasIn ? hi : lo);
          touched = true;
          if (isIn) { run.push(edge); flush(true); }
          else { run = [edge]; cutAtStart = true; }
          wasIn = isIn;
        }
        if (!isIn && k === n) run.push(b);
        tPrev = t;
      }
    }
    if (!touched) { if (run.length > 1) out.push(run); continue; }
    flush(false);
  }
  return out;
}

/**
 * Cut lines wherever they pass through a clear zone, so a label has room around it. Segments that stay far from every
 * zone are copied as they are; near one, the cut ends are placed exactly on the zone's rounded outline.
 */
export function cutOutHalos(lines: XY[][], halos: Halo[]): XY[][] {
  const live = halos.filter((h) => h.r > 0 || (h.box.w > 0 && h.box.h > 0));
  if (!live.length) return lines;
  const reach = live.map((h) => Math.hypot(h.box.w, h.box.h) / 2 + h.r);
  return cutLines(lines, (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const hits = live.filter((h, i) => {
      const t = l2 ? Math.max(0, Math.min(1, ((h.box.cx - a[0]) * dx + (h.box.cy - a[1]) * dy) / l2)) : 0;
      return Math.hypot(a[0] + t * dx - h.box.cx, a[1] + t * dy - h.box.cy) <= reach[i]!;
    });
    return hits.length ? (p) => hits.some((h) => inside(p, h)) : undefined;
  });
}

/**
 * Cut lines wherever they come within `r` mm of a route (a polyline), so the route has clear paper beside it. Works on
 * the lines as they are drawn, so it holds in the 3D view too. Route segments are binned in a grid so long tracks stay fast;
 * a line segment far from the route is copied as it is, and near it is sampled every 0.25 mm.
 */
export function cutNearRoute(lines: XY[][], route: XY[], r: number): XY[][] {
  if (!(r > 0) || route.length < 2) return lines;
  const cell = Math.max(2 * r, 2);
  const grid = new Map<string, number[]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  for (let i = 0; i + 1 < route.length; i++) {
    const [ax, ay] = route[i]!, [bx, by] = route[i + 1]!;
    const x0 = Math.floor((Math.min(ax, bx) - r) / cell), x1 = Math.floor((Math.max(ax, bx) + r) / cell);
    const y0 = Math.floor((Math.min(ay, by) - r) / cell), y1 = Math.floor((Math.max(ay, by) + r) / cell);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const k = key(cx, cy);
      const list = grid.get(k);
      if (list) list.push(i); else grid.set(k, [i]);
    }
  }
  /** route segments that could be within r of anything in the box */
  const candidates = (x0: number, y0: number, x1: number, y1: number): Set<number> => {
    const out = new Set<number>();
    for (let cx = Math.floor((x0 - r) / cell); cx <= Math.floor((x1 + r) / cell); cx++)
      for (let cy = Math.floor((y0 - r) / cell); cy <= Math.floor((y1 + r) / cell); cy++)
        for (const i of grid.get(key(cx, cy)) ?? []) out.add(i);
    return out;
  };
  const r2 = r * r;
  const tooClose = (p: XY, segs: Set<number>): boolean => {
    for (const i of segs) {
      const [ax, ay] = route[i]!, [bx, by] = route[i + 1]!;
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2)) : 0;
      const ex = ax + t * dx - p[0], ey = ay + t * dy - p[1];
      if (ex * ex + ey * ey <= r2) return true;
    }
    return false;
  };
  return cutLines(lines, (a, b) => {
    const segs = candidates(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]));
    return segs.size ? (p) => tooClose(p, segs) : undefined;
  });
}
