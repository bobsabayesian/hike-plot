import { DOODLE_KINDS, type DoodleKind } from './glyphs';

export interface DoodleSettings {
  enabled: boolean;
  /** 0 to 100: how many (about 25 at most on a poster of the usual size) */
  density: number;
  /** height of a typical doodle, mm */
  sizeMm: number;
  /** another number scatters them differently */
  seed: number;
  /** clear paper left around each, mm: terrain lines and land cover marks are cut away there */
  clearMm: number;
  /** pens: the ones on the ground, and the ones in the sky */
  pen: string;
  skyPen: string;
  weightMm: number;
  kinds: Record<DoodleKind, boolean>;
}

const PEN_INK = 'ink';
const PEN_BLUE = 'blue';

export const defaultDoodles = (): DoodleSettings => ({
  enabled: false, density: 40, sizeMm: 11, seed: 1, clearMm: 1.2, pen: PEN_INK, skyPen: PEN_BLUE, weightMm: 0.25,
  // only the sun to begin with: the rest are there to tick when wanted
  kinds: Object.fromEntries(DOODLE_KINDS.map((k) => [k, k === 'sun'])) as Record<DoodleKind, boolean>,
});

/** Settings read from a file: unknown kinds ignored, missing ones as they are by default, numbers in range. */
export function normalizeDoodles(raw: unknown): DoodleSettings {
  const d = defaultDoodles();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<DoodleSettings>;
  const num = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
  const kinds = { ...d.kinds };
  if (r.kinds && typeof r.kinds === 'object') for (const k of DOODLE_KINDS) if (typeof (r.kinds as Record<string, unknown>)[k] === 'boolean') kinds[k] = (r.kinds as Record<DoodleKind, boolean>)[k];
  return {
    enabled: r.enabled === true,
    density: num(r.density, 0, 100, d.density),
    sizeMm: num(r.sizeMm, 3, 40, d.sizeMm),
    seed: typeof r.seed === 'number' && Number.isFinite(r.seed) ? Math.floor(r.seed) : d.seed,
    clearMm: num(r.clearMm, 0, 10, d.clearMm),
    pen: typeof r.pen === 'string' ? r.pen : d.pen,
    skyPen: typeof r.skyPen === 'string' ? r.skyPen : d.skyPen,
    weightMm: num(r.weightMm, 0.05, 1, d.weightMm),
    kinds,
  };
}
