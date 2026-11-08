import { useEffect, useState } from 'react';

/**
 * Oman's border, governorates and towns (web/public/data/oman_places.json, written by `python -m analog.places`
 * from Natural Earth and GeoNames). Used to say in words where the drone is and to draw the overview map.
 */

type Ring = [number, number][];
export interface Geometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: Ring[] | Ring[][];
}

export interface Governorate {
  en: string;
  ar: string;
  lat: number;
  lon: number;
  geometry: Geometry;
}

/** [english, arabic | null, lat, lon, rank]: rank 3 governorate seat, 2 town >= 5000 people, 1 village, 0 locality */
export type Town = [string, string | null, number, number, number];

export interface Places {
  border: Geometry;
  governorates: Governorate[];
  towns: Town[];
  note: string;
}

export interface CellPlace {
  gov_en: string;
  gov_ar: string;
  town_en?: string;
  town_ar?: string;
  town_km?: number;
}

const URL_ = `${import.meta.env.BASE_URL}data/oman_places.json`;
let cache: Promise<Places | null> | null = null;

export function usePlaces(): Places | null {
  const [p, setP] = useState<Places | null>(null);
  useEffect(() => {
    let alive = true;
    if (!cache) cache = fetch(URL_).then((r) => (r.ok ? (r.json() as Promise<Places>) : null)).catch(() => null);
    cache.then((x) => alive && setP(x));
    return () => {
      alive = false;
    };
  }, []);
  return p;
}

export const polygons = (g: Geometry): Ring[][] => (g.type === 'Polygon' ? [g.coordinates as Ring[]] : (g.coordinates as Ring[][]));

function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function inGeometry(lon: number, lat: number, g: Geometry): boolean {
  return polygons(g).some((poly) => inRing(lon, lat, poly[0]) && !poly.slice(1).some((h) => inRing(lon, lat, h)));
}

const R = Math.PI / 180;
export function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const h = Math.sin(((bLat - aLat) * R) / 2) ** 2 + Math.cos(aLat * R) * Math.cos(bLat * R) * Math.sin(((bLon - aLon) * R) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Governorate under the point (or null over the sea / outside Oman) and the nearest town of at least `minRank`. */
export function whereIs(p: Places, lat: number, lon: number, minRank = 1): { gov: Governorate | null; town: Town | null; km: number } {
  const gov = p.governorates.find((g) => inGeometry(lon, lat, g.geometry)) ?? null;
  let best: Town | null = null;
  let bestKm = Infinity;
  for (const t of p.towns) {
    if (t[4] < minRank) continue;
    const d = km(lat, lon, t[2], t[3]);
    if (d < bestKm) { bestKm = d; best = t; }
  }
  return { gov, town: best, km: bestKm };
}

/** "near Bahla (18 km), Ad Dakhiliyah" in the page language. */
export function placeLabel(pl: CellPlace | undefined | null, lang: string, nearWord: string, kmFmt: (n: number) => string): string {
  if (!pl) return '';
  const gov = lang === 'ar' ? pl.gov_ar : pl.gov_en;
  if (!pl.town_en) return gov;
  const town = lang === 'ar' ? pl.town_ar ?? pl.town_en : pl.town_en;
  return `${nearWord} ${town} (${kmFmt(pl.town_km ?? 0)}), ${gov}`;
}

/**
 * Where a point is, in words: "Bahla, Ad Dakhiliyah" when inside a town, "12 km from Bahla, Ad Dakhiliyah"
 * otherwise; over the sea, "Over the sea" (when `sea` is true) or the nearest governorate.
 */
export function describePlace(
  p: Places | null, lat: number, lon: number,
  t: (k: string, v?: Record<string, string | number>) => string,
  loc: (v: { en: string; ar: string }) => string,
  sea = false,
): string | null {
  if (!p) return null;
  const w = whereIs(p, lat, lon, 1);
  const gov = w.gov ?? (sea ? null : p.governorates.reduce((a, b) => (km(lat, lon, a.lat, a.lon) < km(lat, lon, b.lat, b.lon) ? a : b)));
  const govName = gov ? loc({ en: gov.en, ar: gov.ar }) : null;
  if (!govName) return t('scout.overSea');
  if (!w.town || w.km > 40) return govName;
  const town = loc({ en: w.town[0], ar: w.town[1] ?? w.town[0] });
  const where = w.km < 1.5 ? t('places.at', { place: town }) : t('places.near', { km: Math.round(w.km), place: town });
  return `${where}، ${govName}`.replace('،', loc({ en: ',', ar: '،' }));
}
