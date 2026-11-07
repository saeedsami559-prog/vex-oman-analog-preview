// The NASA POWER summary the website serves (written by `python -m analog.environment`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Dataset } from '../types';
import { meanOver, monthRange, sharedCoolestMonths, type EnvData } from './environment';

const read = <T,>(rel: string) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8')) as T;
const env = read<EnvData>('../../public/data/environment.json');
const data = read<Dataset>('../../public/data/sites.json');

describe('served environment.json', () => {
  it('covers every scored Earth site at the same coordinates', () => {
    for (const s of data.earth_sites) {
      const e = env.sites.find((x) => x.id === s.id);
      expect(e, s.id).toBeDefined();
      expect(e!.lat).toBeCloseTo(s.lat, 3);
      expect(e!.lon).toBeCloseTo(s.lon, 3);
      expect(e!.scored).toBe(true);
    }
  });

  it('has twelve months for every parameter and names its source', () => {
    expect(env.source.dataset).toBe('NASA POWER');
    for (const e of env.sites) for (const series of Object.values(e.monthly)) expect(series).toHaveLength(12);
  });
});

describe('environment helpers', () => {
  it('finds the shared coolest window', () => {
    expect(sharedCoolestMonths(env, data.earth_sites.map((s) => s.id))).toEqual([11, 0, 1]);
    expect(sharedCoolestMonths(env, [])).toEqual([]);
  });

  it('averages and labels a window', () => {
    expect(meanOver([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [11, 0, 1])).toBeCloseTo(5);
    expect(monthRange(['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'], [11, 0, 1])).toBe('D–F');
  });
});
