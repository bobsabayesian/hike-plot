import { MAX_PENS, PEN_BLUE, PEN_INK, PEN_RED, type Pen } from './pens';
import { DEFAULT_TIP_MM } from './pens';
import { defaultProject, type Project } from './project';

/**
 * A pen of this color for a preset: one already in the palette with (nearly) that color, else a new one with the
 * given name, else (palette full) `fallback`.
 */
function penOfColor(p: Project, color: string, name: string, fallback: string): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const near = (a: string, b: string) => { const [x, y] = [rgb(a), rgb(b)]; return x.every((v, i) => Math.abs(v - y[i]!) <= 24); };
  const have = p.pens.find((x) => x.name === name) ?? p.pens.find((x) => /^#[0-9a-f]{6}$/i.test(x.color) && near(x.color, color));
  if (have) return have.id;
  if (p.pens.length >= MAX_PENS) return fallback;
  let n = p.pens.length + 1;
  while (p.pens.some((x) => x.id === `pen-${n}`)) n++;
  const pen: Pen = { id: `pen-${n}`, name, color, tipMm: DEFAULT_TIP_MM };
  p.pens.push(pen);
  return pen.id;
}

/** Colors of a military topographic sheet. */
export const MILITARY_COLORS = { black: '#1d1d1b', brown: '#8a5a2b', blue: '#2f6f9f', green: '#3f8a4a', red: '#b4441f' } as const;

/**
 * The look of a military topographic map at 1:50,000, on the flat map, with MGRS references: brown 40 m contours with numbered index lines, blue water,
 * woodland in green, a black UTM grid with its numbers, scale bars and grid notes, and the title on top.
 * Page size, margins, border and units are left as they are. Mutates (use on a draft).
 */
export function applyMilitary(p: Project): void {
  const ink = p.pens.some((x) => x.id === PEN_INK) ? PEN_INK : penOfColor(p, MILITARY_COLORS.black, 'Black', p.pens[0]!.id);
  const brown = penOfColor(p, MILITARY_COLORS.brown, 'Contour brown', ink);
  const blue = p.pens.some((x) => x.id === PEN_BLUE) ? PEN_BLUE : penOfColor(p, MILITARY_COLORS.blue, 'Water blue', ink);
  const green = penOfColor(p, MILITARY_COLORS.green, 'Woodland green', ink);
  const red = p.pens.some((x) => x.id === PEN_RED) ? PEN_RED : penOfColor(p, MILITARY_COLORS.red, 'Route red', ink);

  p.paper = '#f8f7f2';
  p.mapScale = 50000; // the standard military topographic scale
  p.relief.enabled = false;
  p.shade.enabled = false;
  p.terrain = {
    // 40 m, as on a 1:50,000 sheet; every 5th line (200 m) is heavy and numbered
    ...p.terrain, enabled: true, intervalM: 40, indexEvery: 5, pen: brown, weightMm: 0.15, indexWeightMm: 0.35, opacity: 1,
    labels: { enabled: true, density: 'sparse', every: 1, gap: true, sizePt: 7 },
  };
  delete p.terrain.indexPen;
  p.cover = {
    ...p.cover, enabled: true, weightMm: 0.15,
    classes: {
      wood: { on: true, pattern: 'hatch', pen: green, spacingMm: 1.1, clearPct: 0 },
      rock: { on: false, pattern: 'dashes', pen: brown, spacingMm: 2.2, clearPct: 0 },
      ice: { on: true, pattern: 'clear', pen: blue, spacingMm: 1.5, clearPct: 0 },
      grass: { on: false, pattern: 'dots', pen: green, spacingMm: 2.5, clearPct: 0 },
      wetland: { on: true, pattern: 'reeds', pen: blue, spacingMm: 3, clearPct: 0 },
      sand: { on: false, pattern: 'dots', pen: brown, spacingMm: 1.6, clearPct: 0 },
    },
  };
  p.features = {
    ...p.features, enabled: true, water: true,
    pens: { default: ink, overrides: { ...p.features.pens.overrides, waterOutline: blue, waterLabel: blue } },
  };
  p.route = { ...p.route, pen: red, weightMm: 0.6, style: 'solid' };
  p.grid = { ...p.grid, enabled: true, spacingM: 0, pen: ink, weightMm: 0.15, labels: true, labelSizePt: 8, neatline: true, neatlineMm: 0.35, legend: true };
  p.north.enabled = false; // the grid and its notes give north
  p.profile.enabled = false;
  p.text = {
    ...p.text, font: 'sans', align: 'left', trackingEm: 0.08,
    title: { ...p.text.title, placement: 'top', sizePt: 36, style: 'fill', align: 'inherit', pen: ink, fillPen: ink },
    location: { ...p.text.location, placement: 'top', sizePt: 12, pen: ink, showCoords: true, coordFormat: 'mgrs' },
    info: { ...p.text.info, pen: ink },
  };
}

/**
 * Terrain in 3D: the contours lifted onto the land and seen at an angle, standing on a solid base with strata, in
 * the classic ink-on-cream style with a red route. Page size, margins, border and units are left as they are.
 * Mutates (use on a draft).
 */
export function applyRelief3d(p: Project): void {
  const d = defaultProject();
  const ink = p.pens.some((x) => x.id === PEN_INK) ? PEN_INK : penOfColor(p, '#1f2a24', 'Ink', p.pens[0]!.id);
  const red = p.pens.some((x) => x.id === PEN_RED) ? PEN_RED : penOfColor(p, MILITARY_COLORS.red, 'Route red', ink);
  const blue = p.pens.some((x) => x.id === PEN_BLUE) ? PEN_BLUE : penOfColor(p, MILITARY_COLORS.blue, 'Water blue', ink);

  p.paper = d.paper;
  p.mapScale = 0;
  p.relief = { ...d.relief, enabled: true, style: 'contours', turn: 0, tilt: 55, perspective: 35, depth: 150, base: { ...d.relief.base, enabled: true } };
  p.shade = { ...d.shade };
  p.terrain = { ...d.terrain, pen: ink, labels: { ...d.terrain.labels } };
  p.cover = { ...d.cover, enabled: false };
  p.grid = { ...d.grid, pen: ink };
  p.features = { ...p.features, enabled: true, water: true, pens: { default: ink, overrides: { ...p.features.pens.overrides, waterOutline: blue, waterLabel: blue } } };
  p.route = { ...d.route, pen: red };
  p.north = { ...d.north, pen: ink };
  p.profile = { ...d.profile, pen: ink, labels: { ...d.profile.labels } };
  p.text = {
    ...p.text, font: d.text.font, align: d.text.align, trackingEm: d.text.trackingEm,
    title: { ...d.text.title, value: p.text.title.value, pen: ink, fillPen: ink },
    location: { ...d.text.location, value: p.text.location.value, pen: ink },
    info: { ...p.text.info, pen: ink },
  };
}

export type LookId = 'military' | 'relief3d';
export const LOOKS: { id: LookId; name: string; title: string; apply: (p: Project) => void }[] = [
  { id: 'military', name: 'Military map', title: 'A topographic sheet at 1:50,000: brown 40 m contours, blue water, green woods, a UTM grid with MGRS references', apply: applyMilitary },
  { id: 'relief3d', name: '3D contours', title: 'The contours lifted onto the land and seen at an angle, on a solid base', apply: applyRelief3d },
];

/** What the poster shows rather than how it looks: kept when switching looks, and ignored when telling them apart. */
function withoutContent(p: Project): Project {
  return {
    ...p, points: [], waypoints: [], customLandmarks: [], lookup: {}, feature: undefined,
    features: { ...p.features, overrides: {} },
    text: {
      ...p.text,
      title: { ...p.text.title, value: undefined },
      location: { ...p.text.location, value: undefined },
      info: { ...p.text.info, items: p.text.info.items.map((i) => ({ ...i, value: undefined })) },
    },
  };
}

/** Deep equality of plain data; a key set to undefined counts the same as a missing key. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((v, i) => same(v, (b as unknown[])[i]));
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** The look the poster has: one whose button would change nothing, or 'custom'. */
export function currentLook(p: Project): LookId | 'custom' {
  const base = withoutContent(p);
  for (const look of LOOKS) {
    const q = structuredClone(base);
    look.apply(q);
    if (same(q, base)) return look.id;
  }
  return 'custom';
}

/** The style of `stash` (an earlier custom design) with the route, place, landmark edits and texts of `current`. */
export function restoreCustom(current: Project, stash: Project): Project {
  const out = structuredClone(stash);
  out.points = current.points;
  out.waypoints = current.waypoints;
  out.customLandmarks = current.customLandmarks;
  out.lookup = current.lookup;
  out.feature = current.feature;
  out.routeSpanKm = current.routeSpanKm;
  out.features.overrides = current.features.overrides;
  out.text.title.value = current.text.title.value;
  out.text.location.value = current.text.location.value;
  out.text.info.items = current.text.info.items;
  return out;
}
