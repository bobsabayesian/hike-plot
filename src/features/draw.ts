import { clipPolyline, simplifyXY, type Rect, type XY } from '../geo/clip';
import type { Fit } from '../geo/project';
import type { Prim } from '../scene/types';
import { placeLandmarks, type LandmarkPlacement, type PlaceInput } from './select';
import type { Pen } from '../scene/pens';
import type { FeatureSettings, Icon, LabelKind, LandmarkKind, WaterLine } from './types';

const f = (n: number) => +n.toFixed(2);
const toD = (lines: XY[][]) => lines.map((l) => l.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('')).join('');

/** Rivers, streams and lake outlines as thin strokes clipped to the map frame (real geometry, plotter-safe). */
export function waterPrims(water: WaterLine[], fit: Fit, frame: Rect, s: FeatureSettings, pen: Pen): Prim[] {
  const lines: XY[][] = [];
  for (const w of water) {
    const mm = simplifyXY(w.coords.map(([la, lo]) => fit.toMm(la, lo)), 0.08);
    lines.push(...clipPolyline(mm, frame));
  }
  return waterLinesPrim(lines, s, pen);
}

/** Water lines that are already page polylines, as one stroked path in the water pen. */
export function waterLinesPrim(lines: XY[][], s: FeatureSettings, pen: Pen): Prim[] {
  return lines.length
    ? [{ kind: 'path', d: toD(lines), color: pen.color, pen: pen.id, mode: 'stroke', widthMm: s.waterWeightMm }]
    : [];
}

/** Simple outline glyph per kind, centered on (x, y); strokes only so it plots. */
export function markerPath(kind: LandmarkKind, x: number, y: number, r: number, icon: Icon = 'default'): string {
  const circle = (rr: number) => `M${f(x - rr)} ${f(y)}a${f(rr)} ${f(rr)} 0 1 0 ${f(2 * rr)} 0a${f(rr)} ${f(rr)} 0 1 0 ${f(-2 * rr)} 0Z`;
  switch (icon) {
    case 'none': return '';
    case 'crosshair': return circle(r * 0.62) + `M${f(x - r * 1.25)} ${f(y)}h${f(r * 2.5)}M${f(x)} ${f(y - r * 1.25)}v${f(r * 2.5)}`;
    case 'circle': return circle(r);
    case 'dot': return circle(r) + circle(r * 0.5);
    case 'triangle': return `M${f(x)} ${f(y - r)}L${f(x + r * 0.95)} ${f(y + r * 0.7)}L${f(x - r * 0.95)} ${f(y + r * 0.7)}Z`;
    case 'diamond': return `M${f(x)} ${f(y - r)}L${f(x + r)} ${f(y)}L${f(x)} ${f(y + r)}L${f(x - r)} ${f(y)}Z`;
    case 'square': return `M${f(x - r * 0.8)} ${f(y - r * 0.8)}h${f(r * 1.6)}v${f(r * 1.6)}h${f(-r * 1.6)}Z`;
    case 'star': {
      let d = '';
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        const rr = i % 2 ? r * 0.42 : r * 1.05;
        d += `${i ? 'L' : 'M'}${f(x + Math.cos(a) * rr)} ${f(y + Math.sin(a) * rr)}`;
      }
      return d + 'Z';
    }
    case 'pin': return `M${f(x - r * 0.9)} ${f(y + r * 0.8)}V${f(y - r * 0.1)}L${f(x)} ${f(y - r)}L${f(x + r * 0.9)} ${f(y - r * 0.1)}V${f(y + r * 0.8)}Z`;
  }
  switch (kind) {
    case 'peak':
      return `M${f(x)} ${f(y - r)}L${f(x + r * 0.95)} ${f(y + r * 0.7)}L${f(x - r * 0.95)} ${f(y + r * 0.7)}Z`;
    case 'pass':
      return `M${f(x)} ${f(y - r)}L${f(x + r)} ${f(y)}L${f(x)} ${f(y + r)}L${f(x - r)} ${f(y)}Z`;
    case 'hut':
      return `M${f(x - r * 0.8)} ${f(y - r * 0.8)}h${f(r * 1.6)}v${f(r * 1.6)}h${f(-r * 1.6)}Z`;
    case 'viewpoint':
      return circle(r);
    case 'trailhead':
      return `M${f(x - r)} ${f(y)}h${f(2 * r)}M${f(x)} ${f(y - r)}v${f(2 * r)}`;
    case 'waypoint':
      return circle(r) + circle(r * 0.3);
    default:
      return '';
  }
}

export interface LandmarkDraw extends PlaceInput {
  /** the pen a label of this kind is drawn with */
  penFor: (kind: LabelKind) => Pen;
  fontFamily: string;
  fontKey: 'sans' | 'serif';
  trackingMm: number;
}

export function landmarkPrims(inp: LandmarkDraw): { prims: Prim[] } & Pick<LandmarkPlacement, 'entries' | 'pool' | 'open' | 'obstacles' | 'halos'> {
  const { labels, entries, pool, open, obstacles, halos } = placeLandmarks(inp);
  const prims: Prim[] = [];
  // markers are grouped by pen so each pen gets one path; labels carry their own pen
  const markers = labels.filter((l) => l.marker);
  const byPen = new Map<string, { pen: Pen; ds: string[] }>();
  for (const l of markers) {
    const pen = inp.penFor(l.kind);
    const g = byPen.get(pen.id) ?? { pen, ds: [] };
    g.ds.push(markerPath(l.kind as LandmarkKind, l.marker![0], l.marker![1], inp.markerR, inp.settings.overrides[l.id]?.icon ?? inp.settings.icons?.[l.kind as LandmarkKind]));
    byPen.set(pen.id, g);
  }
  for (const { pen, ds } of byPen.values())
    prims.push({ kind: 'path', mode: 'stroke', color: pen.color, pen: pen.id, widthMm: 0.35, round: true, d: ds.join('') });
  for (const l of labels) {
    const pen = inp.penFor(l.kind);
    prims.push({
      kind: 'text', text: l.text, x: l.x, y: l.y, anchor: l.anchor, sizeMm: inp.sizeMm,
      trackingMm: inp.trackingMm, fontFamily: inp.fontFamily, fontKey: inp.fontKey, color: pen.color, pen: pen.id,
      ref: l.id,
      ...(l.rotate ? { rotate: l.rotate } : {}),
    });
  }
  return { prims, entries, pool, open, obstacles, halos };
}
