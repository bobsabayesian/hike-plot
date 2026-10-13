import type { PathPrim, Scene, TextPrim } from '../scene/types';
import { offsetPath, passOffsets } from './offset';
import { penFor, type Pen } from '../scene/pens';

interface PathCommand { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }
interface GlyphLike {
  advanceWidth?: number;
  getPath(x: number, y: number, size: number): { toPathData(decimals?: number): string; commands: PathCommand[] };
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
  const rot = t.rotate ? (t.rotate * Math.PI) / 180 : 0;
  const parts = glyphs.map((g, i) => {
    const path = g.getPath(x, t.y, t.sizeMm);
    x += adv[i]!;
    return rot ? rotatedPathData(path.commands, t.x, t.y, rot) : path.toPathData(3);
  });
  return parts.join('');
}

/** Path data for `commands` turned by `rot` radians (clockwise on screen) about (cx, cy). */
function rotatedPathData(commands: PathCommand[], cx: number, cy: number, rot: number): string {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const pt = (x = 0, y = 0) => `${+(cx + (x - cx) * c - (y - cy) * s).toFixed(3)} ${+(cy + (x - cx) * s + (y - cy) * c).toFixed(3)}`;
  return commands
    .map((k) => {
      switch (k.type) {
        case 'M': return `M${pt(k.x, k.y)}`;
        case 'L': return `L${pt(k.x, k.y)}`;
        case 'C': return `C${pt(k.x1, k.y1)} ${pt(k.x2, k.y2)} ${pt(k.x, k.y)}`;
        case 'Q': return `Q${pt(k.x1, k.y1)} ${pt(k.x, k.y)}`;
        default: return 'Z';
      }
    })
    .join('');
}

export interface PrepareOptions {
  /** the pen palette: each primitive is drawn with the tip width of its pen */
  pens?: Pen[];
  /** tip width for anything without a pen (and when there is no palette); defaults to 0.3 mm */
  penMm?: number;
}

/** The tip width the plotter export uses for a primitive. */
export function tipFor(p: { pen?: string }, opts: PrepareOptions): number {
  return opts.pens && p.pen !== undefined ? penFor(opts.pens, p.pen).tipMm : (opts.penMm ?? PLOTTER_PEN_MM);
}

export function prepareScene(scene: Scene, mode: ExportMode, fonts?: FontSet, opts: PrepareOptions = {}): Scene {
  if (mode === 'live') return scene;
  if (!fonts) throw new Error('Fonts are required to outline text');
  const plotter = mode === 'plotter';
  const prims = scene.prims.flatMap((p): Scene['prims'] => {
    const pen = tipFor(p, opts);
    if (p.kind === 'text') {
      const path: PathPrim = plotter
        ? { kind: 'path', d: textToPath(p, fonts), color: p.color, pen: p.pen, mode: 'stroke', widthMm: pen, round: true }
        : { kind: 'path', d: textToPath(p, fonts), color: p.color, pen: p.pen, mode: 'fill', opacity: p.opacity };
      return [path];
    }
    if (!plotter) return [p];
    // Plotters cannot fill or fade: draw the outline instead, at full strength, with the one pen.
    const stroke: PathPrim = p.mode === 'fill' ? { ...p, mode: 'stroke', widthMm: pen, opacity: undefined } : { ...p, opacity: undefined };
    const offsets = passOffsets(stroke.widthMm ?? 0.5, pen, stroke.minPasses);
    // A heavy line is the same path repeated, shifted sideways, with the thin pen.
    return offsets.map((o) => ({ ...stroke, d: o === 0 ? stroke.d : offsetPath(stroke.d, o), widthMm: pen, minPasses: undefined }));
  });
  return { ...scene, prims };
}
