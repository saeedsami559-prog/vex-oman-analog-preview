export type Body = 'earth' | 'mars' | 'moon';
export type Lang = 'en' | 'ar';

export interface Localized {
  en: string;
  ar: string;
}

export interface SiteCardText {
  summary: string;
  similarities?: string[];
  differences?: string[];
}

export type RawMetrics = Record<string, number | null | undefined>;
export type Resolutions = Record<string, number | null | undefined>;

export type ReasonCode =
  | 'no_coverage'
  | 'needs_login'
  | 'not_implemented'
  | 'calibration_missing'
  | 'not_applicable'
  | 'download_failed';

/** Where a measured value came from (written by analysis/src/analog/compute.py). */
export interface Provenance {
  dataset: string;
  version: string;
  products: string[];
  urls: string[];
  acquired: string[];
  native_resolution_m: number;
  processing: string;
  window_coverage?: number;
  [extra: string]: unknown;
}

/** A metric that is null, and why. */
export interface MissingMetric {
  feature: string;
  status: 'unavailable' | 'not_applicable';
  reason_code: ReasonCode;
  reason_en: string;
  reason_ar: string;
  needed: string;
  needed_ar: string;
}

export interface Site {
  id: string;
  body: Body;
  name: Localized;
  lat: number;
  lon: number;
  bbox_km: number;
  role?: 'analog' | 'reference';
  intended_targets?: string[];
  coords_approximate?: boolean;
  coords_note?: Localized;
  /** Per criterion: datasets actually used (from provenance). */
  sources: Record<string, string[]>;
  /** Per criterion: resolution used by the confidence penalty (terrain = common grid). */
  resolution_m: Resolutions;
  /** Measured value, or null when the metric is missing (see `missing`). */
  raw: RawMetrics;
  provenance: Record<string, Provenance>;
  missing: MissingMetric[];
  measured: string[];
  card: Record<Lang, SiteCardText>;
}

export interface CriterionSpec {
  weight: number;
  features: string[];
}

export interface SimilarityConfig {
  criteria: Record<string, CriterionSpec>;
  /** Pooled min..max of measured values (after `feature_scale`); null = fewer than two measured sites. */
  feature_ranges: Record<string, [number, number] | null>;
  /** Per-body ranges for features whose instruments differ by body (mineral band depths). */
  feature_ranges_by_body?: Record<string, Record<string, [number, number] | null>>;
  /** Mineral features skipped when both sites are below `floor` on their own body scale (no shared signal). */
  signal_floor?: { floor: number; features: string[] };
  body_relative_features?: string[];
  feature_scale?: Record<string, string>;
  common_terrain_scale_m: number;
  confidence: { resolution_k: number; resolution_min_factor: number };
}

export interface SimilarityResult {
  overall: number | null;
  confidence: number;
  coverage: number;
  resolution_factor: number;
  per_criterion: Record<string, number | null>;
}

export interface Score extends SimilarityResult {
  earth: string;
  target: string;
}

export interface Validation {
  reference_site: string | null;
  mean_mars_similarity: Record<string, number | null>;
  ranking: string[];
  reference_rank: number | null;
  best_mars_target: Record<string, string | null>;
}

export interface Coverage {
  measured: number;
  unavailable: number;
  not_applicable: number;
  /** measured / (measured + unavailable) */
  share: number;
  by_feature: Record<string, { measured: number; unavailable: number; not_applicable: number }>;
}

export interface Dataset {
  generated: string;
  coverage: Coverage;
  score_spread: number | null;
  config: SimilarityConfig;
  earth_sites: Site[];
  targets: Site[];
  scores: Score[];
  validation: Validation;
}

export type Weights = Record<string, number>;
