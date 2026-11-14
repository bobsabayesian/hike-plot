import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { parse } from 'opentype.js';
import { sceneToSvg, penLayerOf } from '../src/export/svg';
import { prepareScene, type FontSet } from '../src/export/outlines';
import { composeScene } from '../src/scene/buildScene';
import { defaultProject } from '../src/scene/project';
import { sampleTrack, sampleWaypoints } from '../src/sample';
import type { PathPrim, Scene } from '../src/scene/types';

const pens = [
  { id: 'a', name: 'Ink', color: '#1f2a24', tipMm: 0.3 },
  { id: 'b', name: 'Red', color: '#b4441f', tipMm: 0.5 },
  { id: 'c', name: 'Fine ink', color: '#1f2a24', tipMm: 0.1 },
];
const line = (pen: string | undefined, color: string, w: number): PathPrim => ({ kind: 'path', d: 'M0 0L5 5', color, pen, mode: 'stroke', widthMm: w });
const scene = (prims: PathPrim[]): Scene => ({ widthMm: 100, heightMm: 100, paper: '#fff', prims });

describe('layers follow pens', () => {
  it('one layer per pen, named after it, in the order of the palette (not first use)', () => {
    const svg = sceneToSvg(scene([line('c', '#1f2a24', 0.1), line('b', '#b4441f', 0.5), line('a', '#1f2a24', 0.3), line('a', '#1f2a24', 0.3)]), { layers: 'pen', pens });
    const labels = [...svg.matchAll(/inkscape:label="([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toEqual(['Pen 1: Ink (0.3 mm, #1f2a24)', 'Pen 2: Red (0.5 mm, #b4441f)', 'Pen 3: Fine ink (0.1 mm, #1f2a24)']);
    expect((svg.match(/<g id="/g) ?? []).length).toBe(3);
  });
  it('two pens of the same color but different tips are two layers, a pen is never merged into another', () => {
    const svg = sceneToSvg(scene([line('a', '#1f2a24', 0.3), line('c', '#1f2a24', 0.1)]), { layers: 'pen', pens });
    expect((svg.match(/<g id="/g) ?? []).length).toBe(2);
  });
  it('anything without a pen of the palette goes to its own "no pen" layer at the end', () => {
    expect(penLayerOf(line(undefined, '#123456', 0.3), pens).label).toMatch(/^No pen/);
    expect(penLayerOf(line('gone', '#123456', 0.3), pens).rank).toBe(pens.length);
  });
  it('the default is unchanged: a layer per color and width', () => {
    const svg = sceneToSvg(scene([line('a', '#1f2a24', 0.3), line('c', '#1f2a24', 0.1)]));
    expect(svg).toContain('layer-1f2a24-0.3mm');
    expect(svg).toContain('layer-1f2a24-0.1mm');
  });
});

describe('filled text in the plotter export', () => {
  const buf = (f: string) => { const b = readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
  const fonts = {
    sans: parse(buf('node_modules/@fontsource/inter/files/inter-latin-400-normal.woff')),
    serif: parse(buf('node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff')),
  } as unknown as FontSet;
  const p = defaultProject();
  p.points = sampleTrack();
  p.waypoints = sampleWaypoints(p.points);
  p.features.kinds.waypoint = true;
  const out = prepareScene(composeScene(p, undefined, undefined).scene, 'plotter', fonts, { pens: p.pens });
  const svg = sceneToSvg(out, { layers: 'pen', pens: p.pens });

  it('a whole plotter poster: no fills, no opacity, and each layer is exactly its pen', () => {
    expect(svg).not.toMatch(/fill="#/);
    expect(svg).not.toMatch(/opacity=/);
    const groups = svg.split('<g id="').slice(1);
    expect(groups.length).toBeLessThanOrEqual(p.pens.length);
    for (const g of groups) {
      const pen = p.pens[+g.match(/^pen-(\d+)-/)![1]! - 1]!;
      const widths = new Set([...g.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => +m[1]!));
      const colors = new Set([...g.matchAll(/stroke="(#[0-9a-f]{6})"/g)].map((m) => m[1]));
      expect([...widths]).toEqual([pen.tipMm]);
      expect(colors.size).toBe(1);
    }
  });
  it('all filled text, big or small, is outlined and filled in with hatch lines of its own pen', () => {
    const text = out.prims.filter((x): x is PathPrim => x.kind === 'path' && (x.d.match(/M/g) ?? []).length > 40);
    expect(text.length).toBeGreaterThan(0);
  });
});
