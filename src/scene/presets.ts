import { MAX_PENS, PEN_BLUE, PEN_INK, PEN_RED, type Pen } from './pens';
import { DEFAULT_TIP_MM } from './pens';
import type { Project } from './project';

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
 * The look of a military topographic map, on the flat map: brown 40 m contours with numbered index lines, blue water,
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
      wood: { on: true, pattern: 'hatch', pen: green, spacingMm: 1.1 },
      rock: { on: false, pattern: 'dashes', pen: brown, spacingMm: 2.2 },
      ice: { on: true, pattern: 'clear', pen: blue, spacingMm: 1.5 },
      grass: { on: false, pattern: 'dots', pen: green, spacingMm: 2.5 },
      wetland: { on: true, pattern: 'reeds', pen: blue, spacingMm: 3 },
      sand: { on: false, pattern: 'dots', pen: brown, spacingMm: 1.6 },
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
    location: { ...p.text.location, placement: 'top', sizePt: 12, pen: ink },
    info: { ...p.text.info, pen: ink },
  };
}
