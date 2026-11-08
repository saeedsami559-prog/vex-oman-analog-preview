import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useI18n } from '../../i18n';
import { safeShare, slopeClass, toLatLon, type Body, type Marker, type ScoutCell, type Waypoint } from '../../lib/scout';

/**
 * The virtual drone: a WebGL flight over the real NASADEM heightmap of one VEX Scout cell.
 * Heights are true metres (drawn with a 1.6x vertical exaggeration); everything the HUD reads comes
 * from the same heightmap. Manual control (keyboard, mouse drag, touch joysticks) or an autopilot
 * that flies a lawnmower survey pattern.
 */

export type Lens = 'relief' | 'slope' | 'mars' | 'satellite';

export interface Telemetry {
  lat: number;
  lon: number;
  altMsl: number;
  agl: number;
  ground: number;
  slope: number;
  speed: number;
  heading: number;
  battery: number;
  auto: boolean;
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

export interface DroneHandle {
  scan: () => ScanResult;
  mark: (label: string) => Marker;
  path: () => Waypoint[];
  markers: () => Marker[];
  setAuto: (on: boolean) => void;
  recharge: () => void;
}

interface Props {
  cell: ScoutCell;
  heights: Float32Array;
  slope: Float32Array;
  px: number;
  resM: number;
  lens: Lens;
  body: Body;
  onTelemetry: (t: Telemetry) => void;
  onSatelliteFail?: () => void;
}

const EX = 1.6; // vertical exaggeration, drawing only
const MIN_AGL = 25;
const SCAN_R = 2000;

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
  l = Math.hypot(xx, xy, xz);
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
attribute vec3 aPos; attribute vec3 aNormal; attribute float aSlope; attribute vec2 aUv;
uniform mat4 uMvp; uniform vec3 uEye;
varying vec3 vNormal; varying float vSlope; varying float vH; varying vec2 vUv; varying float vDist; varying vec2 vXZ;
void main(){
  vNormal = aNormal; vSlope = aSlope; vH = aPos.y; vUv = aUv; vXZ = aPos.xz;
  vDist = distance(aPos, uEye);
  gl_Position = uMvp * vec4(aPos, 1.0);
}`;

const FS = `
precision mediump float;
varying vec3 vNormal; varying float vSlope; varying float vH; varying vec2 vUv; varying float vDist; varying vec2 vXZ;
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
    col = vSlope < 10.0 ? vec3(0.22, 0.72, 0.38) : vSlope < 25.0 ? vec3(0.93, 0.74, 0.22) : vec3(0.88, 0.27, 0.22);
    col *= 0.55 + 0.6 * diff;
  } else if (uLens == 2) {
    col = ramp(t, vec3(0.45, 0.20, 0.10), vec3(0.70, 0.33, 0.16), vec3(0.82, 0.48, 0.28), vec3(0.88, 0.70, 0.55)) * shade;
  } else if (uLens == 3) {
    col = texture2D(uTex, vUv).rgb * (0.75 + 0.35 * diff);
  } else {
    col = ramp(t, vec3(0.80, 0.70, 0.52), vec3(0.72, 0.56, 0.38), vec3(0.55, 0.42, 0.32), vec3(0.78, 0.76, 0.74)) * shade;
  }
  // scan ring sweeping outward from the scan point
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

function Joystick({ onMove, label }: { onMove: (x: number, y: number) => void; label: string }) {
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
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); update(e); }}
      onPointerMove={(e) => e.buttons && update(e)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <i style={{ transform: `translate(${knob.x * 32}px, ${knob.y * 32}px)` }} />
    </div>
  );
}

const DroneView = forwardRef<DroneHandle, Props>(function DroneView(
  { cell, heights, slope, px, resM, lens, body, onTelemetry, onSatelliteFail }, ref,
) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const size = (px - 1) * resM;
  const half = size / 2;
  const hmin = Math.min(...heights);
  const hmax = Math.max(...heights);

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

  const st = useRef({
    x: 0, z: half * 0.75, alt: 0, yaw: 0, pitch: -0.32, speed: 0,
    keys: new Set<string>(), joyL: [0, 0], joyR: [0, 0],
    auto: false, wp: [] as [number, number][], wpi: 0,
    battery: 100, path: [] as Waypoint[], markers: [] as Marker[], lastRec: 0,
    scan: null as null | { x: number; z: number; t0: number },
    lens: lens as Lens, satReady: false,
  });
  st.current.lens = lens;

  useImperativeHandle(ref, () => ({
    scan: () => {
      const s = st.current;
      s.scan = { x: s.x, z: s.z, t0: performance.now() };
      const cx = (s.x + half) / resM, cy = (s.z + half) / resM;
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
    },
    mark: (label: string) => {
      const s = st.current;
      const [lat, lon] = toLatLon(cell, s.x, -s.z);
      const m = { lat, lon, label };
      s.markers.push(m);
      return m;
    },
    path: () => st.current.path.slice(),
    markers: () => st.current.markers.slice(),
    setAuto: (on: boolean) => {
      const s = st.current;
      s.auto = on;
      if (on) {
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
      }
    },
    recharge: () => { st.current.battery = 100; },
  }), [cell, half, heights, px, resM, slope]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) return;
    const s = st.current;
    s.x = 0; s.z = half * 0.75; s.yaw = 0; s.alt = groundAt(0, half * 0.75) + 600;
    s.path = []; s.markers = []; s.battery = 100; s.auto = false;

    // ----- mesh -----
    const n = px * px;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const sl = new Float32Array(n);
    // satellite texture placement (tile range covering the cell)
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
      const [la, lo] = toLatLon(cell, wx, -wz);
      uv[i * 2] = (tileX(lo, SAT_Z) - tx0) / tw;
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
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size2, gl.FLOAT, false, 0, 0);
    };
    attr('aPos', pos, 3); attr('aNormal', nor, 3); attr('aSlope', sl, 1); attr('aUv', uv, 2);
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
      s.keys.add(k2);
      if (s.keys.size) s.auto = false;
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
      s.pitch = Math.max(-1.3, Math.min(0.2, s.pitch - (e.clientY - drag.y) * 0.004));
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

      // controls -> velocity
      const kd = (a: string, b?: string) => s.keys.has(a) || (b ? s.keys.has(b) : false);
      const boost = s.keys.has('shift') ? 2.2 : 1;
      let fwd = (kd('w', 'arrowup') ? 1 : 0) - (kd('s', 'arrowdown') ? 1 : 0) - s.joyL[1];
      let turn = (kd('a', 'arrowleft') ? 1 : 0) - (kd('d', 'arrowright') ? 1 : 0) - s.joyL[0];
      let climb = (kd('e', 'pageup') ? 1 : 0) - (kd('q', 'pagedown') ? 1 : 0) - s.joyR[1];
      const strafe = s.joyR[0];
      if (s.auto && s.wp.length && s.battery > 0) {
        const [gx, gz] = s.wp[s.wpi];
        const want = Math.atan2(-(gx - s.x), -(gz - s.z));
        let d = want - s.yaw;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        turn = Math.max(-1, Math.min(1, d * 2));
        fwd = Math.abs(d) < 0.6 ? 1 : 0.2;
        const agl = s.alt - groundAt(s.x, s.z);
        climb = Math.max(-1, Math.min(1, (450 - agl) / 150));
        if (Math.hypot(gx - s.x, gz - s.z) < 250) s.wpi = (s.wpi + 1) % s.wp.length;
      }
      if (s.battery <= 0) { fwd = 0; turn = 0; climb = 0; }
      const maxV = 160 * boost; // m/s, a fast survey drone with time compressed
      s.speed += (fwd * maxV - s.speed) * Math.min(1, dt * 2.5);
      s.yaw += turn * dt * 1.1;
      s.x += -Math.sin(s.yaw) * s.speed * dt + Math.cos(s.yaw) * strafe * maxV * 0.6 * dt;
      s.z += -Math.cos(s.yaw) * s.speed * dt - Math.sin(s.yaw) * strafe * maxV * 0.6 * dt;
      s.x = Math.max(-half, Math.min(half, s.x));
      s.z = Math.max(-half, Math.min(half, s.z));
      s.alt += climb * 120 * boost * dt;
      const ground = groundAt(s.x, s.z);
      s.alt = Math.max(ground + MIN_AGL, Math.min(ground + 3000, s.alt));
      // time runs 10x faster than real (a 27 km cell in minutes): ~6 min of real flying = ~1 h of drone time
      s.battery = Math.max(0, s.battery - dt * (0.12 + Math.abs(s.speed) / 1000));
      if (now - s.lastRec > 1000) {
        s.lastRec = now;
        const [la, lo] = toLatLon(cell, s.x, -s.z);
        const prev = s.path[s.path.length - 1];
        if (!prev || Math.hypot(prev.lat - la, prev.lon - lo) > 0.0005) s.path.push({ lat: la, lon: lo, altM: s.alt });
      }

      // camera
      const eye = [s.x, s.alt * EX, s.z];
      const dir = [-Math.sin(s.yaw) * Math.cos(s.pitch), Math.sin(s.pitch), -Math.cos(s.yaw) * Math.cos(s.pitch)];
      const view = lookAt(eye, [eye[0] + dir[0], eye[1] + dir[1], eye[2] + dir[2]], [0, 1, 0]);
      const proj = perspective((62 * Math.PI) / 180, canvas.width / Math.max(1, canvas.height), 20, size * 2.5);
      const lensNow = s.lens === 'satellite' && !s.satReady ? 'relief' : s.lens;
      const fog = lensNow === 'mars' ? [0.78, 0.6, 0.45] : body === 'moon' && lensNow !== 'satellite' ? [0.05, 0.06, 0.09] : [0.62, 0.74, 0.88];
      gl.clearColor(fog[0], fog[1], fog[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(uMvp, false, mul(proj, view));
      gl.uniform3f(uEye, eye[0], eye[1], eye[2]);
      gl.uniform1i(uLens, { relief: 0, slope: 1, mars: 2, satellite: 3 }[lensNow]);
      gl.uniform3f(uFog, fog[0], fog[1], fog[2]);
      if (s.scan) {
        const tt = (now - s.scan.t0) / 1600;
        gl.uniform3f(uScan, s.scan.x, SCAN_R, s.scan.z);
        gl.uniform1f(uScanT, tt <= 1 ? tt : -1);
        if (tt > 1) s.scan = null;
      } else gl.uniform1f(uScanT, -1);
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);

      // minimap: slope classes, path, markers, drone
      const M = mini.width;
      mg.drawImage(base, 0, 0, M, M);
      const toM = (x: number, z: number) => [((x + half) / size) * M, ((z + half) / size) * M];
      mg.strokeStyle = 'rgba(255,255,255,0.8)';
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
        mg.fillStyle = '#7fd8ff';
        mg.beginPath(); mg.arc(a, b, 4, 0, Math.PI * 2); mg.fill();
      });
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
        let hd = (-s.yaw * 180) / Math.PI % 360;
        if (hd < 0) hd += 360;
        onTelemetry({ lat: la, lon: lo, altMsl: s.alt, agl: s.alt - ground, ground, slope: slopeAt(s.x, s.z),
          speed: Math.abs(s.speed), heading: hd, battery: s.battery, auto: s.auto });
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

  return (
    <div className="drone-view" ref={wrapRef} tabIndex={0} aria-label={t('scout.viewLabel')}>
      <canvas ref={canvasRef} className="drone-canvas" />
      <div className="drone-reticle" aria-hidden="true" />
      <canvas ref={miniRef} className="drone-mini" width={150} height={150} aria-hidden="true" />
      <div className="drone-joys">
        <Joystick label={t('scout.joyMove')} onMove={(x, y) => { st.current.joyL = [x, y]; if (x || y) st.current.auto = false; }} />
        <Joystick label={t('scout.joyAlt')} onMove={(x, y) => { st.current.joyR = [x, y]; if (x || y) st.current.auto = false; }} />
      </div>
    </div>
  );
});

export default DroneView;
