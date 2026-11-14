import { describe, expect, it } from 'vitest';
import { applySavedPen, cleanSavedPen, contrast, defaultPens, inkWidth, isDarkPaper, loadSavedPens, MIN_INK_CONTRAST, PAPER_COLORS, penKind, savedFromPen, storeSavedPens, withKind, withSavedPen } from '../src/scene/pens';
import { tipFor } from '../src/export/outlines';
import { fromFile, toFile } from '../src/projectFile';
import { defaultProject } from '../src/scene/project';

const ink = defaultPens()[0]!;

describe('pen kinds', () => {
  it('a pen without a kind (an older project) draws exactly as before', () => {
    expect(inkWidth(ink)).toBe(0.3);
    expect(tipFor({ pen: ink.id }, { pens: [ink] })).toBe(0.3);
  });
  it('a kind sets the spread and transparency; a marker leaves a wider line than its tip', () => {
    const m = withKind({ ...ink, tipMm: 1 }, 'marker');
    expect(m.kind).toBe('marker');
    expect(m.gainMm).toBe(0.25);
    expect(inkWidth(m)).toBe(1.5);
    expect(tipFor({ pen: m.id }, { pens: [m] })).toBe(1.5);
  });
  it('changing kind snaps the tip to a size that kind comes in, and custom keeps it', () => {
    expect(withKind({ ...ink, tipMm: 0.3 }, 'marker').tipMm).toBe(0.5);
    expect(withKind({ ...ink, tipMm: 0.33 }, 'custom').tipMm).toBe(0.33);
    expect(withKind({ ...ink, tipMm: 0.3 }, 'fineliner').tipMm).toBe(0.3);
    expect(penKind('nonsense').id).toBe('custom');
  });
  it('kind, spread and transparency survive saving and opening a project', () => {
    const p = defaultProject();
    p.pens[0] = withKind({ ...p.pens[0]!, tipMm: 0.3 }, 'fineliner');
    const back = fromFile(JSON.parse(JSON.stringify(toFile(p))));
    expect(back.pens[0]).toMatchObject({ kind: 'fineliner', gainMm: 0.04, transparency: 0.35 });
  });
});

describe('saved pen library', () => {
  const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
  it('round-trips and replaces a pen of the same name in place', () => {
    const s = store();
    const a = savedFromPen('Micron 0.3', withKind(ink, 'fineliner'));
    const b = savedFromPen('Molotow 1', withKind({ ...ink, tipMm: 1 }, 'marker'));
    storeSavedPens(withSavedPen(withSavedPen([], a), b), s);
    expect(loadSavedPens(s).map((x) => x.name)).toEqual(['Micron 0.3', 'Molotow 1']);
    expect(withSavedPen([a, b], { ...a, name: 'micron 0.3', tipMm: 0.5 }).map((x) => x.tipMm)).toEqual([0.5, 1]);
  });
  it('ignores junk in storage', () => {
    const bad = { getItem: () => '[{"name":"x"},{"name":"y","color":"red"},5,null]' };
    expect(loadSavedPens(bad)).toEqual([]);
    expect(loadSavedPens({ getItem: () => 'not json' })).toEqual([]);
    expect(cleanSavedPen({ name: 'ok', color: '#AABBCC', kind: 'gel', tipMm: 0.5, transparency: 0.1, gainMm: 0.05 })?.color).toBe('#aabbcc');
    expect(cleanSavedPen({ name: 'ok', color: '#aabbcc', kind: 'gel', tipMm: 99, transparency: 0.1, gainMm: 0.05 })).toBeNull();
  });
  it('applying a saved pen keeps the id so what used the pen still does', () => {
    const s = savedFromPen('Molotow 2', withKind({ ...ink, tipMm: 2, color: '#ffffff' }, 'marker'));
    expect(applySavedPen(ink, s)).toMatchObject({ id: ink.id, name: 'Molotow 2', kind: 'marker', tipMm: 2, color: '#ffffff' });
  });
});

describe('paper', () => {
  it('has swatches that are valid colors, including the default paper', () => {
    for (const c of PAPER_COLORS) expect(c.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(PAPER_COLORS.map((c) => c.color)).toContain(defaultProject().paper);
  });
  it('tells dark paper from light, and a pen too close to the paper from one that shows', () => {
    expect(isDarkPaper('#0d0d0d')).toBe(true);
    expect(isDarkPaper('#16213e')).toBe(true);
    expect(isDarkPaper('#f3ead3')).toBe(false);
    expect(isDarkPaper('#b08968')).toBe(false);
    expect(contrast('#1f2a24', '#0d0d0d')).toBeLessThan(MIN_INK_CONTRAST); // dark ink on black paper
    expect(contrast('#1f2a24', '#f6f3ec')).toBeGreaterThan(MIN_INK_CONTRAST);
    expect(contrast('#ffffff', '#0d0d0d')).toBeGreaterThan(10);
  });
});
