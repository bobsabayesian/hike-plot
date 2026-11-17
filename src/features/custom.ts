import type { TrackPoint } from '../gpx/types';
import type { Landmark } from './types';

/** A landmark the user adds by hand: at the start, end or highest point of the GPX track, or at a latitude and longitude. */
export interface CustomLandmark {
  id: string;
  name: string;
  at: 'start' | 'end' | 'high' | 'latlon';
  /** for `latlon` */
  lat?: number;
  lon?: number;
}

export const CUSTOM_PREFIX = 'custom-';
export const validLat = (v: number) => Number.isFinite(v) && v >= -90 && v <= 90;
export const validLon = (v: number) => Number.isFinite(v) && v >= -180 && v <= 180;

export const newCustomId = (existing: CustomLandmark[]): string => {
  let n = existing.length + 1;
  while (existing.some((c) => c.id === `${CUSTOM_PREFIX}${n}`)) n++;
  return `${CUSTOM_PREFIX}${n}`;
};

/** Reads "46.8523, -121.7603", "46.8523 -121.7603" or "46.8523°N 121.7603°W". */
export function parseLatLon(text: string): { lat: number; lon: number } | undefined {
  const m = text.match(/(-?\d+(?:\.\d+)?)\s*°?\s*([NSns])?[\s,;/]+(-?\d+(?:\.\d+)?)\s*°?\s*([EWew])?/);
  if (!m) return undefined;
  let lat = +m[1]!, lon = +m[3]!;
  if (m[2] && m[2].toLowerCase() === 's') lat = -Math.abs(lat);
  if (m[4] && m[4].toLowerCase() === 'w') lon = -Math.abs(lon);
  return validLat(lat) && validLon(lon) ? { lat, lon } : undefined;
}

/** Turn the user's entries into landmarks. Start and end follow the track, so they move when a different GPX is loaded. */
export function resolveCustom(items: CustomLandmark[], points: TrackPoint[]): Landmark[] {
  const out: Landmark[] = [];
  for (const c of items) {
    const name = c.name.trim();
    if (!name) continue;
    let pt: { lat: number; lon: number; ele?: number } | undefined;
    if (c.at === 'start') pt = points[0];
    else if (c.at === 'end') pt = points[points.length - 1];
    else if (c.at === 'high') pt = highPoint(points);
    else if (c.lat !== undefined && c.lon !== undefined && validLat(c.lat) && validLon(c.lon)) pt = { lat: c.lat, lon: c.lon };
    if (!pt) continue;
    out.push({ id: c.id, name, kind: 'waypoint', lat: pt.lat, lon: pt.lon, ele: pt.ele, custom: true });
  }
  return out;
}

/** The highest point of the track (by its GPX elevations), or undefined when it has none. */
export function highPoint(points: TrackPoint[]): TrackPoint | undefined {
  let best: TrackPoint | undefined;
  for (const q of points) if (q.ele !== undefined && (!best || q.ele > best.ele!)) best = q;
  return best;
}
