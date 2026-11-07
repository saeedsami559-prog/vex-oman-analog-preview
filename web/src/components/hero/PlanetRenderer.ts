import type { PlanetTexture } from './planetTextures';

export interface PlanetStyle {
  tilt: number; // axial tilt in the image plane, radians
  pitch: number; // north pole tipped toward the viewer, radians
  atmo: [number, number, number]; // rim-scatter colour
  atmoStrength: number;
  glow: [number, number, number]; // outer halo colour
  glowAlpha: number;
  ambient: number; // how visible the night side is
}

/** Sun direction in view space (x right, y up, z toward viewer): upper right, slightly in front. */
const SUN = (() => {
  const v = [0.72, 0.34, 0.6];
  const l = Math.hypot(v[0], v[1], v[2]);
  return v.map((c) => c / l) as [number, number, number];
})();

/**
 * Renders a textured, lit sphere into a canvas with a per-pixel lookup table:
 * the geometry (latitude, longitude, lighting) is precomputed once per size,
 * so each frame is only a texture fetch per pixel.
 */
export class PlanetRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private buf = document.createElement('canvas');
  private bctx: CanvasRenderingContext2D;
  private img: ImageData | null = null;
  private tex: PlanetTexture | null = null;
  private n = 0; // disk diameter in device px
  private pad = 0;
  private count = 0;
  private idx = new Int32Array(0);
  private lon = new Float32Array(0);
  private lat = new Float32Array(0);
  private rowOff = new Int32Array(0);
  private light = new Float32Array(0);
  private night = new Float32Array(0);
  private rim = new Float32Array(0);
  private edge = new Uint8Array(0);

  constructor(canvas: HTMLCanvasElement, private style: PlanetStyle) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.bctx = this.buf.getContext('2d')!;
  }

  get ready() {
    return this.tex !== null && this.n > 0;
  }

  setTexture(tex: PlanetTexture) {
    this.tex = tex;
    this.updateRows();
  }

  /** diameter in device pixels; returns the canvas size including halo padding. */
  resize(diameter: number): number {
    const n = Math.max(32, Math.round(diameter));
    if (n === this.n) return this.canvas.width;
    this.n = n;
    this.pad = Math.round(n * 0.2);
    this.canvas.width = this.canvas.height = n + this.pad * 2;
    this.buf.width = this.buf.height = n;
    this.img = this.bctx.createImageData(n, n);
    this.build();
    return this.canvas.width;
  }

  private build() {
    const n = this.n, r = n / 2;
    const { tilt, pitch, ambient } = this.style;
    const ct = Math.cos(tilt), st = Math.sin(tilt), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cap = n * n;
    const idx = new Int32Array(cap), lon = new Float32Array(cap), lat = new Float32Array(cap);
    const light = new Float32Array(cap), night = new Float32Array(cap), rim = new Float32Array(cap), edge = new Uint8Array(cap);
    let k = 0;
    for (let py = 0; py < n; py++) {
      for (let px = 0; px < n; px++) {
        let x = (px + 0.5 - r) / r;
        let y = -(py + 0.5 - r) / r;
        const d = Math.hypot(x, y);
        const a = Math.min(1, Math.max(0, (1 - d) * r + 0.5));
        if (a <= 0) continue;
        if (d > 1) {
          x /= d;
          y /= d;
        }
        const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
        const lambert = x * SUN[0] + y * SUN[1] + z * SUN[2];
        // view -> body: undo tilt (about view z) then pitch (about x)
        const x1 = x * ct + y * st;
        const y1 = -x * st + y * ct;
        const y2 = y1 * cp + z * sp;
        const z2 = -y1 * sp + z * cp;
        idx[k] = (py * n + px) * 4;
        lon[k] = Math.atan2(x1, z2) / (Math.PI * 2) + 0.5;
        lat[k] = 0.5 - Math.asin(Math.max(-1, Math.min(1, y2))) / Math.PI;
        const day = Math.min(1, Math.max(0, lambert * 1.15 + 0.05));
        // limb darkening keeps the disc from looking flat
        light[k] = Math.max(ambient, Math.pow(day, 0.85) * (0.62 + 0.38 * Math.pow(z, 0.5)));
        night[k] = 1 - Math.min(1, Math.max(0, (lambert + 0.04) / 0.18));
        rim[k] = Math.pow(1 - z, 2.4) * (0.15 + 0.85 * Math.min(1, Math.max(0, lambert + 0.25)));
        edge[k] = Math.round(a * 255);
        k++;
      }
    }
    this.count = k;
    this.idx = idx.slice(0, k);
    this.lon = lon.slice(0, k);
    this.lat = lat.slice(0, k);
    this.light = light.slice(0, k);
    this.night = night.slice(0, k);
    this.rim = rim.slice(0, k);
    this.edge = edge.slice(0, k);
    this.updateRows();
  }

  private updateRows() {
    if (!this.tex || !this.count) return;
    const { w, h } = this.tex;
    const rows = new Int32Array(this.count);
    for (let k = 0; k < this.count; k++) rows[k] = Math.min(h - 1, (this.lat[k] * h) | 0) * w;
    this.rowOff = rows;
  }

  /** rot / cloudRot are in turns (0..1); highlight 0..1 brightens the halo on hover. */
  draw(rot: number, cloudRot: number, highlight: number) {
    const tex = this.tex, img = this.img;
    if (!tex || !img) return;
    const out = img.data;
    const { w, color, clouds, lights } = tex;
    const [ar, ag, ab] = this.style.atmo;
    const as = this.style.atmoStrength;
    const { idx, lon, rowOff, light, night, rim, edge, count } = this;
    const rr = rot - Math.floor(rot), cr = cloudRot - Math.floor(cloudRot);
    for (let k = 0; k < count; k++) {
      let u = lon[k] - rr;
      if (u < 0) u += 1;
      const ti = rowOff[k] + ((u * w) | 0);
      const t4 = ti * 4;
      const L = light[k];
      let r = color[t4] * L, g = color[t4 + 1] * L, b = color[t4 + 2] * L;
      let ca = 0;
      if (clouds) {
        let u2 = lon[k] - cr;
        if (u2 < 0) u2 += 1;
        ca = clouds[rowOff[k] + ((u2 * w) | 0)] / 255;
        const cl = 236 * L + 4;
        r += (cl - r) * ca;
        g += (cl + 2 - g) * ca;
        b += (cl + 8 - b) * ca;
      }
      if (lights) {
        const nl = lights[ti] * night[k] * (1 - ca * 0.85) * 0.9;
        r += nl;
        g += nl * 0.7;
        b += nl * 0.38;
      }
      const s = rim[k] * as;
      r += ar * s;
      g += ag * s;
      b += ab * s;
      const o = idx[k];
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = edge[k];
    }
    this.bctx.putImageData(img, 0, 0);

    const ctx = this.ctx, size = this.canvas.width, c = size / 2, R = this.n / 2;
    ctx.clearRect(0, 0, size, size);
    const [gr, gg, gb] = this.style.glow;
    const ga = this.style.glowAlpha * (1 + highlight * 0.7);
    // halo leans toward the sun so the lit limb glows more than the dark one
    const gx = c + SUN[0] * R * 0.12, gy = c - SUN[1] * R * 0.12;
    const halo = ctx.createRadialGradient(gx, gy, R * 0.92, gx, gy, R * (1.17 + highlight * 0.05));
    halo.addColorStop(0, `rgba(${gr},${gg},${gb},${ga})`);
    halo.addColorStop(0.35, `rgba(${gr},${gg},${gb},${ga * 0.35})`);
    halo.addColorStop(1, `rgba(${gr},${gg},${gb},0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(this.buf, this.pad, this.pad);
  }
}
