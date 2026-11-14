import { describe, expect, it } from 'vitest';
import { buildScene, WATERMARK_TEXT } from '../src/scene/buildScene';
import { sceneToSvg } from '../src/export/svg';
import { defaultProject } from '../src/scene/project';
import { sampleTrack } from '../src/sample';
import type { Prim } from '../src/scene/types';

// Click to edit: every part of the poster says what it is, so the preview can open its settings.
const poster = () => {
  const p = { ...defaultProject(), points: sampleTrack() };
  p.north.enabled = true;
  p.border.enabled = true;
  return buildScene(p);
};
const textOf = (ps: Prim[], s: string) => ps.find((x) => x.kind === 'text' && x.text === s);

describe('poster parts for click to edit', () => {
  it('tags the border, text, watermark, profile, route and north arrow', () => {
    const { prims } = poster();
    const parts = new Set(prims.map((x) => x.part));
    for (const part of ['border', 'title', 'info', 'watermark', 'profile', 'route', 'north'] as const) expect(parts).toContain(part);
    expect(textOf(prims, WATERMARK_TEXT)?.part).toBe('watermark');
    expect(prims.find((x) => x.kind === 'text' && x.text === x.text.toUpperCase() && x.part === 'title')).toBeTruthy();
  });
  it('the preview carries the tags and a wider line to click on; exports carry neither', () => {
    const scene = poster();
    const preview = sceneToSvg(scene, { paper: true, ids: true });
    expect(preview).toContain('data-part="route"');
    expect(preview).toContain('stroke="transparent"');
    const out = sceneToSvg(scene, { paper: true });
    expect(out).not.toContain('data-part');
    expect(out).not.toContain('stroke="transparent"');
  });
});
