/**
 * Procedural equirectangular textures for the hero planets. Noise is sampled on the
 * unit sphere (not the flat map), so there is no seam at the date line and no pinching at the poles.
 */
export interface PlanetTexture {
  kind: 'earth' | 'mars';
  w: number;
  h: number;
  color: Uint8ClampedArray; // RGBA
  clouds?: Uint8Array; // alpha 0..255
  lights?: Uint8Array; // night-side city glow 0..255
}

type Noise = (x: number, y: number, z: number) => number;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed: number): Noise {
  const r = rng(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) vals[i] = r() * 2 - 1;
  const h = (i: number, j: number, k: number) => vals[perm[perm[perm[i] + j] + k]];
  return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const X = xi & 255, Y = yi & 255, Z = zi & 255;
    const x00 = h(X, Y, Z) + (h(X + 1, Y, Z) - h(X, Y, Z)) * u;
    const x10 = h(X, Y + 1, Z) + (h(X + 1, Y + 1, Z) - h(X, Y + 1, Z)) * u;
    const x01 = h(X, Y, Z + 1) + (h(X + 1, Y, Z + 1) - h(X, Y, Z + 1)) * u;
    const x11 = h(X, Y + 1, Z + 1) + (h(X + 1, Y + 1, Z + 1) - h(X, Y + 1, Z + 1)) * u;
    const y0 = x00 + (x10 - x00) * v;
    const y1 = x01 + (x11 - x01) * v;
    return y0 + (y1 - y0) * w;
  };
}

function fbm(n: Noise, x: number, y: number, z: number, octaves: number): number {
  let amp = 0.5, f = 1, sum = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * n(x * f + o * 17.3, y * f, z * f);
    f *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

function percentile(values: Float32Array, q: number): number {
  const step = Math.max(1, Math.floor(values.length / 20000));
  const sample: number[] = [];
  for (let i = 0; i < values.length; i += step) sample.push(values[i]);
  sample.sort((a, b) => a - b);
  return sample[Math.min(sample.length - 1, Math.floor(q * sample.length))];
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Calls fn for every texel with its unit-sphere point and latitude (radians). */
function forEachTexel(w: number, h: number, fn: (i: number, x: number, y: number, z: number, lat: number) => void) {
  for (let j = 0; j < h; j++) {
    const lat = (0.5 - (j + 0.5) / h) * Math.PI;
    const cy = Math.sin(lat), cr = Math.cos(lat);
    for (let i = 0; i < w; i++) {
      const lon = ((i + 0.5) / w) * Math.PI * 2;
      fn(j * w + i, cr * Math.sin(lon), cy, cr * Math.cos(lon), lat);
    }
  }
}

export function earthTexture(w = 1536, h = 768): PlanetTexture {
  const nWarp = makeNoise(11), nElev = makeNoise(23), nMoist = makeNoise(37), nCloud = makeNoise(41), nCity = makeNoise(53);
  const N = w * h;
  const elev = new Float32Array(N), moist = new Float32Array(N), cloud = new Float32Array(N), city = new Float32Array(N);
  const lats = new Float32Array(N);
  forEachTexel(w, h, (i, x, y, z, lat) => {
    const q = fbm(nWarp, x * 1.3, y * 1.3, z * 1.3, 3) * 1.4;
    elev[i] = fbm(nElev, x * 1.6 + q, y * 1.6 - q * 0.6, z * 1.6 + q * 0.4, 6);
    moist[i] = fbm(nMoist, x * 2.1, y * 2.1, z * 2.1, 3);
    cloud[i] = fbm(nCloud, x * 3.4 + q, y * 7, z * 3.4 - q, 5);
    city[i] = nCity(x * 70, y * 70, z * 70);
    lats[i] = lat;
  });
  const sea = percentile(elev, 0.69);
  const cloudThr = percentile(cloud, 0.62);
  const color = new Uint8ClampedArray(N * 4);
  const clouds = new Uint8Array(N);
  const lights = new Uint8Array(N);

  const deep: RGB = [7, 26, 58], shallow: RGB = [26, 86, 128], coast: RGB = [44, 118, 140];
  const forest: RGB = [38, 70, 40], grass: RGB = [86, 108, 56], desert: RGB = [186, 154, 106], rock: RGB = [104, 92, 78];
  const tundra: RGB = [118, 112, 96], ice: RGB = [226, 233, 240];

  for (let i = 0; i < N; i++) {
    const e = elev[i], absLat = Math.abs(lats[i]) / (Math.PI / 2);
    let c: RGB;
    let isLand = false;
    if (e < sea) {
      const d = clamp01((sea - e) * 4.5);
      c = d < 0.08 ? mix(coast, shallow, d / 0.08) : mix(shallow, deep, Math.pow((d - 0.08) / 0.92, 0.55));
    } else {
      isLand = true;
      const hgt = clamp01((e - sea) * 4);
      const m = moist[i];
      // Deserts cluster in the subtropics (~15–35°), like on the real planet.
      const subtropic = smooth(0.1, 0.2, absLat) * (1 - smooth(0.38, 0.5, absLat));
      const dry = clamp01(smooth(0.05, -0.2, m) * (0.35 + subtropic));
      c = mix(mix(forest, grass, smooth(-0.1, 0.25, m) * 0.5 + hgt * 0.4), desert, dry);
      c = mix(c, rock, smooth(0.45, 0.85, hgt) * 0.7);
      c = mix(c, tundra, smooth(0.62, 0.75, absLat));
      if (hgt > 0.82 && absLat > 0.3) c = mix(c, ice, smooth(0.82, 0.95, hgt));
      if (dry < 0.6) {
        const lv = smooth(0.18, 0.45, city[i]) * (1 - smooth(0.55, 0.7, absLat)) * (1 - dry * 0.8);
        lights[i] = Math.round(lv * 255);
      }
    }
    const capEdge = 0.82 + moist[i] * 0.08;
    if (absLat > capEdge) c = mix(c, ice, smooth(capEdge, capEdge + 0.04, absLat));
    if (!isLand) lights[i] = 0;
    const o = i * 4;
    color[o] = c[0];
    color[o + 1] = c[1];
    color[o + 2] = c[2];
    color[o + 3] = 255;
    clouds[i] = Math.round(Math.pow(smooth(cloudThr, cloudThr + 0.3, cloud[i]), 1.4) * 205);
  }
  return { kind: 'earth', w, h, color, clouds, lights };
}

export function marsTexture(w = 1024, h = 512): PlanetTexture {
  const nBase = makeNoise(101), nAlb = makeNoise(211), nWarp = makeNoise(307);
  const N = w * h;
  const base = new Float32Array(N), alb = new Float32Array(N), lats = new Float32Array(N);
  const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
  forEachTexel(w, h, (i, x, y, z, lat) => {
    const q = fbm(nWarp, x * 1.5, y * 1.5, z * 1.5, 3);
    base[i] = fbm(nBase, x * 2.8 + q, y * 2.8, z * 2.8 - q, 6);
    alb[i] = fbm(nAlb, x * 1.2 + q * 0.8, y * 1.6, z * 1.2, 4);
    lats[i] = lat;
    px[i] = x;
    py[i] = y;
    pz[i] = z;
  });
  const darkThr = percentile(alb, 0.28);

  // Craters: random directions on the sphere, mostly small, a few large.
  const r = rng(909);
  const craters: { x: number; y: number; z: number; cosOuter: number; rad: number; lat: number }[] = [];
  for (let k = 0; k < 220; k++) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const rad = 0.008 + Math.pow(r(), 3.2) * 0.075;
    craters.push({ x: s * Math.cos(th), y: u, z: s * Math.sin(th), rad, cosOuter: Math.cos(rad * 1.25), lat: Math.asin(u) });
  }

  const dust: RGB = [206, 118, 70], ochre: RGB = [172, 88, 52], basalt: RGB = [88, 50, 38], cap: RGB = [236, 226, 214];
  const color = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    let c = mix(dust, ochre, smooth(-0.25, 0.3, base[i]));
    c = mix(c, basalt, smooth(darkThr + 0.04, darkThr - 0.12, alb[i]) * 0.72);
    let shade = 1;
    for (const k of craters) {
      if (Math.abs(lats[i] - k.lat) > k.rad * 1.25) continue; // cheap latitude-band reject
      const d =px[i] * k.x + py[i] * k.y + pz[i] * k.z;
      if (d < k.cosOuter) continue;
      const t = Math.acos(Math.min(1, d)) / k.rad;
      if (t < 0.85) shade *= 0.86 + t * 0.08;
      else if (t < 1.1) shade *= 1.1;
      else shade *= 1 - (1.25 - t) * 0.15;
    }
    c = [c[0] * shade, c[1] * shade, c[2] * shade];
    const lat = lats[i] / (Math.PI / 2);
    const capN = 0.86 + base[i] * 0.1, capS = -0.9 - base[i] * 0.06;
    if (lat > capN) c = mix(c, cap, smooth(capN, capN + 0.04, lat));
    if (lat < capS) c = mix(c, cap, smooth(capS, capS - 0.04, lat));
    const o = i * 4;
    color[o] = c[0];
    color[o + 1] = c[1];
    color[o + 2] = c[2];
    color[o + 3] = 255;
  }
  return { kind: 'mars', w, h, color };
}
