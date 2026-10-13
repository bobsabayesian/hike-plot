import { clipPolyline, simplifyXY, type Rect, type XY } from '../geo/clip';
import type { Fit } from '../geo/project';
import type { Prim } from '../scene/types';
import { placeLandmarks, type LandmarkPlacement, type PlaceInput } from './select';
import type { FeatureSettings, LandmarkKind, WaterLine } from './types';

const f = (n: number) => +n.toFixed(2);
const toD = (lines: XY[][]) => lines.map((l) => l.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('')).join('');

/** Rivers, streams and lake outlines as thin strokes clipped to the map frame (real geometry, plotter-safe). */
export function waterPrims(water: WaterLine[], fit: Fit, frame: Rect, s: FeatureSettings): Prim[] {
  const lines: XY[][] = [];
  for (const w of water) {
    const mm = simplifyXY(w.coords.map(([la, lo]) => fit.toMm(la, lo)), 0.08);
    lines.push(...clipPolyline(mm, frame));
  }
  return lines.length
    ? [{ kind: 'path', d: toD(lines), color: s.waterColor, mode: 'stroke', widthMm: s.waterWeightMm }]
    : [];
}

/** Simple outline glyph per kind, centered on (x, y); strokes only so it plots. */
export function markerPath(kind: LandmarkKind, x: number, y: number, r: number): string {
  const circle = (rr: number) => `M${f(x - rr)} ${f(y)}a${f(rr)} ${f(rr)} 0 1 0 ${f(2 * rr)} 0a${f(rr)} ${f(rr)} 0 1 0 ${f(-2 * rr)} 0Z`;
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
  fontFamily: string;
  fontKey: 'sans' | 'serif';
  trackingMm: number;
}

export function landmarkPrims(inp: LandmarkDraw): { prims: Prim[] } & Pick<LandmarkPlacement, 'entries' | 'pool' | 'open'> {
  const { labels, entries, pool, open } = placeLandmarks(inp);
  const prims: Prim[] = [];
  const color = inp.settings.color;
  const markers = labels.filter((l) => l.marker);
  if (markers.length)
    prims.push({
      kind: 'path', mode: 'stroke', color, widthMm: 0.35, round: true,
      d: markers.map((l) => markerPath(l.kind as LandmarkKind, l.marker![0], l.marker![1], inp.markerR)).join(''),
    });
  for (const l of labels)
    prims.push({
      kind: 'text', text: l.text, x: l.x, y: l.y, anchor: l.anchor, sizeMm: inp.sizeMm,
      trackingMm: inp.trackingMm, fontFamily: inp.fontFamily, fontKey: inp.fontKey, color,
      ...(l.rotate ? { rotate: l.rotate } : {}),
    });
  return { prims, entries, pool, open };
}
