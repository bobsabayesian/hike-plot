import { clipPolyline, type Rect, type XY } from '../geo/clip';
import type { Fit } from '../geo/project';
import type { FeatureSettings, Landmark, LandmarkKind, Side, WaterLine } from './types';

export interface LandmarkEntry {
  id: string;
  name: string;
  kind: LandmarkKind;
  hidden: boolean;
  /** false when it was a candidate but no label position fit */
  placed: boolean;
}

export interface PlacedLabel {
  id: string;
  kind: LandmarkKind;
  /** marker center, poster mm; undefined for lakes (label only) */
  marker?: XY;
  text: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
}

export interface PlaceInput {
  landmarks: Landmark[];
  water: WaterLine[];
  fit: Fit;
  frame: Rect;
  /** where label text may go; defaults to the frame. Routes often touch the frame edge, so callers allow some margin. */
  labelBounds?: Rect;
  /** route polyline in poster mm (empty if none) */
  route: XY[];
  settings: FeatureSettings;
  sizeMm: number;
  markerR: number;
}

interface Box { x0: number; y0: number; x1: number; y1: number }
interface Candidate { id: string; name: string; kind: LandmarkKind; x: number; y: number; score: number; marker: boolean; ele?: number }

const KIND_WEIGHT: Record<LandmarkKind, number> = {
  waypoint: 100, trailhead: 1.2, hut: 1.1, peak: 1, pass: 1, lake: 0.6, viewpoint: 0.7,
};
const MAX_CANDIDATES = 80;
const MAX_LISTED = 24;
const MIN_LAKE_AREA_MM2 = 6;

const overlap = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

function distToSegment(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function distToPolyline(p: XY, line: XY[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, distToSegment(p, line[i - 1]!, line[i]!));
  return best;
}

function ringArea(r: XY[]): number {
  let a = 0;
  for (let i = 1; i < r.length; i++) a += r[i - 1]![0] * r[i]![1] - r[i]![0] * r[i - 1]![1];
  return Math.abs(a) / 2;
}

const sideOrder = (side: Side): Exclude<Side, 'auto'>[] =>
  side === 'auto' ? ['right', 'left', 'above', 'below'] : [side];

/** Pick the most important landmarks, then give each a label position that avoids the route and other labels. */
export function placeLandmarks(inp: PlaceInput): { entries: LandmarkEntry[]; labels: PlacedLabel[] } {
  const { settings: s, fit, frame, route, sizeMm, markerR } = inp;
  const inFrame = ([x, y]: XY) => x >= frame.x && x <= frame.x + frame.w && y >= frame.y && y <= frame.y + frame.h;

  const eleVals = inp.landmarks.filter((l) => l.kind === 'peak' && l.ele !== undefined).map((l) => l.ele!);
  const eMin = Math.min(...eleVals);
  const eSpan = Math.max(Math.max(...eleVals) - eMin, 1);
  const proximityScale = 0.1 * Math.min(frame.w, frame.h);

  const cands: Candidate[] = [];
  const addCand = (c: Omit<Candidate, 'score'> & { base: number }) => {
    if (!inFrame([c.x, c.y])) return;
    const d = route.length > 1 ? distToPolyline([c.x, c.y], route) : Infinity;
    const near = d === Infinity ? 0 : 1.5 / (1 + d / proximityScale);
    cands.push({ ...c, score: c.base * (1 + near) });
  };

  for (const l of inp.landmarks) {
    if (!s.kinds[l.kind] || !l.name.trim()) continue;
    const [x, y] = fit.toMm(l.lat, l.lon);
    const eleBonus = l.kind === 'peak' && l.ele !== undefined && eleVals.length > 1 ? 2 * ((l.ele - eMin) / eSpan) : 0;
    addCand({ id: l.id, name: l.name, kind: l.kind, x, y, marker: true, ele: l.ele, base: KIND_WEIGHT[l.kind] + eleBonus });
  }

  if (s.kinds.lake) {
    for (const w of inp.water) {
      if (w.kind !== 'lake' || !w.name?.trim() || w.coords.length < 4) continue;
      const mm = w.coords.map(([la, lo]) => fit.toMm(la, lo));
      const area = ringArea(mm);
      if (area < MIN_LAKE_AREA_MM2) continue;
      const cx = mm.reduce((a, p) => a + p[0], 0) / mm.length;
      const cy = mm.reduce((a, p) => a + p[1], 0) / mm.length;
      addCand({ id: w.id, name: w.name, kind: 'lake', x: cx, y: cy, marker: false, base: KIND_WEIGHT.lake + Math.min(2, area / (frame.w * frame.h * 0.02)) });
    }
  }

  cands.sort((a, b) => b.score - a.score);
  // Same name + kind twice (OSM splits features): keep the strongest.
  const seen = new Set<string>();
  const unique = cands.filter((c) => {
    const k = `${c.kind}|${c.name.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, MAX_CANDIDATES);

  const taken: Box[] = [];
  const entries: LandmarkEntry[] = [];
  const labels: PlacedLabel[] = [];
  const gap = markerR * 0.7;
  const lb = inp.labelBounds ?? frame;
  const bounds: Box = { x0: lb.x, y0: lb.y, x1: lb.x + lb.w, y1: lb.y + lb.h };
  let placedCount = 0;

  for (const c of unique) {
    if (placedCount >= s.maxLabels || entries.length >= MAX_LISTED) break;
    const ov = s.overrides[c.id] ?? {};
    const name = (ov.name ?? c.name).trim() || c.name;
    const entry: LandmarkEntry = { id: c.id, name, kind: c.kind, hidden: !!ov.hidden, placed: false };
    entries.push(entry);
    if (entry.hidden) continue;

    const w = name.length * sizeMm * 0.56;
    const r = c.marker ? markerR : 0;
    const markerBox: Box = { x0: c.x - r, y0: c.y - r, x1: c.x + r, y1: c.y + r };
    const forced = ov.side && ov.side !== 'auto';
    const sides = c.marker ? sideOrder(ov.side ?? 'auto') : (['middle'] as const);

    for (const side of sides) {
      let label: PlacedLabel;
      let box: Box;
      const base = { id: c.id, kind: c.kind, marker: c.marker ? ([c.x, c.y] as XY) : undefined, text: name };
      if (side === 'right') {
        const x = c.x + r + gap;
        label = { ...base, x, y: c.y + sizeMm * 0.35, anchor: 'start' };
        box = { x0: x, y0: c.y - sizeMm * 0.55, x1: x + w, y1: c.y + sizeMm * 0.45 };
      } else if (side === 'left') {
        const x = c.x - r - gap;
        label = { ...base, x, y: c.y + sizeMm * 0.35, anchor: 'end' };
        box = { x0: x - w, y0: c.y - sizeMm * 0.55, x1: x, y1: c.y + sizeMm * 0.45 };
      } else if (side === 'above') {
        const y = c.y - r - gap;
        label = { ...base, x: c.x, y, anchor: 'middle' };
        box = { x0: c.x - w / 2, y0: y - sizeMm * 0.85, x1: c.x + w / 2, y1: y + sizeMm * 0.15 };
      } else if (side === 'below') {
        const y = c.y + r + gap + sizeMm * 0.8;
        label = { ...base, x: c.x, y, anchor: 'middle' };
        box = { x0: c.x - w / 2, y0: y - sizeMm * 0.85, x1: c.x + w / 2, y1: y + sizeMm * 0.15 };
      } else {
        label = { ...base, x: c.x, y: c.y + sizeMm * 0.35, anchor: 'middle' };
        box = { x0: c.x - w / 2, y0: c.y - sizeMm * 0.55, x1: c.x + w / 2, y1: c.y + sizeMm * 0.45 };
      }
      const inside = box.x0 >= bounds.x0 && box.x1 <= bounds.x1 && box.y0 >= bounds.y0 && box.y1 <= bounds.y1;
      const hitsRoute = route.length > 1 && clipPolylineHit(route, box);
      const clear = inside && !hitsRoute && !taken.some((t) => overlap(t, box)) && !(c.marker && side !== 'middle' && overlap(box, markerBox));
      if (clear || forced) {
        taken.push(box);
        if (c.marker) taken.push(markerBox);
        labels.push(label);
        entry.placed = true;
        placedCount++;
        break;
      }
    }
  }
  return { entries, labels };
}

function clipPolylineHit(route: XY[], b: Box): boolean {
  const rect = { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 };
  // Cheap pre-check per segment, then exact clip.
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const c = route[i]!;
    if (Math.max(a[0], c[0]) < rect.x || Math.min(a[0], c[0]) > rect.x + rect.w) continue;
    if (Math.max(a[1], c[1]) < rect.y || Math.min(a[1], c[1]) > rect.y + rect.h) continue;
    if (clipPolyline([a, c], rect).length > 0) return true;
  }
  return false;
}
