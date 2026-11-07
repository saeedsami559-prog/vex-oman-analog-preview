import { describe, expect, it } from 'vitest';
import { earthMarsDistanceKm } from './orbits';

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
