import { describe, expect, it } from 'vitest';
import { actualZoom, clampZoom, fitSize, maxZoom, scrollToKeep, wheelFactor, zoomPercent, ZOOM_MIN } from '../src/ui/zoom';

describe('fitting the poster in the stage', () => {
  it('is as large as fits whole, limited by width or by height', () => {
    expect(fitSize(1000, 500, 0.5)).toEqual({ w: 250, h: 500 }); // tall poster, short stage: height rules
    expect(fitSize(300, 900, 0.5)).toEqual({ w: 300, h: 600 }); // narrow stage: width rules
    const capped = fitSize(1000, 2000, 0.5, 800);
    expect(capped.h).toBe(800);
    expect(capped.w).toBe(400);
  });
  it('never collapses to nothing', () => {
    expect(fitSize(0, 0, 0.7).h).toBeGreaterThanOrEqual(1);
  });
});

describe('zoom limits and names', () => {
  it('fit is the smallest, and the largest is four times real size (at least four times fit)', () => {
    expect(clampZoom(0.2, 10)).toBe(ZOOM_MIN);
    expect(clampZoom(50, 10)).toBe(10);
    expect(clampZoom(NaN, 10)).toBe(ZOOM_MIN);
    expect(clampZoom(3, 10)).toBe(3);
    // a 457 mm (18 in) wide poster fitted at 600 px: real size is 1728 px, so 2.88 times fit
    expect(actualZoom(600, 457.2)).toBeCloseTo(2.88, 2);
    expect(maxZoom(600, 457.2)).toBeCloseTo(11.52, 1);
    expect(maxZoom(2000, 100)).toBe(4); // a small poster that already fills the stage still zooms
  });
  it('is shown as a share of real size, so the real-size zoom reads 100%', () => {
    const fit = 600, mm = 457.2;
    expect(zoomPercent(actualZoom(fit, mm), fit, mm)).toBe(100);
    expect(zoomPercent(1, fit, mm)).toBe(35);
    expect(zoomPercent(actualZoom(fit, mm) * 2, fit, mm)).toBe(200);
  });
});

describe('the wheel', () => {
  it('zooms in on a turn up, out on a turn down, by about a third for a mouse notch, and smoothly for small pinch steps', () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1.25);
    expect(wheelFactor(-100)).toBeLessThan(1.35);
    expect(wheelFactor(100)).toBeCloseTo(1 / wheelFactor(-100), 9);
    expect(wheelFactor(0)).toBe(1);
    expect(wheelFactor(-3)).toBeGreaterThan(1);
    expect(wheelFactor(-3)).toBeLessThan(1.01);
    expect(wheelFactor(-100000)).toBe(wheelFactor(-200)); // a fling is capped
  });
});

describe('keeping the point under the pointer', () => {
  it('scrolls so the same spot of the poster stays under the pointer after it grows', () => {
    // the poster is 600 wide at the viewport's left edge (100 on screen); the pointer is at 300 in the viewport: 40% across
    const frac = (100 + 300 - 100) / 600;
    // it doubles to 1200 and its left edge is now at 100 (unscrolled): the spot is at 100 + 0.5*1200... check by the formula
    const scroll = scrollToKeep(frac, 100, 1200, 300, 100, 0);
    // after scrolling by `scroll`, the edge moves to 100 - scroll, and the spot is at 100 - scroll + frac * 1200, which must equal 100 + 300
    expect(100 - scroll + frac * 1200).toBeCloseTo(100 + 300, 9);
  });
  it('needs no scroll when the pointer is at the poster edge or the size does not change', () => {
    expect(scrollToKeep(0, 100, 600, 0, 100, 0)).toBe(0);
    expect(scrollToKeep(0.5, 100, 600, 300, 100, 0)).toBe(0);
  });
});
