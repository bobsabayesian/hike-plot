import type { BBox } from '../geo/project';
import type { TrackPoint } from '../gpx/types';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A SunCalc page (suncalc.org) for the middle of the map, at the time the hike started, so the sun's direction and
 * height there can be read off and typed into the shading. Its address is
 * `#/lat,lon,zoom/yyyy.mm.dd/hh:mm/objectlevel/maptype`. The time is the hike's start in this browser's time zone;
 * without a GPX time it is today at noon.
 */
export function suncalcUrl(view: BBox, points: TrackPoint[], now = new Date()): string {
  const lat = (view.minLat + view.maxLat) / 2;
  const lon = (view.minLon + view.maxLon) / 2;
  const start = points.find((q) => q.time !== undefined)?.time;
  const d = start !== undefined ? new Date(start) : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0);
  const date = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `https://www.suncalc.org/#/${lat.toFixed(4)},${lon.toFixed(4)},12/${date}/${time}/1/3`;
}
