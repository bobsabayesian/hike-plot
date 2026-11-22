import type { PathPrim, Prim, TextPrim } from './types';
import type { Placement } from './project';

/** A round passport stamp: two rings, a word round the top, one round the bottom, and a big word in the middle. */
export interface BadgeSettings {
  enabled: boolean;
  placement: Placement;
  align: 'left' | 'center' | 'right';
  /** across the whole stamp, mm */
  sizeMm: number;
  pen: string;
  /** round the top; empty = the title of the poster */
  top: string;
  /** in the middle */
  middle: string;
  /** round the bottom; empty = the date of the hike */
  bottom: string;
}

export const defaultBadge = (pen: string): BadgeSettings => ({ enabled: false, placement: 'bottom', align: 'left', sizeMm: 40, pen, top: '', middle: 'SUMMIT', bottom: '' });

export const MIN_BADGE_MM = 20;
export const MAX_BADGE_MM = 90;

export function normalizeBadge(raw: unknown, pen: string): BadgeSettings {
  const d = defaultBadge(pen);
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<BadgeSettings>;
  const s = (v: unknown, fallback: string) => (typeof v === 'string' ? v.slice(0, 40) : fallback);
  return {
    enabled: r.enabled === true,
    placement: r.placement === 'top' ? 'top' : 'bottom',
    align: r.align === 'center' || r.align === 'right' ? r.align : 'left',
    sizeMm: Math.min(MAX_BADGE_MM, Math.max(MIN_BADGE_MM, Number(r.sizeMm) || d.sizeMm)),
    pen: typeof r.pen === 'string' ? r.pen : pen,
    top: s(r.top, ''), middle: s(r.middle, d.middle), bottom: s(r.bottom, ''),
  };
}

const f = (n: number) => +n.toFixed(3);
const circle = (cx: number, cy: number, r: number) => `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
/** an average letter is about this wide compared with its size */
const LETTER_EM = 0.68;
/** the most of the ring a word may use, radians */
const MAX_SWEEP = 2.5;

export interface BadgeFont { fontFamily: string; fontKey: 'sans' | 'serif'; color: string; pen: string }

/** The letters of `word` spread evenly round an arc centred on `centreRad` (clockwise from straight up). */
function arcWord(word: string, cx: number, cy: number, r: number, sizeMm: number, centreRad: number, bottom: boolean, font: BadgeFont): TextPrim[] {
  const chars = [...word.toUpperCase()];
  if (!chars.length) return [];
  const step = (sizeMm * LETTER_EM) / r;
  const sweep = step * (chars.length - 1);
  const k = sweep > MAX_SWEEP ? MAX_SWEEP / sweep : 1; // squeeze a long word instead of wrapping it round
  const size = sizeMm * k;
  return chars.flatMap((ch, i): TextPrim[] => {
    if (ch === ' ') return [];
    const off = (i - (chars.length - 1) / 2) * step * k;
    // along the top the word reads clockwise; along the bottom it reads anticlockwise so it is the right way up
    const a = bottom ? centreRad - off : centreRad + off;
    const x = cx + r * Math.sin(a);
    const y = cy - r * Math.cos(a);
    const rotate = (a * 180) / Math.PI + (bottom ? 180 : 0);
    return [{ kind: 'text', part: 'badge', text: ch, x: f(x), y: f(y), anchor: 'middle', sizeMm: size, trackingMm: 0, rotate: f(rotate), ...font }];
  });
}

/** Every mark of the stamp, centred on (cx, cy). */
export function badgePrims(b: Pick<BadgeSettings, 'sizeMm' | 'top' | 'middle' | 'bottom'>, cx: number, cy: number, font: BadgeFont): Prim[] {
  const R = b.sizeMm / 2;
  const lineMm = Math.max(0.25, R * 0.025);
  const ring = (r: number, w = lineMm): PathPrim => ({ kind: 'path', part: 'badge', d: circle(cx, cy, r), color: font.color, pen: font.pen, mode: 'stroke', widthMm: f(w) });
  const out: Prim[] = [ring(R), ring(R * 0.94), ring(R * 0.58)];
  const word = R * 0.17;
  out.push(...arcWord(b.top, cx, cy, R * 0.66, word, 0, false, font));
  // along the bottom the letters stand with their tops toward the centre, so they sit on the outer radius
  out.push(...arcWord(b.bottom, cx, cy, R * 0.82, word, Math.PI, true, font));
  // a small ring at each side of the band where the two words stop
  for (const side of [-1, 1]) out.push(ring0(cx + side * R * 0.76, cy, R * 0.035, font, lineMm));
  const mid = b.middle.trim().toUpperCase();
  if (mid) {
    const inner = R * 0.58 * 2 * 0.82;
    const size = Math.min(R * 0.3, inner / Math.max(1, mid.length * LETTER_EM));
    out.push({ kind: 'text', part: 'badge', text: mid, x: f(cx), y: f(cy + size * 0.36), anchor: 'middle', sizeMm: f(size), trackingMm: 0, ...font });
  }
  return out;
}

function ring0(x: number, y: number, r: number, font: BadgeFont, w: number): PathPrim {
  return { kind: 'path', part: 'badge', d: circle(x, y, r), color: font.color, pen: font.pen, mode: 'stroke', widthMm: f(w) };
}
