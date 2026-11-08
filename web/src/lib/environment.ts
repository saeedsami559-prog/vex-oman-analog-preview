import { useEffect, useState } from 'react';

/**
 * Field-environment context from NASA POWER (web/public/data/environment.json, written by
 * `python -m analog.environment` from the raw API answers in data/processed/environment/nasa_power/).
 * Shown next to the analysis; it is not part of the similarity score.
 */
export type PowerParam = 'T2M' | 'T2M_MAX' | 'T2M_MIN' | 'T2M_RANGE' | 'PRECTOTCORR' | 'ALLSKY_SFC_SW_DWN' | 'RH2M' | 'WS2M';

export interface EnvSite {
  id: string;
  scored: boolean;
  lat: number;
  lon: number;
  cell_elevation_m: number;
  monthly: Record<PowerParam, number[]>;
  annual: Record<PowerParam, number>;
  role?: 'scored' | 'candidate' | 'benchmark';
  derived: { precip_mm_per_year: number; coolest_months: number[]; env_index?: EnvIndex };
  request_url: string;
}

/** Environmental analog index: 0 = Earth-like climate, 1 = as far as Earth goes toward Mars/Moon conditions. */
export interface EnvIndex { aridity: number; dry_air: number; thermal_swing: number; index: number }

export interface EnvData {
  source: {
    dataset: string;
    provider: string;
    api: string;
    inputs: string[];
    period: string;
    time_standard: string;
    community: string;
    home: string;
    raw_files: string;
  };
  parameters: Record<PowerParam, { units: string; longname: string }>;
  months: string[];
  sites: EnvSite[];
}

export const ENV_URL = `${import.meta.env.BASE_URL}data/environment.json`;

let cache: Promise<EnvData | null> | null = null;

function load(): Promise<EnvData | null> {
  if (!cache) {
    cache = fetch(ENV_URL)
      .then((r) => (r.ok ? (r.json() as Promise<EnvData>) : null))
      .catch(() => null);
  }
  return cache;
}

/** The NASA POWER summary; null while loading or if the file is unavailable. */
export function useEnvironment(): EnvData | null {
  const [env, setEnv] = useState<EnvData | null>(null);
  useEffect(() => {
    let alive = true;
    load().then((d) => alive && setEnv(d));
    return () => {
      alive = false;
    };
  }, []);
  return env;
}

export const envSite = (env: EnvData | null, id: string | undefined) => env?.sites.find((s) => s.id === id) ?? null;

/** Months (0 = Jan) that are the coolest three-month window at every listed site, or [] if they disagree. */
export function sharedCoolestMonths(env: EnvData | null, ids: string[]): number[] {
  const sites = ids.map((id) => envSite(env, id)).filter((s): s is EnvSite => !!s);
  if (!sites.length) return [];
  const first = sites[0].derived.coolest_months;
  return sites.every((s) => s.derived.coolest_months.join() === first.join()) ? first : [];
}

/** Mean of a monthly series over the given month indices. */
export const meanOver = (series: number[], months: number[]) => months.reduce((a, m) => a + series[m], 0) / months.length;

/** Localised short month names, built from Intl so no month strings live in the translation files. */
export function monthNames(lang: string): string[] {
  const fmt = new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en', { month: 'short', timeZone: 'UTC' });
  return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(Date.UTC(2001, i, 15))));
}

/** "Dec–Feb" style label for a run of months. */
export const monthRange = (names: string[], months: number[]) => (months.length ? `${names[months[0]]}–${names[months[months.length - 1]]}` : '');

/** Keep a number with a Latin unit ("27.1 °C") in left-to-right order inside Arabic text. */
export const ltr = (s: string) => `\u2066${s}\u2069`;

/** "2001–2025" from the POWER period string. */
export const periodYears = (period: string) => {
  const y = period.match(/\b(19|20)\d{2}\b/g);
  return y && y.length >= 2 ? `${y[0]}–${y[y.length - 1]}` : period;
};

/** Sites with an environmental analog index, highest first. */
export function envRanking(env: EnvData | null): EnvSite[] {
  return (env?.sites ?? []).filter((s) => s.derived.env_index).sort((a, b) => b.derived.env_index!.index - a.derived.env_index!.index);
}
