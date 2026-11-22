import type { Part } from './types';

/**
 * The layers of a poster as a person thinks of them: Terrain lines, Land cover, Route, and so on. Each takes in one or more of
 * the scene's parts. They are drawn in a stack, first at the bottom, and a layer can cut the lines of layers beneath it.
 */
export const LAYERS = [
  { id: 'border', label: 'Border', parts: ['border'] },
  { id: 'title', label: 'Title', parts: ['title'] },
  { id: 'details', label: 'Location, info, QR, watermark', parts: ['location', 'info', 'watermark', 'qr'] },
  { id: 'terrain', label: 'Terrain lines', parts: ['contours', 'relief'] },
  { id: 'cover', label: 'Land cover', parts: ['cover'] },
  { id: 'water', label: 'Water', parts: ['water'] },
  { id: 'doodles', label: 'Doodles', parts: ['doodles'] },
  { id: 'grid', label: 'Grid and legend', parts: ['grid'] },
  { id: 'profile', label: 'Elevation profile', parts: ['profile'] },
  { id: 'route', label: 'Route', parts: ['route'] },
  { id: 'north', label: 'North arrow', parts: ['north'] },
  { id: 'landmarks', label: 'Landmarks and names', parts: ['landmarks'] },
] as const satisfies readonly { id: string; label: string; parts: readonly Part[] }[];

export type LayerId = (typeof LAYERS)[number]['id'];
export const LAYER_IDS: LayerId[] = LAYERS.map((l) => l.id);
export const layerLabel = (id: LayerId): string => LAYERS.find((l) => l.id === id)!.label;

const BY_PART = new Map<Part, LayerId>(LAYERS.flatMap((l) => (l.parts as readonly Part[]).map((p) => [p, l.id] as const)));
/** The layer a scene part belongs to (undefined for a primitive with no part). */
export const layerOfPart = (part: Part | undefined): LayerId | undefined => (part ? BY_PART.get(part) : undefined);

export const DEFAULT_GAP_MM = 0.4;
export const MAX_GAP_MM = 5;

/** What a layer cuts: the layers beneath it that it knocks lines out of, and the gap left beside it (on top of half the pen's line). */
export interface LayerRule { cuts: LayerId[]; gapMm: number }

export interface LayerSettings {
  /** drawing order, first = bottom = plotted first */
  order: LayerId[];
  /** the plotter file's layers follow this order (a layer for each run of one pen) instead of being one per pen in palette order */
  byStack: boolean;
  rules: Partial<Record<LayerId, LayerRule>>;
}

/** The order the poster has always been drawn in. */
export const defaultLayers = (): LayerSettings => ({ order: [...LAYER_IDS], byStack: false, rules: {} });

/** The layers beneath this one (drawn before it): the ones it may cut. */
export const beneath = (s: LayerSettings, id: LayerId): LayerId[] => s.order.slice(0, Math.max(0, s.order.indexOf(id)));

const isId = (v: unknown): v is LayerId => typeof v === 'string' && (LAYER_IDS as string[]).includes(v);

/**
 * Settings read from a saved file or built by hand, made safe: unknown layers dropped, each layer once, missing ones added at the
 * end of the order, cuts only of layers beneath, gaps in range.
 */
export function normalizeLayers(raw: unknown): LayerSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<LayerSettings>;
  const order: LayerId[] = [];
  for (const id of Array.isArray(r.order) ? r.order : []) if (isId(id) && !order.includes(id)) order.push(id);
  for (const id of LAYER_IDS) if (!order.includes(id)) order.push(id);
  const out: LayerSettings = { order, byStack: r.byStack === true, rules: {} };
  const rules = r.rules && typeof r.rules === 'object' ? r.rules : {};
  for (const id of order) {
    const rule = (rules as Record<string, Partial<LayerRule> | undefined>)[id];
    if (!rule || !Array.isArray(rule.cuts)) continue;
    const below = beneath(out, id);
    const cuts = [...new Set(rule.cuts.filter((c): c is LayerId => isId(c) && below.includes(c)))];
    if (!cuts.length) continue;
    const gap = typeof rule.gapMm === 'number' && Number.isFinite(rule.gapMm) ? Math.min(MAX_GAP_MM, Math.max(0, rule.gapMm)) : DEFAULT_GAP_MM;
    out.rules[id] = { cuts, gapMm: gap };
  }
  return out;
}

/** Move a layer one place up or down the order (later = on top). Cuts that no longer point beneath are dropped. */
export function moveLayer(s: LayerSettings, id: LayerId, by: -1 | 1): LayerSettings {
  const i = s.order.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= s.order.length) return s;
  const order = [...s.order];
  [order[i], order[j]] = [order[j]!, order[i]!];
  return normalizeLayers({ ...s, order });
}

/** Put a layer where another is (dragging a row onto a row). */
export function moveLayerTo(s: LayerSettings, id: LayerId, to: number): LayerSettings {
  const i = s.order.indexOf(id);
  if (i < 0) return s;
  const order = s.order.filter((x) => x !== id);
  order.splice(Math.max(0, Math.min(order.length, to)), 0, id);
  return normalizeLayers({ ...s, order });
}

/** Switch on or off the upper layer's cut of a lower one (only layers beneath it can be cut). */
export function setCut(s: LayerSettings, upper: LayerId, lower: LayerId, on: boolean): LayerSettings {
  if (!beneath(s, upper).includes(lower)) return s;
  const rule = s.rules[upper] ?? { cuts: [], gapMm: DEFAULT_GAP_MM };
  const cuts = on ? [...new Set([...rule.cuts, lower])] : rule.cuts.filter((c) => c !== lower);
  const rules = { ...s.rules };
  if (cuts.length) rules[upper] = { ...rule, cuts }; else delete rules[upper];
  return { ...s, rules };
}

export function setGap(s: LayerSettings, upper: LayerId, gapMm: number): LayerSettings {
  const rule = s.rules[upper];
  if (!rule) return s;
  return { ...s, rules: { ...s.rules, [upper]: { ...rule, gapMm: Math.min(MAX_GAP_MM, Math.max(0, Number.isFinite(gapMm) ? gapMm : DEFAULT_GAP_MM)) } } };
}

/** The order the starter uses: the ground first, then what is drawn over it, the text last. */
const STARTER_ORDER: LayerId[] = ['border', 'terrain', 'cover', 'water', 'grid', 'profile', 'route', 'north', 'landmarks', 'details', 'title'];

/**
 * A starting point: the ground is drawn first, and what is drawn over it (route, north arrow, landmarks, text) clears the
 * terrain lines, land cover and water under it. The order is changed to make that possible (a layer only cuts what is beneath it).
 */
export function suggestCuts(s: LayerSettings): LayerSettings {
  let out: LayerSettings = normalizeLayers({ ...s, order: STARTER_ORDER, rules: {} });
  for (const upper of ['route', 'north', 'landmarks', 'details', 'title'] as LayerId[]) for (const lower of ['terrain', 'cover', 'water'] as LayerId[]) out = setCut(out, upper, lower, true);
  return out;
}
