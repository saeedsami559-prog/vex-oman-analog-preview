// TypeScript twin of analysis/src/analog/similarity.py + normalize.py.
// Users change weights in the browser, so the index must be computed here too.
// Keep the operation order identical to Python; similarity.test.ts checks parity.

import type { RawMetrics, Resolutions, SimilarityConfig, SimilarityResult, Weights } from '../types';

/** Apply the feature's scale (undefined = linear, "log10"). */
export function transform(value: number, scale: string | null | undefined): number {
  if (scale === null || scale === undefined || scale === 'linear') return value;
  if (scale === 'log10') {
    if (value <= 0) throw new Error(`log10 scale needs positive values, got ${value}`);
    return Math.log10(value);
  }
  throw new Error(`unknown scale ${scale}`);
}

/** Map a raw value to 0..1 with a range in transformed units; null value or range -> null. */
export function normalizeValue(
  value: number | null | undefined,
  range: [number, number] | null | undefined,
  scale?: string | null,
): number | null {
  if (value === null || value === undefined || Number.isNaN(value) || !range) return null;
  const [lo, hi] = range;
  if (hi === lo) return null;
  const t = (transform(value, scale) - lo) / (hi - lo);
  return Math.min(1, Math.max(0, t));
}

/**
 * Normalisation range for one site's value. Mineral indices come from different instruments per
 * body (EMIT on Earth, CRISM on Mars), so they use that body's own range; mirrors normalize.range_for.
 */
export function rangeFor(config: SimilarityConfig, feature: string, body?: string | null): [number, number] | null | undefined {
  const byBody = config.feature_ranges_by_body?.[feature];
  if (byBody && body) return byBody[body] ?? null;
  return config.feature_ranges[feature];
}

export function resolutionFactor(
  resA: number | null | undefined,
  resB: number | null | undefined,
  k: number,
  minFactor: number,
): number {
  if (!resA || !resB) return 1;
  return Math.max(minFactor, 1 - k * Math.abs(Math.log2(resA / resB)));
}

export function similarity(
  rawA: RawMetrics,
  rawB: RawMetrics,
  resA: Resolutions,
  resB: Resolutions,
  config: SimilarityConfig,
  weights?: Weights | null,
  bodyA?: string | null,
  bodyB?: string | null,
): SimilarityResult {
  const { criteria } = config;
  const scales = config.feature_scale ?? {};
  const k = config.confidence.resolution_k;
  const minFactor = config.confidence.resolution_min_factor;
  // Shared absence is not similarity: skip a floor feature when both sides are below the floor.
  const floor = config.signal_floor?.floor;
  const floorFeatures = new Set(config.signal_floor?.features ?? []);

  const perCriterion: Record<string, number | null> = {};
  let num = 0;
  let den = 0;
  let total = 0;
  let covNum = 0;
  let resNum = 0;

  for (const [name, spec] of Object.entries(criteria)) {
    const w = weights && name in weights ? Number(weights[name]) : Number(spec.weight);
    if (w > 0) total += w;

    let diffsSum = 0;
    let count = 0;
    for (const feature of spec.features) {
      const scale = scales[feature];
      const na = normalizeValue(rawA[feature], rangeFor(config, feature, bodyA), scale);
      const nb = normalizeValue(rawB[feature], rangeFor(config, feature, bodyB), scale);
      if (na === null || nb === null) continue;
      if (floor !== undefined && floor !== null && floorFeatures.has(feature) && na < floor && nb < floor) continue;
      diffsSum += 1 - Math.abs(na - nb);
      count += 1;
    }

    if (count === 0) {
      perCriterion[name] = null;
      continue;
    }

    const score = diffsSum / count;
    perCriterion[name] = score;
    if (w > 0) {
      num += w * score;
      den += w;
      covNum += (w * count) / spec.features.length;
      resNum += w * resolutionFactor(resA[name], resB[name], k, minFactor);
    }
  }

  const overall = den > 0 ? num / den : null;
  const coverage = total > 0 ? covNum / total : 0;
  const resMean = den > 0 ? resNum / den : 0;
  return {
    overall,
    confidence: coverage * resMean,
    coverage,
    resolution_factor: resMean,
    per_criterion: perCriterion,
  };
}

export function defaultWeights(config: SimilarityConfig): Weights {
  return Object.fromEntries(Object.entries(config.criteria).map(([k, v]) => [k, v.weight]));
}

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export function confidenceLevel(c: number): ConfidenceLevel {
  if (c >= 0.7) return 'high';
  if (c >= 0.45) return 'medium';
  return 'low';
}
