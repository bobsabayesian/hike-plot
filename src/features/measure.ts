import { GLYPH_WIDTHS } from './glyphWidths';

/** width of a character the table does not know, as a fraction of the font size */
const UNKNOWN_EM = 0.6;

/**
 * How wide a line of text is on paper, mm: the fonts' own advance widths (measured ahead of time, since the scene is
 * laid out before fonts load in the browser), plus letter spacing after each character as SVG draws it.
 */
export function textWidthMm(text: string, sizeMm: number, font: 'sans' | 'serif' = 'sans', trackingMm = 0): number {
  const table = GLYPH_WIDTHS[font];
  let em = 0;
  let n = 0;
  for (const ch of text) { em += table[ch] ?? UNKNOWN_EM; n++; }
  return em * sizeMm + trackingMm * n;
}
