import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { clipPolyline, simplifyXY, type XY } from '../geo/clip';
import type { BBox } from '../geo/project';
import type { Landmark, WaterLine, WaterName } from '../features/types';
import { TILE_CLASSES, type CoverShape } from '../cover/types';

/**
 * Map features from OpenFreeMap's OpenMapTiles vector tiles: peaks, saddles, viewpoints, shelters, rivers, lakes.
 * Tiles are static files, so this is fast and does not depend on a query server. Fetch them from the user's own
 * browser (the service's terms rule out automated collection), at most four at once, and keep the count modest.
 */
export const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
export const MAX_ZOOM = 14;
export const MIN_ZOOM = 8;
/** Most tiles one view may take; a bigger area is fetched at a lower zoom instead. */
export const MAX_TILES = 150;
export const CONCURRENCY = 4;
/** Lakes smaller than this are left out of the outlines (ponds would only add clutter). */
export const MIN_WATER_AREA_M2 = 20_000;

export interface TileCoord { z: number; x: number; y: number }
export interface DecodedTile { landmarks: Landmark[]; water: WaterLine[]; waterNames: WaterName[]; cover: CoverShape[] }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const tileX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const tileY = (lat: number, z: number) => {
  const s = Math.sin((clamp(lat, -85.05, 85.05) * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z;
};
const lonAt = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const latAt = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

/** The tiles that cover a bounding box at one zoom. */
export function tilesFor(b: BBox, z: number): TileCoord[] {
  const n = 2 ** z;
  const x0 = clamp(Math.floor(tileX(b.minLon, z)), 0, n - 1);
  const x1 = clamp(Math.floor(tileX(b.maxLon, z)), 0, n - 1);
  const y0 = clamp(Math.floor(tileY(b.maxLat, z)), 0, n - 1);
  const y1 = clamp(Math.floor(tileY(b.minLat, z)), 0, n - 1);
  const out: TileCoord[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ z, x, y });
  return out;
}

/** The sharpest zoom whose tile count for this area stays within the budget. */
export function pickZoom(b: BBox, maxTiles = MAX_TILES): number {
  for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) if (tilesFor(b, z).length <= maxTiles) return z;
  return MIN_ZOOM;
}

/** The area a set of tiles covers. */
export function tilesBBox(tiles: TileCoord[]): BBox {
  const z = tiles[0]!.z;
  const xs = tiles.map((t) => t.x);
  const ys = tiles.map((t) => t.y);
  return {
    minLat: latAt(Math.max(...ys) + 1, z), maxLat: latAt(Math.min(...ys), z),
    minLon: lonAt(Math.min(...xs), z), maxLon: lonAt(Math.max(...xs) + 1, z),
  };
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Turn one tile's bytes into landmarks, water lines and lake names. Each feature belongs to the tile it lies in. */
export function decodeTile(bytes: Uint8Array, z: number, tx: number, ty: number): DecodedTile {
  const vt = new VectorTile(new PbfReader(bytes));
  const landmarks: Landmark[] = [];
  const water: WaterLine[] = [];
  const waterNames: WaterName[] = [];
  const cover: CoverShape[] = [];
  const tag = `${z}-${tx}-${ty}`;

  for (const [layerName, layer] of Object.entries(vt.layers)) {
    const ext = layer.extent;
    const inside = (x: number, y: number) => x >= 0 && x < ext && y >= 0 && y < ext;
    const toLL = (x: number, y: number): [number, number] => [latAt(ty + y / ext, z), lonAt(tx + x / ext, z)];
    const rect = { x: 0, y: 0, w: ext, h: ext };
    // Lines and shorelines are cut to the tile's own square: the tiles carry a margin that neighbors also draw,
    // and without this a line would be doubled and lake outlines would show straight edges along tile borders.
    const pieces = (pts: { x: number; y: number }[]) => clipPolyline(pts.map((p): XY => [p.x, p.y]), rect);
    const metersPerUnit = (40075016.686 * Math.cos((latAt(ty + 0.5, z) * Math.PI) / 180)) / (2 ** z * ext);

    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      const p = f.properties;
      const name = text(p.name);

      if (layerName === 'mountain_peak' && name) {
        const cls = text(p.class);
        const kind = cls === 'peak' || cls === 'volcano' ? 'peak' : cls === 'saddle' ? 'pass' : undefined;
        const pt = f.loadGeometry()[0]?.[0];
        if (!kind || !pt || !inside(pt.x, pt.y)) continue;
        const [lat, lon] = toLL(pt.x, pt.y);
        const ele = Number(p.ele);
        landmarks.push({ id: `t:${kind}:${name}:${lat.toFixed(4)},${lon.toFixed(4)}`, name, kind, lat, lon, ...(Number.isFinite(ele) && p.ele !== '' ? { ele } : {}) });
      } else if (layerName === 'poi' && name) {
        const sub = text(p.subclass);
        const cls = text(p.class);
        const kind = sub === 'viewpoint' ? 'viewpoint' : sub === 'alpine_hut' || sub === 'wilderness_hut' || sub === 'shelter' || cls === 'shelter' ? 'hut' : undefined;
        const pt = f.loadGeometry()[0]?.[0];
        if (!kind || !pt || !inside(pt.x, pt.y)) continue;
        const [lat, lon] = toLL(pt.x, pt.y);
        landmarks.push({ id: `t:${kind}:${name}:${lat.toFixed(4)},${lon.toFixed(4)}`, name, kind, lat, lon });
      } else if (layerName === 'water_name' && name) {
        const cls = text(p.class);
        const pt = f.loadGeometry()[0]?.[0];
        // Lake labels are placed anywhere in the tile's wide margin, even a whole tile away, and the same lake
        // shows up in several tiles with shifted coordinates. So there is no owner tile: accept them all, and
        // loadVectorFeatures keeps one per name. Whether a name is in view is decided later.
        if (cls === 'ocean' || cls === 'sea' || cls === 'river' || !pt) continue;
        const [lat, lon] = toLL(pt.x, pt.y);
        waterNames.push({ id: `t:wn:${name}:${lat.toFixed(4)},${lon.toFixed(4)}`, name, lat, lon });
      } else if (layerName === 'waterway' && name) {
        const cls = text(p.class);
        if (cls !== 'river' && cls !== 'stream') continue;
        f.loadGeometry().forEach((line, k) => {
          pieces(line).forEach((piece, j) => {
            if (piece.length >= 2) water.push({ id: `t:ww:${name}:${tag}:${i}.${k}.${j}`, kind: 'river', name, coords: piece.map(([x, y]) => toLL(x, y)) });
          });
        });
      } else if (layerName === 'landcover') {
        // areas overlap the tile's margin and the neighbors' copies; they are filled as a union later, so that is harmless
        const cls = TILE_CLASSES[text(p.subclass)] ?? TILE_CLASSES[text(p.class)];
        if (!cls) continue;
        const rings = f.loadGeometry()
          .map((ring) => simplifyXY(ring.map((q): XY => [q.x, q.y]), ext / 2048))
          .filter((ring) => ring.length >= 3)
          .map((ring) => ring.map(([x, y]) => toLL(x, y)));
        if (rings.length) cover.push({ cls, rings });
      } else if (layerName === 'water') {
        if (text(p.class) === 'swimming_pool') continue;
        f.loadGeometry().forEach((ring, k) => {
          let area = 0;
          for (let a = 0; a < ring.length; a++) { const b = ring[(a + 1) % ring.length]!; area += ring[a]!.x * b.y - b.x * ring[a]!.y; }
          if ((Math.abs(area) / 2) * metersPerUnit * metersPerUnit < MIN_WATER_AREA_M2) return;
          const closed = ring.length && (ring[0]!.x !== ring[ring.length - 1]!.x || ring[0]!.y !== ring[ring.length - 1]!.y) ? [...ring, ring[0]!] : ring;
          pieces(closed).forEach((piece, j) => {
            if (piece.length >= 2) water.push({ id: `t:lake:${tag}:${i}.${k}.${j}`, kind: 'lake', coords: piece.map(([x, y]) => toLL(x, y)) });
          });
        });
      }
    }
  }
  return { landmarks, water, waterNames, cover };
}

type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer>; json(): Promise<unknown> }>;

let template: { url: string; at: number } | undefined;
const TEMPLATE_TTL_MS = 3_600_000;

/** The current tile address. It carries the build date, which changes weekly, so it is read from the TileJSON. */
export async function tileTemplate(f: Fetcher = fetch as Fetcher, signal?: AbortSignal): Promise<string> {
  if (template && Date.now() - template.at < TEMPLATE_TTL_MS) return template.url;
  const r = await f(TILEJSON_URL, { signal });
  if (!r.ok) throw new Error(`Map tile service answered ${r.status}`);
  const url = ((await r.json()) as { tiles?: unknown[] }).tiles?.[0];
  if (typeof url !== 'string' || !/\{z\}.*\{x\}.*\{y\}/.test(url)) throw new Error('Map tile service gave an unexpected answer');
  template = { url, at: Date.now() };
  return url;
}

/** Forget what was cached (for tests). */
export function resetVectorCache() {
  template = undefined;
  cache.clear();
}

const cache = new Map<string, Promise<DecodedTile>>();
const CACHE_MAX = 2500;

function getTile(url: string, c: TileCoord, f: Fetcher, signal?: AbortSignal): Promise<DecodedTile> {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = (async () => {
    let last = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await f(url, { signal });
      if (r.ok) return decodeTile(new Uint8Array(await r.arrayBuffer()), c.z, c.x, c.y);
      if (r.status === 404 || r.status === 204) return { landmarks: [], water: [], waterNames: [], cover: [] }; // an empty tile
      last = r.status;
    }
    throw new Error(`Map tile ${c.z}/${c.x}/${c.y} failed (${last})`);
  })();
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return p;
}

/** Run `job` over `items`, at most `limit` at a time. */
async function pool<T, R>(items: T[], limit: number, job: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await job(items[i]!); }
  }));
  return out;
}

export interface VectorResult {
  landmarks: Landmark[];
  water: WaterLine[];
  waterNames: WaterName[];
  /** forests, rock, ice and so on */
  cover: CoverShape[];
  /** the area the tiles cover (at least the area asked for) */
  covers: BBox;
  zoom: number;
  tiles: number;
  /** at the sharpest zoom the small features (viewpoints, shelters, small lakes) are all there */
  complete: boolean;
}

export interface VectorOptions {
  fetch?: Fetcher;
  signal?: AbortSignal;
  maxTiles?: number;
}

/** Peaks, saddles, viewpoints, shelters, rivers, lakes and lake names for an area, from the vector tiles. */
export async function loadVectorFeatures(b: BBox, opts: VectorOptions = {}): Promise<VectorResult> {
  const f = opts.fetch ?? (fetch as Fetcher);
  const zoom = pickZoom(b, opts.maxTiles ?? MAX_TILES);
  const tiles = tilesFor(b, zoom);
  const tpl = await tileTemplate(f, opts.signal);
  const decoded = await pool(tiles, CONCURRENCY, (t) =>
    getTile(tpl.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y)), t, f, opts.signal));
  const landmarks = new Map<string, Landmark>();
  const names = new Map<string, WaterName>();
  const water: WaterLine[] = [];
  const cover: CoverShape[] = [];
  for (const d of decoded) {
    cover.push(...d.cover);
    for (const l of d.landmarks) landmarks.set(l.id, l);
    for (const n of d.waterNames) if (!names.has(n.name.toLowerCase())) names.set(n.name.toLowerCase(), n);
    water.push(...d.water);
  }
  return { landmarks: [...landmarks.values()], water, waterNames: [...names.values()], cover, covers: tilesBBox(tiles), zoom, tiles: tiles.length, complete: zoom >= MAX_ZOOM };
}
