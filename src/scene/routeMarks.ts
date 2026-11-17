import { haversine } from '../geo/project';
import type { TrackPoint } from '../gpx/types';
import type { XY } from '../geo/clip';

/** A mile (or km) mark along the track: where it is, which one it is, and the track just before and after it. */
export interface Tick { lat: number; lon: number; n: number; before: { lat: number; lon: number }; after: { lat: number; lon: number } }

/** Marks every `everyM` meters along the track (not at the start). */
export function distanceTicks(points: TrackPoint[], everyM: number): Tick[] {
  const out: Tick[] = [];
  if (!(everyM > 0) || points.length < 2) return out;
  let walked = 0;
  let next = everyM;
  for (let i = 1; i < points.length && out.length < 500; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = haversine(a.lat, a.lon, b.lat, b.lon);
    while (d > 0 && walked + d >= next) {
      const t = (next - walked) / d;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, n: out.length + 1, before: a, after: b });
      next += everyM;
    }
    walked += d;
  }
  return out;
}

/** The meters between marks: `every` miles or km. */
export const tickMeters = (every: number, units: 'imperial' | 'metric') => every * (units === 'imperial' ? 1609.344 : 1000);

/** How a number is written: whole numbers plain, halves with one decimal. */
export const tickLabel = (n: number, every: number) => {
  const v = n * every;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

/**
 * A short mark across the route at `at`, square to the route's direction there (from `a` to `b` on the page),
 * `len` mm long, and where its number goes: a little past one end of the mark.
 */
export function tickMark(at: XY, a: XY, b: XY, len: number): { line: XY[]; label: XY; nx: number; ny: number } {
  let dx = b[0] - a[0];
  let dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  dx /= l; dy /= l;
  // the normal, turned so the number sits on the right of the route's direction or above it
  let nx = -dy;
  let ny = dx;
  if (ny > 0.2 || (Math.abs(ny) <= 0.2 && nx < 0)) { nx = -nx; ny = -ny; }
  const h = len / 2;
  return {
    line: [[at[0] - nx * h, at[1] - ny * h], [at[0] + nx * h, at[1] + ny * h]],
    label: [at[0] + nx * (h + len * 0.45), at[1] + ny * (h + len * 0.45)],
    nx, ny,
  };
}

/** Points every `step` mm along a polyline (flat map mm), starting `step / 2` in. */
export function everyAlong(line: XY[], step: number): XY[] {
  const out: XY[] = [];
  if (!(step > 0)) return out;
  let next = step / 2;
  let walked = 0;
  for (let i = 1; i < line.length && out.length < 20000; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (d > 0 && walked + d >= next) {
      const t = (next - walked) / d;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      next += step;
    }
    walked += d;
  }
  return out;
}
