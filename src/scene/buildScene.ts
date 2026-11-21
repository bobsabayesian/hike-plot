import { cleanTrack } from '../gpx/clean';
import { bbox, bboxCenter, fitBBox, fitScale, groundMetersPerMm, haversine, MAP_SCALES, type BBox, type Fit } from '../geo/project';
import { toMgrs } from '../geo/utm';
import type { Rect } from '../geo/clip';
import {
  computeStats, metersToFeet, formatCoords, formatDuration, formatFeet, formatKm, formatMeters, formatMiles,
  type TrackStats,
} from '../geo/stats';
import { contourInterval, contourPaths, toD } from '../topo/contours';
import { resolveCustom } from '../features/custom';
import { cutNearRoute, cutOutHalos } from '../features/halo';
import { buildRelief, contourLines, needsHiding, pageLines, ridgeRowLines, type Relief } from '../relief/relief';
import { buildSurface } from '../relief/surface';
import { baseLines, strataLevels } from '../relief/base';
import { band, depthOf, splitFar, thinLine } from '../relief/fade';
import { distanceTicks, everyAlong, tickLabel, tickMark, tickMeters } from './routeMarks';
import { thinUnder } from '../cover/thin';
import { buildShadeMap, extraShare, splitByShade } from '../relief/shade';
import { coverMask, markSymbol, patternMarks, type Mask } from '../cover/draw';
import { COVER_CLASSES, type CoverClass } from '../cover/types';
import { buildVisibility, visibleRuns, type P3 } from '../relief/visibility';
import type { TerrainField } from '../topo/terrain';
import { landmarkPrims, waterLinesPrim, waterPrims } from '../features/draw';
import { clipPolyline } from '../geo/clip';
import type { LandmarkEntry, LandmarkPlacement } from '../features/select';
import { penKeyOf, type OsmData } from '../features/types';
import type { XY } from '../geo/clip';
import { northBox, northPrims } from './north';
import { gridLabelRoom, gridLayout, gridPrims, legendHeight, legendPrims } from './grid';
import { borderPrims, layoutBorder } from './border';
import { featurePenId, inkWidth, penFor } from './pens';
import { formatLevel, linesWithGaps, pathsWithGaps, placeContourLabels } from '../topo/contourLabels';
import type { Box } from '../features/select';
import type { Part, PathPrim, Prim, Scene } from './types';
import { clampMargins, posterMm, type InfoItem, type Placement, type Project, type StrokeStyle } from './project';

const PT = 25.4 / 72;
/** Poster title when there is no name to use (no GPX peak name and no searched feature). */
export const DEFAULT_TITLE = 'Walk of Frame';
export const WATERMARK_TEXT = 'Generated with hike.bobsabayesian.io · free for non-commercial use';
export const FONTS = {
  sans: 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif',
  serif: '"Source Serif 4", Georgia, "Times New Roman", serif',
};
/** Minimum map extent (degrees) so a point-like feature (a single peak) still gets a useful view. */
export const MIN_SPAN_DEG = 0.06;

const f = (n: number) => +n.toFixed(3);
const circle = (cx: number, cy: number, r: number) =>
  `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;

/** Round-number tick values within [lo, hi], aiming for about `target` ticks. */
export function niceTicks(lo: number, hi: number, target: number): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [];
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((k) => k * mag >= raw) ?? 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
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

/** The area a typed feature is shown at: `spanKm` square if set, else the feature's own extent (at least ~6 km). */
export function featureView(f: NonNullable<Project['feature']>): BBox {
  if (f.spanKm === undefined) return expandMin(f.bbox);
  const lat = (f.bbox.minLat + f.bbox.maxLat) / 2;
  const lon = (f.bbox.minLon + f.bbox.maxLon) / 2;
  const dLat = f.spanKm / 110.57 / 2;
  const dLon = f.spanKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.05)) / 2;
  return { minLat: lat - dLat, maxLat: lat + dLat, minLon: lon - dLon, maxLon: lon + dLon };
}

/**
 * The area a GPX route is shown at: the route's own extent, grown to at least `spanKm` each way around its center
 * when that is set (never smaller, so the route is never cut off).
 */
export function routeView(points: { lat: number; lon: number }[], spanKm?: number): BBox {
  const b = bbox(points);
  if (spanKm === undefined) return b;
  const lat = (b.minLat + b.maxLat) / 2;
  const lon = (b.minLon + b.maxLon) / 2;
  const dLat = Math.max(spanKm / 110.57, b.maxLat - b.minLat) / 2;
  const dLon = Math.max(spanKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.05)), b.maxLon - b.minLon) / 2;
  // min/max so rounding in the center can never leave a sliver of the route outside
  return { minLat: Math.min(lat - dLat, b.minLat), maxLat: Math.max(lat + dLat, b.maxLat), minLon: Math.min(lon - dLon, b.minLon), maxLon: Math.max(lon + dLon, b.maxLon) };
}

/** Rough size of a view in km (width, height). */
export function viewSizeKm(b: BBox): [number, number] {
  const lat = (b.minLat + b.maxLat) / 2;
  return [(b.maxLon - b.minLon) * 111.32 * Math.cos((lat * Math.PI) / 180), (b.maxLat - b.minLat) * 110.57];
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
export function autoValues(p: Project, stats?: TrackStats, contourM?: number) {
  const imperial = p.units === 'imperial';
  const dist = (m: number) => (imperial ? formatMiles(m) : formatKm(m));
  const ele = (m: number) => (imperial ? formatFeet(m) : formatMeters(m));
  const center = stats?.peak ?? (p.points.length ? p.points[0] : undefined);
  const coordPt = center ?? (p.feature ? { lat: p.feature.lat, lon: p.feature.lon } : undefined);
  return {
    title: p.lookup.peakName ?? p.feature?.name ?? DEFAULT_TITLE,
    location: p.lookup.location ?? '',
    coords: coordPt ? (p.text.location.coordFormat === 'mgrs' ? toMgrs(coordPt.lat, coordPt.lon, 4) : formatCoords(coordPt.lat, coordPt.lon)) : '',
    /** the point the coordinates are for, and what it is */
    coordPt,
    coordWhat: center ? (stats?.peak ? 'HIGH POINT' : 'START') : (p.feature?.name ?? '').toUpperCase(),
    info: {
      distance: stats ? dist(stats.distanceM) : '',
      gain: stats ? ele(stats.gainM) : '',
      maxEle: stats?.maxEleM !== undefined ? ele(stats.maxEleM) : '',
      duration: stats?.durationMs !== undefined ? formatDuration(stats.durationMs) : '',
      date: autoDate(stats?.startTime),
      contour: contourM ? (imperial ? `${contourM} m (${Math.round(metersToFeet(contourM))} ft)` : `${contourM} m`) : '',
    } as Record<InfoItem['key'], string>,
  };
}

interface Block { part: Part; height: number; gapAfter: number; draw: (yTop: number) => Prim[] }

export interface View {
  frame: Rect; fit: Fit; bbox: BBox;
  /** the fixed scale the map is drawn at (denominator), if one is set: the one asked for, or the next that holds the route */
  scale?: number;
}
export interface Composed { scene: Scene; view?: View; landmarks?: LandmarkEntry[]; pool?: LandmarkPlacement['pool']; open?: LandmarkPlacement['open'] }

function compose(p: Project, terrain?: TerrainField, layoutOnly = false, osm?: OsmData): Composed {
  const { w: W, h: H } = posterMm(p);
  const prims: Prim[] = [];
  const mg = clampMargins(p.page.margins, W, H); // explicit page margins, paper edge to content
  const minMargin = Math.min(mg.top, mg.right, mg.bottom, mg.left);
  const t = p.text;
  const colorOf = (penId: string) => penFor(p.pens, penId).color;
  /** mark everything added since `start` as drawing `part` (what the preview opens when it is clicked) */
  const tagFrom = (start: number, part: Part) => { for (let i = start; i < prims.length; i++) prims[i]!.part ??= part; };
  // the border goes first so it is drawn under everything else
  if (!layoutOnly) { prims.push(...borderPrims(W, H, p.border, mg, colorOf(p.border.pen))); tagFrom(0, 'border'); }
  const fontFamily = FONTS[t.font];
  const anchor = t.align === 'left' ? 'start' : t.align === 'right' ? 'end' : 'middle';
  const contentL = mg.left;
  const contentR = W - mg.right;
  const tx = t.align === 'left' ? contentL : t.align === 'right' ? contentR : (contentL + contentR) / 2;
  const innerW = contentR - contentL;
  const stats = p.points.length ? computeStats(p.points) : undefined;
  const wantsTerrain = p.terrain.enabled || p.relief.enabled;
  const interval = wantsTerrain && terrain ? contourInterval(p.terrain.intervalM, terrain) : undefined;
  const auto = autoValues(p, stats, interval);
  const text = (penId: string, s: string, y: number, sizeMm: number, extra: Partial<Extract<Prim, { kind: 'text' }>> = {}, x = tx): Prim => ({
    kind: 'text', text: s, x, y, anchor, sizeMm, trackingMm: sizeMm * t.trackingEm, fontFamily, fontKey: t.font, color: colorOf(penId), pen: penId, ...extra,
  });

  // ---- text blocks (height + draw), stacked from the top and bottom margins
  const blocks: Record<Placement, Block[]> = { top: [], bottom: [] };

  const title = (t.title.value ?? auto.title).trim();
  if (t.title.visible && title) {
    const ts = t.title;
    const size = ts.sizePt * PT;
    const align = ts.align === 'inherit' ? t.align : ts.align;
    const justify = align === 'justify';
    const where = {
      anchor: (justify || align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle') as 'start' | 'middle' | 'end',
      x: justify || align === 'left' ? contentL : align === 'right' ? contentR : (contentL + contentR) / 2,
      ...(justify ? { fitWidthMm: innerW } : {}),
    };
    const { x: titleX, ...place } = where;
    blocks[ts.placement].push({
      part: 'title', height: size * 0.75, gapAfter: size * 0.4,
      draw: (y) => {
        const base = y + size * 0.72;
        const outline = { ...place, mode: 'stroke' as const, strokeMm: ts.outlineMm };
        if (ts.style === 'outline') return [text(ts.pen, title.toUpperCase(), base, size, outline, titleX)];
        // inside first, so the outline sits on top of it
        if (ts.style === 'outlineFill') return [
          text(ts.fillPen, title.toUpperCase(), base, size, { ...place, hatch: ts.fillDensity }, titleX),
          text(ts.pen, title.toUpperCase(), base, size, outline, titleX),
        ];
        return [text(ts.pen, title.toUpperCase(), base, size, { ...place, plotFill: ts.fillDensity }, titleX)];
      },
    });
  }

  const loc = (t.location.value ?? auto.location).trim();
  const coords = t.location.showCoords ? auto.coords : '';
  if (t.location.visible && (loc || coords)) {
    const size = t.location.sizePt * PT;
    const small = size * 0.75;
    blocks[t.location.placement].push({
      part: 'location', height: (loc ? size * 0.75 : 0) + (loc && coords ? size * 0.5 : 0) + (coords ? small * 0.75 : 0),
      gapAfter: size * 0.8,
      draw: (y) => {
        const out: Prim[] = [];
        let cy = y;
        if (loc) { out.push(text(t.location.pen, loc, cy + size * 0.72, size)); cy += size * 1.25; }
        if (coords) out.push(text(t.location.pen, coords, cy + small * 0.72, small, { opacity: 0.7 }));
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
      text(t.info.pen, it.label.toUpperCase(), y + ls * 0.72, ls, { opacity: 0.65 }, x),
      text(t.info.pen, it.value, y + ls * 1.5 + size * 0.72, size, { trackingMm: size * t.trackingEm * 0.6 }, x),
    ];
    blocks[t.info.placement].push({
      part: 'info', height: column ? items.length * cell + (items.length - 1) * colGap : cell,
      gapAfter: size * 0.6,
      draw: (y) => {
        if (column) return items.flatMap((it, i) => cellDraw(it, y + i * (cell + colGap), tx));
        const cw = innerW / items.length;
        return items.flatMap((it, i) => {
          const x = t.align === 'left' ? contentL + i * cw : t.align === 'right' ? contentL + (i + 1) * cw : contentL + (i + 0.5) * cw;
          return cellDraw(it, y, x);
        });
      },
    });
  }

  // the map grid's legend (scale bars and notes) sits right under the map; what it says is known once the map is
  const gridOn = p.grid.enabled && !p.relief.enabled && (p.points.length >= 2 || !!p.feature);
  let legendY: number | undefined;
  if (gridOn && p.grid.legend) {
    const lh = legendHeight(p.grid);
    blocks.bottom.unshift({ part: 'grid', height: lh, gapAfter: lh * 0.35, draw: (y) => { legendY = y; return []; } });
  }

  let topCursor = mg.top;
  if (!layoutOnly) for (const b of blocks.top) { const at = prims.length; prims.push(...b.draw(topCursor)); tagFrom(at, b.part); topCursor += b.height + b.gapAfter; }
  else for (const b of blocks.top) topCursor += b.height + b.gapAfter;

  let bottomCursor = H - mg.bottom;
  if (p.showWatermark) {
    const size = 7 * PT;
    if (!layoutOnly) prims.push(text(p.watermarkPen, WATERMARK_TEXT, bottomCursor, size, { trackingMm: size * 0.04, opacity: 0.55, part: 'watermark' }));
    bottomCursor -= size * 2.4;
  }
  for (const b of [...blocks.bottom].reverse()) {
    bottomCursor -= b.height;
    if (!layoutOnly) { const at = prims.length; prims.push(...b.draw(bottomCursor)); tagFrom(at, b.part); }
    bottomCursor -= b.gapAfter;
  }

  // ---- map
  const gap = Math.max(6, minMargin * 0.4);
  const hasMap = p.points.length >= 2 || !!p.feature;
  let view: View | undefined;
  let landmarks: LandmarkEntry[] | undefined;
  let pool: LandmarkPlacement['pool'] | undefined;
  let open: LandmarkPlacement['open'] | undefined;
  if (hasMap) {
    const profileH = p.profile.enabled && p.profile.position === 'bottom' && p.points.length ? H * 0.09 : 0;
    // distance tick labels hang below the profile, so reserve room for them
    const tickPad = p.profile.enabled && p.profile.labels.xTicks && p.points.length ? p.profile.labels.sizePt * PT * 2.4 : 0;
    // grid numbers go just outside the map: keep room for them above and below (and at the sides if the margin is thin)
    const padY = gridOn && p.grid.labels ? gridLabelRoom(p.grid) : 0;
    const padX = padY ? Math.max(0, p.grid.labelSizePt * PT * 4.4 + 2 - Math.min(mg.left, mg.right)) : 0;
    const frame: Rect = { x: contentL + padX, y: topCursor + padY, w: innerW - 2 * padX, h: bottomCursor - topCursor - (profileH ? profileH + gap : 0) - tickPad - 2 * padY };
    const focus: BBox = p.points.length >= 2 ? routeView(p.points, p.routeSpanKm) : featureView(p.feature!);
    let fit = fitBBox(focus, frame);
    let fixedScale: number | undefined;
    if (p.mapScale > 0) {
      // a fixed scale, centered on the route or place; a bigger standard scale if the whole route would not fit
      const holds = p.points.length >= 2 ? bbox(p.points) : undefined;
      const [cLat, cLon] = bboxCenter(holds ?? focus);
      for (const s of [p.mapScale, ...MAP_SCALES.filter((x) => x > p.mapScale)]) {
        const f = fitScale(cLat, cLon, frame, s);
        const fits = !holds || [[holds.minLat, holds.minLon], [holds.maxLat, holds.maxLon]].every(([la, lo]) => {
          const [x, y] = f.toMm(la!, lo!);
          return x >= frame.x - 1e-6 && x <= frame.x + frame.w + 1e-6 && y >= frame.y - 1e-6 && y <= frame.y + frame.h + 1e-6;
        });
        if (fits) { fit = f; fixedScale = s; break; }
      }
    }
    const [la1, lo1] = fit.fromMm(frame.x, frame.y + frame.h);
    const [la2, lo2] = fit.fromMm(frame.x + frame.w, frame.y);
    view = { frame, fit, ...(fixedScale ? { scale: fixedScale } : {}), bbox: { minLat: Math.min(la1, la2), maxLat: Math.max(la1, la2), minLon: Math.min(lo1, lo2), maxLon: Math.max(lo1, lo2) } };

    if (!layoutOnly) {
      // The route and the landmark labels are worked out first: contour numbers have to stay clear of both.
      // Labels may spill a little into the margin, but never onto or past the border.
      const innerBorder = p.border.enabled ? layoutBorder(W, H, p.border, mg).rects.at(-1)!.x + p.border.weightMm / 2 + 1.5 : 0;
      const withinBorder = (r: Rect): Rect => {
        const x0 = Math.max(r.x, innerBorder);
        const y0 = Math.max(r.y, innerBorder);
        return { x: x0, y: y0, w: Math.min(r.x + r.w, W - innerBorder) - x0, h: Math.min(r.y + r.h, H - innerBorder) - y0 };
      };
      // In 3D, every place on the map is found through a fit that follows the terrain; the flat fit still frames the view.
      const relief: Relief | undefined = p.relief.enabled && terrain ? buildRelief(terrain, fit, frame, p.relief, p.points) : undefined;
      const mapFit = relief?.fit ?? fit;
      // hills hide what is behind them (the route stays on top)
      const vis = relief && needsHiding(p.relief) ? buildVisibility(relief) : undefined;
      // a zoomed 3D view runs past the frame: everything drawn on the map is trimmed at its edges
      const zoomed = !!relief && (p.relief.zoom ?? 100) > 100;
      const inFrame = (lines: XY[][]): XY[][] => (zoomed ? lines.flatMap((l) => clipPolyline(l, frame)) : lines);
      const frameHas = ([x, y]: XY) => !zoomed || (x >= frame.x && x <= frame.x + frame.w && y >= frame.y && y <= frame.y + frame.h);
      const onSurface = (lat: number, lon: number): P3 => { const [x, y] = fit.toMm(lat, lon); return [x, y, relief!.heightMm(relief!.surface.sample(x, y))]; };
      const clean = p.points.length >= 2 ? cleanTrack(p.points, groundMetersPerMm(fit, frame) * 0.1) : [];
      // in 3D the route can float above the ground (lines dropped from it show the gap)
      const lift = relief ? Math.max(0, p.route.liftMm ?? 0) : 0;
      const routeAt = (lat: number, lon: number): XY => {
        if (!lift) return mapFit.toMm(lat, lon);
        const q = onSurface(lat, lon);
        return relief!.camera.project(q[0], q[1], q[2] + lift);
      };
      const routeXY: XY[] = clean.map((q) => routeAt(q.lat, q.lon));

      const labelObstacles: Box[] = [];
      if (p.north.enabled) {
        const nb = northBox(frame, p.north.corner, p.north.sizeMm);
        labelObstacles.push({ cx: nb.x + p.north.sizeMm / 2, cy: nb.y + p.north.sizeMm / 2, w: p.north.sizeMm, h: p.north.sizeMm, ang: 0 });
      }
      if (p.profile.enabled && p.profile.position === 'corner' && p.points.length)
        labelObstacles.push({ cx: contentR - innerW * 0.2, cy: frame.y + frame.h - H * 0.04, w: innerW * 0.4, h: H * 0.08, ang: 0 });
      let landmarkOut: ReturnType<typeof landmarkPrims> | undefined;
      if (p.features.enabled) {
        const sizeMm = p.features.sizePt * PT;
        landmarkOut = landmarkPrims({
          landmarks: [...resolveCustom(p.customLandmarks ?? [], p.points), ...p.waypoints, ...(osm?.landmarks ?? [])],
          water: osm?.water ?? [],
          waterNames: osm?.waterNames ?? [],
          fit: mapFit, frame, route: routeXY,
          visible: vis || zoomed ? (la, lo) => {
            const q = onSurface(la, lo);
            // tested a little above the ground, so a summit is not judged hidden behind its own crest
            return frameHas(relief!.camera.project(q[0], q[1], q[2])) && (!vis || vis.isVisible(q[0], q[1], q[2] + LANDMARK_LIFT_MM));
          } : undefined,
          labelBounds: withinBorder({ x: frame.x - mg.left * 0.5, y: frame.y - mg.top * 0.5, w: frame.w + (mg.left + mg.right) * 0.5, h: frame.h + mg.top * 0.5 }), settings: p.features, sizeMm,
          markerR: Math.min(W, H) * 0.0045,
          obstacles: labelObstacles,
          penFor: (kind) => penFor(p.pens, featurePenId(p.features, penKeyOf(kind))),
          fontFamily, fontKey: t.font, trackingMm: sizeMm * 0.05,
        });
      }

      const halos = landmarkOut?.halos ?? [];
      // clear paper beside the route: half of what the route draws (its weight, or the pen's line if that is wider) plus the gap
      const routeClearR = (p.route.clearMm ?? 0) > 0 && routeXY.length >= 2 ? Math.max(p.route.weightMm, inkWidth(penFor(p.pens, p.route.pen))) / 2 + p.route.clearMm! : 0;
      const clearLines = (lines: XY[][]): XY[][] => cutNearRoute(cutOutHalos(inFrame(lines), halos), routeXY, routeClearR);
      // heavy lines and their numbers: their own pen if one is set (its tip makes them heavier, so no forced second pass), else the regular pen, drawn twice over
      const majorPen = p.terrain.indexPen !== undefined && p.terrain.indexPen !== p.terrain.pen ? p.terrain.indexPen : undefined;
      const heavyPen = majorPen ?? p.terrain.pen;
      const majorPasses = majorPen ? {} : { minPasses: 2 };
      // land cover: where each kind is on the flat map; kinds left as clear paper cut the terrain lines away
      const coverMasks = new Map<CoverClass, Mask>();
      if (p.cover.enabled && osm?.cover?.length) {
        for (const c of COVER_CLASSES) {
          if (!p.cover.classes[c].on) continue;
          const m = coverMask(osm.cover.filter((s) => s.cls === c), fit.toMm, frame);
          if (!m.empty) coverMasks.set(c, m);
        }
      }
      const clearMasks = [...coverMasks].filter(([c]) => p.cover.classes[c].pattern === 'clear').map(([, m]) => m);
      // kinds that only thin the terrain lines under them: how much to clear (0 to 1), where each one is
      const thinMasks = [...coverMasks].filter(([c]) => p.cover.classes[c].pattern !== 'clear' && (p.cover.classes[c].clearPct ?? 0) > 0)
        .map(([c, mask]) => ({ mask, share: Math.min(1, (p.cover.classes[c].clearPct ?? 0) / 100) }));
      const thinShare = (x: number, y: number): number => { let f = 0; for (const t of thinMasks) if (t.share > f && t.mask.has(x, y)) f = t.share; return f; };
      /** terrain lines (flat-map points first) with the parts over clear-paper cover cut away, and those over thinning cover broken into dashes */
      const uncover = <T extends readonly number[]>(lines: T[][]): T[][] => {
        const bare = clearMasks.length ? splitByShade(lines, (x, y) => clearMasks.some((m) => m.has(x, y))).lit : lines;
        return thinMasks.length ? thinUnder(bare, thinShare) : bare;
      };
      const terrainAt = prims.length;
      // light and shade: where the ground faces away from the sun, lines are drawn darker and extra lines go between them
      const sh = p.shade;
      const shadeMap = sh.enabled && terrain && (relief || p.terrain.enabled)
        ? buildShadeMap(relief?.surface ?? buildSurface(terrain, fit, frame), groundMetersPerMm(fit, frame), sh.sunAzimuth, sh.sunAltitude)
        : undefined;
      const inShade = (share: number) => { const cut = shadeMap!.cut(share / 100); return (x: number, y: number) => shadeMap!.darkness(x, y) > cut; };
      const shadePen = sh.pen ?? p.terrain.pen;
      /** the regular lines (flat-map points, anything after kept) split into lit and dark, drawn through `toPage` */
      const shadeLines = <T extends readonly number[]>(lines: T[][], toPage: (ls: T[][]) => XY[][], weightMm: number, base: Omit<PathPrim, 'kind' | 'd' | 'widthMm'>): XY[][] => {
        lines = uncover(lines);
        if (!shadeMap) return toPage(lines);
        const { lit, dark } = splitByShade(lines, inShade(sh.amount));
        const darkPage = clearLines(toPage(dark));
        if (darkPage.length) {
          const darkPaint = !sh.darken ? { widthMm: weightMm, ...base }
            : shadePen === p.terrain.pen ? { widthMm: weightMm * 1.6, ...base, minPasses: 2 }
            : { widthMm: weightMm, ...base, color: colorOf(shadePen), pen: shadePen };
          prims.push({ kind: 'path', d: toD(darkPage), ...darkPaint });
        }
        return toPage(lit);
      };
      /** in-between lines, step 1..extra between each pair of regular lines: only their parts in the shade */
      const pushExtra = <T extends readonly number[]>(steps: { step: number; lines: T[][] }[], toPage: (ls: T[][]) => XY[][], weightMm: number) => {
        const out: XY[][] = [];
        for (const { step, lines } of steps) out.push(...toPage(splitByShade(uncover(lines), inShade(extraShare(step, sh.extra, sh.amount))).dark));
        const cleared = clearLines(out);
        if (cleared.length) prims.push({ kind: 'path', d: toD(cleared), widthMm: weightMm, color: colorOf(shadePen), pen: shadePen, mode: 'stroke', opacity: p.terrain.opacity });
      };
      /** contours at a finer interval, sorted by which in-between step they are; `pt` makes each point (e.g. lifts it to its level) */
      const extraContours = <T extends readonly number[]>(pt: (q: XY, level: number) => T) => {
        const sub = interval! / (sh.extra + 1);
        const steps = new Map<number, T[][]>();
        for (const pc of contourPaths(terrain!, fit, frame, sub, 0).pieces) {
          const step = ((Math.round(pc.level / sub) % (sh.extra + 1)) + sh.extra + 1) % (sh.extra + 1);
          if (step) steps.set(step, [...(steps.get(step) ?? []), pc.pts.map((q) => pt(q, pc.level))]);
        }
        return [...steps].map(([step, lines]) => ({ step, lines }));
      };
      if (relief && terrain) {
        // the terrain in 3D: contours lifted onto the surface, and/or evenly spaced slices across it
        const tc = p.terrain;
        const style = p.relief.style;
        const paint = { color: colorOf(tc.pen), pen: tc.pen, mode: 'stroke' as const, opacity: tc.opacity };
        const heavy = { ...paint, ...(majorPen ? { color: colorOf(majorPen), pen: majorPen } : {}) };
        const toPage = (ls: P3[][]) => pageLines(relief, ls, vis);
        // lighter lines in the distance: fewer of them far back, and/or a lighter pen there
        const fade = p.relief.fade;
        const depthT = fade?.enabled ? depthOf(relief) : undefined;
        const bandAt = (x: number, y: number) => band(depthT!(x, y), fade.startPct);
        const thin = <T extends readonly number[]>(lines: T[][], indexOf: (k: number) => number): T[][] =>
          depthT && fade.fewer ? lines.flatMap((l, k) => thinLine(l, indexOf(k), bandAt)) : lines;
        const farPen = depthT && fade.pen !== undefined && fade.pen !== tc.pen ? fade.pen : undefined;
        const farPaint = farPen ? { color: colorOf(farPen), pen: farPen } : {};
        /** draw near lines in their own paint and, with a far pen, the far parts in it */
        const nearFar = (lines: P3[][], draw: (ls: P3[][], far: boolean) => void) => {
          if (!farPen) return draw(lines, false);
          const { near, far } = splitFar(lines, bandAt);
          draw(near, false);
          draw(far, true);
        };
        if (style !== 'rows') {
          const pieces = contourPaths(terrain, fit, frame, interval!, tc.indexEvery).pieces;
          const lines = contourLines(relief, pieces);
          const levels = pieces.filter((pc) => !pc.heavy).map((pc) => pc.level);
          // 'both' keeps only the heavy index lines over the rows: they read as elevation marks on the slices
          if (style === 'contours' || style === 'rowsAll') {
            nearFar(thin(lines.regular, (k) => Math.round(levels[k]! / interval!)), (ls, far) => {
              const pnt = { ...paint, ...(far ? farPaint : {}) };
              const regular = clearLines(shadeLines(ls, toPage, tc.weightMm, pnt));
              if (regular.length) prims.push({ kind: 'path', d: toD(regular), widthMm: tc.weightMm, ...pnt });
            });
            // a finer contour is lifted to its own level, like the regular ones (with rows, the extra lines are rows)
            if (style === 'contours' && shadeMap && sh.extra) pushExtra(extraContours(([x, y], level): P3 => [x, y, relief.heightMm(level)]), toPage, tc.weightMm);
          }
          nearFar(lines.index, (ls, far) => {
            const index = clearLines(toPage(uncover(ls)));
            if (index.length) prims.push({ kind: 'path', d: toD(index), widthMm: tc.indexWeightMm, ...majorPasses, ...heavy, ...(far ? farPaint : {}) });
          });
        }
        if (style !== 'contours') {
          const rowPage = (ls: P3[][]) => pageLines(relief, ls, vis, true);
          nearFar(thin(ridgeRowLines(relief, p.relief.rows), (k) => k), (ls, far) => {
            const pnt = { ...paint, ...(far ? farPaint : {}) };
            const rows = clearLines(shadeLines(ls, rowPage, p.relief.rowWeightMm, pnt));
            prims.push({ kind: 'path', d: toD(rows), widthMm: p.relief.rowWeightMm, ...pnt });
          });
          if (shadeMap && sh.extra) {
            const n = Math.max(2, Math.round(p.relief.rows));
            const fine = ridgeRowLines(relief, (n - 1) * (sh.extra + 1) + 1);
            const steps = new Map<number, P3[][]>();
            fine.forEach((line, m) => { const step = m % (sh.extra + 1); if (step) steps.set(step, [...(steps.get(step) ?? []), line]); });
            pushExtra([...steps].map(([step, lines]) => ({ step, lines })), rowPage, p.relief.rowWeightMm);
          }
        }
        const base = p.relief.base;
        if (base.enabled) {
          // a solid base: walls on the sides facing the viewer, outlined heavy, with strata or hatching on them
          const stepM = base.faces === 'strata' ? interval! : base.faces === 'strataHeavy' ? interval! * (tc.indexEvery > 0 ? tc.indexEvery : 5) : 0;
          const lines = baseLines(relief, base, p.relief, strataLevels(relief, base.depthMm, stepM));
          const basePen = base.pen ?? tc.pen;
          const basePaint = { color: colorOf(basePen), pen: basePen, mode: 'stroke' as const, opacity: tc.opacity };
          const outline = clearLines(lines.outline);
          const faces = clearLines(lines.faces);
          if (faces.length) prims.push({ kind: 'path', d: toD(faces), widthMm: tc.weightMm, ...basePaint });
          if (outline.length) prims.push({ kind: 'path', d: toD(outline), widthMm: tc.indexWeightMm, ...basePaint, ...(basePen === tc.pen ? { minPasses: 2 } : {}) });
        }
      } else if (p.terrain.enabled && terrain) {
        const paths = contourPaths(terrain, fit, frame, interval!, p.terrain.indexEvery);
        const tc = p.terrain;
        let { regular, index } = paths;
        let pieces = paths.pieces;
        if (halos.length || routeClearR > 0 || clearMasks.length || thinMasks.length) {
          // room around labels and beside the route, and clear-paper cover: cut the contours there (the pieces stay consistent for the numbers below)
          pieces = pieces.flatMap((pc) => clearLines(uncover([pc.pts])).map((pts) => ({ ...pc, pts })));
          regular = toD(pieces.filter((x) => !x.heavy).map((x) => x.pts));
          index = toD(pieces.filter((x) => x.heavy).map((x) => x.pts));
        }
        let numbers: ReturnType<typeof placeContourLabels> = [];
        if (tc.labels.enabled && tc.indexEvery > 0) {
          const avoid: Box[] = [...(landmarkOut?.obstacles ?? [])];
          if (p.north.enabled) {
            const nb = northBox(frame, p.north.corner, p.north.sizeMm);
            avoid.push({ cx: nb.x + p.north.sizeMm / 2, cy: nb.y + p.north.sizeMm / 2, w: p.north.sizeMm, h: p.north.sizeMm, ang: 0 });
          }
          if (p.profile.enabled && p.profile.position === 'corner' && p.points.length)
            avoid.push({ cx: contentR - innerW * 0.2, cy: frame.y + frame.h - H * 0.04, w: innerW * 0.4, h: H * 0.08, ang: 0 });
          numbers = placeContourLabels(pieces, {
            intervalM: interval!, indexEvery: tc.indexEvery, every: tc.labels.every, density: tc.labels.density, gap: tc.labels.gap,
            sizePt: tc.labels.sizePt, format: (lv) => formatLevel(lv, p.units), frame, obstacles: avoid, route: routeXY, fontKey: t.font,
          });
          if (numbers.length && tc.labels.gap) ({ regular, index } = pathsWithGaps(pieces, numbers, tc.labels.sizePt));
        }
        if (shadeMap) {
          // the regular lines as points again (with their number gaps), split into light and shade
          const lines = numbers.length && tc.labels.gap ? linesWithGaps(pieces, numbers, tc.labels.sizePt).regular : pieces.filter((x) => !x.heavy).map((x) => x.pts);
          const paint = { color: colorOf(tc.pen), pen: tc.pen, mode: 'stroke' as const, opacity: tc.opacity };
          regular = toD(shadeLines(lines, (ls) => ls, tc.weightMm, paint));
          if (sh.extra) pushExtra(extraContours((q) => q), (ls) => ls, tc.weightMm);
        }
        if (regular) prims.push({ kind: 'path', d: regular, color: colorOf(tc.pen), pen: tc.pen, mode: 'stroke', widthMm: tc.weightMm, opacity: tc.opacity });
        // heavy lines are drawn as two passes of the pen in the plotter export, so they stay heavier than the rest
        if (index) prims.push({ kind: 'path', d: index, color: colorOf(heavyPen), pen: heavyPen, mode: 'stroke', widthMm: tc.indexWeightMm, opacity: tc.opacity, ...majorPasses });
        const nsize = tc.labels.sizePt * PT;
        for (const n of numbers) {
          // text sits centered on its line (gap) or just above it, always upright along the line
          const nx = Math.sin(n.angle);
          const ny = -Math.cos(n.angle);
          const lift = tc.labels.gap ? 0 : nsize * (1.15 / 2 + 0.2); // same offset the placement reserved
          prims.push({
            kind: 'text', text: n.text, x: n.x + nx * lift - nx * nsize * 0.36, y: n.y + ny * lift - ny * nsize * 0.36,
            anchor: 'middle', sizeMm: nsize, trackingMm: nsize * 0.04, fontFamily, fontKey: t.font, color: colorOf(heavyPen), pen: heavyPen,
            ...(n.angle ? { rotate: (n.angle * 180) / Math.PI } : {}),
          });
        }
      }

      tagFrom(terrainAt, relief ? 'relief' : 'contours');

      // land cover patterns, one path per kind in its pen: ground lines draped over the relief, upright marks at their spot
      const coverAt = prims.length;
      // cover marks always keep off the route, at least a little beyond its edge
      const routeHalf = routeXY.length >= 2 ? Math.max(p.route.weightMm, inkWidth(penFor(p.pens, p.route.pen))) / 2 : 0;
      const clearCover = (lines: XY[][]): XY[][] => cutNearRoute(cutOutHalos(inFrame(lines), halos), routeXY, Math.max(routeClearR, routeHalf + 0.6));
      for (const [c, mask] of coverMasks) {
        const cs = p.cover.classes[c];
        if (cs.pattern === 'clear') continue;
        const { lines, marks } = patternMarks(mask, cs.pattern, cs.spacingMm, frame, COVER_CLASSES.indexOf(c) * 7);
        let page: XY[][];
        let at: XY[];
        if (relief) {
          const lift = (x: number, y: number): P3 => [x, y, relief.heightMm(relief.surface.sample(x, y))];
          page = pageLines(relief, lines.map((l) => densify(l, 1).map(([x, y]) => lift(x, y))), vis);
          at = marks.map(([x, y]) => lift(x, y)).filter((q) => !vis || vis.isVisible(q[0], q[1], q[2])).map((q) => relief.camera.project(q[0], q[1], q[2]));
        } else {
          page = lines;
          at = marks;
        }
        page = clearCover(page);
        // a mark is dropped where its spot is cleared (beside the route, around a label): test them all as tiny strokes at once
        const keyOf = (q: XY) => `${q[0]},${q[1]}`;
        const kept = new Set(clearCover(at.map((q): XY[] => [q, [q[0] + 0.01, q[1]]])).map((l) => keyOf(l[0]!)));
        at = at.filter((q) => kept.has(keyOf(q)));
        const d = toD(page) + at.map(([x, y]) => markSymbol(cs.pattern, x, y, cs.spacingMm * 0.7)).join('');
        if (d) prims.push({ kind: 'path', d, color: colorOf(cs.pen), pen: cs.pen, mode: 'stroke', widthMm: p.cover.weightMm, round: true, opacity: p.terrain.opacity });
      }
      tagFrom(coverAt, 'cover');
      const waterAt = prims.length;
      if (p.features.enabled && p.features.water && osm) {
        const waterPen = penFor(p.pens, featurePenId(p.features, 'waterOutline'));
        if (relief && vis) {
          // water follows the ground, so a stream behind a hill is cut away like any other line
          const lines: P3[][] = [];
          for (const w of osm.water) for (const piece of clipPolyline(w.coords.map(([la, lo]) => fit.toMm(la, lo)), frame)) {
            lines.push(piece.map(([x, y]): P3 => [x, y, relief.heightMm(relief.surface.sample(x, y))]));
          }
          prims.push(...waterLinesPrim(inFrame(visibleRuns(relief, vis, lines)), p.features, waterPen));
        } else prims.push(...waterPrims(osm.water, mapFit, frame, p.features, waterPen));
      }

      tagFrom(waterAt, 'water');
      if (gridOn) {
        // the grid goes over the land and water and under the route, broken where it would cross a landmark's name
        const grid = gridLayout(fit, frame, p.grid.spacingM);
        const draw = { pen: p.grid.pen, color: colorOf(p.grid.pen), fontFamily, fontKey: t.font, clear: (ls: XY[][]) => cutOutHalos(ls, halos) };
        prims.push(...gridPrims(grid, frame, p.grid, draw));
        if (legendY !== undefined) {
          prims.push(...legendPrims(p.grid, draw, {
            layout: grid, center: fit.fromMm(frame.x + frame.w / 2, frame.y + frame.h / 2), groundMetersPerMm: groundMetersPerMm(fit, frame), scale: fixedScale,
            reference: auto.coordPt ? { what: auto.coordWhat, lat: auto.coordPt.lat, lon: auto.coordPt.lon } : undefined,
            intervalM: p.terrain.enabled ? interval : undefined, imperial: p.units === 'imperial', x: contentL, y: legendY, w: innerW,
          }));
        }
      }
      if (p.points.length >= 2) {
        const xy = routeXY;
        const profileAt = prims.length;

        if (p.profile.enabled) {
          const corner = p.profile.position === 'corner';
          const pw = corner ? innerW * 0.4 : innerW;
          const ph = corner ? H * 0.08 : profileH;
          const px = corner ? contentR - pw : contentL;
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
            prims.push({ kind: 'path', d: `${topLine}L${f(px + pw)} ${f(py + ph)}L${f(px)} ${f(py + ph)}Z`, color: colorOf(p.profile.pen), pen: p.profile.pen, mode: 'fill', opacity: p.profile.opacity, ...(p.profile.hatch !== 'off' ? { hatch: p.profile.hatch } : {}) });
            prims.push({ kind: 'path', d: topLine, color: colorOf(p.profile.pen), pen: p.profile.pen, mode: 'stroke', widthMm: 0.4 });

            const lb = p.profile.labels;
            if (lb.extremes || lb.yTicks || lb.xTicks) {
              const size = lb.sizePt * PT;
              const col = colorOf(p.profile.pen);
              const imperial = p.units === 'imperial';
              const yOf = (e: number) => py + ph - ((e - eMin) / span) * ph * 0.92 - ph * 0.04;
              const xOf = (dist: number) => px + (dist / (d || 1)) * pw;
              const txt = (s: string, x: number, y: number, anchor: 'start' | 'middle' | 'end', opacity?: number) =>
                prims.push({ kind: 'text', text: s, x, y, anchor, sizeMm: size, trackingMm: size * 0.04, fontFamily, fontKey: t.font, color: col, pen: p.profile.pen, opacity });
              const grid = (d: string, w: number, opacity?: number) =>
                prims.push({ kind: 'path', d, color: col, pen: p.profile.pen, mode: 'stroke', widthMm: w, opacity });

              if (lb.yTicks) {
                const toDisp = (m: number) => (imperial ? metersToFeet(m) : m);
                const fromDisp = (v: number) => (imperial ? v / 3.280839895 : v);
                const lines: string[] = [];
                for (const v of niceTicks(toDisp(eMin), toDisp(eMax), 4)) {
                  const y = yOf(fromDisp(v));
                  lines.push(`M${f(px)} ${f(y)}H${f(px + pw)}`);
                  txt(Math.round(v).toLocaleString('en-US'), px - size * 0.6, y + size * 0.35, 'end');
                }
                if (lines.length) grid(lines.join(''), 0.12, 0.45);
              }
              if (lb.xTicks) {
                const unitM = imperial ? 1609.344 : 1000;
                const unit = imperial ? 'mi' : 'km';
                const marks: string[] = [];
                for (const v of niceTicks(0, d / unitM, 5)) {
                  if (v <= 0) continue;
                  const x = xOf(v * unitM);
                  marks.push(`M${f(x)} ${f(py + ph)}v${f(size * 0.5)}`);
                  txt(`${v} ${unit}`, x, py + ph + size * 1.5, 'middle');
                }
                if (marks.length) grid(marks.join(''), 0.2);
              }
              if (lb.extremes) {
                const fmt = (m: number) => (imperial ? formatFeet(m) : formatMeters(m));
                const hi = series.reduce((a, b) => (b.e > a.e ? b : a));
                const lo = series.reduce((a, b) => (b.e < a.e ? b : a));
                const marks: string[] = [];
                for (const pt of hi === lo ? [hi] : [hi, lo]) {
                  const x = xOf(pt.d);
                  const y = yOf(pt.e);
                  marks.push(circle(x, y, size * 0.25));
                  const a = x < px + pw * 0.15 ? 'start' : x > px + pw * 0.85 ? 'end' : 'middle';
                  txt(fmt(pt.e), x, y - size * 0.8, a);
                }
                grid(marks.join(''), 0.3);
              }
            }
          }
        }

        tagFrom(profileAt, 'profile');
        prims.push({
          kind: 'path', part: 'route', d: inFrame([xy]).map(polyline).join(''), color: colorOf(p.route.pen), pen: p.route.pen, mode: 'stroke', widthMm: p.route.weightMm,
          ...dashFor(p.route.style, p.route.weightMm),
        });
        const rpaint = { color: colorOf(p.route.pen), pen: p.route.pen, mode: 'stroke' as const };
        if (relief && lift > 0 && (p.route.dropMm ?? 0) > 0) {
          // lines down from the raised route to the ground; the parts behind a hill are hidden
          const drops = everyAlong(clean.map((q) => fit.toMm(q.lat, q.lon)), p.route.dropMm).map(([x, y]): P3[] => {
            const zg = relief.heightMm(relief.surface.sample(x, y));
            return [[x, y, zg + lift], [x, y, zg]];
          });
          const page = inFrame(vis ? visibleRuns(relief, vis, drops) : drops.map((l) => l.map((q) => relief.camera.project(q[0], q[1], q[2]))));
          if (page.length) prims.push({ kind: 'path', part: 'route', d: toD(page), widthMm: Math.max(0.1, p.route.weightMm * 0.3), ...rpaint });
        }
        if (p.route.ticks !== 'off' && p.route.tickEvery > 0) {
          // a mark across the route every mile (or km), and its number
          const len = Math.max(1.6, p.route.weightMm * 3);
          const size = p.route.tickSizePt * PT;
          const marks: XY[][] = [];
          for (const tk of distanceTicks(clean, tickMeters(p.route.tickEvery, p.units))) {
            const at = routeAt(tk.lat, tk.lon);
            if (!frameHas(at)) continue;
            const m = tickMark(at, routeAt(tk.before.lat, tk.before.lon), routeAt(tk.after.lat, tk.after.lon), len);
            marks.push(m.line);
            if (p.route.ticks === 'numbers') {
              prims.push({
                kind: 'text', part: 'route', text: tickLabel(tk.n, p.route.tickEvery), x: m.label[0] + m.nx * size * 0.4, y: m.label[1] + m.ny * size * 0.4 + size * 0.36,
                anchor: 'middle', sizeMm: size, trackingMm: size * 0.04, fontFamily, fontKey: t.font, color: colorOf(p.route.pen), pen: p.route.pen,
              });
            }
          }
          if (marks.length) prims.push({ kind: 'path', part: 'route', d: toD(marks), widthMm: Math.max(0.15, p.route.weightMm * 0.5), ...rpaint });
        }
      }

      if (p.north.enabled) {
        let northAngle = 0;
        if (relief) {
          const cx = frame.x + frame.w / 2, cy = frame.y + frame.h / 2;
          const [ax, ay] = relief.camera.project(cx, cy, 0);
          const [bx, by] = relief.camera.project(cx, cy - 10, 0);
          northAngle = (Math.atan2(bx - ax, -(by - ay)) * 180) / Math.PI;
        }
        const northAt = prims.length;
        prims.push(...northPrims(frame, { ...p.north, rotateDeg: northAngle, color: colorOf(p.north.pen), fontFamily, fontKey: t.font }));
        tagFrom(northAt, 'north');
      }

      if (landmarkOut) {
        const landmarksAt = prims.length;
        prims.push(...landmarkOut.prims);
        tagFrom(landmarksAt, 'landmarks');
        landmarks = landmarkOut.entries;
        pool = landmarkOut.pool;
        open = landmarkOut.open;
      }
    }
  }

  return { scene: { widthMm: W, heightMm: H, paper: p.paper, prims }, view, landmarks, pool, open };
}

/** How far above the ground a landmark's spot is tested for being in view, mm (in the relief's height units). */
const LANDMARK_LIFT_MM = 1.5;

/** A line with extra points so no step is longer than `step` mm (so it can follow the ground). */
function densify(line: XY[], step: number): XY[] {
  const out: XY[] = [line[0]!];
  for (let k = 1; k < line.length; k++) {
    const [ax, ay] = line[k - 1]!;
    const [bx, by] = line[k]!;
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
    for (let t = 1; t <= n; t++) out.push([ax + ((bx - ax) * t) / n, ay + ((by - ay) * t) / n]);
  }
  return out;
}

export const composeScene = (p: Project, terrain?: TerrainField, osm?: OsmData): Composed => compose(p, terrain, false, osm);
export const buildScene = (p: Project, terrain?: TerrainField, osm?: OsmData): Scene => compose(p, terrain, false, osm).scene;

/** The geographic area the map frame shows; terrain must cover this. Cheap (no route/contour work). */
export const viewBBox = (p: Project): BBox | undefined => compose(p, undefined, true).view?.bbox;
