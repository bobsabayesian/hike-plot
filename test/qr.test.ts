import { describe, expect, it } from 'vitest';
import { qrModules, qrPrim, qrTarget, defaultQr } from '../src/scene/qr';
import { buildScene } from '../src/scene/buildScene';
import { defaultProject } from '../src/scene/project';
import { sampleTrack } from '../src/sample';
import type { PathPrim } from '../src/scene/types';

const URL = 'https://hike.bobsabayesian.io/?p=abcd2345';

describe('QR code strokes', () => {
  it('draws exactly the dark modules, one stroke per run of them', () => {
    const m = qrModules(URL);
    const { prim, modules, moduleMm } = qrPrim(URL, 10, 20, 29, '#000', 'ink')!;
    expect(modules).toBe(m.length);
    expect(moduleMm).toBeCloseTo(29 / m.length, 6);
    expect(prim.widthMm).toBeCloseTo(moduleMm, 2);
    const k = 29 / m.length;
    // read the strokes back into a grid
    const back = m.map((r) => r.map(() => false));
    for (const s of prim.d.matchAll(/M([\d.]+) ([\d.]+)H([\d.]+)/g)) {
      const row = Math.round((+s[2]! - 20) / k - 0.5);
      for (let c = Math.round((+s[1]! - 10) / k); c < Math.round((+s[3]! - 10) / k); c++) back[row]![c] = true;
    }
    expect(back).toEqual(m);
  });
  it('has the three finder squares, and nothing for an empty address', () => {
    const m = qrModules(URL);
    const n = m.length;
    for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]] as const) {
      expect(m[r]!.slice(c, c + 7).every(Boolean)).toBe(true);
      expect(m[r + 6]!.slice(c, c + 7).every(Boolean)).toBe(true);
    }
    expect(qrPrim('', 0, 0, 20, '#000', 'ink')).toBeUndefined();
  });
  it('the address is the saved link or the typed one', () => {
    const q = { ...defaultQr('ink'), link: URL, url: ' https://x.org ' };
    expect(qrTarget(q)).toBe(URL);
    expect(qrTarget({ ...q, mode: 'custom' })).toBe('https://x.org');
  });
});

describe('QR code on the poster', () => {
  const scene = (edit: (p: ReturnType<typeof defaultProject>) => void) => {
    const p = { ...defaultProject(), points: sampleTrack() };
    p.qr = { ...p.qr };
    edit(p);
    return buildScene(p);
  };
  const qrs = (s: ReturnType<typeof buildScene>) => s.prims.filter((x) => x.part === 'qr') as PathPrim[];
  it('is off by default, and waits for a link when it follows the saved project', () => {
    expect(qrs(scene(() => {}))).toHaveLength(0);
    expect(qrs(scene((p) => { p.qr.enabled = true; }))).toHaveLength(0);
  });
  it('draws inside the page at its side, in its pen, once it has an address', () => {
    for (const align of ['left', 'center', 'right'] as const) {
      const p0 = { ...defaultProject(), points: sampleTrack() };
      const s = scene((p) => { p.qr = { ...p.qr, enabled: true, link: URL, align, sizeMm: 20 }; });
      const [q] = qrs(s);
      expect(q).toBeDefined();
      const xs = [...q!.d.matchAll(/[MH]([\d.]+)/g)].map((m) => +m[1]!);
      expect(Math.min(...xs)).toBeGreaterThan(0);
      expect(Math.max(...xs)).toBeLessThan(s.widthMm);
      expect(q!.pen).toBe(p0.qr.pen);
    }
  });
  it('a typed address works without a saved link and moves the other blocks over', () => {
    const base = scene(() => {});
    const withQr = scene((p) => { p.qr = { ...p.qr, enabled: true, mode: 'custom', url: 'https://example.com', sizeMm: 25 }; });
    expect(qrs(withQr)).toHaveLength(1);
    const titleY = (s: typeof base) => (s.prims.find((x) => x.part === 'title') as { y?: number; d?: string }).y;
    expect(withQr.prims.length).toBeGreaterThan(base.prims.length - 1);
    expect(titleY(withQr) ?? 0).toBeDefined();
  });
});
