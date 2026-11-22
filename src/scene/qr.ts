import qrcode from 'qrcode-generator';
import type { PathPrim } from './types';
import type { Placement } from './project';

export interface QrSettings {
  enabled: boolean;
  placement: Placement;
  /** which side of the poster it sits on */
  align: 'left' | 'center' | 'right';
  /** the whole code, quiet zone not included, mm */
  sizeMm: number;
  pen: string;
  /** 'saved': the link to this project once it is saved; 'custom': the address typed below */
  mode: 'saved' | 'custom';
  url: string;
  /** the saved project's link, filled in by the app while it draws (never stored) */
  link: string;
}

export const defaultQr = (pen: string): QrSettings => ({ enabled: false, placement: 'bottom', align: 'right', sizeMm: 18, pen, mode: 'saved', url: '', link: '' });

/** the address the code holds, or '' while there is none yet (a saved link before the first save) */
export const qrTarget = (q: QrSettings): string => (q.mode === 'custom' ? q.url : q.link).trim();

/** Dark modules of the code, row by row (error correction M, so a bit of pen wobble still scans). */
export function qrModules(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

const f = (n: number) => +n.toFixed(3);

/**
 * The code as a pen can draw it: every run of dark modules in a row is one straight stroke as thick as a module, so it fills
 * solid with no hatching. Returns the stroke (one path, butt ends) and the module size; `x`, `y` are its top-left corner.
 */
export function qrPrim(text: string, x: number, y: number, sizeMm: number, color: string, pen: string): { prim: PathPrim; moduleMm: number; modules: number } | undefined {
  if (!text) return undefined;
  const m = qrModules(text);
  const n = m.length;
  const k = sizeMm / n;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!m[r]![c]) continue;
      const start = c;
      while (c + 1 < n && m[r]![c + 1]) c++;
      const yy = y + (r + 0.5) * k;
      d += `M${f(x + start * k)} ${f(yy)}H${f(x + (c + 1) * k)}`;
    }
  }
  return { prim: { kind: 'path', part: 'qr', d, color, pen, mode: 'stroke', widthMm: f(k) }, moduleMm: k, modules: n };
}
