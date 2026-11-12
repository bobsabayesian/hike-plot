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
