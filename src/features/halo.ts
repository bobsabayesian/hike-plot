import type { XY } from '../geo/clip';
import type { Box } from './select';

/** A clear zone: the box, plus `r` mm of margin on every side. */
export interface Halo { box: Box; r: number }

const inside = (p: XY, h: Halo): boolean => {
  const c = Math.cos(h.box.ang), s = Math.sin(h.box.ang);
  const dx = p[0] - h.box.cx, dy = p[1] - h.box.cy;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  return Math.abs(lx) <= h.box.w / 2 + h.r && Math.abs(ly) <= h.box.h / 2 + h.r;
};

const STEP_MM = 0.25;

/**
 * Cut lines wherever they pass through a clear zone, so a label has room around it. Segments that stay far from every
 * zone are copied as they are; near one, the segment is sampled every 0.25 mm and the part inside is dropped.
 */
export function cutOutHalos(lines: XY[][], halos: Halo[]): XY[][] {
  const live = halos.filter((h) => h.r > 0 || (h.box.w > 0 && h.box.h > 0));
  if (!live.length) return lines;
  const reach = live.map((h) => Math.hypot(h.box.w, h.box.h) / 2 + h.r);
  /** does the segment a-b come within reach of any zone? */
  const near = (a: XY, b: XY) => live.some((h, i) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((h.box.cx - a[0]) * dx + (h.box.cy - a[1]) * dy) / l2)) : 0;
    return Math.hypot(a[0] + t * dx - h.box.cx, a[1] + t * dy - h.box.cy) <= reach[i]!;
  });
  const out: XY[][] = [];
  for (const line of lines) {
    let run: XY[] = [];
    const flush = () => { if (run.length > 1) out.push(run); run = []; };
    for (let i = 0; i < line.length; i++) {
      const b = line[i]!;
      if (i === 0) {
        if (!live.some((h) => inside(b, h))) run.push(b);
        continue;
      }
      const a = line[i - 1]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!near(a, b)) { run.push(b); continue; }
      const n = Math.max(1, Math.ceil(len / STEP_MM));
      for (let k = 1; k <= n; k++) {
        const p: XY = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
        if (live.some((h) => inside(p, h))) flush();
        else run.push(p);
      }
    }
    flush();
  }
  return out;
};

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
  const out: XY[][] = [];
  for (const line of lines) {
    let run: XY[] = [];
    const flush = () => { if (run.length > 1) out.push(run); run = []; };
    for (let i = 0; i < line.length; i++) {
      const b = line[i]!;
      if (i === 0) {
        if (!tooClose(b, candidates(b[0], b[1], b[0], b[1]))) run.push(b);
        continue;
      }
      const a = line[i - 1]!;
      const segs = candidates(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]));
      if (!segs.size) { run.push(b); continue; }
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(len / STEP_MM));
      for (let k = 1; k <= n; k++) {
        const p: XY = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
        if (tooClose(p, segs)) flush(); else run.push(p);
      }
    }
    flush();
  }
  return out;
}
