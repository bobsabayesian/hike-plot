import type { PathPrim, Prim, Scene, TextPrim } from '../scene/types';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f = (n: number) => +n.toFixed(3);

/** Normalize any #rgb / #rrggbb to lowercase #rrggbb so equal colors share a layer. */
export function normColor(c: string): string {
  const h = c.trim().toLowerCase();
  return /^#[0-9a-f]{3}$/.test(h) ? '#' + [...h.slice(1)].map((x) => x + x).join('') : h;
}

function pathEl(p: PathPrim): string {
  const col = normColor(p.color);
  const op = p.opacity !== undefined && p.opacity < 1 ? ` opacity="${f(p.opacity)}"` : '';
  if (p.mode === 'fill') return `<path d="${p.d}" fill="${col}" stroke="none"${op}/>`;
  const dash = p.dash ? ` stroke-dasharray="${p.dash.map(f).join(' ')}"` : '';
  return `<path d="${p.d}" fill="none" stroke="${col}" stroke-width="${f(p.widthMm ?? 0.5)}" stroke-linejoin="round" stroke-linecap="${p.round ? 'round' : 'butt'}"${dash}${op}/>`;
}

function textEl(t: TextPrim): string {
  const op = t.opacity !== undefined && t.opacity < 1 ? ` opacity="${f(t.opacity)}"` : '';
  const rot = t.rotate ? ` transform="rotate(${f(t.rotate)} ${f(t.x)} ${f(t.y)})"` : '';
  return `<text x="${f(t.x)}" y="${f(t.y)}"${rot} text-anchor="${t.anchor}" font-size="${f(t.sizeMm)}" letter-spacing="${f(t.trackingMm)}" font-family="${esc(t.fontFamily)}" fill="${normColor(t.color)}"${op}>${esc(t.text)}</text>`;
}

const el = (p: Prim) => (p.kind === 'path' ? pathEl(p) : textEl(p));
const colorOf = (p: Prim) => normColor(p.color);

export interface SvgOptions {
  /** include the paper-colored background rect (omit for plotting) */
  paper?: boolean;
}

/**
 * One <g> per distinct color, flagged as an Inkscape layer so each pen gets its own layer.
 * Layers are ordered by first appearance, which keeps painter's order for fills under lines.
 */
export function sceneToSvg(scene: Scene, opts: SvgOptions = {}): string {
  const order: string[] = [];
  const groups = new Map<string, string[]>();
  for (const p of scene.prims) {
    const c = colorOf(p);
    if (!groups.has(c)) {
      groups.set(c, []);
      order.push(c);
    }
    groups.get(c)!.push(el(p));
  }
  const { widthMm: w, heightMm: h } = scene;
  const layers = order
    .map(
      (c, i) =>
        `<g id="layer-${c.slice(1)}" inkscape:groupmode="layer" inkscape:label="Pen ${i + 1} ${c}">${groups.get(c)!.join('')}</g>`,
    )
    .join('\n');
  const paper = opts.paper ? `<rect id="paper" width="${f(w)}" height="${f(h)}" fill="${normColor(scene.paper)}"/>\n` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${f(w)}mm" height="${f(h)}mm" viewBox="0 0 ${f(w)} ${f(h)}">\n${paper}${layers}\n</svg>`;
}
