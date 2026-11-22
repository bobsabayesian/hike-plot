import type { Ink } from './ink';

export interface HwSpacing {
  /** writing size, % of the title size */
  scale: number;
  /** extra space between letters, % of the writing height */
  tracking: number;
  /** how far every letter gap is pulled toward the average one, % */
  even: number;
  /** word gaps as % of what was written */
  wordGap: number;
}
export const DEFAULT_SPACING: HwSpacing = { scale: 100, tracking: 0, even: 0, wordGap: 100 };
export const SPACING_RANGE = { scale: [50, 200], tracking: [-20, 60], even: [0, 100], wordGap: [0, 300] } as const;

const clamp = (v: unknown, [lo, hi]: readonly [number, number], d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export const normalizeSpacing = (s: Partial<HwSpacing> | undefined): HwSpacing => ({
  scale: clamp(s?.scale, SPACING_RANGE.scale, 100),
  tracking: clamp(s?.tracking, SPACING_RANGE.tracking, 0),
  even: clamp(s?.even, SPACING_RANGE.even, 0),
  wordGap: clamp(s?.wordGap, SPACING_RANGE.wordGap, 100),
});
export const isDefaultSpacing = (s: HwSpacing) => s.tracking === 0 && s.even === 0 && s.wordGap === 100;

interface Cluster { strokes: [number, number][][]; x0: number; x1: number }

/** Strokes grouped into letters: ones that overlap sideways (the dot of an i, the bar of a t) belong together. */
export function letterClusters(ink: Ink): Cluster[] {
  const items = ink.strokes.map((s) => ({ s, x0: Math.min(...s.map((p) => p[0])), x1: Math.max(...s.map((p) => p[0])) })).sort((a, b) => a.x0 - b.x0);
  const out: Cluster[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && it.x0 < last.x1) { last.strokes.push(it.s); last.x1 = Math.max(last.x1, it.x1); }
    else out.push({ strokes: [it.s], x0: it.x0, x1: it.x1 });
  }
  return out;
}

export interface Spaced { ink: Ink; letters: number; words: number; separated: boolean }

/** Re-space the letters of a written line. Strokes are only moved sideways and scaled as a whole, never reshaped. */
export function spaceInk(ink: Ink, text: string, raw: Partial<HwSpacing> | undefined): Spaced {
  const s = normalizeSpacing(raw);
  const words = text.trim().split(/\s+/).filter(Boolean).length || 1;
  const cl = letterClusters(ink);
  const scaled = (i: Ink): Ink => (s.scale === 100 ? i : { ...i, widthMm: i.widthMm * s.scale / 100, heightMm: i.heightMm * s.scale / 100, strokes: i.strokes.map((st) => st.map(([x, y]) => [x * s.scale / 100, y * s.scale / 100] as [number, number])) });
  // nothing to space if the letters are joined into fewer pieces than there are words
  if (cl.length < 2 || cl.length < words || isDefaultSpacing(s)) return { ink: scaled(ink), letters: cl.length, words, separated: cl.length >= words && cl.length > 1 };
  const gaps = cl.slice(1).map((c, i) => c.x0 - cl[i]!.x1);
  const wordIdx = new Set(gaps.map((g, i) => [g, i] as const).sort((a, b) => b[0] - a[0]).slice(0, words - 1).map(([, i]) => i));
  const letterGaps = gaps.filter((_, i) => !wordIdx.has(i));
  const mean = letterGaps.length ? letterGaps.reduce((a, b) => a + b, 0) / letterGaps.length : 0;
  const extra = (s.tracking / 100) * ink.heightMm;
  const strokes: [number, number][][] = [];
  let shift = -cl[0]!.x0;
  cl.forEach((c, i) => {
    if (i > 0) {
      const g = gaps[i - 1]!;
      const ng = wordIdx.has(i - 1) ? g * s.wordGap / 100 : Math.max(0, g + (mean - g) * s.even / 100 + extra);
      shift += ng - g;
    }
    for (const st of c.strokes) strokes.push(st.map(([x, y]) => [x + shift, y] as [number, number]));
  });
  const width = Math.max(...strokes.flat().map((p) => p[0]), 0);
  return { ink: scaled({ ...ink, widthMm: width, strokes }), letters: cl.length, words, separated: true };
}
