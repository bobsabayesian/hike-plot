import { haversine } from './project';
import type { TrackPoint } from '../gpx/types';

/** Timestamps implying more than this average speed (125 mph) are treated as bogus. */
export const MAX_PLAUSIBLE_SPEED_MPS = 125 * 0.44704;

export interface TrackStats {
  distanceM: number;
  /** smoothed cumulative ascent, meters */
  gainM: number;
  minEleM?: number;
  maxEleM?: number;
  /** max minus min elevation, meters */
  reliefM?: number;
  peak?: TrackPoint;
  startTime?: number;
  durationMs?: number;
}

export function distanceM(pts: TrackPoint[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    d += haversine(pts[i - 1]!.lat, pts[i - 1]!.lon, pts[i]!.lat, pts[i]!.lon);
  }
  return d;
}

/** Cumulative ascent with hysteresis so GPS noise doesn't accumulate. */
export function elevationGain(pts: TrackPoint[], thresholdM = 3): number {
  let gain = 0;
  let ref: number | undefined;
  for (const p of pts) {
    if (p.ele === undefined) continue;
    if (ref === undefined) ref = p.ele;
    else if (p.ele - ref >= thresholdM) {
      gain += p.ele - ref;
      ref = p.ele;
    } else if (ref - p.ele >= thresholdM) ref = p.ele;
  }
  return gain;
}

export function computeStats(pts: TrackPoint[]): TrackStats {
  let peak: TrackPoint | undefined;
  let min = Infinity;
  for (const p of pts) {
    if (p.ele === undefined) continue;
    if (!peak || p.ele > peak.ele!) peak = p;
    min = Math.min(min, p.ele);
  }
  const dist = distanceM(pts);
  const dur = duration(pts);
  const plausible = dur !== undefined && dist / (dur / 1000) <= MAX_PLAUSIBLE_SPEED_MPS;
  return {
    distanceM: dist,
    gainM: elevationGain(pts),
    minEleM: peak ? min : undefined,
    maxEleM: peak?.ele,
    reliefM: peak ? peak.ele! - min : undefined,
    peak,
    startTime: pts.find((p) => p.time !== undefined)?.time,
    durationMs: plausible ? dur : undefined,
  };
}

export const metersToMiles = (m: number) => m / 1609.344;
export const metersToFeet = (m: number) => m * 3.280839895;
export const formatMiles = (m: number) => `${metersToMiles(m).toFixed(1)} mi`;
export const formatFeet = (m: number) => `${Math.round(metersToFeet(m)).toLocaleString('en-US')} ft`;
export const formatKm = (m: number) => `${(m / 1000).toFixed(1)} km`;
export const formatMeters = (m: number) => `${Math.round(m).toLocaleString('en-US')} m`;

function duration(pts: TrackPoint[]): number | undefined {
  const first = pts.find((p) => p.time !== undefined)?.time;
  const last = [...pts].reverse().find((p) => p.time !== undefined)?.time;
  return first !== undefined && last !== undefined && last > first ? last - first : undefined;
}

export function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  return mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} m` : `${mins} m`;
}

export function formatCoords(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
}

// --- the playful numbers: the same walk, measured in things you can picture ---
export const EIFFEL_TOWER_M = 330;
export const EVEREST_M = 8849;
/** an American football field, goal line to goal line */
export const FOOTBALL_FIELD_M = 91.44;
export const BANANA_M = 0.18;
/** a hiker's stride */
export const STEP_M = 0.75;

const round = (n: number, step: number) => Math.round(n / step) * step;
const group = (n: number) => Math.round(n).toLocaleString('en-US');
const one = (n: number) => (n < 10 ? n.toFixed(1) : group(n));

/** "2.8 Eiffel Towers" of climbing (or 1.0 Eiffel Tower) */
export function formatTowers(gainM: number): string {
  const n = gainM / EIFFEL_TOWER_M;
  return `${n.toFixed(1)} Eiffel Tower${n.toFixed(1) === '1.0' ? '' : 's'}`;
}
/** about how many steps the distance is, to the nearest hundred (or fewer, for a short walk) */
export const formatSteps = (distM: number): string => group(distM / STEP_M >= 1000 ? round(distM / STEP_M, 100) : round(distM / STEP_M, 10));
export const formatFields = (distM: number): string => one(distM / FOOTBALL_FIELD_M);
export const formatBananas = (distM: number): string => group(distM / BANANA_M >= 10000 ? round(distM / BANANA_M, 100) : distM / BANANA_M);
export const formatEverests = (gainM: number): string => { const n = gainM / EVEREST_M; return n < 1 ? n.toFixed(2) : n.toFixed(1); };
