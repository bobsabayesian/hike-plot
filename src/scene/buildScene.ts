import { cleanTrack } from '../gpx/clean';
import { bbox, fitBBox, haversine, type BBox, type Fit } from '../geo/project';
import type { Rect } from '../geo/clip';
import {
  computeStats, formatCoords, formatDuration, formatFeet, formatKm, formatMeters, formatMiles,
  type TrackStats,
} from '../geo/stats';
import { autoInterval, contourPaths, fieldRange } from '../topo/contours';
import type { TerrainField } from '../topo/terrain';
import type { Prim, Scene } from './types';
import { posterMm, type InfoItem, type Placement, type Project, type StrokeStyle } from './project';

const PT = 25.4 / 72;
export const WATERMARK_TEXT = 'Generated with hike.bobsabayesian.io · free for non-commercial use';
export const FONTS = {
  sans: 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif',
  serif: '"Source Serif 4", Georgia, "Times New Roman", serif',
};
/** Minimum map extent (degrees) so a point-like feature (a single peak) still gets a useful view. */
export const MIN_SPAN_DEG = 0.06;

const f = (n: number) => +n.toFixed(3);
const polyline = (xy: [number, number][]) => xy.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('');

function dashFor(style: StrokeStyle, w: number): { dash?: number[]; round?: boolean } {
  if (style === 'dashed') return { dash: [w * 5, w * 3] };
  if (style === 'dotted') return { dash: [0, w * 2.5], round: true };
  return {};
}

export function autoDate(t?: number): string {
  return t === undefined
    ? ''
    : new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function expandMin(b: BBox, minSpan = MIN_SPAN_DEG): BBox {
  const out = { ...b };
  if (b.maxLat - b.minLat < minSpan) {
    const c = (b.maxLat + b.minLat) / 2;
    out.minLat = c - minSpan / 2;
    out.maxLat = c + minSpan / 2;
  }
  if (b.maxLon - b.minLon < minSpan) {
    const c = (b.maxLon + b.minLon) / 2;
    out.minLon = c - minSpan / 2;
    out.maxLon = c + minSpan / 2;
  }
  return out;
}

/** Values the text blocks auto-fill with. Empty string = nothing to show. */
export function autoValues(p: Project, stats?: TrackStats) {
  const imperial = p.units === 'imperial';
  const dist = (m: number) => (imperial ? formatMiles(m) : formatKm(m));
  const ele = (m: number) => (imperial ? formatFeet(m) : formatMeters(m));
  const center = stats?.peak ?? (p.points.length ? p.points[0] : undefined);
  const coordPt = center ?? (p.feature ? { lat: p.feature.lat, lon: p.feature.lon } : undefined);
  return {
    title: p.lookup.peakName ?? p.feature?.name ?? 'Untitled Hike',
    location: p.lookup.location ?? '',
    coords: coordPt ? formatCoords(coordPt.lat, coordPt.lon) : '',
    info: {
      distance: stats ? dist(stats.distanceM) : '',
      gain: stats ? ele(stats.gainM) : '',
      maxEle: stats?.maxEleM !== undefined ? ele(stats.maxEleM) : '',
      duration: stats?.durationMs !== undefined ? formatDuration(stats.durationMs) : '',
      date: autoDate(stats?.startTime),
    } as Record<InfoItem['key'], string>,
  };
}

interface Block { height: number; gapAfter: number; draw: (yTop: number) => Prim[] }

export interface View { frame: Rect; fit: Fit; bbox: BBox }
export interface Composed { scene: Scene; view?: View }

function compose(p: Project, terrain?: TerrainField, layoutOnly = false): Composed {
  const { w: W, h: H } = posterMm(p);
  const prims: Prim[] = [];
  const m = Math.min(W, H) * 0.07;
  const t = p.text;
  const fontFamily = FONTS[t.font];
  const anchor = t.align === 'left' ? 'start' : t.align === 'right' ? 'end' : 'middle';
  const tx = t.align === 'left' ? m : t.align === 'right' ? W - m : W / 2;
  const innerW = W - 2 * m;
  const stats = p.points.length ? computeStats(p.points) : undefined;
  const auto = autoValues(p, stats);
  const text = (s: string, y: number, sizeMm: number, extra: Partial<Extract<Prim, { kind: 'text' }>> = {}, x = tx): Prim => ({
    kind: 'text', text: s, x, y, anchor, sizeMm, trackingMm: sizeMm * t.trackingEm, fontFamily, fontKey: t.font, color: t.color, ...extra,
  });

  // ---- text blocks (height + draw), stacked from the top and bottom margins
  const blocks: Record<Placement, Block[]> = { top: [], bottom: [] };

  const title = (t.title.value ?? auto.title).trim();
  if (t.title.visible && title) {
    const size = t.title.sizePt * PT;
    blocks[t.title.placement].push({
      height: size * 0.75, gapAfter: size * 0.4,
      draw: (y) => [text(title.toUpperCase(), y + size * 0.72, size)],
    });
  }

  const loc = (t.location.value ?? auto.location).trim();
  const coords = t.location.showCoords ? auto.coords : '';
  if (t.location.visible && (loc || coords)) {
    const size = t.location.sizePt * PT;
    const small = size * 0.75;
    blocks[t.location.placement].push({
      height: (loc ? size * 0.75 : 0) + (loc && coords ? size * 0.5 : 0) + (coords ? small * 0.75 : 0),
      gapAfter: size * 0.8,
      draw: (y) => {
        const out: Prim[] = [];
        let cy = y;
        if (loc) { out.push(text(loc, cy + size * 0.72, size)); cy += size * 1.25; }
        if (coords) out.push(text(coords, cy + small * 0.72, small, { opacity: 0.7 }));
        return out;
      },
    });
  }

  const items = t.info.items
    .filter((i) => i.visible)
    .map((i) => ({ label: i.label, value: (i.value ?? auto.info[i.key]).trim() }))
    .filter((i) => i.value);
  if (t.info.visible && items.length) {
    const size = t.info.sizePt * PT;
    const ls = size * 0.45;
    const cell = ls * 1.5 + size * 0.75;
    const column = t.info.layout === 'column';
    const colGap = size * 0.6;
    const cellDraw = (it: (typeof items)[number], y: number, x: number): Prim[] => [
      text(it.label.toUpperCase(), y + ls * 0.72, ls, { opacity: 0.65 }, x),
      text(it.value, y + ls * 1.5 + size * 0.72, size, { trackingMm: size * t.trackingEm * 0.6 }, x),
    ];
    blocks[t.info.placement].push({
      height: column ? items.length * cell + (items.length - 1) * colGap : cell,
      gapAfter: size * 0.6,
      draw: (y) => {
        if (column) return items.flatMap((it, i) => cellDraw(it, y + i * (cell + colGap), tx));
        const cw = innerW / items.length;
        return items.flatMap((it, i) => {
          const x = t.align === 'left' ? m + i * cw : t.align === 'right' ? m + (i + 1) * cw : m + (i + 0.5) * cw;
          return cellDraw(it, y, x);
        });
      },
    });
  }

  let topCursor = m;
  if (!layoutOnly) for (const b of blocks.top) { prims.push(...b.draw(topCursor)); topCursor += b.height + b.gapAfter; }
  else for (const b of blocks.top) topCursor += b.height + b.gapAfter;

  let bottomCursor = H - m;
  if (p.showWatermark) {
    const size = 7 * PT;
    if (!layoutOnly) prims.push(text(WATERMARK_TEXT, bottomCursor, size, { trackingMm: size * 0.04, opacity: 0.55 }));
    bottomCursor -= size * 2.4;
  }
  for (const b of [...blocks.bottom].reverse()) {
    bottomCursor -= b.height;
    if (!layoutOnly) prims.push(...b.draw(bottomCursor));
    bottomCursor -= b.gapAfter;
  }

  // ---- map
  const gap = m * 0.4;
  const hasMap = p.points.length >= 2 || !!p.feature;
  let view: View | undefined;
  if (hasMap) {
    const profileH = p.profile.enabled && p.profile.position === 'bottom' && p.points.length ? H * 0.09 : 0;
    const frame: Rect = { x: m, y: topCursor, w: innerW, h: bottomCursor - topCursor - (profileH ? profileH + gap : 0) };
    const focus: BBox = p.points.length >= 2 ? bbox(p.points) : expandMin(p.feature!.bbox);
    const fit = fitBBox(focus, frame);
    const [la1, lo1] = fit.fromMm(frame.x, frame.y + frame.h);
    const [la2, lo2] = fit.fromMm(frame.x + frame.w, frame.y);
    view = { frame, fit, bbox: { minLat: Math.min(la1, la2), maxLat: Math.max(la1, la2), minLon: Math.min(lo1, lo2), maxLon: Math.max(lo1, lo2) } };

    if (!layoutOnly) {
      if (p.terrain.enabled && terrain) {
        const [lo, hi] = fieldRange(terrain);
        const interval = p.terrain.intervalM > 0 ? p.terrain.intervalM : autoInterval(lo, hi);
        const paths = contourPaths(terrain, fit, frame, interval, p.terrain.indexEvery);
        const tc = p.terrain;
        if (paths.regular) prims.push({ kind: 'path', d: paths.regular, color: tc.color, mode: 'stroke', widthMm: tc.weightMm, opacity: tc.opacity });
        if (paths.index) prims.push({ kind: 'path', d: paths.index, color: tc.color, mode: 'stroke', widthMm: tc.indexWeightMm, opacity: tc.opacity });
      }

      if (p.points.length >= 2) {
        const clean = cleanTrack(p.points, fit.metersPerMm * 0.1);
        const xy = clean.map((q) => fit.toMm(q.lat, q.lon));

        if (p.profile.enabled) {
          const corner = p.profile.position === 'corner';
          const pw = corner ? innerW * 0.4 : innerW;
          const ph = corner ? H * 0.08 : profileH;
          const px = corner ? W - m - pw : m;
          const py = corner ? frame.y + frame.h - ph : frame.y + frame.h + gap;
          const withEle = clean.filter((q) => q.ele !== undefined);
          if (withEle.length >= 2) {
            let d = 0;
            const series = withEle.map((q, i) => {
              if (i) d += haversine(withEle[i - 1]!.lat, withEle[i - 1]!.lon, q.lat, q.lon);
              return { d, e: q.ele! };
            });
            const eMin = Math.min(...series.map((s) => s.e));
            const eMax = Math.max(...series.map((s) => s.e));
            const span = Math.max(eMax - eMin, 1);
            const line = series.map((s): [number, number] => [px + (s.d / (d || 1)) * pw, py + ph - ((s.e - eMin) / span) * ph * 0.92 - ph * 0.04]);
            const topLine = polyline(line);
            prims.push({ kind: 'path', d: `${topLine}L${f(px + pw)} ${f(py + ph)}L${f(px)} ${f(py + ph)}Z`, color: p.profile.fill, mode: 'fill', opacity: p.profile.opacity });
            prims.push({ kind: 'path', d: topLine, color: p.profile.stroke, mode: 'stroke', widthMm: 0.4 });
          }
        }

        prims.push({
          kind: 'path', d: polyline(xy), color: p.route.color, mode: 'stroke', widthMm: p.route.weightMm,
          ...dashFor(p.route.style, p.route.weightMm),
        });
      }
    }
  }

  return { scene: { widthMm: W, heightMm: H, paper: p.paper, prims }, view };
}

export const buildScene = (p: Project, terrain?: TerrainField): Scene => compose(p, terrain).scene;

/** The geographic area the map frame shows; terrain must cover this. Cheap (no route/contour work). */
export const viewBBox = (p: Project): BBox | undefined => compose(p, undefined, true).view?.bbox;
