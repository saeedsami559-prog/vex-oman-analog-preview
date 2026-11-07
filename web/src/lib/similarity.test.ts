// TypeScript side of the Python <-> TypeScript parity check.
// Fixtures are written by `python -m analog.export` (see analysis/tests/test_parity.py).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeValue, similarity } from './similarity';
import type { SimilarityConfig, SimilarityResult } from '../types';

interface ParityCase {
  earth: string;
  target: string;
  raw_a: Record<string, number | null>;
  raw_b: Record<string, number | null>;
  res_a: Record<string, number | null>;
  res_b: Record<string, number | null>;
  weights: Record<string, number> | null;
  body_a?: string;
  body_b?: string;
  expected: SimilarityResult;
}

const fixture = fileURLToPath(new URL('../../../analysis/tests/fixtures/parity_cases.json', import.meta.url));
const data = JSON.parse(readFileSync(fixture, 'utf-8')) as { config: SimilarityConfig; cases: ParityCase[] };

describe('similarity parity with Python', () => {
  it('has cases', () => expect(data.cases.length).toBeGreaterThan(0));

  it.each(data.cases.map((c) => [`${c.earth} vs ${c.target} w=${JSON.stringify(c.weights)}`, c] as const))(
    '%s',
    (_label, c) => {
      const got = similarity(c.raw_a, c.raw_b, c.res_a, c.res_b, data.config, c.weights, c.body_a, c.body_b);
      for (const key of ['overall', 'confidence', 'coverage', 'resolution_factor'] as const) {
        const exp = c.expected[key];
        if (exp === null) expect(got[key]).toBeNull();
        else expect(got[key] as number).toBeCloseTo(exp, 12);
      }
      for (const [crit, exp] of Object.entries(c.expected.per_criterion)) {
        if (exp === null) expect(got.per_criterion[crit]).toBeNull();
        else expect(got.per_criterion[crit] as number).toBeCloseTo(exp, 12);
      }
    },
  );
});

describe('normalizeValue', () => {
  it('clips and handles missing values', () => {
    expect(normalizeValue(50, [0, 100])).toBe(0.5);
    expect(normalizeValue(-5, [0, 100])).toBe(0);
    expect(normalizeValue(500, [0, 100])).toBe(1);
    expect(normalizeValue(null, [0, 1])).toBeNull();
    expect(normalizeValue(5, null)).toBeNull();
  });

  it('applies log10 before the range', () => {
    expect(normalizeValue(100, [1, 3], 'log10')).toBeCloseTo(0.5, 12);
    expect(() => normalizeValue(0, [1, 3], 'log10')).toThrow();
  });
});
