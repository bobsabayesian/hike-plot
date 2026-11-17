import { describe, expect, it } from 'vitest';
import { suncalcUrl } from '../src/ui/suncalc';

const view = { minLat: 39.18, maxLat: 39.22, minLon: -106.37, maxLon: -106.32 };

describe('SunCalc link', () => {
  it('points at the middle of the map, at the hike start in local time', () => {
    const start = new Date(2020, 7, 8, 6, 5).getTime(); // 8 Aug 2020, 06:05 local
    expect(suncalcUrl(view, [{ lat: 39.2, lon: -106.3 }, { lat: 39.2, lon: -106.3, time: start }])).toBe(
      'https://www.suncalc.org/#/39.2000,-106.3450,12/2020.08.08/06:05/1/3',
    );
  });
  it('without times in the GPX, today at noon', () => {
    expect(suncalcUrl(view, [], new Date(2026, 10, 17, 9, 47))).toBe('https://www.suncalc.org/#/39.2000,-106.3450,12/2026.11.17/12:00/1/3');
  });
});
