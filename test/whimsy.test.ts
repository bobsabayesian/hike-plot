import { describe, expect, it } from 'vitest';
import { formatBananas, formatEverests, formatFields, formatSteps, formatTowers } from '../src/geo/stats';
import { autoValues } from '../src/scene/buildScene';
import { computeStats } from '../src/geo/stats';
import { fromFile, toFile } from '../src/projectFile';
import { defaultProject } from '../src/scene/project';
import { sampleTrack } from '../src/sample';

describe('the playful numbers', () => {
  it('count the climb in Eiffel Towers, singular at one', () => {
    expect(formatTowers(330)).toBe('1.0 Eiffel Tower');
    expect(formatTowers(1510)).toBe('4.6 Eiffel Towers');
    expect(formatTowers(33)).toBe('0.1 Eiffel Towers');
  });
  it('turn a distance into steps (rounded), football fields and bananas end to end', () => {
    expect(formatSteps(15000)).toBe('20,000');
    expect(formatSteps(300)).toBe('400');
    expect(formatFields(91.44)).toBe('1.0');
    expect(formatFields(9144)).toBe('100');
    expect(formatBananas(18)).toBe('100');
    expect(formatBananas(15000)).toBe('83,300');
  });
  it('and the climb in Everests', () => {
    expect(formatEverests(1510)).toBe('0.17');
    expect(formatEverests(17698)).toBe('2.0');
  });
});

describe('on the poster', () => {
  it('are offered as route info, off by default, with a value from the track', () => {
    const p = { ...defaultProject(), points: sampleTrack() };
    const keys = p.text.info.items.map((i) => i.key);
    for (const k of ['towers', 'steps', 'fields', 'bananas', 'everests'] as const) {
      expect(keys).toContain(k);
      expect(p.text.info.items.find((i) => i.key === k)!.visible).toBe(false);
      expect(autoValues(p, computeStats(p.points)).info[k]).not.toBe('');
    }
    expect(autoValues(p, computeStats(p.points)).info.towers).toMatch(/Eiffel Towers?$/);
    expect(autoValues(p).info.towers).toBe(''); // no track, nothing to say
  });
  it('are added to a project saved before they existed, after its own items', () => {
    const raw = JSON.parse(JSON.stringify(toFile(defaultProject())));
    raw.project.text.info.items = raw.project.text.info.items.filter((i: { key: string }) => !['towers', 'steps', 'fields', 'bananas', 'everests'].includes(i.key));
    const back = fromFile(raw).text.info.items.map((i) => i.key);
    expect(back.slice(0, 6)).toEqual(['distance', 'gain', 'maxEle', 'duration', 'date', 'contour']);
    expect(back).toEqual(expect.arrayContaining(['towers', 'steps', 'fields', 'bananas', 'everests']));
    expect(new Set(back).size).toBe(back.length);
  });
});
