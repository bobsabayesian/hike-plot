import { describe, expect, it } from 'vitest';
import { fromUtm, gridZone, latBand, squareId, toMgrs, toUtm, utmZone } from '../src/geo/utm';

describe('UTM', () => {
  it('a point on a central meridian at the equator is at 500 000 m E, 0 m N', () => {
    const u = toUtm(0, 3);
    expect(u.zone).toBe(31);
    expect(u.easting).toBeCloseTo(500000, 3);
    expect(u.northing).toBeCloseTo(0, 3);
  });
  it('matches the published value at 0°N 0°E (zone 31, 166 021.44 m E)', () => {
    const u = toUtm(0, 0);
    expect(u.zone).toBe(31);
    expect(u.easting).toBeCloseTo(166021.44, 1);
  });
  it('matches a known landmark (CN Tower: 17T 630084 4833438)', () => {
    const u = toUtm(43.6426, -79.3871);
    expect(u.zone).toBe(17);
    // the latitude and longitude are only given to about 10 m
    expect(Math.abs(u.easting - 630084)).toBeLessThan(10);
    expect(Math.abs(u.northing - 4833438)).toBeLessThan(10);
  });
  it('on a central meridian the northing is 0.9996 of the meridian arc (4 984 944.4 m to 45°)', () => {
    const u = toUtm(45, -75);
    expect(u.zone).toBe(18);
    expect(u.easting).toBeCloseTo(500000, 3);
    expect(u.northing).toBeCloseTo(0.9996 * 4984944.378, 0);
  });
  it('the southern hemisphere adds a false northing of 10 000 km', () => {
    const u = toUtm(-45, -75);
    expect(u.south).toBe(true);
    expect(u.northing).toBeCloseTo(10000000 - 0.9996 * 4984944.378, 0);
  });
  it('round-trips to well under a meter, also outside the point\'s own zone', () => {
    for (const [lat, lon, zone] of [[46.8529, -121.7604, 10], [39.1875, -106.4756, 13], [-45.5, 170.1, 59], [64.9, -18.2, 27], [46.8, -120.05, 10]] as const) {
      const u = toUtm(lat, lon, zone);
      const [la, lo] = fromUtm(u.zone, u.south, u.easting, u.northing);
      expect(Math.abs(la - lat) * 111000).toBeLessThan(0.05);
      expect(Math.abs(lo - lon) * 111000 * Math.cos((lat * Math.PI) / 180)).toBeLessThan(0.05);
    }
  });
  it('picks the zone, with the Norway and Svalbard exceptions', () => {
    expect(utmZone(46.85, -121.76)).toBe(10);
    expect(utmZone(60, 5)).toBe(32);
    expect(utmZone(78, 15)).toBe(33);
    expect(utmZone(10, 180)).toBe(1);
  });
});

describe('MGRS', () => {
  it('names the latitude band', () => {
    expect(latBand(46.85)).toBe('T');
    expect(latBand(-33.9)).toBe('H');
    expect(latBand(0)).toBe('N');
    expect(latBand(80)).toBe('X');
    expect(gridZone(46.85, -121.76)).toBe('10T');
  });
  it('names the 100 km square (CN Tower is in 17T PJ)', () => {
    const u = toUtm(43.6426, -79.3871);
    expect(squareId(u.zone, u.easting, u.northing)).toBe('PJ');
    expect(toMgrs(43.6426, -79.3871, 3).slice(0, 7)).toBe('17T PJ ');
  });
  it('Mount Rainier is in 10T ES; the row letters of even zones start five letters on', () => {
    expect(toMgrs(46.8529, -121.7604, 1)).toMatch(/^10T ES \d \d$/);
    expect(squareId(1, 150000, 50000)).toBe('AA');
    expect(squareId(2, 150000, 50000)).toBe('JF');
    expect(squareId(3, 850000, 1950000)).toBe('ZV');
    expect(squareId(3, 850000, 2050000)).toBe('ZA'); // the rows repeat every 2000 km
  });
});
