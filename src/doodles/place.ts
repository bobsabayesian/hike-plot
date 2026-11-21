import type { Rect, XY } from '../geo/clip';
import { inside, type Halo } from '../features/halo';
import type { Box } from '../features/select';
import { GLYPH_BY_KIND, GLYPHS, type DoodleKind } from './glyphs';
import type { DoodleSettings } from './types';

/** One doodle set down on the poster: its box (centered on cx, cy), and how it is drawn. */
export interface Placed {
  kind: DoodleKind;
  cx: number;
  cy: number;
  /** mm per glyph unit */
  scale: number;
  flip: boolean;
  /** a slight lean, degrees */
  turnDeg: number;
  sky: boolean;
  w: number;
  h: number;
}

export interface PlaceOptions {
  settings: DoodleSettings;
  /** the map area on the page, mm */
  frame: Rect;
  /** the route as drawn on the page, to keep clear of */
  route: XY[];
  /** clear zones already taken (landmark labels) */
  halos: Halo[];
  /** boxes to keep out of (north arrow, a corner profile) */
  obstacles: Box[];
  /**
   * Where a point of the flat map stands on the page, or undefined if it cannot be used (out of the frame, hidden behind a hill).
   * On a flat map this is the point itself.
   */
  ground(x: number, y: number): XY | undefined;
  /**
   * In the 3D view: is this circle of the page free of terrain, so it is sky? Undefined on a flat map, where anything may go anywhere.
   */
  sky?: (cx: number, cy: number, r: number) => boolean;
}

/** Most doodles a poster gets, whatever its size. */
const MAX_DOODLES = 60;
/** Area of the map (mm²) per doodle at full density and the usual size. */
const AREA_PER_DOODLE = 3500;
const USUAL_SIZE_MM = 9;

/** A steady random number generator: the same seed always scatters the doodles the same way. */
export function mulberry32(seed: number): () => number {
  let a = (seed ^ 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const distToPolyline = (p: XY, line: XY[]): number => {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1]!, [bx, by] = line[i]!;
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2)) : 0;
    const d = Math.hypot(ax + t * dx - p[0], ay + t * dy - p[1]);
    if (d < best) best = d;
  }
  return best;
};

/** How many doodles a poster of this size and these settings gets. */
export function doodleCount(frame: Rect, s: DoodleSettings): number {
  if (!s.enabled || s.density <= 0) return 0;
  const bySize = Math.min(2, USUAL_SIZE_MM / Math.max(3, s.sizeMm));
  return Math.min(MAX_DOODLES, Math.round(((s.density / 100) * frame.w * frame.h * bySize) / AREA_PER_DOODLE));
}

const corners = (cx: number, cy: number, w: number, h: number): XY[] => [[cx, cy], [cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx - w / 2, cy + h / 2], [cx + w / 2, cy + h / 2]];

/**
 * Scatter doodles over the map where there is room: not on the route, not on a label, not on each other, inside the map; trees in
 * groves, birds in flocks. On the ground in 3D they stand on visible terrain, and in the sky they sit where there is no terrain.
 */
export function placeDoodles(o: PlaceOptions): Placed[] {
  const s = o.settings;
  const target = doodleCount(o.frame, s);
  const kinds = GLYPHS.filter((g) => s.kinds[g.kind]);
  if (!target || !kinds.length) return [];
  const rnd = mulberry32(s.seed);
  const items: Placed[] = [];
  const f = o.frame;
  const gap = Math.max(1, s.clearMm) + 0.8;
  const in3d = !!o.sky;

  const free = (cx: number, cy: number, w: number, h: number, apart: number, ignore?: Placed): boolean => {
    if (cx - w / 2 < f.x + gap || cx + w / 2 > f.x + f.w - gap || cy - h / 2 < f.y + gap || cy + h / 2 > f.y + f.h - gap) return false;
    for (const q of items) {
      if (q === ignore) continue;
      if (Math.abs(cx - q.cx) < (w + q.w) / 2 + apart && Math.abs(cy - q.cy) < (h + q.h) / 2 + apart) return false;
    }
    const pts = corners(cx, cy, w, h);
    for (const hl of o.halos) for (const p of pts) if (inside(p, { box: hl.box, r: hl.r + s.clearMm })) return false;
    for (const b of o.obstacles) if (Math.abs(cx - b.cx) < (w + b.w) / 2 + gap && Math.abs(cy - b.cy) < (h + b.h) / 2 + gap) return false;
    if (o.route.length > 1 && Math.min(...pts.map((p) => distToPolyline(p, o.route))) < gap + 0.4) return false;
    // the route may pass between the corners of a big doodle: check along its middle too
    if (o.route.length > 1 && distToPolyline([cx, cy], o.route) < Math.max(w, h) * 0.45 + gap) return false;
    return true;
  };

  /** try one doodle of a kind at a chosen place; returns it if it fits */
  const tryAt = (kind: DoodleKind, x: number, y: number, scaleMul: number, apart: number): Placed | undefined => {
    const g = GLYPH_BY_KIND[kind];
    const scale = s.sizeMm * scaleMul * (kind === 'bird' ? 0.7 : 1);
    const w = g.w * scale, h = g.h * scale;
    const sky = g.home === 'sky' && in3d;
    let cx: number, cy: number;
    if (g.home === 'ground' || !in3d) {
      const at = o.ground(x, y);
      if (!at) return undefined;
      cx = at[0];
      cy = g.home === 'ground' ? at[1] - h / 2 : at[1];
    } else {
      cx = x; cy = y;
      if (!o.sky!(cx, cy, Math.max(w, h) * 0.6 + gap)) return undefined;
    }
    if (!free(cx, cy, w, h, apart)) return undefined;
    return { kind, cx, cy, scale, flip: g.flips && rnd() < 0.5, turnDeg: g.home === 'ground' ? (rnd() - 0.5) * 8 : (rnd() - 0.5) * 12, sky, w, h };
  };

  let suns = 0;
  /** the next kind to try, or undefined when nothing is left to place (only the sun is on, and it is already there) */
  const pick = (): DoodleKind | undefined => {
    const pool = kinds.filter((g) => g.kind !== 'sun' || suns < 1);
    if (!pool.length) return undefined;
    let r = rnd() * pool.reduce((a, g) => a + g.weight, 0);
    for (const g of pool) { r -= g.weight; if (r <= 0) return g.kind; }
    return pool[pool.length - 1]!.kind;
  };

  for (let tries = 0; tries < target * 80 && items.length < target; tries++) {
    const kind = pick();
    if (!kind) break;
    const g = GLYPH_BY_KIND[kind];
    const x = f.x + rnd() * f.w;
    // sky things hug the top of the picture, where the sky is
    const y = g.home === 'sky' && in3d ? f.y + rnd() * rnd() * f.h * 0.8 : f.y + rnd() * f.h;
    const placed = tryAt(kind, x, y, 0.8 + rnd() * 0.45, gap);
    if (!placed) continue;
    items.push(placed);
    if (kind === 'sun') suns++;
    // company: trees come in groves, birds in flocks
    const company = kind === 'pine' || kind === 'tree' ? 1 + Math.floor(rnd() * 3) : kind === 'bird' ? 1 + Math.floor(rnd() * 3) : 0;
    for (let c = 0; c < company && items.length < MAX_DOODLES; c++) {
      for (let a = 0; a < 8; a++) {
        const dx = (rnd() < 0.5 ? -1 : 1) * (0.45 + rnd() * 0.5) * placed.w * (kind === 'bird' ? 1.8 : 1.15);
        const dy = (rnd() - 0.5) * placed.h * (kind === 'bird' ? 1.4 : 0.5);
        const mate = tryAt(kind === 'tree' || kind === 'pine' ? (rnd() < 0.7 ? kind : kind === 'tree' ? 'pine' : 'tree') : kind, kind === 'bird' ? placed.cx + dx : x + dx, kind === 'bird' ? placed.cy + dy : y + dy, 0.6 + rnd() * 0.4, 0.3);
        if (mate) { items.push(mate); break; }
      }
    }
  }
  return items;
}

/** The strokes of a doodle as page polylines. */
export function doodleLines(it: Placed): XY[][] {
  const g = GLYPH_BY_KIND[it.kind];
  const a = (it.turnDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return g.strokes.map((st) => st.map(([gx, gy]) => {
    const lx = ((it.flip ? g.w - gx : gx) - g.w / 2) * it.scale;
    const ly = (gy - g.h / 2) * it.scale;
    return [+(it.cx + lx * c - ly * s).toFixed(3), +(it.cy + lx * s + ly * c).toFixed(3)] as XY;
  }));
}

/** The clear zone each doodle takes: its box, with `clearMm` all round. */
export const doodleHalos = (items: Placed[], clearMm: number): Halo[] => items.map((it) => ({ box: { cx: it.cx, cy: it.cy, w: it.w, h: it.h, ang: 0 }, r: clearMm }));
