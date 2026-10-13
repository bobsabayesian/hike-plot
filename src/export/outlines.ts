import type { PathPrim, Scene, TextPrim } from '../scene/types';

interface GlyphLike {
  advanceWidth?: number;
  getPath(x: number, y: number, size: number): { toPathData(decimals?: number): string };
}
export interface FontLike {
  unitsPerEm: number;
  charToGlyph(c: string): GlyphLike;
}
export type FontSet = Record<'sans' | 'serif', FontLike>;

/** How text and fills are written to the file. */
export type ExportMode =
  /** text stays as <text>; needs the fonts installed wherever the file is opened */
  | 'live'
  /** text becomes filled vector outlines; identical everywhere */
  | 'print'
  /** everything is a stroked line, one pen weight, no fills/opacity: what a pen plotter can draw */
  | 'plotter';

export const PLOTTER_PEN_MM = 0.3;

/** Text as one path in poster mm, honoring anchor and letter-spacing. Glyphs missing from the font fall back to .notdef. */
export function textToPath(t: TextPrim, fonts: FontSet): string {
  const font = fonts[t.fontKey];
  const glyphs = [...t.text].map((c) => font.charToGlyph(c));
  const adv = glyphs.map((g) => ((g.advanceWidth ?? 0) / font.unitsPerEm) * t.sizeMm + t.trackingMm);
  const width = adv.reduce((a, b) => a + b, 0) - t.trackingMm;
  let x = t.anchor === 'start' ? t.x : t.anchor === 'middle' ? t.x - width / 2 : t.x - width;
  const parts = glyphs.map((g, i) => {
    const d = g.getPath(x, t.y, t.sizeMm).toPathData(3);
    x += adv[i]!;
    return d;
  });
  return parts.join('');
}

export function prepareScene(scene: Scene, mode: ExportMode, fonts?: FontSet): Scene {
  if (mode === 'live') return scene;
  if (!fonts) throw new Error('Fonts are required to outline text');
  const plotter = mode === 'plotter';
  const prims = scene.prims.map((p): Scene['prims'][number] => {
    if (p.kind === 'text') {
      const path: PathPrim = plotter
        ? { kind: 'path', d: textToPath(p, fonts), color: p.color, mode: 'stroke', widthMm: PLOTTER_PEN_MM, round: true }
        : { kind: 'path', d: textToPath(p, fonts), color: p.color, mode: 'fill', opacity: p.opacity };
      return path;
    }
    if (!plotter) return p;
    // Plotters cannot fill or fade: draw the outline instead, at full strength.
    return p.mode === 'fill'
      ? { ...p, mode: 'stroke', widthMm: PLOTTER_PEN_MM, opacity: undefined }
      : { ...p, opacity: undefined };
  });
  return { ...scene, prims };
}
