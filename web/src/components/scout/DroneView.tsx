import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useI18n } from '../../i18n';
import { SAFE_DEG, HAZARD_DEG, safeShare, slopeClass, toLatLon, type Body, type Marker, type ScoutCell, type Waypoint } from '../../lib/scout';
import type { Photo } from '../../lib/missionLog';

/**
 * The virtual drone: a WebGL flight over the real NASADEM heightmap of one VEX Scout cell.
 *
 * It behaves like a small survey drone: it starts on the ground, takes off, flies with inertia, holds
 * altitude, has a gimbal camera with a real-drone field of view (82 deg horizontal), returns home by
 * itself when the battery reaches 20 % and lands. Wind is the NASA POWER 10 m mean for the current
 * month at the cell (it costs battery and shakes the camera; POWER gives speed, so no direction is
 * invented). Heights are true metres, drawn with a 1.6x vertical exaggeration; every number on the HUD
 * comes from the same heightmap. Time runs 10x faster than real.
 *
 * Autopilots: 'survey' flies a lawnmower pattern; 'dragonfly' follows the scouting strategy of NASA's
 * Dragonfly rotorcraft for Titan: fly ahead, image a candidate landing site, come back to the last
 * verified safe site and land, then hop to the newly verified site.
 */

export type Lens = 'relief' | 'slope' | 'mars' | 'satellite' | 'hazard';
export type Phase = 'landed' | 'takeoff' | 'flying' | 'landing' | 'rth';
export type AutoMode = false | 'survey' | 'dragonfly';
export type DfStep = 'out' | 'scan' | 'back' | 'land' | 'hop' | null;

export interface Telemetry {
  lat: number;
  lon: number;
  altMsl: number;
  agl: number;
  ground: number;
  slope: number;
  speed: number; // m/s, simulated (10x real)
  vspeed: number; // m/s, simulated
  heading: number;
  battery: number;
  auto: AutoMode;
  phase: Phase;
  distHome: number; // m
  gimbal: number; // deg, negative = down
  flightSec: number; // drone time
  wind: number | null;
  footprintM: [number, number] | null; // ground width x depth seen by the camera when looking down
  dfStep: DfStep;
  lzCount: number;
}

export interface ScanResult {
  lat: number;
  lon: number;
  radiusM: number;
  safe: number;
  meanSlope: number;
  elevMin: number;
  elevMax: number;
}

export interface FlightStats {
  droneSeconds: number;
  distanceKm: number;
  batteryUsed: number;
  maxAglM: number;
  landings: number;
}

export interface DroneHandle {
  scan: () => ScanResult;
  mark: (label: string) => Marker;
  path: () => Waypoint[];
  markers: () => Marker[];
  setAuto: (mode: AutoMode) => void;
  recharge: () => void;
  takeOff: () => void;
  land: () => void;
  returnHome: () => void;
  photo: () => void;
  stats: () => FlightStats;
}

export type DroneEvent =
  | { type: 'takeoff' }
  | { type: 'landed'; safe: boolean; slope: number }
  | { type: 'rth'; reason: 'battery' | 'user' }
  | { type: 'lz'; marker: Marker }
  | { type: 'photo'; photo: Photo };

interface Props {
  cell: ScoutCell;
  heights: Float32Array;
  slope: Float32Array;
  px: number;
  resM: number;
  lens: Lens;
  body: Body;
  wind: number | null;
  onTelemetry: (t: Telemetry) => void;
  onEvent?: (e: DroneEvent) => void;
  onSatelliteFail?: () => void;
}

const EX = 1.6; // vertical exaggeration, drawing only
const MIN_AGL = 25; // in flight; take-off and landing go lower
const SCAN_R = 2000;
const HFOV = 82; // deg, a typical small survey drone's wide camera
const TIME = 10; // simulated time runs 10x real
const RTH_AT = 20; // % battery
const CRUISE = 300; // m AGL for the autopilots
const LZ_R = 450; // m, landing-zone check radius
const HOP = 6000; // m, Dragonfly scouting distance (scaled to a 27 km cell)

// ---------- tiny matrix helpers (column-major, like WebGL) ----------
type M4 = Float32Array;
const perspective = (fov: number, aspect: number, near: number, far: number): M4 => {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
};
const lookAt = (e: number[], c: number[], up: number[]): M4 => {
  let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
  let l = Math.hypot(zx, zy, zz);
  zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1;
  xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
    -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1,
  ]);
};
const mul = (a: M4, b: M4): M4 => {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
    o[i * 4 + j] = s;
  }
  return o;
};

const VS = `
attribute vec3 aPos; attribute vec3 aNormal; attribute float aSlope; attribute float aRough; attribute vec2 aUv;
uniform mat4 uMvp; uniform vec3 uEye;
varying vec3 vNormal; varying float vSlope; varying float vRough; varying float vH; varying vec2 vUv; varying float vDist; varying vec2 vXZ;
void main(){
  vNormal = aNormal; vSlope = aSlope; vRough = aRough; vH = aPos.y; vUv = aUv; vXZ = aPos.xz;
  vDist = distance(aPos, uEye);
  gl_Position = uMvp * vec4(aPos, 1.0);
}`;

const FS = `
precision mediump float;
varying vec3 vNormal; varying float vSlope; varying float vRough; varying float vH; varying vec2 vUv; varying float vDist; varying vec2 vXZ;
uniform int uLens; uniform vec2 uHRange; uniform vec3 uSun; uniform vec3 uFog; uniform float uFogFar;
uniform sampler2D uTex; uniform vec3 uScan; uniform float uScanT;
vec3 ramp(float t, vec3 a, vec3 b, vec3 c, vec3 d){
  return t < 0.33 ? mix(a, b, t / 0.33) : t < 0.66 ? mix(b, c, (t - 0.33) / 0.33) : mix(c, d, (t - 0.66) / 0.34);
}
void main(){
  vec3 n = normalize(vNormal);
  float diff = clamp(dot(n, normalize(uSun)), 0.0, 1.0);
  float shade = 0.35 + 0.75 * diff;
  float t = clamp((vH - uHRange.x) / max(1.0, uHRange.y - uHRange.x), 0.0, 1.0);
  vec3 col;
  if (uLens == 1) {
    col = vSlope < ${SAFE_DEG.toFixed(1)} ? vec3(0.22, 0.72, 0.38) : vSlope < ${HAZARD_DEG.toFixed(1)} ? vec3(0.93, 0.74, 0.22) : vec3(0.88, 0.27, 0.22);
    col *= 0.55 + 0.6 * diff;
  } else if (uLens == 2) {
    col = ramp(t, vec3(0.45, 0.20, 0.10), vec3(0.70, 0.33, 0.16), vec3(0.82, 0.48, 0.28), vec3(0.88, 0.70, 0.55)) * shade;
  } else if (uLens == 3) {
    col = texture2D(uTex, vUv).rgb * (0.75 + 0.35 * diff);
  } else if (uLens == 4) {
    // hazard map in the style of the Jezero landing hazard map: blue safest, green safe, yellow caution, red hazard
    float lvl = vSlope < 5.0 && vRough < 30.0 ? 0.0 : vSlope < ${SAFE_DEG.toFixed(1)} && vRough < 60.0 ? 1.0 : vSlope < ${HAZARD_DEG.toFixed(1)} ? 2.0 : 3.0;
    col = lvl < 0.5 ? vec3(0.20, 0.48, 0.86) : lvl < 1.5 ? vec3(0.25, 0.72, 0.40) : lvl < 2.5 ? vec3(0.95, 0.78, 0.25) : vec3(0.90, 0.25, 0.22);
    col *= 0.5 + 0.65 * diff;
  } else {
    col = ramp(t, vec3(0.80, 0.70, 0.52), vec3(0.72, 0.56, 0.38), vec3(0.55, 0.42, 0.32), vec3(0.78, 0.76, 0.74)) * shade;
  }
  if (uScanT >= 0.0) {
    float d = distance(vXZ, uScan.xz);
    float ring = smoothstep(18.0, 0.0, abs(d - uScanT * uScan.y)) * (1.0 - uScanT);
    float inside = step(d, uScan.y) * 0.18 * (1.0 - uScanT * 0.6);
    col = mix(col, vec3(0.35, 0.95, 1.0), clamp(ring + inside, 0.0, 1.0));
  }
  float f = clamp(vDist / uFogFar, 0.0, 1.0);
  gl_FragColor = vec4(mix(col, uFog, f * f), 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}

// Web Mercator helpers for the satellite drape (Esri World Imagery tiles)
const tileX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const tileY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const SAT_Z = 12;

function Joystick({ onMove, label, hint }: { onMove: (x: number, y: number) => void; label: string; hint: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const update = (e: RPointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    let x = (e.clientX - r.left - r.width / 2) / (r.width / 2);
    let y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    setKnob({ x, y });
    onMove(x, y);
  };
  const end = () => { setKnob({ x: 0, y: 0 }); onMove(0, 0); };
  return (
    <div
      ref={ref}
      className="joystick"
      aria-label={label}
      title={label}
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); update(e); }}
      onPointerMove={(e) => e.buttons && update(e)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <span className="joy-hint">{hint}</span>
      <i style={{ transform: `translate(${knob.x * 32}px, ${knob.y * 32}px)` }} />
    </div>
  );
}

type Task =
  | { k: 'takeoff' }
  | { k: 'goto'; x: number; z: number; agl: number; step: DfStep }
  | { k: 'scanpick' }
  | { k: 'land'; step: DfStep }
  | { k: 'wait'; s: number }
  | { k: 'lz' };

const DroneView = forwardRef<DroneHandle, Props>(function DroneView(
  { cell, heights, slope, px, resM, lens, body, wind, onTelemetry, onEvent, onSatelliteFail }, ref,
) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState(0);
  const size = (px - 1) * resM;
  const half = size / 2;
  let hmin = Infinity, hmax = -Infinity;
  for (const h of heights) { if (h < hmin) hmin = h; if (h > hmax) hmax = h; }
  const evRef = useRef(onEvent);
  evRef.current = onEvent;

  const clampXZ = (v: number) => Math.min(half, Math.max(-half, v));
  const groundAt = (x: number, z: number) => {
    // x east, z south (world), pixel row 0 = north edge
    const fx = Math.min(px - 1.001, Math.max(0, (x + half) / resM));
    const fy = Math.min(px - 1.001, Math.max(0, (z + half) / resM));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), dx = fx - x0, dy = fy - y0;
    const h = (xx: number, yy: number) => heights[yy * px + xx];
    return (h(x0, y0) * (1 - dx) + h(x0 + 1, y0) * dx) * (1 - dy) + (h(x0, y0 + 1) * (1 - dx) + h(x0 + 1, y0 + 1) * dx) * dy;
  };
  const slopeAt = (x: number, z: number) => {
    const ix = Math.round(Math.min(px - 1, Math.max(0, (x + half) / resM)));
    const iy = Math.round(Math.min(px - 1, Math.max(0, (z + half) / resM)));
    return slope[iy * px + ix];
  };
  const toPix = (x: number, z: number) => [(x + half) / resM, (z + half) / resM];
  /** Best landing zone (largest safe share within LZ_R, then lowest slope) within `searchR` of (x, z). */
  const findLz = (x: number, z: number, searchR: number): [number, number, number] => {
    const [cx, cy] = toPix(x, z);
    const r = searchR / resM;
    let best: [number, number, number] = [x, z, -1];
    let bestSlope = Infinity;
    for (let y = Math.max(2, Math.floor(cy - r)); y <= Math.min(px - 3, Math.ceil(cy + r)); y += 1) {
      for (let xx = Math.max(2, Math.floor(cx - r)); xx <= Math.min(px - 3, Math.ceil(cx + r)); xx += 1) {
        if ((xx - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        const share = safeShare(slope, px, resM, xx, y, LZ_R);
        const sl = slope[y * px + xx];
        if (share > best[2] + 1e-6 || (Math.abs(share - best[2]) < 1e-6 && sl < bestSlope)) {
          best = [xx * resM - half, y * resM - half, share];
          bestSlope = sl;
        }
      }
    }
    return best;
  };

  const st = useRef({
    x: 0, z: 0, alt: 0, yaw: 0, gimbal: -0.2, speed: 0, side: 0, vs: 0, yawRate: 0,
    keys: new Set<string>(), joyL: [0, 0], joyR: [0, 0],
    auto: false as AutoMode, wp: [] as [number, number][], wpi: 0,
    tasks: [] as Task[], df: { a: [0, 0] as [number, number], b: null as null | [number, number], heading: 0, n: 0 }, dfStep: null as DfStep, waitT: 0,
    phase: 'landed' as Phase, home: [0, 0] as [number, number], rthReason: null as null | 'battery' | 'user',
    battery: 100, batteryStart: 100, path: [] as Waypoint[], markers: [] as Marker[], lastRec: 0,
    flightSec: 0, maxAgl: 0, landings: 0, distM: 0,
    scan: null as null | { x: number; z: number; t0: number },
    lens: lens as Lens, satReady: false, shoot: false,
  });
  st.current.lens = lens;

  const doScan = (): ScanResult => {
    const s = st.current;
    s.scan = { x: s.x, z: s.z, t0: performance.now() };
    const [cx, cy] = toPix(s.x, s.z);
    const safe = safeShare(slope, px, resM, cx, cy, SCAN_R);
    let sum = 0, n = 0, lo = Infinity, hi = -Infinity;
    const r = SCAN_R / resM;
    for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      sum += slope[y * px + x]; n++;
      const h = heights[y * px + x];
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    const [lat, lon] = toLatLon(cell, s.x, -s.z);
    return { lat, lon, radiusM: SCAN_R, safe, meanSlope: n ? sum / n : 0, elevMin: lo, elevMax: hi };
  };
  const addMarker = (label: string, x?: number, z?: number): Marker => {
    const s = st.current;
    const [lat, lon] = toLatLon(cell, x ?? s.x, -(z ?? s.z));
    const m = { lat, lon, label };
    s.markers.push(m);
    return m;
  };
  const takeOff = () => {
    const s = st.current;
    if (s.phase !== 'landed' || s.battery <= RTH_AT / 2) return;
    s.phase = 'takeoff';
    if (!s.path.length) s.home = [s.x, s.z];
    evRef.current?.({ type: 'takeoff' });
  };
  const planDragonfly = () => {
    const s = st.current;
    const [ax, az] = s.df.a;
    // pick a heading that keeps the scouting point inside the cell (2 km margin), turning if needed
    let hx = 0, hz = 0;
    for (let i = 0; i < 8; i++) {
      const hd = s.df.heading + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 4);
      hx = ax - Math.sin(hd) * HOP;
      hz = az - Math.cos(hd) * HOP;
      if (Math.abs(hx) < half - 2000 && Math.abs(hz) < half - 2000) { s.df.heading = hd; break; }
    }
    s.tasks = [
      ...(s.phase === 'landed' ? [{ k: 'takeoff' } as Task] : []),
      { k: 'goto', x: hx, z: hz, agl: CRUISE, step: 'out' },
      { k: 'scanpick' },
      { k: 'goto', x: ax, z: az, agl: CRUISE, step: 'back' },
      { k: 'land', step: 'land' },
      { k: 'wait', s: 1.2 },
      { k: 'takeoff' },
      { k: 'goto', x: NaN, z: NaN, agl: CRUISE, step: 'hop' }, // filled in by scanpick
      { k: 'land', step: 'hop' },
      { k: 'lz' },
    ];
  };

  useImperativeHandle(ref, () => ({
    scan: doScan,
    mark: (label: string) => addMarker(label),
    path: () => st.current.path.slice(),
    markers: () => st.current.markers.slice(),
    setAuto: (mode: AutoMode) => {
      const s = st.current;
      s.auto = mode;
      s.tasks = [];
      s.dfStep = null;
      if (mode === 'survey') {
        // lawnmower survey: east-west legs 3 km apart, inset 1.5 km from the edges
        const wp: [number, number][] = [];
        const inset = 1500;
        let dir = 1;
        for (let z = -half + inset; z <= half - inset; z += 3000) {
          wp.push([-dir * (half - inset), z], [dir * (half - inset), z]);
          dir = -dir;
        }
        s.wp = wp;
        s.wpi = wp.reduce((best, p, i) => (Math.hypot(p[0] - s.x, p[1] - s.z) < Math.hypot(wp[best][0] - s.x, wp[best][1] - s.z) ? i : best), 0);
        if (s.phase === 'landed') takeOff();
      } else if (mode === 'dragonfly') {
        // the first verified site is where we are (or the safest spot nearby if we are airborne)
        if (s.phase === 'landed') s.df.a = [s.x, s.z];
        else { const [lx, lz] = findLz(s.x, s.z, 1500); s.df.a = [lx, lz]; }
        s.df.heading = s.yaw;
        planDragonfly();
      }
    },
    recharge: () => { const s = st.current; s.battery = 100; s.batteryStart = 100; },
    takeOff,
    land: () => { const s = st.current; if (s.phase !== 'landed') { s.auto = false; s.tasks = []; s.phase = 'landing'; } },
    returnHome: () => {
      const s = st.current;
      if (s.phase === 'landed') return;
      s.auto = false; s.tasks = [];
      s.phase = 'rth'; s.rthReason = 'user';
      evRef.current?.({ type: 'rth', reason: 'user' });
    },
    photo: () => { st.current.shoot = true; },
    stats: () => {
      const s = st.current;
      return { droneSeconds: s.flightSec, distanceKm: s.distM / 1000, batteryUsed: Math.max(0, s.batteryStart - s.battery), maxAglM: s.maxAgl, landings: s.landings };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [cell, half, heights, px, resM, slope]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) return;
    const s = st.current;
    // start on the ground, on the safest spot near the south of the cell
    const [sx, sz] = findLz(0, half * 0.55, 3000);
    Object.assign(s, {
      x: sx, z: sz, yaw: 0, gimbal: -0.12, speed: 0, side: 0, vs: 0, yawRate: 0, alt: groundAt(sx, sz),
      phase: 'landed', home: [sx, sz], path: [], markers: [], battery: 100, batteryStart: 100, auto: false, tasks: [],
      dfStep: null, flightSec: 0, maxAgl: 0, landings: 0, distM: 0, df: { a: [sx, sz], b: null, heading: 0, n: 0 },
    });

    // ----- mesh -----
    const n = px * px;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const sl = new Float32Array(n);
    const ro = new Float32Array(n);
    const [latN, lonW] = toLatLon(cell, -half, half);
    const [latS, lonE] = toLatLon(cell, half, -half);
    const tx0 = Math.floor(tileX(lonW, SAT_Z)), tx1 = Math.floor(tileX(lonE, SAT_Z));
    const ty0 = Math.floor(tileY(latN, SAT_Z)), ty1 = Math.floor(tileY(latS, SAT_Z));
    const tw = tx1 - tx0 + 1, th = ty1 - ty0 + 1;
    for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
      const i = y * px + x;
      const wx = x * resM - half, wz = y * resM - half;
      pos[i * 3] = wx; pos[i * 3 + 1] = heights[i] * EX; pos[i * 3 + 2] = wz;
      const hl = heights[y * px + Math.max(0, x - 1)], hr = heights[y * px + Math.min(px - 1, x + 1)];
      const hu = heights[Math.max(0, y - 1) * px + x], hd = heights[Math.min(px - 1, y + 1) * px + x];
      const nx = -(hr - hl) * EX / (2 * resM), nz = -(hd - hu) * EX / (2 * resM);
      const l = Math.hypot(nx, 1, nz);
      nor[i * 3] = nx / l; nor[i * 3 + 1] = 1 / l; nor[i * 3 + 2] = nz / l;
      sl[i] = slope[i];
      // local roughness: height range of the 3 x 3 neighbourhood (~650 m)
      let lo = Infinity, hi = -Infinity;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const v = heights[Math.min(px - 1, Math.max(0, y + dy)) * px + Math.min(px - 1, Math.max(0, x + dx))];
        if (v < lo) lo = v; if (v > hi) hi = v;
      }
      ro[i] = hi - lo;
      const [la, lo2] = toLatLon(cell, wx, -wz);
      uv[i * 2] = (tileX(lo2, SAT_Z) - tx0) / tw;
      uv[i * 2 + 1] = (tileY(la, SAT_Z) - ty0) / th;
    }
    const idx = new Uint16Array((px - 1) * (px - 1) * 6);
    let k = 0;
    for (let y = 0; y < px - 1; y++) for (let x = 0; x < px - 1; x++) {
      const a = y * px + x, b = a + 1, c = a + px, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const attr = (name: string, data: Float32Array, size2: number) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, name);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size2, gl.FLOAT, false, 0, 0);
    };
    attr('aPos', pos, 3); attr('aNormal', nor, 3); attr('aSlope', sl, 1); attr('aRough', ro, 1); attr('aUv', uv, 2);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    const U = (nm: string) => gl.getUniformLocation(prog, nm);
    const uMvp = U('uMvp'), uEye = U('uEye'), uLens = U('uLens'), uHR = U('uHRange'), uSun = U('uSun'),
      uFog = U('uFog'), uFogFar = U('uFogFar'), uScan = U('uScan'), uScanT = U('uScanT');
    gl.uniform2f(uHR, hmin * EX, hmax * EX);
    gl.uniform3f(uSun, 0.55, 0.75, -0.35);
    gl.uniform1f(uFogFar, size * 1.15);
    gl.enable(gl.DEPTH_TEST);

    // ----- satellite drape: Esri World Imagery tiles composited on a canvas -----
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([120, 110, 90, 255]));
    let cancelled = false;
    s.satReady = false;
    (async () => {
      try {
        const c = document.createElement('canvas');
        c.width = tw * 256; c.height = th * 256;
        const g = c.getContext('2d')!;
        const jobs: Promise<void>[] = [];
        for (let yy = 0; yy < th; yy++) for (let xx = 0; xx < tw; xx++) {
          jobs.push(new Promise((res, rej) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => { g.drawImage(img, xx * 256, yy * 256); res(); };
            img.onerror = () => rej(new Error('tile'));
            img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${SAT_Z}/${ty0 + yy}/${tx0 + xx}`;
          }));
        }
        await Promise.all(jobs);
        if (cancelled) return;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c); // throws if tainted
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        s.satReady = true;
      } catch {
        if (!cancelled) onSatelliteFail?.();
      }
    })();

    // ----- input -----
    const down = (e: KeyboardEvent) => {
      const k2 = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'pageup', 'pagedown'].includes(k2)) e.preventDefault();
      if (e.repeat) return;
      if (k2 === 't') { if (s.phase === 'landed') takeOff(); else { s.auto = false; s.tasks = []; s.phase = 'landing'; } return; }
      if (k2 === 'p') { s.shoot = true; return; }
      if (k2 === 'h' && s.phase !== 'landed') { s.auto = false; s.tasks = []; s.phase = 'rth'; s.rthReason = 'user'; evRef.current?.({ type: 'rth', reason: 'user' }); return; }
      s.keys.add(k2);
      if (['w', 's', 'a', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'pageup', 'pagedown'].includes(k2)) {
        if (s.auto) { s.auto = false; s.tasks = []; s.dfStep = null; }
        if (s.phase === 'landed' && ['e', 'pageup'].includes(k2)) takeOff();
      }
    };
    const up = (e: KeyboardEvent) => s.keys.delete(e.key.toLowerCase());
    const wrap = wrapRef.current!;
    wrap.addEventListener('keydown', down);
    wrap.addEventListener('keyup', up);
    let drag: { x: number; y: number } | null = null;
    const pd = (e: PointerEvent) => { if (e.target === canvas) { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); wrap.focus(); } };
    const pm = (e: PointerEvent) => {
      if (!drag) return;
      s.yaw -= (e.clientX - drag.x) * 0.005;
      s.gimbal = Math.max(-Math.PI / 2, Math.min(0.35, s.gimbal - (e.clientY - drag.y) * 0.004));
      drag = { x: e.clientX, y: e.clientY };
    };
    const pu = () => { drag = null; };
    canvas.addEventListener('pointerdown', pd);
    canvas.addEventListener('pointermove', pm);
    canvas.addEventListener('pointerup', pu);

    // ----- loop -----
    let raf = 0, last = performance.now(), lastTel = 0;
    const mini = miniRef.current!;
    const mg = mini.getContext('2d')!;
    const base = document.createElement('canvas');
    base.width = base.height = px;
    const bg = base.getContext('2d')!;
    const im = bg.createImageData(px, px);
    for (let i = 0; i < n; i++) {
      const cls = slopeClass(slope[i]);
      const tt = (heights[i] - hmin) / Math.max(1, hmax - hmin);
      const shade = 0.55 + 0.45 * tt;
      const col = cls === 'pass' ? [70, 170, 95] : cls === 'warn' ? [225, 180, 60] : [215, 75, 60];
      im.data[i * 4] = col[0] * shade; im.data[i * 4 + 1] = col[1] * shade; im.data[i * 4 + 2] = col[2] * shade; im.data[i * 4 + 3] = 255;
    }
    bg.putImageData(im, 0, 0);
    const monthWind = wind ?? 0;

    /** Steer toward (gx, gz) at a target AGL; returns the remaining horizontal distance. */
    const steer = (gx: number, gz: number, agl: number) => {
      const dist = Math.hypot(gx - s.x, gz - s.z);
      const want = Math.atan2(-(gx - s.x), -(gz - s.z));
      let d = want - s.yaw;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const ground = groundAt(s.x, s.z);
      return { dist, turn: Math.max(-1, Math.min(1, d * 2)), fwd: dist < 30 ? 0 : Math.abs(d) < 0.6 ? Math.min(1, dist / 600 + 0.15) : 0.15,
        climb: Math.max(-1, Math.min(1, (agl - (s.alt - ground)) / 150)) };
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      const ground0 = groundAt(s.x, s.z);
      const airborne = s.phase !== 'landed';

      // ---- inputs (Mode 2: left stick = throttle + yaw, right stick = forward + sideways) ----
      const kd = (a: string, b?: string) => s.keys.has(a) || (b ? s.keys.has(b) : false);
      // autopilots cruise at 20 m/s real (x1.25), a normal survey-drone speed; Shift is the manual sport mode
      const boost = s.keys.has('shift') ? 2.2 : s.auto ? 1.25 : 1;
      let fwd = (kd('w', 'arrowup') ? 1 : 0) - (kd('s', 'arrowdown') ? 1 : 0) - s.joyR[1];
      let turn = (kd('a', 'arrowleft') ? 1 : 0) - (kd('d', 'arrowright') ? 1 : 0) - s.joyL[0];
      let climb = (kd('e', 'pageup') ? 1 : 0) - (kd('q', 'pagedown') ? 1 : 0) - s.joyL[1];
      let side = s.joyR[0];
      if (kd('r')) s.gimbal = Math.min(0.35, s.gimbal + dt * 0.9);
      if (kd('f')) s.gimbal = Math.max(-Math.PI / 2, s.gimbal - dt * 0.9);
      if (s.phase === 'landed' && climb > 0.5) takeOff();

      // ---- battery safety: return home at 20 %, land wherever we are at 0 % ----
      if (airborne && s.battery <= RTH_AT && s.phase !== 'rth' && s.phase !== 'landing' && s.rthReason !== 'battery') {
        s.auto = false; s.tasks = []; s.dfStep = null; s.phase = 'rth'; s.rthReason = 'battery';
        evRef.current?.({ type: 'rth', reason: 'battery' });
      }
      if (airborne && s.battery <= 0 && s.phase !== 'landing') { s.phase = 'landing'; s.tasks = []; s.auto = false; }

      // ---- autopilots / phases override the sticks ----
      let targetAgl: number | null = null;
      if (s.phase === 'takeoff') { fwd = 0; turn = 0; side = 0; climb = 0; targetAgl = 30; }
      else if (s.phase === 'landing') { fwd = 0; side = 0; climb = -0.35; }
      else if (s.phase === 'rth') {
        const g = steer(s.home[0], s.home[1], Math.max(120, s.alt - ground0));
        fwd = g.fwd; turn = g.turn; side = 0; climb = g.climb;
        if (g.dist < 40) s.phase = 'landing';
      } else if (s.auto === 'survey' && s.wp.length && s.phase === 'flying') {
        const [gx, gz] = s.wp[s.wpi];
        const g = steer(gx, gz, CRUISE);
        fwd = Math.max(g.fwd, 0.6); turn = g.turn; climb = g.climb; side = 0;
        if (g.dist < 250) s.wpi = (s.wpi + 1) % s.wp.length;
      } else if (s.auto === 'dragonfly' && s.tasks.length) {
        const task = s.tasks[0];
        side = 0;
        if (task.k === 'takeoff') {
          fwd = 0; turn = 0; climb = 0;
          if (s.phase === 'landed') takeOff();
          if (s.phase === 'flying') s.tasks.shift();
        } else if (task.k === 'goto') {
          s.dfStep = task.step;
          const g = steer(task.x, task.z, task.agl);
          fwd = g.fwd; turn = g.turn; climb = g.climb;
          if (g.dist < 60) { s.tasks.shift(); }
        } else if (task.k === 'scanpick') {
          fwd = 0; turn = 0; climb = 0; s.dfStep = 'scan';
          doScan();
          const [bx, bz] = findLz(s.x, s.z, 1500);
          s.df.b = [bx, bz];
          addMarker(`${t('scout.lzCandidate')} ${s.df.n + 1}`, bx, bz);
          const hop = s.tasks.find((x) => x.k === 'goto' && x.step === 'hop') as Extract<Task, { k: 'goto' }> | undefined;
          if (hop) { hop.x = bx; hop.z = bz; }
          s.tasks.shift();
          s.tasks.unshift({ k: 'wait', s: 1.6 });
        } else if (task.k === 'land') {
          s.dfStep = task.step;
          fwd = 0; turn = 0; side = 0; climb = 0;
          if (s.phase === 'flying') s.phase = 'landing';
          if (s.phase === 'landed') s.tasks.shift();
        } else if (task.k === 'wait') {
          fwd = 0; turn = 0; climb = 0;
          task.s -= dt;
          if (task.s <= 0) s.tasks.shift();
        } else if (task.k === 'lz') {
          s.df.n += 1;
          s.df.a = s.df.b ?? [s.x, s.z];
          const m = addMarker(`${t('scout.lzVerified')} ${s.df.n}`);
          evRef.current?.({ type: 'lz', marker: m });
          s.tasks.shift();
          if (s.battery > RTH_AT + 15) planDragonfly(); else { s.auto = false; s.dfStep = null; }
        }
      }
      if (s.phase === 'landed') { fwd = 0; side = 0; climb = 0; turn = 0; }

      // ---- physics: smoothed velocities (inertia), 10x time ----
      const maxV = 160 * boost; // simulated m/s = 16 m/s real
      const k1 = Math.min(1, dt * 1.8);
      s.speed += (fwd * maxV - s.speed) * k1;
      s.side += (side * maxV * 0.6 - s.side) * k1;
      s.yawRate += (turn * 1.1 - s.yawRate) * Math.min(1, dt * 4);
      s.yaw += s.yawRate * dt;
      let wantVs = climb * 120 * boost;
      if (targetAgl != null) wantVs = Math.max(-60, Math.min(60, (ground0 + targetAgl - s.alt) * 1.5));
      if (s.phase === 'landing') wantVs = -Math.max(15, Math.min(60, (s.alt - ground0) * 0.8));
      s.vs += (wantVs - s.vs) * Math.min(1, dt * 3);
      const ox = s.x, oz = s.z;
      s.x = clampXZ(s.x - Math.sin(s.yaw) * s.speed * dt + Math.cos(s.yaw) * s.side * dt);
      s.z = clampXZ(s.z - Math.cos(s.yaw) * s.speed * dt - Math.sin(s.yaw) * s.side * dt);
      s.distM += Math.hypot(s.x - ox, s.z - oz);
      s.alt += s.vs * dt;
      const ground = groundAt(s.x, s.z);
      const minAgl = s.phase === 'flying' || s.phase === 'rth' ? MIN_AGL : 0;
      s.alt = Math.max(ground + minAgl, Math.min(ground + 3000, s.alt));
      if (s.phase === 'takeoff' && s.alt - ground >= 29) s.phase = 'flying';
      if (s.phase === 'landing' && s.alt - ground < 0.5) {
        s.alt = ground; s.phase = 'landed'; s.speed = 0; s.side = 0; s.vs = 0; s.landings += 1; s.rthReason = null;
        const sl2 = slopeAt(s.x, s.z);
        evRef.current?.({ type: 'landed', safe: sl2 < SAFE_DEG, slope: sl2 });
      }
      if (s.phase === 'landed') s.alt = ground;
      const agl = s.alt - ground;
      if (s.phase !== 'landed') {
        s.flightSec += dt * TIME;
        s.maxAgl = Math.max(s.maxAgl, agl);
        // drain: hover + speed + wind (aerodynamic load grows with the square of the wind speed)
        s.battery = Math.max(0, s.battery - dt * (0.12 + Math.abs(s.speed) / 1000) * (1 + (monthWind / 10) ** 2));
        if (now - s.lastRec > 1000) {
          s.lastRec = now;
          const [la, lo] = toLatLon(cell, s.x, -s.z);
          const prev = s.path[s.path.length - 1];
          if (!prev || Math.hypot(prev.lat - la, prev.lon - lo) > 0.0005 || Math.abs(prev.altM - s.alt) > 40) s.path.push({ lat: la, lon: lo, altM: s.alt });
        }
      }

      // ---- camera: gimbal pitch, 82 deg horizontal FOV, wind shake ----
      const shake = s.phase === 'landed' ? 0 : monthWind * 0.012;
      const jx = Math.sin(now / 170) * shake + Math.sin(now / 63) * shake * 0.4;
      const jy = Math.cos(now / 210) * shake * 0.7;
      const pitch = s.gimbal + jy * 0.02;
      const yawC = s.yaw + jx * 0.02;
      const camAlt = s.phase === 'landed' ? ground + 2 : s.alt;
      const eye = [s.x, camAlt * EX, s.z];
      const dir = [-Math.sin(yawC) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yawC) * Math.cos(pitch)];
      const upv = Math.abs(pitch) > 1.5 ? [-Math.sin(yawC), 0, -Math.cos(yawC)] : [0, 1, 0];
      const view = lookAt(eye, [eye[0] + dir[0], eye[1] + dir[1], eye[2] + dir[2]], upv);
      const aspect = canvas.width / Math.max(1, canvas.height);
      const vfov = 2 * Math.atan(Math.tan((HFOV * Math.PI) / 360) / aspect);
      const near = Math.max(1.5, Math.min(20, (camAlt - ground) * 0.25));
      const proj = perspective(vfov, aspect, near, size * 2.5);
      const lensNow = s.lens === 'satellite' && !s.satReady ? 'relief' : s.lens;
      const fog = lensNow === 'mars' ? [0.78, 0.6, 0.45] : body === 'moon' && lensNow !== 'satellite' ? [0.05, 0.06, 0.09] : [0.62, 0.74, 0.88];
      gl.clearColor(fog[0], fog[1], fog[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(uMvp, false, mul(proj, view));
      gl.uniform3f(uEye, eye[0], eye[1], eye[2]);
      gl.uniform1i(uLens, { relief: 0, slope: 1, mars: 2, satellite: 3, hazard: 4 }[lensNow]);
      gl.uniform3f(uFog, fog[0], fog[1], fog[2]);
      if (s.scan) {
        const tt = (now - s.scan.t0) / 1600;
        gl.uniform3f(uScan, s.scan.x, SCAN_R, s.scan.z);
        gl.uniform1f(uScanT, tt <= 1 ? tt : -1);
        if (tt > 1) s.scan = null;
      } else gl.uniform1f(uScanT, -1);
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);

      // ---- photo: read the frame we just drew (same task, so no preserveDrawingBuffer needed) ----
      if (s.shoot) {
        s.shoot = false;
        try {
          const tw2 = 360, th2 = Math.round(360 / aspect);
          const c2 = document.createElement('canvas');
          c2.width = tw2; c2.height = th2;
          c2.getContext('2d')!.drawImage(canvas, 0, 0, tw2, th2);
          const [la, lo] = toLatLon(cell, s.x, -s.z);
          const photo: Photo = { url: c2.toDataURL('image/jpeg', 0.7), lat: la, lon: lo, altM: Math.round(s.alt), aglM: Math.round(agl), t: Math.round(s.flightSec) };
          evRef.current?.({ type: 'photo', photo });
          setFlash((f) => f + 1);
        } catch {
          /* a tainted canvas cannot be read; skip the photo */
        }
      }

      // ---- camera footprint on the ground (flat ground at the height below the drone) ----
      const tH = Math.tan((HFOV * Math.PI) / 360), tV = Math.tan(vfov / 2);
      const fwdV = [-Math.sin(s.yaw) * Math.cos(s.gimbal), Math.sin(s.gimbal), -Math.cos(s.yaw) * Math.cos(s.gimbal)];
      const right = [Math.cos(s.yaw), 0, -Math.sin(s.yaw)];
      const upC = [right[1] * fwdV[2] - right[2] * fwdV[1], right[2] * fwdV[0] - right[0] * fwdV[2], right[0] * fwdV[1] - right[1] * fwdV[0]];
      const corners: [number, number][] = [];
      const hgt = Math.max(1, camAlt - ground);
      for (const [cx2, cy2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const d = [0, 1, 2].map((i) => fwdV[i] + right[i] * cx2 * tH + upC[i] * cy2 * tV);
        const reach = d[1] < -1e-3 ? Math.min(8000, hgt / -d[1]) : 8000;
        const l = d[1] < -1e-3 ? 1 : Math.hypot(d[0], d[2]) || 1;
        corners.push([s.x + (d[0] / l) * reach, s.z + (d[2] / l) * reach]);
      }
      const footprintM: [number, number] | null = s.gimbal < -1.2 ? [2 * hgt * tH, 2 * hgt * tV] : null;

      // ---- minimap: slope classes, footprint, path, markers, home, drone ----
      const M = mini.width;
      mg.drawImage(base, 0, 0, M, M);
      const toM = (x: number, z: number) => [((x + half) / size) * M, ((z + half) / size) * M];
      mg.fillStyle = 'rgba(127,216,255,0.22)';
      mg.strokeStyle = 'rgba(127,216,255,0.9)';
      mg.lineWidth = 1;
      mg.beginPath();
      corners.forEach(([cx3, cz3], i) => { const [a, b] = toM(cx3, cz3); if (i) mg.lineTo(a, b); else mg.moveTo(a, b); });
      mg.closePath(); mg.fill(); mg.stroke();
      mg.strokeStyle = 'rgba(255,255,255,0.85)';
      mg.lineWidth = 1.5;
      mg.beginPath();
      s.path.forEach((p, i) => {
        const lx = (p.lon - cell.lon) * 111_320 * Math.cos((cell.lat * Math.PI) / 180);
        const lz = -(p.lat - cell.lat) * 111_320;
        const [a, b] = toM(lx, lz);
        if (i) mg.lineTo(a, b); else mg.moveTo(a, b);
      });
      mg.stroke();
      s.markers.forEach((m) => {
        const lx = (m.lon - cell.lon) * 111_320 * Math.cos((cell.lat * Math.PI) / 180);
        const lz = -(m.lat - cell.lat) * 111_320;
        const [a, b] = toM(lx, lz);
        mg.fillStyle = m.label.startsWith(t('scout.lzVerified')) ? '#3b82f6' : '#7fd8ff';
        mg.beginPath(); mg.arc(a, b, 4, 0, Math.PI * 2); mg.fill();
      });
      const [hx2, hz2] = toM(s.home[0], s.home[1]);
      mg.fillStyle = '#ffd34d';
      mg.font = 'bold 11px sans-serif';
      mg.textAlign = 'center';
      mg.textBaseline = 'middle';
      mg.fillText('H', hx2, hz2);
      const [dx2, dz2] = toM(s.x, s.z);
      mg.save();
      mg.translate(dx2, dz2);
      mg.rotate(-s.yaw);
      mg.fillStyle = '#ffffff';
      mg.strokeStyle = '#0b0f17';
      mg.beginPath(); mg.moveTo(0, -8); mg.lineTo(5, 6); mg.lineTo(0, 3); mg.lineTo(-5, 6); mg.closePath();
      mg.fill(); mg.stroke();
      mg.restore();

      if (now - lastTel > 150) {
        lastTel = now;
        const [la, lo] = toLatLon(cell, s.x, -s.z);
        let hd = ((-s.yaw * 180) / Math.PI) % 360;
        if (hd < 0) hd += 360;
        onTelemetry({
          lat: la, lon: lo, altMsl: s.alt, agl, ground, slope: slopeAt(s.x, s.z),
          speed: Math.hypot(s.speed, s.side), vspeed: s.vs, heading: hd, battery: s.battery, auto: s.auto, phase: s.phase,
          distHome: Math.hypot(s.x - s.home[0], s.z - s.home[1]), gimbal: (s.gimbal * 180) / Math.PI, flightSec: s.flightSec,
          wind, footprintM, dfStep: s.auto === 'dragonfly' ? s.dfStep : null, lzCount: s.df.n,
        });
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      wrap.removeEventListener('keydown', down);
      wrap.removeEventListener('keyup', up);
      canvas.removeEventListener('pointerdown', pd);
      canvas.removeEventListener('pointermove', pm);
      canvas.removeEventListener('pointerup', pu);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell.id, heights]);

  const stopAuto = () => { const s = st.current; if (s.auto) { s.auto = false; s.tasks = []; s.dfStep = null; } };
  return (
    <div className="drone-view" ref={wrapRef} tabIndex={0} aria-label={t('scout.viewLabel')}>
      <canvas ref={canvasRef} className="drone-canvas" />
      <div className="drone-reticle" aria-hidden="true" />
      {flash > 0 && <div key={flash} className="shutter" aria-hidden="true" />}
      <canvas ref={miniRef} className="drone-mini" width={150} height={150} aria-hidden="true" />
      <div className="drone-joys">
        <Joystick label={t('scout.joyLeft')} hint={t('scout.joyLeftHint')} onMove={(x, y) => {
          st.current.joyL = [x, y];
          if (x || y) stopAuto();
          if (y < -0.5 && st.current.phase === 'landed') takeOff();
        }} />
        <Joystick label={t('scout.joyRight')} hint={t('scout.joyRightHint')} onMove={(x, y) => { st.current.joyR = [x, y]; if (x || y) stopAuto(); }} />
      </div>
    </div>
  );
});

export default DroneView;
