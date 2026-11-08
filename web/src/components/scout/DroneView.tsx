import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useI18n } from '../../i18n';
import { SAFE_DEG, HAZARD_DEG, safeShare, slopeClass, slopeField, toLatLon, type Body, type Marker, type ScoutCell, type Waypoint } from '../../lib/scout';
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

export type Lens = 'relief' | 'slope' | 'mars' | 'satellite' | 'hazard' | 'cover';
export type Phase = 'landed' | 'takeoff' | 'flying' | 'landing' | 'rth';
export type AutoMode = false | 'survey' | 'dragonfly' | 'goto';
export type CamMode = 'fpv' | 'chase';
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
  zoom: number; // camera zoom (1 = the 82 deg wide view)
  cam: CamMode;
  pad: boolean; // a game controller is connected
  holdAgl: number | null;
  buildings: number; // buildings drawn around the drone
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
  /** Share of the scanned ground where JRC saw surface water at least once 1984-2021 (null if not published). */
  water: number | null;
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
  setCam: (c: CamMode) => void;
  setAltitude: (aglM: number) => void;
}

export type DroneEvent =
  | { type: 'takeoff' }
  | { type: 'landed'; safe: boolean; slope: number }
  | { type: 'rth'; reason: 'battery' | 'user' }
  | { type: 'lz'; marker: Marker }
  | { type: 'photo'; photo: Photo }
  | { type: 'scanRequest' };

interface Props {
  cell: ScoutCell;
  heights: Float32Array;
  slope: Float32Array;
  px: number;
  resM: number;
  lens: Lens;
  body: Body;
  wind: number | null;
  /** Optional finer heightmap (same extent) used only for drawing and flying; analysis keeps `heights`. */
  draw?: { heights: Float32Array; px: number; resM: number } | null;
  /** Optional per-pixel land cover (WorldCover code) and surface-water occurrence (0-100), on the `px` grid. */
  layers?: { cover: Uint8Array; water: Uint8Array } | null;
  /** Building footprints of the cell: 6 numbers each (x m, z m, length m, width m, angle deg, height m or 0). */
  buildings?: Float32Array | null;
  /** Control sensitivity, 0.5 (gentle) .. 1.5 (sporty). */
  sens?: number;
  onTelemetry: (t: Telemetry) => void;
  onEvent?: (e: DroneEvent) => void;
  onSatelliteFail?: () => void;
}

const EX = 1.6; // vertical exaggeration, drawing only
/** Land-cover lens colours per ESA WorldCover class (close to the official legend, tuned for a dark screen). */
export const COVER_RGB: Record<number, [number, number, number]> = {
  10: [0.10, 0.45, 0.15], 20: [0.85, 0.65, 0.20], 30: [0.85, 0.85, 0.35], 40: [0.85, 0.50, 0.90], 50: [0.92, 0.15, 0.15],
  60: [0.78, 0.72, 0.60], 70: [0.95, 0.95, 0.95], 80: [0.10, 0.40, 0.85], 90: [0.10, 0.65, 0.70], 95: [0.05, 0.80, 0.50], 100: [0.95, 0.90, 0.65],
};
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
attribute vec3 aPos; attribute vec3 aNormal; attribute float aSlope; attribute float aRough; attribute vec2 aUv; attribute vec3 aCover; attribute float aWater;
uniform mat4 uMvp; uniform vec3 uEye;
varying vec3 vNormal; varying float vSlope; varying float vRough; varying float vH; varying vec2 vUv; varying float vDist; varying vec2 vXZ; varying vec3 vCover; varying float vWater;
void main(){
  vNormal = aNormal; vSlope = aSlope; vRough = aRough; vH = aPos.y; vUv = aUv; vXZ = aPos.xz; vCover = aCover; vWater = aWater;
  vDist = distance(aPos, uEye);
  gl_Position = uMvp * vec4(aPos, 1.0);
}`;

const fsSource = (derivatives: boolean) => `${derivatives ? '#extension GL_OES_standard_derivatives : enable\n' : ''}
precision mediump float;
varying vec3 vNormal; varying float vSlope; varying float vRough; varying float vH; varying vec2 vUv; varying float vDist; varying vec2 vXZ; varying vec3 vCover; varying float vWater;
uniform int uLens; uniform vec2 uHRange; uniform vec3 uSun; uniform vec3 uFog; uniform float uFogFar;
uniform sampler2D uTex; uniform vec3 uScan; uniform float uScanT;
uniform sampler2D uDetail; uniform vec4 uDet; uniform float uDetOn;
uniform sampler2D uDetail2; uniform vec4 uDet2; uniform float uDet2On;
uniform vec3 uTexel; uniform float uHalf; uniform float uContour; uniform float uSatOk; uniform float uEx;
vec3 ramp(float t, vec3 a, vec3 b, vec3 c, vec3 d){
  return t < 0.33 ? mix(a, b, t / 0.33) : t < 0.66 ? mix(b, c, (t - 0.33) / 0.33) : mix(c, d, (t - 0.66) / 0.34);
}
// unsharp mask: the texel plus a little of its difference from its 4 neighbours
vec3 sharp(sampler2D t, vec2 uv, float px, float k){
  vec3 c = texture2D(t, uv).rgb;
  vec3 b = (texture2D(t, uv + vec2(px, 0.0)).rgb + texture2D(t, uv - vec2(px, 0.0)).rgb + texture2D(t, uv + vec2(0.0, px)).rgb + texture2D(t, uv - vec2(0.0, px)).rgb) * 0.25;
  return clamp(c + (c - b) * k, 0.0, 1.0);
}
vec3 satellite(){
  vec3 base = sharp(uTex, vUv, uTexel.x, 0.35);
  if (uDetOn > 0.5) {
    vec2 du = (vXZ - uDet.xy) / uDet.zw;
    if (du.x > 0.0 && du.y > 0.0 && du.x < 1.0 && du.y < 1.0) {
      float e = smoothstep(0.0, 0.1, min(min(du.x, du.y), min(1.0 - du.x, 1.0 - du.y)));
      base = mix(base, sharp(uDetail, du, uTexel.y, 0.45), e);
    }
  }
  if (uDet2On > 0.5) {
    vec2 d2 = (vXZ - uDet2.xy) / uDet2.zw;
    if (d2.x > 0.0 && d2.y > 0.0 && d2.x < 1.0 && d2.y < 1.0) {
      float e = smoothstep(0.0, 0.15, min(min(d2.x, d2.y), min(1.0 - d2.x, 1.0 - d2.y)));
      base = mix(base, sharp(uDetail2, d2, uTexel.z, 0.5), e);
    }
  }
  // gentle grading: a touch more contrast and colour, like a drone camera profile
  base = (base - 0.5) * 1.1 + 0.52;
  float l = dot(base, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(l), base, 1.12), 0.0, 1.0);
}
float contour(){
  if (uContour <= 0.0) return 0.0;
  float h = vH / uEx;
  float f = abs(fract(h / uContour + 0.5) - 0.5);
  ${derivatives ? 'float w = fwidth(h / uContour) * 1.2;' : 'float w = 0.04;'}
  float major = abs(fract(h / (uContour * 5.0) + 0.5) - 0.5);
  ${derivatives ? 'float wm = fwidth(h / (uContour * 5.0)) * 1.6;' : 'float wm = 0.02;'}
  return max(1.0 - smoothstep(0.0, w, f), (1.0 - smoothstep(0.0, wm, major)) * 1.0) * (1.0 - smoothstep(0.0, 1.0, vDist / (uFogFar * 0.6)));
}
void main(){
  vec3 n = normalize(vNormal);
  float diff = clamp(dot(n, normalize(uSun)), 0.0, 1.0);
  float fill = clamp(dot(n, normalize(vec3(-0.6, 0.5, 0.4))), 0.0, 1.0);
  float shade = 0.3 + 0.7 * diff + 0.15 * fill;
  float t = clamp((vH - uHRange.x) / max(1.0, uHRange.y - uHRange.x), 0.0, 1.0);
  vec3 col;
  if (uLens == 1) {
    col = vSlope < ${SAFE_DEG.toFixed(1)} ? vec3(0.22, 0.72, 0.38) : vSlope < ${HAZARD_DEG.toFixed(1)} ? vec3(0.93, 0.74, 0.22) : vec3(0.88, 0.27, 0.22);
    col *= 0.55 + 0.6 * diff;
  } else if (uLens == 2) {
    col = ramp(t, vec3(0.45, 0.20, 0.10), vec3(0.70, 0.33, 0.16), vec3(0.82, 0.48, 0.28), vec3(0.88, 0.70, 0.55)) * shade;
  } else if (uLens == 3) {
    col = satellite() * (0.8 + 0.3 * diff);
  } else if (uLens == 4) {
    // hazard map in the spirit of the Jezero landing hazard map: one continuous hazard score from slope and
    // local roughness, blue safest -> green -> yellow -> red; wadi channels purple; the real ground shows through
    float hz = max(clamp(vSlope / ${HAZARD_DEG.toFixed(1)}, 0.0, 1.0), clamp(vRough / 160.0, 0.0, 1.0));
    vec3 hc = hz < 0.2 ? mix(vec3(0.16, 0.42, 0.90), vec3(0.20, 0.70, 0.45), hz / 0.2)
            : hz < 0.4 ? mix(vec3(0.20, 0.70, 0.45), vec3(0.98, 0.82, 0.25), (hz - 0.2) / 0.2)
            : mix(vec3(0.98, 0.82, 0.25), vec3(0.92, 0.18, 0.18), clamp((hz - 0.4) / 0.6, 0.0, 1.0));
    if (vWater >= 10.0 && vWater < 75.0) hc = mix(hc, vec3(0.62, 0.32, 0.92), 0.85);
    if (vWater >= 75.0) hc = vec3(0.10, 0.30, 0.62); // the sea or a permanent lake: water, not a wadi
    vec3 ground = uSatOk > 0.5 ? satellite() : vec3(0.6);
    col = mix(ground, hc, 0.62) * (0.62 + 0.5 * diff);
  } else if (uLens == 5) {
    // what is on the ground: ESA WorldCover classes, water occurrence from JRC on top
    col = vCover;
    if (vWater > 0.5) col = mix(col, vec3(0.10, 0.45, 0.95), clamp(0.25 + vWater / 100.0, 0.0, 1.0));
    col *= 0.6 + 0.55 * diff;
  } else {
    // relief: hypsometric tint (low plains sand -> rock -> high summits pale) with two-light hillshade
    col = ramp(t, vec3(0.86, 0.76, 0.56), vec3(0.74, 0.58, 0.40), vec3(0.56, 0.45, 0.36), vec3(0.86, 0.85, 0.83)) * shade;
    if (vWater >= 75.0) col = vec3(0.12, 0.33, 0.58) * (0.8 + 0.2 * diff);
  }
  if (uLens == 0 || uLens == 4) col = mix(col, uLens == 0 ? vec3(0.25, 0.17, 0.10) : vec3(0.1), contour() * 0.55);
  if (uScanT >= 0.0) {
    float d = distance(vXZ, uScan.xz);
    float ring = smoothstep(18.0, 0.0, abs(d - uScanT * uScan.y)) * (1.0 - uScanT);
    float inside = step(d, uScan.y) * 0.18 * (1.0 - uScanT * 0.6);
    col = mix(col, vec3(0.35, 0.95, 1.0), clamp(ring + inside, 0.0, 1.0));
  }
  float f = clamp(vDist / uFogFar, 0.0, 1.0);
  // the cell ends after ~27 km: melt its edge into the horizon instead of cutting it
  float edge = smoothstep(0.86, 1.0, max(abs(vXZ.x), abs(vXZ.y)) / uHalf);
  gl_FragColor = vec4(mix(col, uFog, clamp(f * f + edge, 0.0, 1.0)), 1.0 - edge * 0.85);
}`;

// buildings and the drone model: flat-lit boxes; colour < 0 means "take the roof colour from the satellite image"
const VSB = `
attribute vec3 aP; attribute vec3 aN; attribute vec3 aC; attribute vec2 aT;
uniform mat4 uMvp; uniform mat4 uModel; uniform vec3 uEye;
varying vec3 vN; varying vec3 vC; varying vec2 vT; varying float vD;
void main(){
  vec4 w = uModel * vec4(aP, 1.0);
  vN = (uModel * vec4(aN, 0.0)).xyz; vC = aC; vT = aT; vD = distance(w.xyz, uEye);
  gl_Position = uMvp * w;
}`;
const FSB = `
precision mediump float;
varying vec3 vN; varying vec3 vC; varying vec2 vT; varying float vD;
uniform sampler2D uTex; uniform float uUseTex; uniform vec3 uFlat; uniform vec3 uSun; uniform vec3 uFog; uniform float uFogFar;
void main(){
  vec3 n = normalize(vN);
  float d = clamp(dot(n, normalize(uSun)), 0.0, 1.0);
  vec3 base = vC;
  if (vC.r < 0.0) {
    vec3 tc = uUseTex > 0.5 ? texture2D(uTex, vT).rgb : uFlat;
    // roofs keep the colour seen from orbit; walls are a lighter plaster tone of it
    base = n.y > 0.5 ? clamp(tc * 1.1 + 0.05, 0.0, 1.0) : mix(tc, vec3(0.86, 0.80, 0.70), 0.5);
  }
  vec3 col = base * (0.42 + 0.62 * d + 0.14 * max(n.y, 0.0));
  float f = clamp(vD / uFogFar, 0.0, 1.0);
  gl_FragColor = vec4(mix(col, uFog, f * f), 1.0);
}`;

interface Geo { p: number[]; n: number[]; c: number[]; t: number[]; i: number[] }
const geo = (): Geo => ({ p: [], n: [], c: [], t: [], i: [] });
/** Append an oriented box: centre (cx, cz) on the ground, y from y0 to y1, half sizes hx, hz, rotated by `ang` (rad). */
function addBox(g: Geo, cx: number, cz: number, y0: number, y1: number, hx: number, hz: number, ang: number, col: number[], uv: number[], bottom = false) {
  const c = Math.cos(ang), sn = Math.sin(ang);
  const P = (u: number, v: number) => [cx + u * c - v * sn, cz + u * sn + v * c];
  const q = [P(-hx, -hz), P(hx, -hz), P(hx, hz), P(-hx, hz)];
  const face = (pts: number[][], nx: number, ny: number, nz: number) => {
    const b = g.p.length / 3;
    for (const pt of pts) { g.p.push(pt[0], pt[1], pt[2]); g.n.push(nx, ny, nz); g.c.push(col[0], col[1], col[2]); g.t.push(uv[0], uv[1]); }
    g.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  face([[q[0][0], y1, q[0][1]], [q[3][0], y1, q[3][1]], [q[2][0], y1, q[2][1]], [q[1][0], y1, q[1][1]]], 0, 1, 0);
  if (bottom) face([[q[0][0], y0, q[0][1]], [q[1][0], y0, q[1][1]], [q[2][0], y0, q[2][1]], [q[3][0], y0, q[3][1]]], 0, -1, 0);
  for (let k = 0; k < 4; k++) {
    const a = q[k], b2 = q[(k + 1) % 4];
    const ex = b2[0] - a[0], ez = b2[1] - a[1], l = Math.hypot(ex, ez) || 1;
    face([[a[0], y0, a[1]], [b2[0], y0, b2[1]], [b2[0], y1, b2[1]], [a[0], y1, a[1]]], ez / l, 0, -ex / l);
  }
}
/** A small quadcopter in local units (forward = -z), drawn enlarged so it reads on screen in chase view. */
function droneModel(): Geo {
  const g = geo();
  const dark = [0.16, 0.18, 0.22], grey = [0.72, 0.75, 0.8], red = [0.95, 0.25, 0.2], white = [0.93, 0.95, 0.98];
  addBox(g, 0, 0, -0.25, 0.25, 0.55, 0.85, 0, white, [0, 0], true);
  addBox(g, 0, 0, 0.0, 0.12, 1.9, 0.12, Math.PI / 4, dark, [0, 0], true);
  addBox(g, 0, 0, 0.0, 0.12, 1.9, 0.12, -Math.PI / 4, dark, [0, 0], true);
  for (const [x, z] of [[1.34, 1.34], [-1.34, 1.34], [1.34, -1.34], [-1.34, -1.34]]) addBox(g, x, z, 0.14, 0.2, 0.75, 0.75, 0.3, grey, [0, 0], true);
  addBox(g, 0, -0.95, -0.45, -0.12, 0.22, 0.2, 0, dark, [0, 0], true);
  addBox(g, 0, -0.86, 0.05, 0.16, 0.12, 0.05, 0, red, [0, 0], true);
  return g;
}

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
const SAT_Z = 13; // ~17 m per pixel over the whole cell
const DET_Z = 15; // ~4 m per pixel in a 4 x 4 tile patch that follows the drone
const DET2_Z = 17; // ~1 m per pixel in a 4 x 4 tile patch right under a low-flying drone
const TILE_URL = (z: number, y: number, x: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const loadTile = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => res(img);
  img.onerror = () => rej(new Error('tile'));
  img.src = src;
});
const pot = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

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
  { cell, heights, slope, px, resM, lens, body, wind, draw, layers, buildings, sens = 1, onTelemetry, onEvent, onSatelliteFail }, ref,
) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState(0);
  const size = (px - 1) * resM;
  const half = size / 2;
  // G: the grid we draw and fly on (finer when available); heights/slope/px/resM stay the analysis grid
  const G = draw ?? { heights, px, resM };
  let hmin = Infinity, hmax = -Infinity;
  for (const h of G.heights) { if (h < hmin) hmin = h; if (h > hmax) hmax = h; }
  const evRef = useRef(onEvent);
  evRef.current = onEvent;

  const clampXZ = (v: number) => Math.min(half, Math.max(-half, v));
  const groundAt = (x: number, z: number) => {
    // x east, z south (world), pixel row 0 = north edge
    const fx = Math.min(G.px - 1.001, Math.max(0, (x + half) / G.resM));
    const fy = Math.min(G.px - 1.001, Math.max(0, (z + half) / G.resM));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), dx = fx - x0, dy = fy - y0;
    const h = (xx: number, yy: number) => G.heights[yy * G.px + xx];
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
    lens: lens as Lens, satReady: false, shoot: false, zoom: 1,
    det: null as null | { cx: number; cz: number; loading: boolean },
    det2: null as null | { cx: number; cz: number; loading: boolean },
    cam: 'fpv' as CamMode, holdAgl: null as number | null, goto: null as null | [number, number], sens: 1,
    padPrev: [] as boolean[], pad: false, bld: 0,
    ray: { eye: [0, 0, 0], dir: [0, 0, -1], tH: 1, aspect: 1 } as { eye: number[]; dir: number[]; tH: number; aspect: number },
  });
  st.current.lens = lens;
  st.current.sens = sens;

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
    let wet = 0;
    if (layers) {
      for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
        const w = layers.water[y * px + x];
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r && w > 0 && w < 75) wet++; // seasonal water = wadi channels, not the sea
      }
    }
    const [lat, lon] = toLatLon(cell, s.x, -s.z);
    return { lat, lon, radiusM: SCAN_R, safe, meanSlope: n ? sum / n : 0, elevMin: lo, elevMax: hi, water: layers && n ? wet / n : null };
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
    setCam: (c: CamMode) => { st.current.cam = c; },
    setAltitude: (aglM: number) => {
      const s = st.current;
      s.holdAgl = aglM;
      if (s.phase === 'landed') takeOff();
    },
    stats: () => {
      const s = st.current;
      return { droneSeconds: s.flightSec, distanceKm: s.distM / 1000, batteryUsed: Math.max(0, s.batteryStart - s.battery), maxAglM: s.maxAgl, landings: s.landings };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [cell, half, heights, px, resM, slope, layers, draw]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl || gl.isContextLost()) return;
    const s = st.current;
    // start on the ground, on the safest spot near the south of the cell
    const [sx, sz] = findLz(0, half * 0.55, 3000);
    Object.assign(s, {
      x: sx, z: sz, yaw: 0, gimbal: -0.12, speed: 0, side: 0, vs: 0, yawRate: 0, alt: groundAt(sx, sz),
      phase: 'landed', home: [sx, sz], path: [], markers: [], battery: 100, batteryStart: 100, auto: false, tasks: [],
      dfStep: null, flightSec: 0, maxAgl: 0, landings: 0, distM: 0, df: { a: [sx, sz], b: null, heading: 0, n: 0 },
    });

    // ----- mesh (on the drawing grid G) -----
    const gp = G.px, gr = G.resM, gh = G.heights;
    const gslope = gp === px ? slope : slopeField(gh, gp, gr);
    const n = gp * gp;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const sl = new Float32Array(n);
    const ro = new Float32Array(n);
    const cov = new Float32Array(n * 3).fill(0.55);
    const wat = new Float32Array(n);
    const [latN, lonW] = toLatLon(cell, -half, half);
    const [latS, lonE] = toLatLon(cell, half, -half);
    const tx0 = Math.floor(tileX(lonW, SAT_Z)), tx1 = Math.floor(tileX(lonE, SAT_Z));
    const ty0 = Math.floor(tileY(latN, SAT_Z)), ty1 = Math.floor(tileY(latS, SAT_Z));
    const tw = tx1 - tx0 + 1, th = ty1 - ty0 + 1;
    const rr = Math.max(1, Math.round(217 / gr)); // roughness window ~650 m whatever the grid
    for (let y = 0; y < gp; y++) for (let x = 0; x < gp; x++) {
      const i = y * gp + x;
      const wx = x * gr - half, wz = y * gr - half;
      pos[i * 3] = wx; pos[i * 3 + 1] = gh[i] * EX; pos[i * 3 + 2] = wz;
      const hl = gh[y * gp + Math.max(0, x - 1)], hr = gh[y * gp + Math.min(gp - 1, x + 1)];
      const hu = gh[Math.max(0, y - 1) * gp + x], hd = gh[Math.min(gp - 1, y + 1) * gp + x];
      const nx = -(hr - hl) * EX / (2 * gr), nz = -(hd - hu) * EX / (2 * gr);
      const l = Math.hypot(nx, 1, nz);
      nor[i * 3] = nx / l; nor[i * 3 + 1] = 1 / l; nor[i * 3 + 2] = nz / l;
      sl[i] = gslope[i];
      let lo = Infinity, hi = -Infinity;
      for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
        const v = gh[Math.min(gp - 1, Math.max(0, y + dy)) * gp + Math.min(gp - 1, Math.max(0, x + dx))];
        if (v < lo) lo = v; if (v > hi) hi = v;
      }
      ro[i] = hi - lo;
      if (layers) {
        const bi = Math.round((y * (px - 1)) / (gp - 1)) * px + Math.round((x * (px - 1)) / (gp - 1));
        const cc = COVER_RGB[layers.cover[bi]] ?? [0.55, 0.55, 0.55];
        cov[i * 3] = cc[0]; cov[i * 3 + 1] = cc[1]; cov[i * 3 + 2] = cc[2];
        wat[i] = layers.water[bi];
      }
      const [la, lo2] = toLatLon(cell, wx, -wz);
      uv[i * 2] = (tileX(lo2, SAT_Z) - tx0) / tw;
      uv[i * 2 + 1] = (tileY(la, SAT_Z) - ty0) / th;
    }
    const idx = new Uint16Array((gp - 1) * (gp - 1) * 6);
    let k = 0;
    for (let y = 0; y < gp - 1; y++) for (let x = 0; x < gp - 1; x++) {
      const a = y * gp + x, b = a + 1, c = a + gp, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }

    const prog = gl.createProgram()!;
    try {
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fsSource(!!gl.getExtension('OES_standard_derivatives'))));
    } catch {
      return; // no WebGL here: leave the screen empty instead of taking the whole page down
    }
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const tAttrs: { b: WebGLBuffer; loc: number; size: number }[] = [];
    const attr = (name: string, data: Float32Array, size2: number) => {
      const b = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, name);
      if (loc < 0) return;
      tAttrs.push({ b, loc, size: size2 });
    };
    attr('aPos', pos, 3); attr('aNormal', nor, 3); attr('aSlope', sl, 1); attr('aRough', ro, 1); attr('aUv', uv, 2); attr('aCover', cov, 3); attr('aWater', wat, 1);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    const maxAttr = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number;
    const bindTerrain = () => {
      gl.useProgram(prog);
      for (let i = 0; i < maxAttr; i++) gl.disableVertexAttribArray(i);
      for (const a of tAttrs) {
        gl.bindBuffer(gl.ARRAY_BUFFER, a.b);
        gl.enableVertexAttribArray(a.loc);
        gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, 0, 0);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    };
    bindTerrain();
    const U = (nm: string) => gl.getUniformLocation(prog, nm);
    const uMvp = U('uMvp'), uEye = U('uEye'), uLens = U('uLens'), uHR = U('uHRange'), uSun = U('uSun'),
      uFog = U('uFog'), uFogFar = U('uFogFar'), uScan = U('uScan'), uScanT = U('uScanT');
    gl.uniform2f(uHR, hmin * EX, hmax * EX);
    gl.uniform3f(uSun, 0.55, 0.75, -0.35);
    gl.uniform1f(uFogFar, size * 1.15);
    gl.uniform1f(U('uHalf'), half);
    gl.uniform1f(U('uEx'), EX);
    const relief = hmax - hmin;
    gl.uniform1f(U('uContour'), relief > 1500 ? 100 : relief > 600 ? 50 : relief > 200 ? 20 : 10);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // ----- buildings (Microsoft footprints, drawn as blocks where they really stand) and the drone model -----
    const bprog = gl.createProgram()!;
    let bOk = true;
    try {
      gl.attachShader(bprog, compile(gl, gl.VERTEX_SHADER, VSB));
      gl.attachShader(bprog, compile(gl, gl.FRAGMENT_SHADER, FSB));
      gl.linkProgram(bprog);
      bOk = !!gl.getProgramParameter(bprog, gl.LINK_STATUS);
    } catch { bOk = false; }
    const BU = (nm: string) => gl.getUniformLocation(bprog, nm);
    const bLoc = { p: gl.getAttribLocation(bprog, 'aP'), n: gl.getAttribLocation(bprog, 'aN'), c: gl.getAttribLocation(bprog, 'aC'), t: gl.getAttribLocation(bprog, 'aT') };
    const uintExt = gl.getExtension('OES_element_index_uint');
    interface Mesh { b: WebGLBuffer[]; ib: WebGLBuffer; count: number; type: number }
    const mkMesh = (g: Geo): Mesh => {
      const mk = (a: number[]) => { const b = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(a), gl.STATIC_DRAW); return b; };
      const b = [mk(g.p), mk(g.n), mk(g.c), mk(g.t)];
      const big = g.p.length / 3 > 65535;
      const ib2 = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib2);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, big ? new Uint32Array(g.i) : new Uint16Array(g.i), gl.STATIC_DRAW);
      return { b, ib: ib2, count: g.i.length, type: big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
    };
    const freeMesh = (m: Mesh | null) => { if (!m) return; m.b.forEach((b) => gl.deleteBuffer(b)); gl.deleteBuffer(m.ib); };
    const drawMesh = (m: Mesh, model: Float32Array) => {
      for (let i = 0; i < maxAttr; i++) gl.disableVertexAttribArray(i);
      const sizes = [3, 3, 3, 2];
      [bLoc.p, bLoc.n, bLoc.c, bLoc.t].forEach((loc, k) => {
        if (loc < 0) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, m.b[k]);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, sizes[k], gl.FLOAT, false, 0, 0);
      });
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib);
      gl.uniformMatrix4fv(BU('uModel'), false, model);
      gl.drawElements(gl.TRIANGLES, m.count, m.type, 0);
    };
    const ID4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const droneMesh = bOk ? mkMesh(droneModel()) : null;
    let bldMesh: Mesh | null = null;
    let bldAt: [number, number] | null = null;
    const BLD_R = 3500;
    const BLD_MAX = uintExt ? 15000 : 3200;
    const satUv = (wx: number, wz: number) => {
      const [la, lo] = toLatLon(cell, wx, -wz);
      return [(tileX(lo, SAT_Z) - tx0) / tw, (tileY(la, SAT_Z) - ty0) / th];
    };
    /** Blocks for the buildings within BLD_R of (cx, cz), nearest first. */
    const buildBld = (cx: number, cz: number) => {
      if (!buildings || !bOk) return;
      const nB = buildings.length / 6;
      const near: [number, number][] = [];
      for (let i = 0; i < nB; i++) {
        const d = Math.hypot(buildings[i * 6] - cx, buildings[i * 6 + 1] - cz);
        if (d < BLD_R) near.push([d, i]);
      }
      near.sort((a, b) => a[0] - b[0]);
      const g = geo();
      for (const [, i] of near.slice(0, BLD_MAX)) {
        const x = buildings[i * 6], z = buildings[i * 6 + 1], l = buildings[i * 6 + 2], w2 = buildings[i * 6 + 3];
        const ang = (buildings[i * 6 + 4] * Math.PI) / 180, hData = buildings[i * 6 + 5];
        if (l < 2 || w2 < 2) continue;
        // height from the dataset when it has one; otherwise a typical Omani house: one storey, two for big footprints
        const hgt = hData > 0 ? hData : l * w2 > 220 ? 7 : 4.5;
        const gnd = Math.min(groundAt(x, z), groundAt(x + l / 2, z), groundAt(x - l / 2, z), groundAt(x, z + w2 / 2), groundAt(x, z - w2 / 2));
        addBox(g, x, z, (gnd - 1) * EX, (gnd + hgt) * EX, l / 2, w2 / 2, ang, [-1, -1, -1], satUv(x, z));
      }
      freeMesh(bldMesh);
      bldMesh = g.i.length ? mkMesh(g) : null;
      bldAt = [cx, cz];
      s.bld = Math.min(near.length, BLD_MAX);
    };

    // ----- satellite drape: Esri World Imagery tiles composited on a canvas -----
    const maxTex = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, 4096);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    const anisoMax = aniso ? Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) : 0;
    /** Upload a canvas as a mipmapped, anisotropically filtered texture (canvas sizes are powers of two). */
    const upload = (t: WebGLTexture, c: HTMLCanvasElement) => {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c); // throws if tainted
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (aniso && anisoMax) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, anisoMax);
    };
    const tex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([120, 110, 90, 255]));
    const detTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, detTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([120, 110, 90, 255]));
    const det2Tex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, det2Tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([120, 110, 90, 255]));
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(U('uTex'), 0);
    gl.uniform1i(U('uDetail'), 1);
    gl.uniform1i(U('uDetail2'), 2);
    const uDet = U('uDet'), uDetOn = U('uDetOn'), uDet2 = U('uDet2'), uDet2On = U('uDet2On'), uTexel = U('uTexel'), uSatOk = U('uSatOk');
    gl.uniform1f(uDetOn, 0);
    gl.uniform1f(uDet2On, 0);
    gl.uniform1f(uSatOk, 0);
    const texel = [1 / 1024, 1 / 1024, 1 / 1024];
    gl.uniform3f(uTexel, texel[0], texel[1], texel[2]);
    let cancelled = false;
    s.satReady = false;
    s.det = null;
    s.det2 = null;
    (async () => {
      try {
        const W = Math.min(maxTex, pot(tw * 256)), H = Math.min(maxTex, pot(th * 256));
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const g = c.getContext('2d')!;
        const sx = W / (tw * 256), sy = H / (th * 256);
        const jobs: Promise<void>[] = [];
        for (let yy = 0; yy < th; yy++) for (let xx = 0; xx < tw; xx++) {
          jobs.push(loadTile(TILE_URL(SAT_Z, ty0 + yy, tx0 + xx)).then((img) => { g.drawImage(img, xx * 256 * sx, yy * 256 * sy, 256 * sx + 0.5, 256 * sy + 0.5); }));
        }
        await Promise.all(jobs);
        if (cancelled) return;
        gl.activeTexture(gl.TEXTURE0);
        upload(tex, c);
        texel[0] = 1 / W;
        gl.uniform3f(uTexel, texel[0], texel[1], texel[2]);
        gl.uniform1f(uSatOk, 1);
        s.satReady = true;
      } catch {
        if (!cancelled) onSatelliteFail?.();
      }
    })();
    /** Sharper imagery in a 4 x 4 tile patch around the drone, reloaded as it flies on: zoom 15 (~4 m) and,
     *  when the drone is low, zoom 17 (~1 m, where Esri has it) right underneath. */
    const loadPatch = async (level: 1 | 2, x: number, z: number) => {
      const key = level === 1 ? 'det' : 'det2';
      const cur = s[key];
      if (!s.satReady || cur?.loading) return;
      s[key] = { cx: x, cz: z, loading: true };
      const Z = level === 1 ? DET_Z : DET2_Z;
      try {
        const [la, lo] = toLatLon(cell, x, -z);
        const fx = tileX(lo, Z), fy = tileY(la, Z);
        const x0 = Math.round(fx) - 2, y0 = Math.round(fy) - 2;
        const c = document.createElement('canvas');
        c.width = c.height = 1024;
        const g = c.getContext('2d')!;
        await Promise.all(Array.from({ length: 16 }, (_, i) => loadTile(TILE_URL(Z, y0 + Math.floor(i / 4), x0 + (i % 4)))
          .then((img) => g.drawImage(img, (i % 4) * 256, Math.floor(i / 4) * 256))));
        if (cancelled) return;
        // tile corners -> world metres (x east, z south) through the same small-area mapping as the mesh
        const lon0 = (x0 / 2 ** Z) * 360 - 180, lon1 = ((x0 + 4) / 2 ** Z) * 360 - 180;
        const latAt = (ty: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / 2 ** Z))) * 180) / Math.PI;
        const lat0 = latAt(y0), lat1 = latAt(y0 + 4);
        const kx = 111_320 * Math.cos((cell.lat * Math.PI) / 180);
        const wx0 = (lon0 - cell.lon) * kx, wx1 = (lon1 - cell.lon) * kx;
        const wz0 = -(lat0 - cell.lat) * 111_320, wz1 = -(lat1 - cell.lat) * 111_320;
        gl.activeTexture(level === 1 ? gl.TEXTURE1 : gl.TEXTURE2);
        upload(level === 1 ? detTex : det2Tex, c);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform4f(level === 1 ? uDet : uDet2, wx0, wz0, wx1 - wx0, wz1 - wz0);
        gl.uniform1f(level === 1 ? uDetOn : uDet2On, 1);
        s[key] = { cx: x, cz: z, loading: false };
      } catch {
        s[key] = { cx: x, cz: z, loading: false }; // keep what we have; try again after moving on
      }
    };

    const mini = miniRef.current!;
    // ----- input -----
    const down = (e: KeyboardEvent) => {
      const k2 = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'pageup', 'pagedown'].includes(k2)) e.preventDefault();
      if (e.repeat) return;
      if (k2 === 't') { if (s.phase === 'landed') takeOff(); else { s.auto = false; s.tasks = []; s.phase = 'landing'; } return; }
      if (k2 === 'p') { s.shoot = true; return; }
      if (k2 === 'c') { s.cam = s.cam === 'fpv' ? 'chase' : 'fpv'; return; }
      if (k2 === 'h' && s.phase !== 'landed') { s.auto = false; s.tasks = []; s.phase = 'rth'; s.rthReason = 'user'; evRef.current?.({ type: 'rth', reason: 'user' }); return; }
      s.keys.add(k2);
      if (['w', 's', 'a', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'pageup', 'pagedown'].includes(k2)) {
        if (s.auto) { s.auto = false; s.tasks = []; s.dfStep = null; s.goto = null; }
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
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      s.zoom = Math.max(1, Math.min(6, s.zoom * Math.exp(-e.deltaY * 0.0015)));
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    /** Double-click on the ground: fly there and hover. The pixel's ray is marched until it meets the terrain. */
    const flyTo = (x: number, z: number) => {
      s.goto = [clampXZ(x), clampXZ(z)];
      s.tasks = []; s.dfStep = null;
      s.auto = 'goto';
      if (s.phase === 'landed') takeOff();
    };
    const dbl = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1, ny = 1 - ((e.clientY - r.top) / r.height) * 2;
      const { eye, dir, tH, aspect } = s.ray;
      const tV = tH / aspect;
      const rgt = [-dir[2], 0, dir[0]];
      const rl = Math.hypot(rgt[0], rgt[2]) || 1;
      rgt[0] /= rl; rgt[2] /= rl;
      const upc = [rgt[1] * dir[2] - rgt[2] * dir[1], rgt[2] * dir[0] - rgt[0] * dir[2], rgt[0] * dir[1] - rgt[1] * dir[0]];
      const d = [0, 1, 2].map((i) => dir[i] + rgt[i] * nx * tH + upc[i] * ny * tV);
      const dl = Math.hypot(d[0], d[1], d[2]);
      for (let t2 = 20; t2 < 40000; t2 += 20) {
        const x = eye[0] + (d[0] / dl) * t2, y = eye[1] + (d[1] / dl) * t2, z = eye[2] + (d[2] / dl) * t2;
        if (Math.abs(x) > half || Math.abs(z) > half) break;
        if (y <= groundAt(x, z) * EX) { flyTo(x, z); return; }
      }
    };
    canvas.addEventListener('dblclick', dbl);
    const miniDbl = (e: MouseEvent) => {
      const r = mini.getBoundingClientRect();
      flyTo(((e.clientX - r.left) / r.width) * size - half, ((e.clientY - r.top) / r.height) * size - half);
    };
    canvas.addEventListener('pointerdown', pd);
    canvas.addEventListener('pointermove', pm);
    canvas.addEventListener('pointerup', pu);

    // ----- loop -----
    let raf = 0, last = performance.now(), lastTel = 0;
    const mg = mini.getContext('2d')!;
    mini.addEventListener('dblclick', miniDbl);
    const base = document.createElement('canvas');
    base.width = base.height = px;
    const bg = base.getContext('2d')!;
    const im = bg.createImageData(px, px);
    for (let i = 0; i < px * px; i++) {
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

      // ---- game controller (Xbox / PlayStation layout, standard mapping), Mode 2 like a real drone remote ----
      const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
      const pad = Array.from(pads || []).find((p2) => p2 && p2.connected) ?? null;
      s.pad = !!pad;
      if (pad) {
        const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : v);
        const ax = (i: number) => dz(pad.axes[i] ?? 0);
        const any = ax(0) || ax(1) || ax(2) || ax(3);
        if (any && s.auto) { s.auto = false; s.tasks = []; s.dfStep = null; s.goto = null; }
        turn -= ax(0); climb -= ax(1); side += ax(2); fwd -= ax(3);
        const btn = (i: number) => !!pad.buttons[i]?.pressed;
        const edge = (i: number) => btn(i) && !s.padPrev[i];
        if (edge(0)) { if (s.phase === 'landed') takeOff(); else { s.auto = false; s.tasks = []; s.phase = 'landing'; } }
        if (edge(1) && s.phase !== 'landed') { s.auto = false; s.tasks = []; s.phase = 'rth'; s.rthReason = 'user'; evRef.current?.({ type: 'rth', reason: 'user' }); }
        if (edge(2)) s.shoot = true;
        if (edge(3)) evRef.current?.({ type: 'scanRequest' });
        if (btn(4)) s.gimbal = Math.min(0.35, s.gimbal + dt * 0.9);
        if (btn(5)) s.gimbal = Math.max(-Math.PI / 2, s.gimbal - dt * 0.9);
        if (btn(6)) s.zoom = Math.max(1, s.zoom * Math.exp(-dt * 1.5));
        if (btn(7)) s.zoom = Math.min(6, s.zoom * Math.exp(dt * 1.5));
        if (edge(9)) s.cam = s.cam === 'fpv' ? 'chase' : 'fpv';
        s.padPrev = pad.buttons.map((b) => b.pressed);
        if (climb > 0.5 && s.phase === 'landed') takeOff();
      }
      // a manual climb or descent cancels the altitude preset
      if (Math.abs(climb) > 0.1) s.holdAgl = null;
      else if (s.holdAgl != null && s.phase === 'flying') climb = Math.max(-1, Math.min(1, (s.holdAgl - (s.alt - ground0)) / 80));
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
      } else if (s.auto === 'goto' && s.goto && s.phase === 'flying') {
        // click-to-fly: go to the double-clicked point and hover there
        const g = steer(s.goto[0], s.goto[1], Math.max(80, s.holdAgl ?? s.alt - ground0));
        fwd = g.fwd; turn = g.turn; climb = g.climb; side = 0;
        if (g.dist < 40) { s.auto = false; s.goto = null; }
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
      const maxV = 160 * boost * (s.auto ? 1 : s.sens); // simulated m/s = 16 m/s real
      const k1 = Math.min(1, dt * 1.8);
      s.speed += (fwd * maxV - s.speed) * k1;
      s.side += (side * maxV * 0.6 - s.side) * k1;
      s.yawRate += (turn * 1.1 * (s.auto ? 1 : Math.sqrt(s.sens)) - s.yawRate) * Math.min(1, dt * 4);
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
      let eye = [s.x, camAlt * EX, s.z];
      let dir = [-Math.sin(yawC) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yawC) * Math.cos(pitch)];
      if (s.cam === 'chase') {
        // third-person: behind and above the drone, looking at it
        const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
        const dy = s.alt * EX + 3;
        const ex = s.x - fx * 70, ez = s.z - fz * 70;
        const ey = Math.max(dy + 26, groundAt(ex, ez) * EX + 12);
        eye = [ex, ey, ez];
        const tx = s.x + fx * 25, ty = dy, tz = s.z + fz * 25;
        const l = Math.hypot(tx - ex, ty - ey, tz - ez);
        dir = [(tx - ex) / l, (ty - ey) / l, (tz - ez) / l];
      }
      const upv = Math.abs(dir[1]) > 0.997 ? [-Math.sin(yawC), 0, -Math.cos(yawC)] : [0, 1, 0];
      const view = lookAt(eye, [eye[0] + dir[0], eye[1] + dir[1], eye[2] + dir[2]], upv);
      s.ray = { eye, dir };
      const aspect = canvas.width / Math.max(1, canvas.height);
      const tH = Math.tan((HFOV * Math.PI) / 360) / s.zoom;
      const vfov = 2 * Math.atan(tH / aspect);
      const near = s.cam === 'chase' ? 4 : Math.max(1.5, Math.min(20, (camAlt - ground) * 0.25));
      s.ray.tH = tH; s.ray.aspect = aspect;
      const proj = perspective(vfov, aspect, near, size * 2.5);
      const lensNow = s.lens === 'satellite' && !s.satReady ? 'relief' : s.lens;
      const sky = lensNow === 'mars' ? 'mars' : body === 'moon' && lensNow !== 'satellite' ? 'moon' : 'earth';
      if (wrap.dataset.sky !== sky) wrap.dataset.sky = sky;
      if (wrap.dataset.cam !== s.cam) wrap.dataset.cam = s.cam;
      // fog = the colour of the CSS sky at the horizon, so far terrain melts into it
      const fog = sky === 'mars' ? [0.83, 0.62, 0.47] : sky === 'moon' ? [0.03, 0.04, 0.07] : [0.79, 0.86, 0.93];
      const wantsSat = (s.lens === 'satellite' || s.lens === 'hazard') && s.satReady;
      if (wantsSat && camAlt - ground < 2500 && (!s.det || Math.hypot(s.x - s.det.cx, s.z - s.det.cz) > 1300)) void loadPatch(1, s.x, s.z);
      if (wantsSat && camAlt - ground < 700 && (!s.det2 || Math.hypot(s.x - s.det2.cx, s.z - s.det2.cz) > 300)) void loadPatch(2, s.x, s.z);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      bindTerrain();
      const mvp = mul(proj, view);
      gl.uniformMatrix4fv(uMvp, false, mvp);
      gl.uniform3f(uEye, eye[0], eye[1], eye[2]);
      gl.uniform1i(uLens, { relief: 0, slope: 1, mars: 2, satellite: 3, hazard: 4, cover: 5 }[lensNow]);
      gl.uniform3f(uFog, fog[0], fog[1], fog[2]);
      if (s.scan) {
        const tt = (now - s.scan.t0) / 1600;
        gl.uniform3f(uScan, s.scan.x, SCAN_R, s.scan.z);
        gl.uniform1f(uScanT, tt <= 1 ? tt : -1);
        if (tt > 1) s.scan = null;
      } else gl.uniform1f(uScanT, -1);
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);

      // buildings near the drone, and the drone itself in chase view
      if (bOk) {
        gl.useProgram(bprog);
        gl.uniformMatrix4fv(BU('uMvp'), false, mvp);
        gl.uniform3f(BU('uEye'), eye[0], eye[1], eye[2]);
        gl.uniform3f(BU('uSun'), 0.55, 0.75, -0.35);
        gl.uniform3f(BU('uFog'), fog[0], fog[1], fog[2]);
        gl.uniform1f(BU('uFogFar'), size * 1.15);
        gl.uniform1i(BU('uTex'), 0);
        gl.uniform1f(BU('uUseTex'), (lensNow === 'satellite' || lensNow === 'hazard') && s.satReady ? 1 : 0);
        const flat = lensNow === 'cover' ? [0.92, 0.18, 0.18] : lensNow === 'mars' ? [0.7, 0.42, 0.3] : lensNow === 'hazard' || lensNow === 'slope' ? [0.62, 0.62, 0.66] : [0.88, 0.84, 0.76];
        gl.uniform3f(BU('uFlat'), flat[0], flat[1], flat[2]);
        if (buildings && camAlt - ground < 3000 && (!bldAt || Math.hypot(s.x - bldAt[0], s.z - bldAt[1]) > 1500)) buildBld(s.x, s.z);
        if (bldMesh && camAlt - ground < 3000) drawMesh(bldMesh, ID4);
        if (droneMesh && s.cam === 'chase') {
          const k = 5; // drawn ~5x its real size so it reads on screen
          const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
          const tilt = Math.max(-0.35, Math.min(0.35, -s.speed / 600));
          const ct = Math.cos(tilt), st2 = Math.sin(tilt);
          // model = T * Ry(yaw) * Rx(tilt) * S(k)
          const m = new Float32Array([
            c * k, 0, -sn * k, 0,
            sn * st2 * k, ct * k, c * st2 * k, 0,
            sn * ct * k, -st2 * k, c * ct * k, 0,
            s.x, s.alt * EX + 3, s.z, 1,
          ]);
          drawMesh(droneMesh, m);
        }
      }

      // ---- photo: read the frame we just drew (same task, so no preserveDrawingBuffer needed) ----
      if (s.shoot) {
        s.shoot = false;
        try {
          const tw2 = 360, th2 = Math.round(360 / aspect);
          const c2 = document.createElement('canvas');
          c2.width = tw2; c2.height = th2;
          const g2 = c2.getContext('2d')!;
          const grd = g2.createLinearGradient(0, 0, 0, th2);
          const skyCols = sky === 'mars' ? ['#8a5a3c', '#d49e78'] : sky === 'moon' ? ['#000000', '#080a12'] : ['#4f86c6', '#c9dbee'];
          grd.addColorStop(0, skyCols[0]); grd.addColorStop(1, skyCols[1]);
          g2.fillStyle = grd; g2.fillRect(0, 0, tw2, th2);
          g2.drawImage(canvas, 0, 0, tw2, th2);
          const [la, lo] = toLatLon(cell, s.x, -s.z);
          const photo: Photo = { url: c2.toDataURL('image/jpeg', 0.7), lat: la, lon: lo, altM: Math.round(s.alt), aglM: Math.round(agl), t: Math.round(s.flightSec) };
          evRef.current?.({ type: 'photo', photo });
          setFlash((f) => f + 1);
        } catch {
          /* a tainted canvas cannot be read; skip the photo */
        }
      }

      // ---- camera footprint on the ground (flat ground at the height below the drone) ----
      const tV = Math.tan(vfov / 2);
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
          wind, footprintM, zoom: s.zoom, dfStep: s.auto === 'dragonfly' ? s.dfStep : null, lzCount: s.df.n,
          cam: s.cam, pad: s.pad, holdAgl: s.holdAgl, buildings: bldMesh && camAlt - ground < 3000 ? s.bld : 0,
        });
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      wrap.removeEventListener('keydown', down);
      wrap.removeEventListener('keyup', up);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('dblclick', dbl);
      mini.removeEventListener('dblclick', miniDbl);
      freeMesh(bldMesh);
      canvas.removeEventListener('pointerdown', pd);
      canvas.removeEventListener('pointermove', pm);
      canvas.removeEventListener('pointerup', pu);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell.id, heights, buildings]);

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
