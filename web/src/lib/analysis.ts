// Extra views computed in the browser from sites.json only. Nothing here changes a stored value:
// every number comes from the same similarity() used for the published scores.

import type { Dataset, Site, Weights } from '../types';
import { normalizeValue, rangeFor, similarity } from './similarity';

const marsTargets = (data: Dataset) => data.targets.filter((t) => t.body === 'mars');

/** Mean similarity of an Earth site to the Mars targets (same definition as validation.mean_mars_similarity). */
export function meanMarsSimilarity(data: Dataset, earth: Site, weights?: Weights): number | null {
  const scores = marsTargets(data)
    .map((t) => similarity(earth.raw, t.raw, earth.resolution_m, t.resolution_m, data.config, weights, earth.body, t.body).overall)
    .filter((v): v is number => v !== null);
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}

export interface SensitivityRow {
  site: Site;
  /** Share of weight combinations in which the site ranks first. */
  firstShare: number;
  bestRank: number;
  worstRank: number;
  defaultRank: number;
}

/** Every weight combination on a 0.1 grid (sums to 1); returns how stable the Mars ranking is. */
export function weightSensitivity(data: Dataset, step = 0.1): { rows: SensitivityRow[]; combos: number } {
  const combos = weightGrid(data, step);

  const sites = data.earth_sites;
  const ranksOf = (weights?: Weights) => {
    const means = sites.map((s) => ({ id: s.id, m: meanMarsSimilarity(data, s, weights) ?? -1 }));
    means.sort((a, b) => b.m - a.m);
    return new Map(means.map((x, i) => [x.id, i + 1]));
  };
  const def = ranksOf();
  const stats = new Map(sites.map((s) => [s.id, { first: 0, best: Infinity, worst: 0 }]));
  for (const w of combos) {
    const r = ranksOf(w);
    for (const s of sites) {
      const st = stats.get(s.id)!;
      const rank = r.get(s.id)!;
      if (rank === 1) st.first += 1;
      st.best = Math.min(st.best, rank);
      st.worst = Math.max(st.worst, rank);
    }
  }
  const rows = sites
    .map((site) => {
      const st = stats.get(site.id)!;
      return { site, firstShare: st.first / combos.length, bestRank: st.best, worstRank: st.worst, defaultRank: def.get(site.id)! };
    })
    .sort((a, b) => a.defaultRank - b.defaultRank);
  return { rows, combos: combos.length };
}

/** Pairwise similarity between every site (Earth, Mars and Moon) with the default weights. */
export function pairwiseSimilarity(data: Dataset): { sites: Site[]; sim: number[][] } {
  const sites = [...data.earth_sites, ...data.targets];
  const sim = sites.map((a) =>
    sites.map((b) =>
      a.id === b.id ? 1 : similarity(a.raw, b.raw, a.resolution_m, b.resolution_m, data.config, null, a.body, b.body).overall ?? 0,
    ),
  );
  return { sites, sim };
}

/**
 * Classical multidimensional scaling: places sites in 2-D so that distance ≈ 1 − similarity.
 * Eigenvectors by power iteration with deflation (n ≈ 10, so this is instant).
 */
export function mds2d(sim: number[][]): { x: number; y: number }[] {
  const n = sim.length;
  const d2 = sim.map((row) => row.map((s) => (1 - s) ** 2));
  const rowMean = d2.map((r) => r.reduce((a, b) => a + b, 0) / n);
  const all = rowMean.reduce((a, b) => a + b, 0) / n;
  const B = d2.map((r, i) => r.map((v, j) => -0.5 * (v - rowMean[i] - rowMean[j] + all)));
  const vecs: number[][] = [];
  const vals: number[] = [];
  const M = B.map((r) => [...r]);
  for (let k = 0; k < 2; k++) {
    let v = Array.from({ length: n }, (_, i) => Math.sin(i + 1 + k));
    let lambda = 0;
    for (let it = 0; it < 500; it++) {
      const w = M.map((r) => r.reduce((a, x, j) => a + x * v[j], 0));
      const norm = Math.hypot(...w) || 1;
      lambda = w.reduce((a, x, j) => a + x * v[j], 0);
      v = w.map((x) => x / norm);
    }
    vecs.push(v);
    vals.push(Math.max(lambda, 0));
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) M[i][j] -= lambda * v[i] * v[j];
  }
  return Array.from({ length: n }, (_, i) => ({ x: vecs[0][i] * Math.sqrt(vals[0]), y: vecs[1][i] * Math.sqrt(vals[1]) }));
}

/**
 * True when no mineral feature is compared for this pair because both sites sit below the signal floor
 * on their own body's scale (config.signal_floor): shared absence is not counted as similarity.
 */
export function mineralsFromLowSignal(data: Dataset, a: Site, b: Site): boolean {
  const feats = data.config.criteria.mineralogy?.features ?? [];
  const floor = data.config.signal_floor?.floor ?? 0.2;
  const pairs = feats
    .map((f) => [
      normalizeValue(a.raw[f], rangeFor(data.config, f, a.body), data.config.feature_scale?.[f]),
      normalizeValue(b.raw[f], rangeFor(data.config, f, b.body), data.config.feature_scale?.[f]),
    ])
    .filter(([x, y]) => x !== null && y !== null) as [number, number][];
  return pairs.length > 0 && pairs.every(([x, y]) => x < floor && y < floor);
}

/** How many of a criterion's features are measured on both sides, e.g. surface physics = 1 of 2. */
export function sharedFeatures(data: Dataset, criterion: string, a: Site, b: Site): { shared: number; total: number } {
  const feats = data.config.criteria[criterion]?.features ?? [];
  const shared = feats.filter((f) => a.raw[f] != null && b.raw[f] != null).length;
  return { shared, total: feats.length };
}

/** Muscat (city centre), for straight-line access distances. */
const MUSCAT = { lat: 23.588, lon: 58.3829 };

export function kmFromMuscat(site: Site): number | null {
  if (site.body !== 'earth') return null;
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(site.lat - MUSCAT.lat);
  const dLon = rad(site.lon - MUSCAT.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(MUSCAT.lat)) * Math.cos(rad(site.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Rows for the CSV download: one line per Omani site x target pair, straight from sites.json. */
export function scoresCsv(data: Dataset, loc: (s: Site) => string): string {
  const crit = Object.keys(data.config.criteria);
  const head = ['earth_id', 'earth_name', 'target_id', 'target_name', 'target_body', 'overall', 'confidence', ...crit.map((c) => `score_${c}`)];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = data.scores.map((sc) => {
    const e = data.earth_sites.find((s) => s.id === sc.earth);
    const t = data.targets.find((s) => s.id === sc.target);
    return [sc.earth, e ? loc(e) : '', sc.target, t ? loc(t) : '', t?.body ?? '', sc.overall, sc.confidence, ...crit.map((c) => sc.per_criterion[c])]
      .map(esc)
      .join(',');
  });
  return [head.join(','), ...lines].join('\n');
}

/** All weight combinations on a grid (sums to 1), shared by the sensitivity views. */
export function weightGrid(data: Dataset, step = 0.1): Weights[] {
  const names = Object.keys(data.config.criteria);
  const n = Math.round(1 / step);
  const out: Weights[] = [];
  const build = (i: number, left: number, acc: number[]) => {
    if (i === names.length - 1) {
      out.push(Object.fromEntries(names.map((k, j) => [k, (j === i ? left : acc[j]) / n])));
      return;
    }
    for (let v = 0; v <= left; v++) build(i + 1, left - v, [...acc, v]);
  };
  build(0, n, []);
  return out;
}

/** Lowest and highest overall score a pair can get across every weighting on the grid. */
export function pairWeightRange(data: Dataset, a: Site, b: Site): { min: number; max: number } | null {
  const vals = weightGrid(data)
    .map((w) => similarity(a.raw, b.raw, a.resolution_m, b.resolution_m, data.config, w, a.body, b.body).overall)
    .filter((v): v is number => v !== null);
  return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : null;
}

export interface FeatureGap {
  feature: string;
  criterion: string;
  /** 1 − |normalised difference|: 1 = identical after normalisation. */
  closeness: number;
  a: number;
  b: number;
}

/** Per-feature closeness for a pair, for the "why this score" explanation (features measured on both sides). */
export function featureGaps(data: Dataset, a: Site, b: Site): FeatureGap[] {
  const out: FeatureGap[] = [];
  for (const [criterion, spec] of Object.entries(data.config.criteria)) {
    for (const f of spec.features) {
      const va = a.raw[f];
      const vb = b.raw[f];
      if (va == null || vb == null) continue;
      const na = normalizeValue(va, rangeFor(data.config, f, a.body), data.config.feature_scale?.[f]);
      const nb = normalizeValue(vb, rangeFor(data.config, f, b.body), data.config.feature_scale?.[f]);
      if (na === null || nb === null) continue;
      const floor = data.config.signal_floor;
      if (floor && floor.features.includes(f) && na < floor.floor && nb < floor.floor) continue; // not compared
      out.push({ feature: f, criterion, closeness: 1 - Math.abs(na - nb), a: va, b: vb });
    }
  }
  return out.sort((x, y) => y.closeness - x.closeness);
}

/** Display a raw metric with its unit (same precision conventions as the tables). */
export function formatRaw(feature: string, v: number, num: (n: number, d?: number) => string): string {
  switch (feature) {
    case 'slope_deg':
      return `${num(v, 1)}°`;
    case 'roughness_m':
    case 'relief_m':
      return `${num(v, v < 10 ? 1 : 0)} m`;
    case 'albedo':
      return num(v, 3);
    case 'thermal_inertia':
      return `${num(v, 0)} TIU`;
    default:
      return num(v, v < 0.01 ? 4 : 3);
  }
}
