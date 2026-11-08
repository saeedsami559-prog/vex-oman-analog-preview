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

export interface CellLayerStats {
  landcover_pct?: Record<string, number>;
  water_any_pct?: number;
  water_seasonal_pct?: number;
  water_permanent_pct?: number;
  hd?: { px: number; res_m: number };
  lst_day?: (number | null)[];
  lst_night?: (number | null)[];
}

export interface CellLayersFile {
  sources: Record<string, string>;
  cells: Record<string, CellLayerStats>;
}

export const LAYERS_URL = `${import.meta.env.BASE_URL}data/cell_layers.json`;
let layersCache: Promise<CellLayersFile | null> | null = null;

/** Per-cell land cover, surface water, HD terrain and MODIS ground temperature (analysis/src/analog/grid_layers.py). */
export function useCellLayers(): CellLayersFile | null {
  const [s, setS] = useState<CellLayersFile | null>(null);
  useEffect(() => {
    let alive = true;
    if (!layersCache) layersCache = fetch(LAYERS_URL).then((r) => (r.ok ? (r.json() as Promise<CellLayersFile>) : null)).catch(() => null);
    layersCache.then((x) => alive && setS(x));
    return () => {
      alive = false;
    };
  }, []);
  return s;
}

/** ESA WorldCover class codes and the colours the land-cover lens uses. */
export const WORLDCOVER: Record<number, { key: string; color: [number, number, number] }> = {
  10: { key: 'trees', color: [0, 100, 0] },
  20: { key: 'shrub', color: [255, 187, 34] },
  30: { key: 'grass', color: [255, 255, 76] },
  40: { key: 'crops', color: [240, 150, 255] },
  50: { key: 'built', color: [250, 0, 0] },
  60: { key: 'bare', color: [180, 180, 180] },
  70: { key: 'snow', color: [240, 240, 240] },
  80: { key: 'water', color: [0, 100, 200] },
  90: { key: 'wetland', color: [0, 150, 160] },
  95: { key: 'mangrove', color: [0, 207, 117] },
  100: { key: 'moss', color: [250, 230, 160] },
};

async function atlasCrop(name: string, col: number, row: number, px: number): Promise<Uint8ClampedArray> {
  const img = await atlasImage(name);
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('no 2d context');
  g.drawImage(img, col * px, row * px, px, px, 0, 0, px, px);
  return g.getImageData(0, 0, px, px).data;
}

/** Land-cover class and water occurrence (0-100 %) per 128 px heightmap pixel, or null if not published. */
export async function loadCellLayers(cell: ScoutCell): Promise<{ cover: Uint8Array; water: Uint8Array } | null> {
  const hm = cell.heightmap;
  if (!hm) return null;
  try {
    const d = await atlasCrop(hm.atlas.replace('atlas_', 'layers_'), hm.col, hm.row, hm.px);
    const n = hm.px * hm.px;
    const cover = new Uint8Array(n), water = new Uint8Array(n);
    for (let i = 0; i < n; i++) { cover[i] = d[i * 4]; water[i] = d[i * 4 + 1]; }
    return { cover, water };
  } catch {
    return null;
  }
}

/** The 256 px (~109 m) heightmap used for drawing, or null if not published. */
export async function loadHdHeightmap(cell: ScoutCell, px: number): Promise<Float32Array | null> {
  const hm = cell.heightmap;
  if (!hm) return null;
  try {
    return decodeTerrarium(await atlasCrop(hm.atlas.replace('atlas_', 'hd_'), hm.col, hm.row, px), px * px);
  } catch {
    return null;
  }
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
  key: 'science' | 'safety' | 'pristine' | 'access' | 'flood';
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
 *  flood     (when JRC surface water is published) water seen on >= 3 % of the scanned ground: warn
 * Verdict: any fail -> NO-GO; otherwise any warn -> CONDITIONAL; all pass -> GO.
 */
/** Share of scanned ground where JRC saw seasonal surface water (seen at least once but < 75 % of the time, i.e. wadis, not the sea), 1984-2021, that triggers a flood caution. */
export const WATER_WARN = 0.03;

export function decide(cell: ScoutCell, rank: number | undefined, totalRanked: number, safe: number, waterShare?: number | null): Decision {
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
  // wadi / flood channels: any surface water seen by Landsat (JRC) on 3 % or more of the scanned ground is a caution
  if (waterShare != null) criteria.push({ key: 'flood', level: waterShare >= WATER_WARN ? 'warn' : 'pass', value: `${Math.round(waterShare * 100)}%` });
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

interface BuildingsIndex { source: string; total: number; with_height: number; cells: Record<string, { file: string; offset: number; count: number }> }
let bIndex: Promise<BuildingsIndex | null> | null = null;
const bFiles = new Map<string, Promise<ArrayBuffer>>();

/**
 * Building footprints of a cell (web/public/grid/bld_NN.bin, written by `python -m analog.grid_buildings` from
 * Microsoft Global ML Building Footprints): 6 numbers per building - x, z (m from the cell centre, x east,
 * z south), length, width (m), angle (deg), height (m, 0 = not estimated). Null if not published.
 */
export async function loadBuildings(cell: ScoutCell): Promise<Float32Array | null> {
  if (!bIndex) bIndex = fetch(`${import.meta.env.BASE_URL}data/buildings.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const idx = await bIndex;
  const e = idx?.cells[cell.id];
  if (!e || !e.count) return null;
  if (!bFiles.has(e.file)) bFiles.set(e.file, fetch(`${import.meta.env.BASE_URL}grid/${e.file}`).then((r) => { if (!r.ok) throw new Error('bld'); return r.arrayBuffer(); }));
  const buf = await bFiles.get(e.file)!;
  const v = new DataView(buf, e.offset, e.count * 10);
  const out = new Float32Array(e.count * 6);
  for (let i = 0; i < e.count; i++) {
    const o = i * 10;
    out[i * 6] = v.getInt16(o, true);
    out[i * 6 + 1] = v.getInt16(o + 2, true);
    out[i * 6 + 2] = v.getUint16(o + 4, true) / 10;
    out[i * 6 + 3] = v.getUint16(o + 6, true) / 10;
    out[i * 6 + 4] = v.getUint8(o + 8);
    out[i * 6 + 5] = v.getUint8(o + 9) / 2;
  }
  return out;
}
