/**
 * Land cover: what the ground is (forest, rock, ice...), from the `landcover` layer of the OpenFreeMap tiles. Each
 * kind is filled with a pattern a pen can draw, or left as clear paper (terrain lines cut away there).
 */
export const COVER_CLASSES = ['wood', 'rock', 'ice', 'grass', 'wetland', 'sand'] as const;
export type CoverClass = (typeof COVER_CLASSES)[number];

export const COVER_LABELS: Record<CoverClass, string> = {
  wood: 'Forest', rock: 'Rock and scree', ice: 'Glacier and snow', grass: 'Meadow', wetland: 'Wetland', sand: 'Sand',
};

/** The tiles' class names that each kind takes in. */
export const TILE_CLASSES: Record<string, CoverClass> = {
  wood: 'wood', forest: 'wood', rock: 'rock', ice: 'ice', glacier: 'ice', grass: 'grass', wetland: 'wetland', sand: 'sand',
};

export const PATTERNS = ['trees', 'dots', 'dashes', 'hatch', 'crosshatch', 'reeds', 'clear'] as const;
export type Pattern = (typeof PATTERNS)[number];
export const PATTERN_LABELS: Record<Pattern, string> = {
  trees: 'Little trees', dots: 'Dots', dashes: 'Scree dashes', hatch: 'Hatching', crosshatch: 'Cross-hatching',
  reeds: 'Marsh tufts', clear: 'Clear paper (cut the terrain lines)',
};

/** One area of a kind of cover: its rings in [lat, lon], outer ring and holes together (even-odd). */
export interface CoverShape { cls: CoverClass; rings: [number, number][][] }

export interface CoverClassSettings {
  on: boolean;
  pattern: Pattern;
  pen: string;
  /** mm between marks or lines */
  spacingMm: number;
  /** how much of the terrain lines under this cover to clear, 0 to 100 (broken into dashes; 100 is bare paper) */
  clearPct: number;
}

export interface CoverSettings {
  enabled: boolean;
  classes: Record<CoverClass, CoverClassSettings>;
  /** line weight of the marks, mm */
  weightMm: number;
}

/** the default palette's ink and water pens (see scene/pens) */
const PEN_INK = 'ink';
const PEN_BLUE = 'blue';

export const defaultCover = (): CoverSettings => ({
  enabled: false,
  weightMm: 0.15,
  classes: {
    wood: { on: true, pattern: 'trees', pen: PEN_INK, spacingMm: 2.6, clearPct: 0 },
    rock: { on: true, pattern: 'dashes', pen: PEN_INK, spacingMm: 2.2, clearPct: 0 },
    ice: { on: true, pattern: 'clear', pen: PEN_BLUE, spacingMm: 1.5, clearPct: 0 },
    grass: { on: false, pattern: 'dots', pen: PEN_INK, spacingMm: 2.5, clearPct: 0 },
    wetland: { on: false, pattern: 'reeds', pen: PEN_BLUE, spacingMm: 3, clearPct: 0 },
    sand: { on: false, pattern: 'dots', pen: PEN_INK, spacingMm: 1.6, clearPct: 0 },
  },
});

/** The kinds that are switched on and draw with a pen (clear paper uses none). */
export const inkedClasses = (s: CoverSettings): CoverClass[] => (s.enabled ? COVER_CLASSES.filter((c) => s.classes[c].on && s.classes[c].pattern !== 'clear') : []);
