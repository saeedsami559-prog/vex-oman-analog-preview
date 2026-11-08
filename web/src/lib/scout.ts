import { useEffect, useState } from 'react';
import type { Localized } from '../types';

/**
 * VEX Scout: the country-wide screening grid (web/public/data/oman_grid.json, written by
 * `python -m analog.grid`) plus the transparent rules the virtual drone uses to decide GO / CONDITIONAL / NO-GO.
 */

export interface ScoutCell {
  id: string;
  lat: number;
  lon: number;
  land_frac: number;
  slope_deg: number;
  roughness_m: number;
  relief_m: number;
  elev_min: number | null;
  elev_max: number | null;
  elev_mean: number | null;
  built_pct: number | null;
  crop_pct: number | null;
  km_muscat: number;
  mars: Record<string, number | null>;
  mars_best: string | null;
  mars_score: number | null;
  moon_score: number | null;
  mars_rank?: number;
  moon_rank?: number;
  heightmap: { px: number; res_m: number; size_km: number; atlas: string; col: number; row: number } | null;
  /** Share (%) of the cell's 217 m heightmap pixels with slope < SAFE_DEG (written by analog.scout_ai). */
  safe_pct?: number | null;
  /** NASA POWER climatology at the cell centre (analog.scout_ai). */
  env?: CellEnv | null;
  /** The AI second opinion per body (analog.scout_ai). */
  ai?: Partial<Record<Body, CellAi>>;
}

export interface CellEnv {
  rain_mm: number;
  rh: number;
  t_range: number;
  t2m: number;
  t2m_monthly: number[];
  wind_ms: number;
  wind_monthly: number[];
  coolest: number[];
  aridity: number;
  dry_air: number;
  thermal_swing: number;
  index: number;
}

export interface CellAi {
  /** 0..100: mean similarity to the 3 nearest example sites. */
  p: number;
  /** Ids of the 3 nearest example sites, nearest first. */
  nn: string[];
  /** Signed z-score difference per feature (cell - neighbours), in AiModel.features order. */
  z: number[];
  rank: number;
}

export interface AiExample {
  id: string;
  name: Localized;
  lat: number;
  lon: number;
  x: number[];
}

export interface AiModel {
  features: string[];
  k: number;
  mean: number[];
  std: number[];
  examples: Record<Body, AiExample[]>;
  validation: Record<Body, {
    leave_one_out: { id: string; p: number; beats_pct: number }[];
    omani_sites: { id: string; cell: string; p: number; rank: number }[];
    cells: number;
    median_p: number;
  }>;
  note: string;
}

export interface ScoutGrid {
  generated: string;
  method: {
    cell_deg: number;
    min_land: number;
    border: string;
    terrain_source: string;
    landcover_source: string;
    criteria: string;
    heightmap_encoding: string;
    climate_source?: string;
  };
  targets: { id: string; body: 'mars' | 'moon'; name: Localized }[];
  sites: { id: string; lat: number; lon: number; cell: string | null }[];
  cells: ScoutCell[];
  ai?: AiModel;
}

export type Body = 'mars' | 'moon';
export type Verdict = 'go' | 'conditional' | 'nogo';
export type Level = 'pass' | 'warn' | 'fail';

export const GRID_URL = `${import.meta.env.BASE_URL}data/oman_grid.json`;
export const atlasUrl = (name: string) => `${import.meta.env.BASE_URL}grid/${name}`;

let cache: Promise<ScoutGrid | null> | null = null;

export function useScoutGrid(): { grid: ScoutGrid | null; failed: boolean } {
  const [state, setState] = useState<{ grid: ScoutGrid | null; failed: boolean }>({ grid: null, failed: false });
  useEffect(() => {
    let alive = true;
    if (!cache) {
      cache = fetch(GRID_URL)
        .then((r) => (r.ok ? (r.json() as Promise<ScoutGrid>) : null))
        .catch(() => null);
    }
    cache.then((g) => alive && setState({ grid: g, failed: !g }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/** Score of a cell for the Moon, for its best Mars target, or for one chosen Mars target. */
export const scoreOf = (c: ScoutCell, body: Body, marsTarget?: string | null) =>
  body === 'moon' ? c.moon_score : marsTarget ? c.mars[marsTarget] ?? null : c.mars_score;

/** Rank (1 = most similar) among all cells, for the same choice as scoreOf. */
export function ranksFor(cells: ScoutCell[], body: Body, marsTarget?: string | null): Map<string, number> {
  const scored = cells.filter((c) => scoreOf(c, body, marsTarget) != null);
  scored.sort((a, b) => (scoreOf(b, body, marsTarget) ?? 0) - (scoreOf(a, body, marsTarget) ?? 0));
  return new Map(scored.map((c, i) => [c.id, i + 1]));
}

/** Terrarium-encoded RGB pixels to heights in metres. */
export function decodeTerrarium(rgba: Uint8ClampedArray | number[], n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rgba[i * 4] * 256 + rgba[i * 4 + 1] + rgba[i * 4 + 2] / 256 - 32768;
  return out;
}

const atlases = new Map<string, Promise<HTMLImageElement>>();
function atlasImage(name: string): Promise<HTMLImageElement> {
  if (!atlases.has(name)) {
    atlases.set(name, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => { atlases.delete(name); reject(new Error(`atlas ${name} not found`)); };
      img.src = atlasUrl(name);
    }));
  }
  return atlases.get(name)!;
}

/** Load a cell's heightmap from its atlas PNG and decode it (browser only). */
export async function loadHeightmap(cell: ScoutCell): Promise<{ heights: Float32Array; px: number }> {
  const hm = cell.heightmap;
  if (!hm) throw new Error('no heightmap');
  const img = await atlasImage(hm.atlas);
  const px = hm.px;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('no 2d context');
  g.drawImage(img, hm.col * px, hm.row * px, px, px, 0, 0, px, px);
  return { heights: decodeTerrarium(g.getImageData(0, 0, px, px).data, px * px), px };
}

/** Slope in degrees at every heightmap pixel (central differences, edges clamped). */
export function slopeField(h: Float32Array, px: number, resM: number): Float32Array {
  const s = new Float32Array(px * px);
  const at = (x: number, y: number) => h[Math.min(px - 1, Math.max(0, y)) * px + Math.min(px - 1, Math.max(0, x))];
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) / (2 * resM);
      const dy = (at(x, y + 1) - at(x, y - 1)) / (2 * resM);
      s[y * px + x] = (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
    }
  }
  return s;
}

/** Slope classes used by the drone's safety view. Our own transparent thresholds, not a NASA rule. */
export const SAFE_DEG = 10;
export const HAZARD_DEG = 25;
export const slopeClass = (deg: number): Level => (deg < SAFE_DEG ? 'pass' : deg < HAZARD_DEG ? 'warn' : 'fail');

/** Share (0..1) of the pixels within `radiusM` of (cx, cy) - pixel coords - whose slope is below SAFE_DEG. */
export function safeShare(slope: Float32Array, px: number, resM: number, cx = px / 2, cy = px / 2, radiusM = Infinity): number {
  let ok = 0;
  let n = 0;
  const r = radiusM / resM;
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      n++;
      if (slope[y * px + x] < SAFE_DEG) ok++;
    }
  }
  return n ? ok / n : 0;
}

export interface Criterion {
  key: 'science' | 'safety' | 'pristine' | 'access';
  level: Level;
  value: string;
}

export interface Decision {
  verdict: Verdict;
  criteria: Criterion[];
}

/**
 * GO / CONDITIONAL / NO-GO. Every threshold is written here and shown on the page:
 *  science   rank among all cells for the chosen body: top 15 % pass, top 50 % warn, else fail
 *  safety    share of the scanned ground below 10 deg: >= 40 % pass, >= 15 % warn, else fail
 *  pristine  built-up + cropland share (ESA WorldCover): < 1 % pass, < 5 % warn, else fail
 *  access    distance from Muscat: <= 450 km pass, else warn (remote is a cost, never a no-go)
 * Verdict: any fail -> NO-GO; otherwise any warn -> CONDITIONAL; all pass -> GO.
 */
export function decide(cell: ScoutCell, rank: number | undefined, totalRanked: number, safe: number): Decision {
  const pct = rank && totalRanked ? rank / totalRanked : 1;
  const human = (cell.built_pct ?? 0) + (cell.crop_pct ?? 0);
  const criteria: Criterion[] = [
    { key: 'science', level: pct <= 0.15 ? 'pass' : pct <= 0.5 ? 'warn' : 'fail', value: rank ? `#${rank} / ${totalRanked}` : '–' },
    { key: 'safety', level: safe >= 0.4 ? 'pass' : safe >= 0.15 ? 'warn' : 'fail', value: `${Math.round(safe * 100)}%` },
    {
      key: 'pristine',
      level: cell.built_pct == null ? 'warn' : human < 1 ? 'pass' : human < 5 ? 'warn' : 'fail',
      value: cell.built_pct == null ? '–' : `${human.toFixed(1)}%`,
    },
    { key: 'access', level: cell.km_muscat <= 450 ? 'pass' : 'warn', value: `${cell.km_muscat} km` },
  ];
  const verdict: Verdict = criteria.some((c) => c.level === 'fail') ? 'nogo' : criteria.some((c) => c.level === 'warn') ? 'conditional' : 'go';
  return { verdict, criteria };
}

/** Local metres (x east, y north, origin at the cell centre) to latitude/longitude, small-area approximation. */
export function toLatLon(cell: { lat: number; lon: number }, xM: number, yM: number): [number, number] {
  const lat = cell.lat + yM / 111_320;
  const lon = cell.lon + xM / (111_320 * Math.cos((cell.lat * Math.PI) / 180));
  return [lat, lon];
}

export interface Waypoint {
  lat: number;
  lon: number;
  altM: number;
}

export interface Marker {
  lat: number;
  lon: number;
  label: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** KML for Google Earth / GPS apps: the flown path (absolute altitude) and the placed markers. */
export function toKml(name: string, path: Waypoint[], markers: Marker[]): string {
  const coords = path.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)},${Math.round(p.altM)}`).join(' ');
  const marks = markers
    .map((m) => `<Placemark><name>${esc(m.label)}</name><Point><coordinates>${m.lon.toFixed(6)},${m.lat.toFixed(6)},0</coordinates></Point></Placemark>`)
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(name)}</name>` +
    (path.length > 1
      ? `<Placemark><name>${esc(name)} flight path</name><LineString><altitudeMode>absolute</altitudeMode><coordinates>${coords}</coordinates></LineString></Placemark>`
      : '') +
    marks +
    `</Document></kml>`
  );
}
