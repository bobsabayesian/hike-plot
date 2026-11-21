/**
 * Little drawings a pen can do in a few strokes. Each is a set of polylines in its own units, y down, with the bottom of the
 * drawing at y = `h` (a tree's trunk, a tent's floor), so it can be set down at a point. One unit is the doodle size the user chooses.
 */
export type DoodleKind = 'pine' | 'tree' | 'tent' | 'mountain' | 'flag' | 'cairn' | 'bird' | 'cloud' | 'sun';
type Pt = [number, number];

export interface Glyph {
  kind: DoodleKind;
  label: string;
  /** width and height in units */
  w: number;
  h: number;
  strokes: Pt[][];
  /** where it belongs: on the ground, in the sky (3D view), or anywhere on a flat map */
  home: 'ground' | 'sky';
  /** how often it is picked among the kinds that are on */
  weight: number;
  /** may be turned the other way round (it has no writing and leans no particular way) */
  flips: boolean;
}

const TAU = Math.PI * 2;
/** points on an ellipse arc, angles in turns of a full circle (0 = right, 0.25 = down, since y points down) */
function arc(cx: number, cy: number, rx: number, ry: number, t0: number, t1: number, n = 14): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (t0 + ((t1 - t0) * i) / n) * TAU;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as Pt;
  });
}
/** an arc from a to b that bulges to the left of the way from a to b (seen with y down), by `k` times the distance between them */
function bump(a: Pt, b: Pt, k: number, n = 9): Pt[] {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const nx = dy / len, ny = -dx / len;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const o = Math.sin(Math.PI * t) * k * len;
    return [a[0] + dx * t + nx * o, a[1] + dy * t + ny * o] as Pt;
  });
}

export const GLYPHS: Glyph[] = [
  {
    kind: 'pine', label: 'Pine', w: 0.7, h: 1, home: 'ground', weight: 3, flips: true,
    strokes: [
      [[0.35, 0], [0.12, 0.34], [0.21, 0.34], [0.04, 0.64], [0.15, 0.64], [0, 0.88], [0.7, 0.88], [0.55, 0.64], [0.66, 0.64], [0.49, 0.34], [0.58, 0.34], [0.35, 0]],
      [[0.35, 0.88], [0.35, 1]],
    ],
  },
  {
    kind: 'tree', label: 'Round tree', w: 0.7, h: 1, home: 'ground', weight: 3, flips: true,
    strokes: [
      Array.from({ length: 21 }, (_, i) => { const a = (i / 20) * TAU; const r = 0.3 * (1 + 0.1 * Math.sin(a * 5)); return [0.35 + r * Math.cos(a), 0.34 + r * Math.sin(a)] as Pt; }),
      [[0.35, 0.66], [0.35, 1]],
      [[0.35, 0.82], [0.46, 0.72]],
    ],
  },
  {
    kind: 'tent', label: 'Tent', w: 1.1, h: 0.8, home: 'ground', weight: 1, flips: true,
    strokes: [
      [[0, 0.8], [0.55, 0], [1.1, 0.8], [0, 0.8]],
      [[0.55, 0.22], [0.42, 0.8]],
      [[0.55, 0.22], [0.68, 0.8]],
      [[0.55, 0], [0.55, -0.08]],
    ],
  },
  {
    kind: 'mountain', label: 'Mountain', w: 1.3, h: 0.95, home: 'ground', weight: 1.5, flips: true,
    strokes: [
      [[0, 0.95], [0.42, 0.1], [0.62, 0.42], [0.8, 0.26], [1.3, 0.95]],
      [[0.27, 0.36], [0.34, 0.27], [0.4, 0.37], [0.47, 0.27], [0.55, 0.36]],
      [[0.74, 0.52], [0.9, 0.78]],
      [[0.5, 0.55], [0.62, 0.8]],
    ],
  },
  {
    kind: 'flag', label: 'Flag', w: 0.7, h: 1, home: 'ground', weight: 1, flips: false,
    strokes: [
      [[0.06, 1], [0.06, 0]],
      [[0.06, 0], [0.68, 0.17], [0.06, 0.34]],
      arc(0.06, 1, 0.14, 0.05, 0.5, 1, 6),
    ],
  },
  {
    kind: 'cairn', label: 'Cairn', w: 0.6, h: 0.9, home: 'ground', weight: 1, flips: true,
    strokes: [
      arc(0.3, 0.74, 0.3, 0.16, 0, 1, 16),
      arc(0.3, 0.45, 0.21, 0.13, 0, 1, 14),
      arc(0.3, 0.2, 0.13, 0.1, 0, 1, 12),
    ],
  },
  {
    kind: 'bird', label: 'Bird', w: 1, h: 0.3, home: 'sky', weight: 2, flips: true,
    strokes: [[...arc(0.25, 0.28, 0.25, 0.26, 0.5, 1, 8), ...arc(0.75, 0.28, 0.25, 0.26, 0.5, 1, 8)]],
  },
  {
    kind: 'cloud', label: 'Cloud', w: 1.3, h: 0.6, home: 'sky', weight: 1.5, flips: true,
    strokes: [[
      [0.12, 0.6], ...bump([0.12, 0.6], [0.2, 0.3], 0.45).slice(1), ...bump([0.2, 0.3], [0.55, 0.14], 0.4).slice(1),
      ...bump([0.55, 0.14], [0.95, 0.26], 0.4).slice(1), ...bump([0.95, 0.26], [1.18, 0.6], 0.45).slice(1), [0.12, 0.6],
    ]],
  },
  {
    kind: 'sun', label: 'Sun', w: 1, h: 1, home: 'sky', weight: 0.6, flips: false,
    strokes: [
      arc(0.5, 0.5, 0.2, 0.2, 0, 1, 20),
      ...Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * TAU; return [[0.5 + 0.3 * Math.cos(a), 0.5 + 0.3 * Math.sin(a)], [0.5 + 0.48 * Math.cos(a), 0.5 + 0.48 * Math.sin(a)]] as Pt[]; }),
    ],
  },
];

export const GLYPH_BY_KIND: Record<DoodleKind, Glyph> = Object.fromEntries(GLYPHS.map((g) => [g.kind, g])) as Record<DoodleKind, Glyph>;
export const DOODLE_KINDS: DoodleKind[] = GLYPHS.map((g) => g.kind);
