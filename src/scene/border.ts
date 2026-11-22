import type { Margins } from './project';
import type { PathPrim } from './types';

/** single and double rules, a postage-stamp edge, a twisted rope, and a single rule with ornate corners */
export type BorderStyle = 'single' | 'double' | 'stamp' | 'rope' | 'ornate';
export const BORDER_STYLES: { id: BorderStyle; label: string }[] = [
  { id: 'single', label: 'Single line' }, { id: 'double', label: 'Double line' }, { id: 'stamp', label: 'Postage stamp' },
  { id: 'rope', label: 'Rope' }, { id: 'ornate', label: 'Ornate corners' },
];
/** How far each style reaches, in units of its size (the "gap" setting): outside its center line and inside it */
const REACH: Record<BorderStyle, { outer: number; depth: number }> = {
  single: { outer: 0, depth: 0 }, double: { outer: 0, depth: 1 }, stamp: { outer: 0, depth: 0.45 }, rope: { outer: 0.5, depth: 0.5 }, ornate: { outer: 0, depth: 2.4 },
};

export interface BorderSettings {
  enabled: boolean;
  style: BorderStyle;
  /** paper edge to the outer line, mm */
  offsetMm: number;
  /** between the two lines of a double border, mm */
  gapMm: number;
  weightMm: number;
  pen: string;
}

export const defaultBorder = (pen: string): BorderSettings => ({ enabled: false, style: 'single', offsetMm: 12, gapMm: 2.5, weightMm: 0.5, pen });

/** Space kept clear between the border and the content, mm. */
export const BORDER_CLEARANCE_MM = 1;

export interface BorderLayout {
  /** the lines to draw, outermost first */
  rects: { x: number; y: number; w: number; h: number }[];
  /** the offset and gap actually used, which may be less than asked for */
  offsetMm: number;
  gapMm: number;
  /** how far the pattern reaches in from the innermost line, mm (the stamp's notches, the ornate corners) */
  depthMm: number;
  /** true if the border had to be pulled in so it fits inside the margin */
  clamped: boolean;
}

/**
 * Where the border lines go. The border sits inside the margin, so the outer line is `offsetMm` from the paper
 * edge and (for a double border) the inner line `gapMm` further in. If that would reach the content, the offset
 * and then the gap are reduced until everything fits inside the smallest margin.
 */
export function layoutBorder(W: number, H: number, b: BorderSettings, margins: Margins): BorderLayout {
  const half = Math.max(0, b.weightMm) / 2;
  const double = b.style === 'double';
  const { outer, depth } = REACH[b.style];
  const mult = outer + depth || 1;
  const room = Math.max(half * 2, Math.min(margins.top, margins.right, margins.bottom, margins.left) - BORDER_CLEARANCE_MM);
  let offsetMm = Math.max(half, b.offsetMm);
  let gapMm = b.style === 'single' ? 0 : Math.max(0, b.gapMm);
  const reach = () => offsetMm + (outer + depth) * gapMm + half;
  if (reach() > room) offsetMm = Math.max(half, room - (outer + depth) * gapMm - half);
  if (reach() > room) gapMm = Math.max(double ? b.weightMm : 0, (room - offsetMm - half) / mult);
  const clamped = Math.abs(offsetMm - b.offsetMm) > 1e-9 || (b.style !== 'single' && Math.abs(gapMm - b.gapMm) > 1e-9);
  const rect = (inset: number) => ({ x: inset, y: inset, w: W - 2 * inset, h: H - 2 * inset });
  const line = offsetMm + outer * gapMm;
  return { rects: double ? [rect(offsetMm), rect(offsetMm + gapMm)] : [rect(line)], offsetMm, gapMm, depthMm: double ? 0 : depth * gapMm, clamped };
}

const f = (n: number) => +n.toFixed(3);

type Pt = [number, number];
const pt = (p: Pt) => `${f(p[0])} ${f(p[1])}`;
type Rect = { x: number; y: number; w: number; h: number };

/** The rectangle's four sides, clockwise from the top left, each as its start, direction and length */
const sidesOf = (r: Rect) => ([
  { o: [r.x, r.y] as Pt, d: [1, 0] as Pt, len: r.w }, { o: [r.x + r.w, r.y] as Pt, d: [0, 1] as Pt, len: r.h },
  { o: [r.x + r.w, r.y + r.h] as Pt, d: [-1, 0] as Pt, len: r.w }, { o: [r.x, r.y + r.h] as Pt, d: [0, -1] as Pt, len: r.h },
]);
/** to the right of the direction of travel, which is inward for a clockwise walk */
const inward = (d: Pt): Pt => [-d[1], d[0]];

/** A postage-stamp edge: the rule with half-round notches bitten in, evenly spaced, with a plain stretch at each corner. */
function stampPath(r: Rect, size: number): string {
  const pitch = size * 1.5;
  const corner = pitch * 0.9;
  let d = `M${pt([r.x, r.y])}`;
  for (const { o, d: dir, len } of sidesOf(r)) {
    const n = Math.max(0, Math.floor((len - 2 * corner) / pitch));
    const step = n ? (len - 2 * corner) / n : 0;
    const rad = Math.min(size * 0.45, step * 0.3);
    const at = (t: number): Pt => [o[0] + dir[0] * t, o[1] + dir[1] * t];
    for (let i = 0; i < n; i++) {
      const c = corner + (i + 0.5) * step;
      d += `L${pt(at(c - rad))}A${f(rad)} ${f(rad)} 0 0 0 ${pt(at(c + rad))}`;
    }
    d += `L${pt(at(len))}`;
  }
  return d + 'Z';
}

/** A twisted rope: two strands weaving across the center line, crossing at whole waves along each side. */
function ropePath(r: Rect, size: number): string {
  const amp = size * 0.5;
  let d = '';
  for (const { o, d: dir, len } of sidesOf(r)) {
    const n = Math.max(1, Math.round(len / (size * 3)));
    const nrm = inward(dir);
    for (const sign of [1, -1]) {
      const steps = n * 14;
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * len;
        const w = sign * amp * Math.sin((i / steps) * n * 2 * Math.PI);
        d += `${i ? 'L' : 'M'}${pt([o[0] + dir[0] * t + nrm[0] * w, o[1] + dir[1] * t + nrm[1] * w])}`;
      }
    }
  }
  return d;
}

/** The rule's four corners each get two quarter-circle arcs and a small ring tucked between them. */
function ornatePath(r: Rect, size: number): string {
  let d = '';
  const corners: { c: Pt; sx: number; sy: number }[] = [
    { c: [r.x, r.y], sx: 1, sy: 1 }, { c: [r.x + r.w, r.y], sx: -1, sy: 1 }, { c: [r.x + r.w, r.y + r.h], sx: -1, sy: -1 }, { c: [r.x, r.y + r.h], sx: 1, sy: -1 },
  ];
  for (const { c, sx, sy } of corners) {
    for (const k of [1.2, 2.4]) {
      const R = size * k;
      // from along one side to along the other, centered on the corner, bulging into the page
      const sweep = sx * sy > 0 ? 1 : 0;
      d += `M${pt([c[0] + sx * R, c[1]])}A${f(R)} ${f(R)} 0 0 ${sweep} ${pt([c[0], c[1] + sy * R])}`;
    }
    const m = size * 1.8 / Math.SQRT2, rr = size * 0.3;
    const cx = c[0] + sx * m, cy = c[1] + sy * m;
    d += `M${pt([cx - rr, cy])}a${f(rr)} ${f(rr)} 0 1 0 ${f(2 * rr)} 0a${f(rr)} ${f(rr)} 0 1 0 ${f(-2 * rr)} 0Z`;
  }
  return d;
}

/** The border as stroked paths, in the pen's color. */
export function borderPrims(W: number, H: number, b: BorderSettings, margins: Margins, color: string): PathPrim[] {
  if (!b.enabled) return [];
  const lay = layoutBorder(W, H, b, margins);
  const prim = (d: string): PathPrim => ({ kind: 'path', d, color, pen: b.pen, mode: 'stroke', widthMm: b.weightMm });
  const plain = (r: Rect) => prim(`M${f(r.x)} ${f(r.y)}H${f(r.x + r.w)}V${f(r.y + r.h)}H${f(r.x)}Z`);
  const r = lay.rects[0]!;
  switch (b.style) {
    case 'stamp': return [prim(stampPath(r, lay.gapMm))];
    case 'rope': return [{ ...prim(ropePath(r, lay.gapMm)), round: true }];
    case 'ornate': return [plain(r), { ...prim(ornatePath(r, lay.gapMm)), round: true }];
    default: return lay.rects.map(plain);
  }
}
