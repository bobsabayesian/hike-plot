import { describe, expect, it } from 'vitest';
import { buildScene, viewBBox, WATERMARK_TEXT } from '../src/scene/buildScene';
import { sceneToSvg } from '../src/export/svg';
import { defaultProject, posterMm } from '../src/scene/project';
import { pngSize, MAX_SIDE_PX } from '../src/export/png';
import { sampleTrack } from '../src/sample';

const base = () => ({ ...defaultProject(), points: sampleTrack() });
const texts = (p = base()) => buildScene(p).prims.flatMap((x) => (x.kind === 'text' ? [x.text] : []));

describe('scene', () => {
  it('poster size follows print size and orientation', () => {
    const p = defaultProject();
    expect(posterMm(p).w).toBeCloseTo(457.2);
    expect(posterMm({ ...p, landscape: true }).w).toBeCloseTo(609.6);
  });
  it('watermark on by default, gone when unchecked', () => {
    expect(texts()).toContain(WATERMARK_TEXT);
    expect(texts({ ...base(), showWatermark: false })).not.toContain(WATERMARK_TEXT);
  });
  it('auto-fills stats and respects overrides/hiding', () => {
    const p = base();
    expect(texts(p).join('|')).toMatch(/mi/);
    expect(texts(p).join('|')).toMatch(/July 4, 2024/);
    p.text.info.items.find((i) => i.key === 'distance')!.value = '99 mi';
    p.text.info.items.find((i) => i.key === 'date')!.visible = false;
    const s = texts(p).join('|');
    expect(s).toContain('99 mi');
    expect(s).not.toContain('July');
  });
  it('one svg layer per distinct color; same colors merge', () => {
    const p = base(); // route is orange; profile, text, watermark share #1f2a24
    expect(sceneToSvg(buildScene(p)).match(/inkscape:groupmode="layer"/g)).toHaveLength(2);
    p.route.color = '#1F2A24'; // different case, same color -> merges
    expect(sceneToSvg(buildScene(p)).match(/inkscape:groupmode="layer"/g)).toHaveLength(1);
    p.route.color = '#CC3300';
    p.profile.fill = '#336699';
    const svg = sceneToSvg(buildScene(p));
    expect(svg.match(/inkscape:groupmode="layer"/g)).toHaveLength(3);
    expect(svg).not.toContain('id="paper"');
    expect(sceneToSvg(buildScene(p), { paper: true })).toContain('id="paper"');
  });
  it('builds a text-only scene with no track', () => {
    expect(() => buildScene(defaultProject())).not.toThrow();
  });

  it('configurable blocks: title override, location, placement', () => {
    const p = base();
    p.text.title.value = 'Summit Day';
    p.lookup.location = 'Pierce County, Washington';
    expect(texts(p)).toContain('SUMMIT DAY');
    expect(texts(p)).toContain('Pierce County, Washington');
    expect(texts(p).some((t) => t.includes('° N'))).toBe(true);
    p.text.location.visible = false;
    expect(texts(p)).not.toContain('Pierce County, Washington');
    const y = (q: typeof p, s: string) => {
      const t = buildScene(q).prims.find((x) => x.kind === 'text' && x.text === s);
      return t && t.kind === 'text' ? t.y : NaN;
    };
    const bottomY = y(p, 'SUMMIT DAY');
    p.text.title.placement = 'top';
    expect(y(p, 'SUMMIT DAY')).toBeLessThan(bottomY);
  });
  it('feature-only poster (no gpx) uses feature name and shows no stats', () => {
    const p = { ...defaultProject(), feature: { name: 'Mount Rainier', lat: 46.85, lon: -121.76, bbox: { minLat: 46.85, maxLat: 46.85, minLon: -121.76, maxLon: -121.76 } } };
    const t = texts(p);
    expect(t).toContain('MOUNT RAINIER');
    expect(t.some((x) => /mi$/.test(x))).toBe(false);
    expect(viewBBox(p)).toBeDefined();
  });
});

describe('png sizing', () => {
  it('matches print size x dpi when it fits', () => {
    expect(pngSize(457.2, 609.6, 150)).toEqual({ width: 2700, height: 3600, dpi: 150, capped: false });
  });
  it('24x36 at 300 dpi fits as-is', () => {
    expect(pngSize(609.6, 914.4, 300)).toMatchObject({ width: 7200, height: 10800, capped: false });
  });
  it('scales down oversized exports (24x36 at 600 dpi)', () => {
    const s = pngSize(609.6, 914.4, 600);
    expect(s.capped).toBe(true);
    expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(MAX_SIDE_PX);
    expect(s.width * s.height).toBeLessThanOrEqual(100_000_000);
    expect(s.width / s.height).toBeCloseTo(2 / 3, 2);
  });
});
