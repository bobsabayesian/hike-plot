import { describe, expect, it } from 'vitest';
import { buildScene } from '../src/scene/buildScene';
import { defaultProject, type Project } from '../src/scene/project';
import { fromFile, toFile } from '../src/projectFile';
import { prepareScene, type FontSet } from '../src/export/outlines';
import type { PathPrim, TextPrim } from '../src/scene/types';

const fake = { unitsPerEm: 1000, charToGlyph: () => ({ advanceWidth: 500, getPath: (x: number, y: number) => ({ toPathData: () => `M${x} ${y}L${x + 1} ${y}L${x + 1} ${y - 1}L${x} ${y - 1}`, commands: [] }) }) };
const fonts = { sans: fake, serif: fake } as unknown as FontSet;
const poster = (edit: (p: Project) => void = () => {}) => { const p = { ...defaultProject() }; p.text = structuredClone(p.text); p.text.title.value = 'Mount Rainier'; edit(p); return { p, s: buildScene(p) }; };
const titleOf = (s: ReturnType<typeof buildScene>) => s.prims.filter((x) => x.part === 'title');

describe('handwritten title', () => {
  it('is printed lettering by default, as text in capitals', () => {
    expect(defaultProject().text.title.lettering).toBe('font');
    const t = titleOf(poster().s);
    expect(t).toHaveLength(1);
    expect(t[0]!.kind).toBe('text');
    expect((t[0] as TextPrim).text).toBe('MOUNT RAINIER');
  });
  it('script writes the title as one stroked path in the title pen at the line weight, in the case typed', () => {
    for (const lettering of ['script', 'scriptFull'] as const) {
      const { s } = poster((p) => { p.text.title.lettering = lettering; p.text.title.scriptMm = 0.8; });
      const t = titleOf(s);
      expect(t).toHaveLength(1);
      expect(t[0]).toMatchObject({ kind: 'path', mode: 'stroke', pen: 'ink', widthMm: 0.8, round: true, part: 'title' });
      expect((t[0] as PathPrim).d.startsWith('M')).toBe(true);
    }
    const a = titleOf(poster((p) => { p.text.title.lettering = 'script'; }).s)[0] as PathPrim;
    const b = titleOf(poster((p) => { p.text.title.lettering = 'script'; p.text.title.value = 'MOUNT RAINIER'; }).s)[0] as PathPrim;
    expect(a.d).not.toBe(b.d); // lowercase is drawn as lowercase
  });
  it('the title style (outline, fill) does not matter to script, and a title the script lacks a letter for keeps the printed lettering', () => {
    const plain = titleOf(poster((p) => { p.text.title.lettering = 'script'; }).s)[0] as PathPrim;
    const outlined = titleOf(poster((p) => { p.text.title.lettering = 'script'; p.text.title.style = 'outlineFill'; }).s);
    expect(outlined).toHaveLength(1);
    expect((outlined[0] as PathPrim).d).toBe(plain.d);
    const accent = titleOf(poster((p) => { p.text.title.lettering = 'script'; p.text.title.value = 'Café Rainier'; }).s);
    expect(accent[0]!.kind).toBe('text');
  });
  it('follows the alignment: left starts at the margin, justified fills the width', () => {
    const xs = (edit: (p: Project) => void) => {
      const t = titleOf(poster((p) => { p.text.title.lettering = 'script'; edit(p); }).s)[0] as PathPrim;
      const n = (t.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 0);
      return [Math.min(...n), Math.max(...n)];
    };
    const left = xs((p) => { p.text.title.align = 'left'; });
    const just = xs((p) => { p.text.title.align = 'justify'; });
    expect(just[1]! - just[0]!).toBeGreaterThan(left[1]! - left[0]!);
  });
  it('in the plotter file it stays single lines in the pen (no outline and hatch), passes for a heavy weight', () => {
    const { p, s } = poster((q) => { q.text.title.lettering = 'script'; q.text.title.scriptMm = 0.6; });
    const out = prepareScene(s, 'plotter', fonts, { pens: p.pens, plotterText: 'auto' });
    const t = out.prims.filter((x): x is PathPrim => x.kind === 'path' && x.part === 'title');
    expect(t.length).toBe(2); // 0.6 mm with a 0.3 mm pen: two passes
    expect(t.every((x) => x.mode === 'stroke' && x.widthMm === 0.3)).toBe(true);
  });
  it('survives saving, and an older file opens with the printed lettering', () => {
    const p = defaultProject();
    p.text.title.lettering = 'scriptFull';
    p.text.title.scriptMm = 0.9;
    const raw = JSON.parse(JSON.stringify(toFile(p)));
    expect(fromFile(raw).text.title).toMatchObject({ lettering: 'scriptFull', scriptMm: 0.9 });
    delete raw.project.text.title.lettering;
    delete raw.project.text.title.scriptMm;
    expect(fromFile(raw).text.title).toMatchObject({ lettering: 'font', scriptMm: 0.6 });
  });
});

describe('title from the handwriting service', () => {
  const PT = 25.4 / 72;
  const ink = { widthMm: 60, heightMm: 12, strokes: [[[0, 0], [60, 12]] as [number, number][]], missing: '' };
  const make = (edit: (p: Project) => void = () => {}) => poster((p) => { p.text.title.lettering = 'handwriter'; edit(p); });
  it('keeps the printed title until the strokes arrive', async () => {
    const { s } = make((p) => { p.text.title.value = 'Waiting only'; });
    expect(titleOf(s)[0]!.kind).toBe('text');
  });
  it('draws the strokes in the title pen once they are here, inside the content width', async () => {
    const { primeInk } = await import('../src/handwriter/ink');
    const { p } = make();
    const req = { text: 'Hand title', sizeMm: +(p.text.title.sizePt * PT).toFixed(2), font: 'handwriting', preset: 'project', seed: 1 };
    primeInk(req, ink);
    const s = buildScene({ ...p, text: { ...p.text, title: { ...p.text.title, value: 'Hand title' } } });
    const t = titleOf(s);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ kind: 'path', mode: 'stroke', pen: 'ink', widthMm: p.text.title.scriptMm, part: 'title' });
    const xs = [...(t[0] as PathPrim).d.matchAll(/[ML]([\d.-]+) /g)].map((m) => +m[1]!);
    expect(xs[1]! - xs[0]!).toBeCloseTo(60, 1);
  });
});
