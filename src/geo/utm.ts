/**
 * Universal Transverse Mercator (WGS 84) and the Military Grid Reference System built on it: the zone, its latitude
 * band, and the two letters naming each 100 km square. Forward and inverse use the USGS series (Snyder, "Map
 * Projections: A Working Manual", 1987), good to well under a meter inside a zone and its usual overlap.
 */

const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;
const FALSE_E = 500000;
const FALSE_N_SOUTH = 10000000;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** meridian arc length from the equator, meters */
function arc(phi: number): number {
  const e4 = E2 * E2, e6 = e4 * E2;
  return A * ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi
    - ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi)
    + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi)
    - ((35 * e6) / 3072) * Math.sin(6 * phi));
}

/** central meridian of a zone, degrees */
export const zoneMeridian = (zone: number) => (zone - 1) * 6 - 180 + 3;

/** The UTM zone a point belongs to, with the Norway and Svalbard exceptions. */
export function utmZone(lat: number, lon: number): number {
  const l = ((((lon + 180) % 360) + 360) % 360) - 180;
  let z = Math.floor((l + 180) / 6) + 1;
  if (z > 60) z = 60;
  if (lat >= 56 && lat < 64 && l >= 3 && l < 12) z = 32;
  if (lat >= 72 && lat < 84) {
    if (l >= 0 && l < 9) z = 31;
    else if (l >= 9 && l < 21) z = 33;
    else if (l >= 21 && l < 33) z = 35;
    else if (l >= 33 && l < 42) z = 37;
  }
  return z;
}

const BANDS = 'CDEFGHJKLMNPQRSTUVWX';
/** The MGRS latitude band letter (C to X, 8 degrees each; X is 12). */
export function latBand(lat: number): string {
  const i = Math.floor((Math.min(83.99, Math.max(-80, lat)) + 80) / 8);
  return BANDS[Math.min(BANDS.length - 1, i)]!;
}

export interface Utm { zone: number; south: boolean; easting: number; northing: number }

/** Latitude/longitude to UTM, in a given zone (by default the point's own) and hemisphere (by default its own). */
export function toUtm(lat: number, lon: number, zone = utmZone(lat, lon), south = lat < 0): Utm {
  const phi = rad(lat);
  const s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  const n = A / Math.sqrt(1 - E2 * s * s);
  const T = t * t;
  const C = EP2 * c * c;
  let dl = lon - zoneMeridian(zone);
  dl = ((((dl + 180) % 360) + 360) % 360) - 180;
  const a = c * rad(dl);
  const a2 = a * a;
  const easting = FALSE_E + K0 * n * (a + ((1 - T + C) * a2 * a) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * a2 * a2 * a) / 120);
  const northing = K0 * (arc(phi) + n * t * (a2 / 2 + ((5 - T + 9 * C + 4 * C * C) * a2 * a2) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * a2 * a2 * a2) / 720))
    + (south ? FALSE_N_SOUTH : 0);
  return { zone, south, easting, northing };
}

/** UTM back to latitude/longitude, degrees. */
export function fromUtm(zone: number, south: boolean, easting: number, northing: number): [number, number] {
  const m = (northing - (south ? FALSE_N_SOUTH : 0)) / K0;
  const e4 = E2 * E2, e6 = e4 * E2;
  const mu = m / (A * (1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu)
    + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const s = Math.sin(phi1), c = Math.cos(phi1), t = Math.tan(phi1);
  const C1 = EP2 * c * c;
  const T1 = t * t;
  const n1 = A / Math.sqrt(1 - E2 * s * s);
  const r1 = (A * (1 - E2)) / (1 - E2 * s * s) ** 1.5;
  const d = (easting - FALSE_E) / (n1 * K0);
  const d2 = d * d;
  const phi = phi1 - ((n1 * t) / r1) * (d2 / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * d2 * d2) / 24
    + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * d2 * d2 * d2) / 720);
  const lon = zoneMeridian(zone) + deg((d - ((1 + 2 * T1 + C1) * d2 * d) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * d2 * d2 * d) / 120) / c);
  return [deg(phi), lon];
}

const COLS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const ROWS = 'ABCDEFGHJKLMNPQRSTUV';

/** The two letters naming the 100 km square that holds a UTM position (column, then row). */
export function squareId(zone: number, easting: number, northing: number): string {
  const set = ((zone - 1) % 6) + 1;
  const cols = COLS[(set - 1) % 3]!;
  const col = cols[Math.max(0, Math.min(7, Math.floor(easting / 100000) - 1))]!;
  const offset = set % 2 === 0 ? 5 : 0;
  const row = ROWS[(((Math.floor(northing / 100000) + offset) % 20) + 20) % 20]!;
  return col + row;
}

/** The grid zone designation, e.g. "10T". */
export const gridZone = (lat: number, lon: number) => `${utmZone(lat, lon)}${latBand(lat)}`;

/** A full MGRS reference at the given precision (5 digits = 1 m), e.g. "10T ES 94360 89090". */
export function toMgrs(lat: number, lon: number, digits = 5): string {
  const u = toUtm(lat, lon);
  const k = 10 ** (5 - digits);
  const e = String(Math.floor((u.easting % 100000) / k)).padStart(digits, '0');
  const n = String(Math.floor((u.northing % 100000) / k)).padStart(digits, '0');
  return `${u.zone}${latBand(lat)} ${squareId(u.zone, u.easting, u.northing)} ${e} ${n}`;
}
