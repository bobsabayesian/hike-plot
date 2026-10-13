import type { TrackPoint } from './gpx/types';

/** Synthetic out-and-back summit hike so the editor can be tried without a GPX file. */
export function sampleTrack(): TrackPoint[] {
  const pts: TrackPoint[] = [];
  const n = 400;
  const t0 = Date.UTC(2024, 6, 4, 14, 0, 0);
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const out = u < 0.5 ? u * 2 : (1 - u) * 2; // 0 -> 1 -> 0
    const lat = 46.78 + out * 0.045 + Math.sin(out * 9) * 0.004 + (u > 0.5 ? 0.0025 * Math.sin(u * 20) : 0);
    const lon = -121.74 + out * 0.07 + Math.cos(out * 6) * 0.005;
    const ele = 1650 + out ** 1.3 * 1500 + Math.sin(u * 40) * 12;
    pts.push({ lat, lon, ele, time: t0 + u * 6 * 3600e3 });
  }
  return pts;
}
