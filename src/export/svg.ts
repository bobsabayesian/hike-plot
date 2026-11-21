import type { PathPrim, Prim, Scene, TextPrim } from '../scene/types';
import { penFor, type Pen } from '../scene/pens';
import { penKind } from '../scene/pens';
import { layerLabel, layerOfPart, type LayerId, type LayerSettings } from '../scene/layers';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f = (n: number) => +n.toFixed(3);

/** Normalize any #rgb / #rrggbb to lowercase #rrggbb so equal colors share a layer. */
export function normColor(c: string): string {
  const h = c.trim().toLowerCase();
  return /^#[0-9a-f]{3}$/.test(h) ? '#' + [...h.slice(1)].map((x) => x + x).join('') : h;
}

/** How the preview draws what a pen leaves: translucent ink lets what is under it show (and darkens where lines overlap, on light paper). */
export interface InkLook { pens: Pen[]; /** dark paper: inks are drawn over it, not multiplied into it */ dark: boolean }

/** How much of a pen's color one pass shows: an opaque pen 1, a very translucent marker about a half. */
export const inkAlpha = (pen: Pen): number => +(1 - 0.55 * (pen.transparency ?? penKind(pen.kind).transparency)).toFixed(3);

/** wide enough to click on screen: a poster is shown at about 1 px per mm, so a hairline needs help */
const HIT_MM = 4;

function pathEl(p: PathPrim, look?: InkLook, ids = false): string {
  const part = ids && p.part ? ` data-part="${p.part}"` : '';
  const col = normColor(p.color);
  let op = p.opacity !== undefined && p.opacity < 1 ? ` opacity="${f(p.opacity)}"` : '';
  if (look && p.mode === 'stroke' && p.pen !== undefined) {
    const pen = penFor(look.pens, p.pen);
    const a = inkAlpha(pen) * (p.opacity ?? 1);
    op = ` stroke-opacity="${f(a)}"${look.dark ? '' : ' style="mix-blend-mode:multiply"'}`;
  }
  if (p.mode === 'fill') return `<path${part} d="${p.d}" fill="${col}" stroke="none"${op}/>`;
  const dash = p.dash ? ` stroke-dasharray="${p.dash.map(f).join(' ')}"` : '';
  const line = `<path${part} d="${p.d}" fill="none" stroke="${col}" stroke-width="${f(p.widthMm ?? 0.5)}" stroke-linejoin="round" stroke-linecap="${p.round ? 'round' : 'butt'}"${dash}${op}/>`;
  // an invisible, wider copy of the line to click on (editor preview only)
  const hit = part ? `<path${part} d="${p.d}" fill="none" stroke="transparent" stroke-width="${HIT_MM}" stroke-linejoin="round" pointer-events="stroke"/>` : '';
  return line + hit;
}

function textEl(t: TextPrim, ids = false): string {
  const op = t.opacity !== undefined && t.opacity < 1 ? ` opacity="${f(t.opacity)}"` : '';
  const rot = t.rotate ? ` transform="rotate(${f(t.rotate)} ${f(t.x)} ${f(t.y)})"` : '';
  // justified text: let the viewer spread the letters to the width
  const fit = t.fitWidthMm !== undefined ? ` textLength="${f(t.fitWidthMm)}" lengthAdjust="spacing"` : '';
  const paint = t.mode === 'stroke'
    ? `fill="none" stroke="${normColor(t.color)}" stroke-width="${f(t.strokeMm ?? 0.35)}" stroke-linejoin="round"`
    : `fill="${normColor(t.color)}"`;
  const ref = (ids && t.ref ? ` data-lm="${esc(t.ref)}"` : '') + (ids && t.part ? ` data-part="${t.part}"` : '');
  return `<text${ref} x="${f(t.x)}" y="${f(t.y)}"${rot}${fit} text-anchor="${t.anchor}" font-size="${f(t.sizeMm)}" letter-spacing="${f(t.trackingMm)}" font-family="${esc(t.fontFamily)}" ${paint}${op}>${esc(t.text)}</text>`;
}

const el = (p: Prim, ids = false, look?: InkLook) => (p.kind === 'path' ? pathEl(p, look, ids) : textEl(p, ids));
const colorOf = (p: Prim) => normColor(p.color);

export interface SvgOptions {
  /** include the paper-colored background rect (omit for plotting) */
  paper?: boolean;
  /**
   * tag landmark labels with their id, and everything with the part of the poster it draws (with wider invisible lines
   * to click on): the editor preview uses it for click to edit; exports leave it off
   */
  ids?: boolean;
  /**
   * 'style' (the default): one layer per color and stroke width, which is what a design file wants.
   * 'pen': one layer per pen of the palette, named after it, in palette order, which is what a plotter wants: a layer is a pen.
   */
  layers?: 'style' | 'pen';
  /** the pen palette, for `layers: 'pen'` */
  pens?: Pen[];
  /** draw lines the way their pens lay ink on paper (the editor's plotter preview); exports leave it off */
  ink?: InkLook;
  /** with `layers: 'pen'` and `stack.byStack`: file layers follow the layer stack (a layer for each run of one pen) instead of one per pen */
  stack?: LayerSettings;
  /** mark each path with the layer of the design it belongs to (the editor highlights a layer from it); exports leave it off */
  tagLayers?: boolean;
}

/** One stretch of the plot drawn with one pen: a layer of the file when the file follows the stack. */
export interface PlotRun { id: string; label: string; pen: string | undefined; layers: LayerId[]; prims: Prim[] }

/**
 * The plot in the stack's order, cut into runs of consecutive primitives that share a pen: the pen is changed between runs.
 * Primitives keep their order within a layer; one with no part goes last.
 */
export function plotRuns(prims: Prim[], pens: Pen[], stack: LayerSettings): PlotRun[] {
  const rank = (p: Prim) => { const l = layerOfPart(p.part); return l === undefined ? stack.order.length : stack.order.indexOf(l); };
  const sorted = prims.map((p, i) => ({ p, i, r: rank(p) })).sort((a, b) => a.r - b.r || a.i - b.i);
  const runs: PlotRun[] = [];
  let key = '';
  for (const { p } of sorted) {
    const l = penLayerOf(p, pens);
    const here = layerOfPart(p.part);
    if (runs.length && key === l.id) {
      const run = runs[runs.length - 1]!;
      run.prims.push(p);
      if (here && !run.layers.includes(here)) run.layers.push(here);
      continue;
    }
    key = l.id;
    runs.push({ id: `${l.id}-run${runs.length + 1}`, label: l.label, pen: p.pen, layers: here ? [here] : [], prims: [p] });
  }
  return runs;
}

/**
 * Layer key for a primitive. Pen plotters need one pen per layer, so every distinct color AND every distinct
 * stroke width is its own layer. Fills (and live <text>, which is filled) cannot be plotted and go in separate
 * fill layers by color.
 */
export function layerOf(p: Prim): { id: string; label: string } {
  const c = colorOf(p);
  // outlined text is drawn with a pen like any other line
  const width = p.kind === 'path' && p.mode === 'stroke' ? (p.widthMm ?? 0.5) : p.kind === 'text' && p.mode === 'stroke' ? (p.strokeMm ?? 0.35) : undefined;
  if (width !== undefined) {
    const w = +width.toFixed(2);
    return { id: `layer-${c.slice(1)}-${w}mm`, label: `${c} ${w}mm` };
  }
  return { id: `layer-${c.slice(1)}-fill`, label: `${c} fill` };
}

/**
 * One <g> per distinct (color, stroke width), flagged as an Inkscape layer so each pen gets its own layer.
 * Layers are ordered by first appearance, which keeps painter's order for fills under lines.
 */
/** The layer a primitive belongs to when layers follow pens. Anything without a pen of the palette falls back to its color and width. */
export function penLayerOf(p: Prim, pens: Pen[]): { id: string; label: string; rank: number } {
  const i = p.pen === undefined ? -1 : pens.findIndex((x) => x.id === p.pen);
  if (i >= 0) {
    const pen = pens[i]!;
    return { id: `pen-${i + 1}-${pen.id}`, label: `Pen ${i + 1}: ${pen.name} (${+pen.tipMm.toFixed(2)} mm, ${normColor(pen.color)})`, rank: i };
  }
  const l = layerOf(p);
  return { id: l.id, label: `No pen: ${l.label}`, rank: pens.length };
}

export function sceneToSvg(scene: Scene, opts: SvgOptions = {}): string {
  const byPen = opts.layers === 'pen' && !!opts.pens;
  const tag = (p: Prim, svg: string) => (opts.tagLayers && p.kind === 'path' && layerOfPart(p.part) ? svg.replace('<path ', `<path data-layer="${layerOfPart(p.part)}" `) : svg);
  const { widthMm: w, heightMm: h } = scene;
  let layers: string;
  if (byPen && opts.stack?.byStack) {
    layers = plotRuns(scene.prims, opts.pens!, opts.stack)
      .map((run) => `<g id="${run.id}" inkscape:groupmode="layer" inkscape:label="${esc(run.layers.length ? `${run.label} · ${run.layers.map(layerLabel).join(', ')}` : run.label)}">${run.prims.map((p) => tag(p, el(p, opts.ids, opts.ink))).join('')}</g>`)
      .join('\n');
  } else {
    const order: string[] = [];
    const rank = new Map<string, number>();
    const groups = new Map<string, { label: string; els: string[] }>();
    for (const p of scene.prims) {
      const { id, label, rank: r } = byPen ? penLayerOf(p, opts.pens!) : { ...layerOf(p), rank: 0 };
      rank.set(id, r);
      if (!groups.has(id)) {
        groups.set(id, { label, els: [] });
        order.push(id);
      }
      groups.get(id)!.els.push(tag(p, el(p, opts.ids, opts.ink)));
    }
    // pen layers follow the palette's order (the order the pens are swapped in); style layers keep first appearance
    if (byPen) order.sort((a, b) => rank.get(a)! - rank.get(b)!);
    layers = order
      .map((id, i) => {
        const g = groups.get(id)!;
        return `<g id="${id}" inkscape:groupmode="layer" inkscape:label="${byPen ? esc(g.label) : `Layer ${i + 1} ${g.label}`}">${g.els.join('')}</g>`;
      })
      .join('\n');
  }
  const paper = opts.paper ? `<rect id="paper" width="${f(w)}" height="${f(h)}" fill="${normColor(scene.paper)}"/>\n` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${f(w)}mm" height="${f(h)}mm" viewBox="0 0 ${f(w)} ${f(h)}">\n${paper}${layers}\n</svg>`;
}
