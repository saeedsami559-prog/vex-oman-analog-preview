import type { Body, Marker, Verdict, Waypoint } from './scout';

/**
 * The mission log: every VEX Scout flight, kept in this browser (localStorage).
 * Nothing leaves the device; clearing the browser's site data clears the log.
 */

export interface Photo {
  url: string; // small JPEG data URL
  lat: number;
  lon: number;
  altM: number;
  aglM: number;
  t: number; // drone time, seconds since take-off
}

export interface FlightRecord {
  id: string;
  cellId: string;
  body: Body;
  lat: number;
  lon: number;
  started: number; // epoch ms
  updated: number;
  droneSeconds: number; // flight time in drone time (x10 compressed)
  distanceKm: number;
  batteryUsed: number;
  maxAglM: number;
  windMs: number | null;
  mode: 'manual' | 'survey' | 'dragonfly';
  path: Waypoint[];
  markers: Marker[];
  photos: Photo[];
  scan: { verdict: Verdict; safe: number; meanSlope: number } | null;
  aiP: number | null;
  landings: number;
}

const KEY = 'vex-scout-log';
const MAX_FLIGHTS = 20;
export const MAX_PHOTOS = 12;

export function loadLog(): FlightRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as FlightRecord[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function store(list: FlightRecord[]): boolean {
  // newest first; if the browser quota is hit, drop photos of the oldest flights, then the flights themselves
  let l = [...list].sort((a, b) => b.updated - a.updated).slice(0, MAX_FLIGHTS);
  for (let tries = 0; tries < 40; tries++) {
    try {
      localStorage.setItem(KEY, JSON.stringify(l));
      window.dispatchEvent(new Event('vex-log'));
      return true;
    } catch {
      const victim = [...l].reverse().find((f) => f.photos.length);
      if (victim) victim.photos = victim.photos.slice(0, Math.floor(victim.photos.length / 2));
      else if (l.length > 1) l = l.slice(0, -1);
      else return false;
    }
  }
  return false;
}

export function saveFlight(f: FlightRecord): boolean {
  const list = loadLog().filter((x) => x.id !== f.id);
  return store([{ ...f, updated: Date.now() }, ...list]);
}

export function deleteFlight(id: string): void {
  store(loadLog().filter((x) => x.id !== id));
}

export function clearLog(): void {
  try {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new Event('vex-log'));
  } catch {
    /* storage unavailable */
  }
}

/** Path length in km (great-circle between recorded points). */
export function pathKm(path: Waypoint[]): number {
  let km = 0;
  const r = Math.PI / 180;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    km += 2 * 6371 * Math.asin(Math.sqrt(h));
  }
  return km;
}
