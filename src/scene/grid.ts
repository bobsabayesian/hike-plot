import { clipPolyline, type Rect, type XY } from '../geo/clip';
import type { Fit } from '../geo/project';
import { fromUtm, latBand, squareId, toUtm, utmZone } from '../geo/utm';
import { CHAR_W } from '../features/select';
import type { Prim, TextPrim } from './types';

/** A military-style map grid: UTM lines with their numbers in the margin, and the MGRS names in a legend. */
export interface GridSettings {
  enabled: boolean;
  /** meters between lines; 0 = automatic (1 km, or 10 km / 100 km on large maps) */
  spacingM: number;
  pen: string;
  weightMm: number;
  /** grid numbers outside the map's edge */
  labels: boolean;
  labelSizePt: number;
  /** a line around the map (the neat line) */
  neatline: boolean;
  neatlineMm: number;
  /** under the map: scale bars, the grid zone and 100 km square, the grid and the contour interval */
  legend: boolean;
}

export const defaultGrid = (pen: string): GridSettings => ({
  enabled: false, spacingM: 0, pen, weightMm: 0.15, labels: true, labelSizePt: 8, neatline: true, neatlineMm: 0.35, legend: true,
});

export const GRID_SPACINGS = [1000, 10000, 100000] as const;
/** automatic spacing keeps at most this many lines across the map */
const MAX_LINES = 30;
const PT = 25.4 / 72;
/** gap between the map's edge and the grid numbers, mm */
const LABEL_GAP_MM = 1.2;

export interface GridLine { axis: 'e' | 'n'; value: number; pieces: XY[][] }
export interface GridLayout {
  zone: number;
  south: boolean;
  spacingM: number;
  lines: GridLine[];
  /** where each line meets the map's edges: eastings on top and bottom (x), northings on left and right (y) */
  edges: { top: [number, number][]; bottom: [number, number][]; left: [number, number][]; right: [number, number][] };
}

/** The grid for the map frame, in the UTM zone of the map's center. */
export function gridLayout(fit: Fit, frame: Rect, spacingM: number): GridLayout {
  const [cLat, cLon] = fit.fromMm(frame.x + frame.w / 2, frame.y + frame.h / 2);
  const zone = utmZone(cLat, cLon);
  const south = cLat < 0;
  const utmAt = (x: number, y: number) => { const [la, lo] = fit.fromMm(x, y); return toUtm(la, lo, zone, south); };

  // the range of eastings and northings the frame shows, from points around its edge
  let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity;
  const K = 24;
  for (let k = 0; k <= K; k++) {
    const t = k / K;
    for (const [x, y] of [[frame.x + t * frame.w, frame.y], [frame.x + t * frame.w, frame.y + frame.h], [frame.x, frame.y + t * frame.h], [frame.x + frame.w, frame.y + t * frame.h]] as const) {
      const u = utmAt(x, y);
      e0 = Math.min(e0, u.easting); e1 = Math.max(e1, u.easting); n0 = Math.min(n0, u.northing); n1 = Math.max(n1, u.northing);
    }
  }
  const step = spacingM > 0 ? spacingM : (GRID_SPACINGS.find((s) => Math.max(e1 - e0, n1 - n0) / s <= MAX_LINES) ?? 100000);

  const toMm = (e: number, n: number): XY => { const [la, lo] = fromUtm(zone, south, e, n); return fit.toMm(la, lo); };
  const lines: GridLine[] = [];
  const SAMPLES = 48;
  for (let e = Math.ceil(e0 / step) * step; e <= e1; e += step) {
    const pts: XY[] = [];
    for (let k = 0; k <= SAMPLES; k++) pts.push(toMm(e, n0 + ((n1 - n0) * k) / SAMPLES));
    lines.push({ axis: 'e', value: e, pieces: clipPolyline(pts, frame) });
  }
  for (let n = Math.ceil(n0 / step) * step; n <= n1; n += step) {
    const pts: XY[] = [];
    for (let k = 0; k <= SAMPLES; k++) pts.push(toMm(e0 + ((e1 - e0) * k) / SAMPLES, n));
    lines.push({ axis: 'n', value: n, pieces: clipPolyline(pts, frame) });
  }

  // where a value is reached along an edge: eastings grow left to right, northings bottom to top
  const solve = (f: (t: number) => number, target: number): number | undefined => {
    let lo = 0, hi = 1;
    const flo = f(lo) - target, fhi = f(hi) - target;
    if (flo * fhi > 0) return undefined;
    const rising = fhi > flo;
    for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if ((f(m) - target > 0) === rising) hi = m; else lo = m; }
    return (lo + hi) / 2;
  };
  const edges: GridLayout['edges'] = { top: [], bottom: [], left: [], right: [] };
  for (const g of lines) {
    if (g.axis === 'e') {
      for (const [side, y] of [['top', frame.y], ['bottom', frame.y + frame.h]] as const) {
        const t = solve((t) => utmAt(frame.x + t * frame.w, y).easting, g.value);
        if (t !== undefined) edges[side].push([g.value, frame.x + t * frame.w]);
      }
    } else {
      for (const [side, x] of [['left', frame.x], ['right', frame.x + frame.w]] as const) {
        const t = solve((t) => utmAt(x, frame.y + t * frame.h).northing, g.value);
        if (t !== undefined) edges[side].push([g.value, frame.y + t * frame.h]);
      }
    }
  }
  return { zone, south, spacingM: step, lines, edges };
}

/** The grid number of a line as printed big: the kilometer digits that change from line to line ("47" for 547 000). */
export function principalDigits(value: number, spacingM: number): string {
  const km = Math.round(value / 1000);
  if (spacingM >= 100000) return String(Math.floor(km / 100));
  return String(km % 100).padStart(2, '0');
}

/** How far the grid numbers reach out from the map's edge, mm (room to keep for them above and below the map). */
export const gridLabelRoom = (g: Pick<GridSettings, 'labelSizePt'>) => g.labelSizePt * PT * 1.15 + LABEL_GAP_MM;

export interface GridDraw {
  pen: string;
  color: string;
  fontFamily: string;
  fontKey: 'sans' | 'serif';
  /** cut the lines away where they would run through text (landmark labels) */
  clear?: (lines: XY[][]) => XY[][];
}

/** The grid lines, the neat line and the grid numbers. */
export function gridPrims(layout: GridLayout, frame: Rect, s: GridSettings, d: GridDraw): Prim[] {
  const out: Prim[] = [];
  const paint = { color: d.color, pen: d.pen, mode: 'stroke' as const, part: 'grid' as const };
  let pieces = layout.lines.flatMap((g) => g.pieces).filter((l) => l.length >= 2);
  if (d.clear) pieces = d.clear(pieces);
  const toD = (ls: XY[][]) => ls.map((l) => l.map(([x, y], i) => `${i ? 'L' : 'M'}${+x.toFixed(2)} ${+y.toFixed(2)}`).join('')).join('');
  if (pieces.length) out.push({ kind: 'path', d: toD(pieces), widthMm: s.weightMm, ...paint });
  if (s.neatline) {
    const { x, y, w, h } = frame;
    out.push({ kind: 'path', d: `M${x} ${y}H${x + w}V${y + h}H${x}Z`, widthMm: s.neatlineMm, ...paint });
  }
  if (!s.labels) return out;

  const big = s.labelSizePt * PT;
  const small = big * 0.62;
  const text = (t: string, x: number, y: number, anchor: TextPrim['anchor'], size: number): TextPrim => ({
    kind: 'text', part: 'grid', text: t, x, y, anchor, sizeMm: size, trackingMm: 0, fontFamily: d.fontFamily, fontKey: d.fontKey, color: d.color, pen: d.pen,
  });
  const width = (t: string, size: number) => t.length * size * CHAR_W;
  /**
   * One grid number. The big digits are the line's own; the first line along each edge also gets the digits before
   * them (small, raised) and the meters after them, as on a military sheet: ⁵47⁰⁰⁰ᵐE.
   */
  const label = (value: number, axis: 'e' | 'n', x: number, y: number, anchor: TextPrim['anchor'], full: boolean): void => {
    const main = principalDigits(value, layout.spacingM);
    if (!full || layout.spacingM >= 100000) { out.push(text(main, x, y, anchor, big)); return; }
    const km = Math.round(value / 1000);
    const lead = String(Math.floor(km / 100));
    const tail = axis === 'e' ? '000m.E.' : '000m.N.';
    const gap = big * 0.08; // glyph widths are estimates: a hair of space keeps the parts from touching
    const wl = width(lead, small) + gap, wm = width(main, big) + gap, wt = width(tail, small);
    const total = wl + wm + wt;
    const x0 = anchor === 'start' ? x : anchor === 'end' ? x - total : x - (wl + wm / 2);
    out.push(text(lead, x0, y - big * 0.32, 'start', small));
    out.push(text(main, x0 + wl, y, 'start', big));
    out.push(text(tail, x0 + wl + wm, y - big * 0.32, 'start', small));
  };
  // numbers too close to a corner would run into the other edge's numbers
  const clearOfCorners = (v: number, lo: number, hi: number) => v - lo > big * 1.6 && hi - v > big * 1.6;
  const firstE = (list: [number, number][]) => list.filter(([, x]) => clearOfCorners(x, frame.x, frame.x + frame.w)).sort((a, b) => a[1] - b[1]);
  const firstN = (list: [number, number][]) => list.filter(([, y]) => clearOfCorners(y, frame.y, frame.y + frame.h)).sort((a, b) => a[1] - b[1]);

  const top = firstE(layout.edges.top);
  top.forEach(([v, x], i) => label(v, 'e', x, frame.y - LABEL_GAP_MM - big * 0.1, 'middle', i === 0));
  const bottom = firstE(layout.edges.bottom);
  bottom.forEach(([v, x], i) => label(v, 'e', x, frame.y + frame.h + LABEL_GAP_MM + big * 0.75, 'middle', i === 0));
  const left = firstN(layout.edges.left);
  left.forEach(([v, y], i) => label(v, 'n', frame.x - LABEL_GAP_MM, y + big * 0.36, 'end', i === 0));
  const right = firstN(layout.edges.right);
  right.forEach(([v, y], i) => label(v, 'n', frame.x + frame.w + LABEL_GAP_MM, y + big * 0.36, 'start', i === 0));
  return out;
}

/** Height of the legend under the map, mm, for its text size. */
export const legendHeight = (g: Pick<GridSettings, 'labelSizePt'>) => g.labelSizePt * PT * 1.6 * 4;

export interface LegendInput {
  layout: GridLayout;
  /** the map center, for the zone's latitude band and the 100 km square */
  center: [number, number];
  metersPerMm: number;
  /** contour interval in meters, if contours are drawn */
  intervalM?: number;
  imperial: boolean;
  /** the legend's box: across the content width, starting at `y` */
  x: number;
  y: number;
  w: number;
}

/** A length for the scale bar: a round number of `unitM` whose length on paper is at most `maxMm`. */
export function scaleLength(unitM: number, metersPerMm: number, maxMm: number): number {
  const steps = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  let best = steps[0]!;
  for (const s of steps) if ((s * unitM) / metersPerMm <= maxMm) best = s;
  return best;
}

/**
 * The legend: two scale bars (kilometers and miles) with alternate segments filled, and the notes of a military
 * sheet, the grid zone designation, the 100 km square, the grid used and the contour interval.
 */
export function legendPrims(s: GridSettings, d: GridDraw, L: LegendInput): Prim[] {
  const out: Prim[] = [];
  const size = s.labelSizePt * PT;
  const row = size * 1.6;
  const paint = { color: d.color, pen: d.pen, part: 'grid' as const };
  const text = (t: string, x: number, y: number, anchor: TextPrim['anchor'], sz = size, opacity?: number): TextPrim => ({
    kind: 'text', part: 'grid', text: t, x, y, anchor, sizeMm: sz, trackingMm: sz * 0.06, fontFamily: d.fontFamily, fontKey: d.fontKey, color: d.color, pen: d.pen, ...(opacity ? { opacity } : {}),
  });

  // scale bars, on the left half
  const barMax = L.w * 0.42;
  const barH = size * 0.42;
  const bar = (unitM: number, name: string, y: number) => {
    const total = scaleLength(unitM, L.metersPerMm, barMax);
    const parts = [4, 5, 2, 1].find((n) => Number.isInteger(+((total / n) * 100).toFixed(6))) ?? 4;
    const segMm = (total * unitM) / L.metersPerMm / parts;
    const x0 = L.x;
    const fills: string[] = [];
    for (let k = 0; k < parts; k += 2) fills.push(`M${x0 + k * segMm} ${y}h${segMm}v${barH}h${-segMm}Z`);
    out.push({ kind: 'path', d: fills.join(''), mode: 'fill', hatch: 'solid', ...paint });
    out.push({ kind: 'path', d: `M${x0} ${y}h${segMm * parts}v${barH}h${-segMm * parts}Z`, mode: 'stroke', widthMm: 0.2, ...paint });
    for (let k = 0; k <= parts; k++) {
      const v = +((total / parts) * k).toFixed(3);
      out.push(text(String(v), x0 + k * segMm, y + barH + size * 1.05, 'middle', size * 0.8));
    }
    out.push(text(name, x0 + segMm * parts + size * 0.8, y + barH, 'start', size * 0.8));
  };
  const scale = Math.round(L.metersPerMm * 1000);
  out.push(text(`SCALE 1:${scale.toLocaleString('en-US')}`, L.x, L.y + size * 0.75, 'start'));
  bar(1000, 'KILOMETERS', L.y + row * 1.05);
  bar(1609.344, 'MILES', L.y + row * 2.45);

  // notes, on the right half
  const [lat, lon] = L.center;
  const u = toUtm(lat, lon, L.layout.zone, L.layout.south);
  const notes = [
    `GRID ZONE DESIGNATION  ${L.layout.zone}${latBand(lat)}`,
    `100,000 M SQUARE IDENTIFICATION  ${squareId(L.layout.zone, u.easting, u.northing)}`,
    `${L.layout.spacingM.toLocaleString('en-US')} METER UTM GRID, ZONE ${L.layout.zone}${L.layout.south ? ' SOUTH' : ''} · DATUM WGS 84`,
  ];
  if (L.intervalM) {
    const ft = Math.round(L.intervalM * 3.280839895);
    notes.push(`CONTOUR INTERVAL ${L.intervalM} METERS${L.imperial ? ` (${ft} FEET)` : ''}`);
  }
  const nx = L.x + L.w * 0.5;
  notes.forEach((n, i) => out.push(text(n, nx, L.y + size * 0.75 + i * row, 'start', size * 0.85)));
  return out;
}
