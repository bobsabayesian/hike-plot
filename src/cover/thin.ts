/**
 * Thin lines under an area: the lines there are broken into dashes with gaps, a larger share of each stretch left open the
 * stronger the clearing. At 0 a line is untouched; at 1 it is gone. Every line is cut in the same rhythm (a gap at the start of
 * each stretch of `PERIOD_MM`, measured along the line), so the result reads as an even, lighter texture rather than a ragged edge.
 */
type Pt = readonly number[];

/** Length of one dash and its gap together, mm. */
export const THIN_PERIOD_MM = 3;
/** Sampling step along a line, mm: finer than the smallest gap that matters, coarser than the point spacing of a contour. */
const STEP_MM = 0.25;
/** A short segment whose two ends are both outside every area cannot reach into one: it is kept without sampling. */
const SKIP_MM = 1;

/**
 * Cut `lines` (points carry the flat-map position in [0] and [1]; anything after is kept, interpolated, e.g. a height)
 * wherever the gap rhythm of the clearing at that spot says "open". `share(x, y)` is how much to clear there, 0 to 1.
 */
export function thinUnder<T extends Pt>(lines: T[][], share: (x: number, y: number) => number, periodMm = THIN_PERIOD_MM): T[][] {
  const out: T[][] = [];
  const mix = (a: T, b: T, t: number) => a.map((v, k) => v + (b[k]! - v) * t) as unknown as T;
  for (const line of lines) {
    if (line.length < 2) continue;
    let run: T[] = [];
    const flush = () => { if (run.length > 1) out.push(run); run = []; };
    let s = 0; // distance along the line so far, so the dash rhythm carries on across segments
    const open = (x: number, y: number, at: number): boolean => {
      const f = share(x, y);
      return f > 0 && (f >= 0.995 || (at % periodMm) / periodMm < f);
    };
    let prev = line[0]!;
    let prevOpen = open(prev[0]!, prev[1]!, 0);
    if (!prevOpen) run.push(prev);
    /** one sample: where the line goes from kept to open or back, the cut is put half a step from either sample, so the cuts are not biased */
    const take = (p: T, isOpen: boolean) => {
      if (isOpen !== prevOpen) {
        const mid = mix(prev, p, 0.5);
        if (isOpen) { run.push(mid); flush(); } else run = [mid];
      }
      if (!isOpen) run.push(p);
      prev = p;
      prevOpen = isOpen;
    };
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!, b = line[i]!;
      const len = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
      if (len < SKIP_MM && share(a[0]!, a[1]!) === 0 && share(b[0]!, b[1]!) === 0) { take(b, false); s += len; continue; }
      const n = Math.max(1, Math.ceil(len / STEP_MM));
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const p = k === n ? b : mix(a, b, t);
        take(p, open(p[0]!, p[1]!, s + len * t));
      }
      s += len;
    }
    flush();
  }
  return out;
}
