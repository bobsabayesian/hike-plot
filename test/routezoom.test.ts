import { describe, expect, it } from 'vitest';
import { buildScene, routeView, viewBBox, viewSizeKm } from '../src/scene/buildScene';
import { bbox } from '../src/geo/project';
import { defaultProject } from '../src/scene/project';
import { sampleTrack } from '../src/sample';
import { wheelSpan } from '../src/ui/wheel';

// Zooming out around a GPX route: more land around it, the route never cut off.
const pts = sampleTrack();
const base = (spanKm?: number) => ({ ...defaultProject(), points: pts, routeSpanKm: spanKm });

describe('route zoom', () => {
  it('without a width the view is the route itself', () => {
    expect(routeView(pts)).toEqual(bbox(pts));
  });
  it('a width grows the view to at least that, around the route\'s center, and always contains the route', () => {
    const r = bbox(pts);
    const v = routeView(pts, 40);
    const [w, h] = viewSizeKm(v);
    expect(w).toBeGreaterThanOrEqual(39.5);
    expect(h).toBeGreaterThanOrEqual(39.5);
    expect((v.minLat + v.maxLat) / 2).toBeCloseTo((r.minLat + r.maxLat) / 2, 9);
    expect((v.minLon + v.maxLon) / 2).toBeCloseTo((r.minLon + r.maxLon) / 2, 9);
    // a width smaller than the route never crops it
    const tiny = routeView(pts, 0.1);
    expect(tiny.minLat).toBeLessThanOrEqual(r.minLat);
    expect(tiny.maxLat).toBeGreaterThanOrEqual(r.maxLat);
    expect(tiny.minLon).toBeLessThanOrEqual(r.minLon);
    expect(tiny.maxLon).toBeGreaterThanOrEqual(r.maxLon);
  });
  it('the poster shows more map when zoomed out, and the route gets smaller on the page', () => {
    const [w0] = viewSizeKm(viewBBox(base())!);
    const [w1] = viewSizeKm(viewBBox(base(60))!);
    expect(w1).toBeGreaterThan(w0 * 2);
    const routeD = (spanKm?: number) => buildScene(base(spanKm)).prims.find((x) => x.part === 'route')!;
    const extent = (d: string) => { const xs = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 0); return Math.max(...xs) - Math.min(...xs); };
    const a = routeD(); const b = routeD(60);
    expect(a.kind === 'path' && b.kind === 'path' && extent(b.d) < extent(a.d)).toBe(true);
  });
  it('the wheel stays within the slider\'s own limits', () => {
    expect(wheelSpan(12, -1000, 12, 48)).toBe(12);
    expect(wheelSpan(48, 1000, 12, 48)).toBe(48);
  });
});
