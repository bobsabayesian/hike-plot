import type { XY } from '../geo/clip';
import { flattenPath } from '../export/offset';
import { layerOfPart, LAYER_IDS, type LayerId } from './layers';
import type { PathPrim, Prim } from './types';

/** How hand-drawn the lines look: a steady wander added to them, as if drawn freehand. */
export interface HandSettings {
  /** 0 (off) to 100 (wobbly) */
  amount: number;
  /** another number draws the same lines with a different wander */
  seed: number;
  /** 0 (off) to 100: a second, slightly shifted pass over the same lines, like a sketch gone over twice */
  sketch: number;
  /** the layers whose lines wander */
  layers: LayerId[];
}

export const HAND_LAYERS_DEFAULT: LayerId[] = ['terrain', 'water', 'route', 'border', 'profile', 'north', 'doodles'];
export const defaultHand = (): HandSettings => ({ amount: 0, seed: 1, sketch: 0, layers: [...HAND_LAYERS_DEFAULT] });

/** Largest sideways wander, mm, at amount 100. */
const MAX_WANDER_MM = 0.5;
/** Distance along a line over which the wander changes direction, mm. */
const WAVELENGTH_MM = 7;
/** Spacing of the points the lines are redrawn with, mm. */
const STEP_MM = 0.8;
/** Lines shorter than this wander less, so a tiny mark is not turned into a blob, mm. */
const FULL_AT_MM = 25;

export function normalizeHand(raw: unknown): HandSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<HandSettings>;
  const layers = Array.isArray(r.layers) ? [...new Set(r.layers.filter((l): l is LayerId => (LAYER_IDS as string[]).includes(l)))] : [...HAND_LAYERS_DEFAULT];
  return {
    amount: typeof r.amount === 'number' && Number.isFinite(r.amount) ? Math.min(100, Math.max(0, r.amount)) : 0,
    seed: typeof r.seed === 'number' && Number.isFinite(r.seed) ? Math.floor(r.seed) : 1,
    sketch: typeof r.sketch === 'number' && Number.isFinite(r.sketch) ? Math.min(100, Math.max(0, r.sketch)) : 0,
    layers,
  };
}

/** A repeatable pseudo-random number in [0, 1) for three integers. */
function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth noise in [-1, 1] along a line: random values at whole steps, joined with an ease. */
function noise(t: number, seed: number, channel: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  const a = hash(i, seed, channel) * 2 - 1;
  const b = hash(i + 1, seed, channel) * 2 - 1;
  return a + (b - a) * u;
}

const fmt = (n: number) => +n.toFixed(3);

/** One polyline, redrawn with a wander. Closed shapes join up again where they began. */
export function wobbleLine(pts: XY[], closed: boolean, amount: number, seed: number): XY[] {
  if (pts.length < 2 || !(amount > 0)) return pts;
  // the line resampled to even steps along its length
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  const total = cum[cum.length - 1]!;
  if (total < 0.5) return pts;
  const n = Math.max(2, Math.ceil(total / STEP_MM));
  const amp = (amount / 100) * MAX_WANDER_MM * Math.min(1, total / FULL_AT_MM);
  const out: XY[] = [];
  let seg = 1;
  for (let k = 0; k <= n; k++) {
    const s = (total * k) / n;
    while (seg < cum.length - 1 && cum[seg]! < s) seg++;
    const span = cum[seg]! - cum[seg - 1]!;
    const t = span > 0 ? (s - cum[seg - 1]!) / span : 0;
    const x = pts[seg - 1]![0] + (pts[seg]![0] - pts[seg - 1]![0]) * t;
    const y = pts[seg - 1]![1] + (pts[seg]![1] - pts[seg - 1]![1]) * t;
    out.push([x, y]);
  }
  const wander = (s: number, k: number): [number, number] => [noise(s / WAVELENGTH_MM, seed, 1) * amp, noise(s / WAVELENGTH_MM, seed, 2) * amp];
  const off = out.map((_, k) => wander((total * k) / n, k));
  if (closed) {
    // a closed shape must meet itself: take out the drift between the first and the last offset
    const [dx, dy] = [off[n]![0] - off[0]![0], off[n]![1] - off[0]![1]];
    for (let k = 0; k <= n; k++) { off[k]![0] -= (dx * k) / n; off[k]![1] -= (dy * k) / n; }
  }
  return out.map(([x, y], k) => [fmt(x + off[k]![0]), fmt(y + off[k]![1])] as XY);
}

/** The path data of a prim, with its lines wandering. Dashes, colour, pen and weight are kept; text is left alone. */
export function wobblePath(p: PathPrim, amount: number, seed: number, shift: XY = [0, 0]): PathPrim {
  const subs = flattenPath(p.d);
  if (!subs.length) return p;
  const parts = subs.map((s, i) => {
    const first = s.pts[0]!;
    // each line wanders its own way: its start (not its place in the list) sets its noise, so edits elsewhere do not shift it
    const own = Math.floor(first[0] * 7 + first[1] * 13) ^ (i * 977) ^ seed;
    const pts = wobbleLine(s.pts as XY[], s.closed, amount, own);
    return pts.map((q, k) => `${k ? 'L' : 'M'}${fmt(q[0] + shift[0])} ${fmt(q[1] + shift[1])}`).join('') + (s.closed ? 'Z' : '');
  });
  return { ...p, d: parts.join('') };
}

/** Largest sideways shift of the second pass, mm, at sketch 100. */
const MAX_SKETCH_MM = 0.7;

/**
 * The scene's lines, with those of the chosen layers wandering and, if asked, gone over a second time: the same line again, drawn
 * with its own wander and a little to one side. Fills and text are left alone.
 */
export function applyHand(prims: Prim[], hand: HandSettings): Prim[] {
  const sketch = hand.sketch > 0;
  if ((!(hand.amount > 0) && !sketch) || !hand.layers.length) return prims;
  const on = new Set<LayerId>(hand.layers);
  const angle = hash(hand.seed, 5, 5) * Math.PI * 2;
  const shift: XY = [Math.cos(angle) * (hand.sketch / 100) * MAX_SKETCH_MM, Math.sin(angle) * (hand.sketch / 100) * MAX_SKETCH_MM];
  return prims.flatMap((p): Prim[] => {
    if (p.kind !== 'path') return [p];
    const l = layerOfPart(p.part);
    if (!l || !on.has(l)) return [p];
    const first = hand.amount > 0 ? wobblePath(p, hand.amount, hand.seed) : p;
    if (!sketch || p.mode !== 'stroke') return [first];
    return [first, wobblePath(p, Math.max(hand.amount, 30), hand.seed + 7919, shift)];
  });
}
