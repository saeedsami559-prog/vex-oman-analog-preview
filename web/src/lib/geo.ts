import type { Body, Site } from '../types';

const RADIUS_KM: Record<Body, number> = { earth: 6371, mars: 3389.5, moon: 1737.4 };

/** Same box as analysis/src/analog/download/sites.py::bbox_for — the window we clip data from. */
export function analysisWindow(site: Site): [[number, number], [number, number]] {
  const kmPerDeg = (Math.PI * RADIUS_KM[site.body]) / 180;
  const dLat = site.bbox_km / kmPerDeg;
  const dLon = site.bbox_km / (kmPerDeg * Math.max(Math.cos((site.lat * Math.PI) / 180), 0.01));
  return [
    [Math.max(-90, site.lat - dLat), site.lon - dLon],
    [Math.min(90, site.lat + dLat), site.lon + dLon],
  ];
}

export function formatCoords(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}° ${ns}, ${Math.abs(lon).toFixed(2)}° ${ew}`;
}

export const BODY_COLOR: Record<Body, string> = {
  earth: 'var(--earth)',
  mars: 'var(--mars)',
  moon: 'var(--moon)',
};
