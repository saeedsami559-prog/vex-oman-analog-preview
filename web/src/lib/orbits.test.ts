import { describe, expect, it } from 'vitest';
import { earthMarsDistanceKm, earthMoonDistanceKm } from './orbits';

describe('earthMarsDistanceKm', () => {
  it('matches published close approaches within 1.5%', () => {
    // 2018-07-31: ~57.6 million km; 2020-10-06: ~62.07 million km
    expect(earthMarsDistanceKm(new Date('2018-07-31T08:00:00Z')) / 57.59e6).toBeCloseTo(1, 1);
    expect(Math.abs(earthMarsDistanceKm(new Date('2020-10-06T14:18:00Z')) / 62.07e6 - 1)).toBeLessThan(0.015);
  });

  it('stays within the physical range', () => {
    for (let y = 2000; y <= 2040; y += 0.37) {
      const d = earthMarsDistanceKm(new Date(Date.UTC(Math.floor(y), Math.round((y % 1) * 11), 1)));
      expect(d).toBeGreaterThan(54e6);
      expect(d).toBeLessThan(402e6);
    }
  });
});

describe('earthMoonDistanceKm', () => {
  it('matches Meeus example 47.a (1992-04-12 0h: 368,409.7 km) within 100 km', () => {
    expect(Math.abs(earthMoonDistanceKm(new Date('1992-04-12T00:00:00Z')) - 368409.7)).toBeLessThan(100);
  });

  it('matches the 14 Nov 2016 perigee (356,509 km) within 150 km', () => {
    expect(Math.abs(earthMoonDistanceKm(new Date('2016-11-14T11:23:00Z')) - 356509)).toBeLessThan(150);
  });

  it('stays between perigee and apogee limits', () => {
    for (let h = 0; h < 24 * 400; h += 7) {
      const d = earthMoonDistanceKm(new Date(Date.UTC(2026, 0, 1) + h * 3_600_000));
      expect(d).toBeGreaterThan(355_500);
      expect(d).toBeLessThan(407_000);
    }
  });
});
