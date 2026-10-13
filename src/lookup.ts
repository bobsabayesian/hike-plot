import { bbox, haversine, type BBox } from './geo/project';
import type { TrackPoint } from './gpx/types';
import type { Feature } from './scene/project';
import { computeStats } from './geo/stats';

async function api<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `Request failed (${r.status})`);
  return r.json() as Promise<T>;
}

export async function geocodeFeature(q: string): Promise<Feature & { location: string }> {
  return api(`/api/geocode?q=${encodeURIComponent(q)}`);
}

/** Region name (e.g. "Pierce County, Washington") near the track's high point. */
export async function reverseLocation(pts: TrackPoint[]): Promise<string | undefined> {
  const at = computeStats(pts).peak ?? pts[0]!;
  return (await api<{ location: string }>(`/api/reverse?lat=${at.lat}&lon=${at.lon}`)).location || undefined;
}

/** Named OSM peak closest to the track's high point, if one is within `maxM`. */
export async function nearestPeakName(pts: TrackPoint[], maxM = 1500): Promise<string | undefined> {
  const high = computeStats(pts).peak;
  if (!high) return undefined;
  const b: BBox = bbox([high]);
  const pad = 0.02;
  const qs = new URLSearchParams({
    minLat: String(b.minLat - pad), maxLat: String(b.maxLat + pad),
    minLon: String(b.minLon - pad), maxLon: String(b.maxLon + pad),
  });
  const { peaks } = await api<{ peaks: { name: string; lat: number; lon: number }[] }>(`/api/peaks?${qs}`);
  let best: { name: string; d: number } | undefined;
  for (const pk of peaks) {
    const d = haversine(high.lat, high.lon, pk.lat, pk.lon);
    if (d <= maxM && (!best || d < best.d)) best = { name: pk.name, d };
  }
  return best?.name;
}
