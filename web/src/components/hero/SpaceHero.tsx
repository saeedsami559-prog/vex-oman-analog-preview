import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { earthMarsDistanceKm, earthMoonDistanceKm, LIGHT_KM_S } from '../../lib/orbits';
import { PlanetRenderer, type PlanetStyle } from './PlanetRenderer';
import type { PlanetTexture } from './planetTextures';

type Body = 'earth' | 'mars' | 'moon';
const BODIES: Body[] = ['earth', 'mars', 'moon'];

// Textures are generated once per page load, off the main thread, low-res first then sharp.
const textures: Partial<Record<Body, PlanetTexture>> = {};
const listeners: Record<Body, Set<(t: PlanetTexture) => void>> = { earth: new Set(), mars: new Set(), moon: new Set() };
const started = new Set<Body>();

function publish(kind: Body, tex: PlanetTexture) {
  if (textures[kind] && textures[kind]!.w >= tex.w) return;
  textures[kind] = tex;
  listeners[kind].forEach((fn) => fn(tex));
}

function watchTexture(kind: Body, fn: (t: PlanetTexture) => void): () => void {
  listeners[kind].add(fn);
  if (textures[kind]) fn(textures[kind]!);
  if (!started.has(kind)) {
    started.add(kind);
    const fallback = () =>
      import('./planetTextures').then((m) => publish(kind, kind === 'earth' ? m.earthTexture() : kind === 'mars' ? m.marsTexture() : m.moonTexture()));
    try {
      const worker = new Worker(new URL('./textureWorker.ts', import.meta.url), { type: 'module' });
      let got = 0;
      worker.onmessage = (e: MessageEvent<PlanetTexture>) => {
        publish(kind, e.data);
        if (++got === 2) worker.terminate();
      };
      worker.onerror = () => {
        worker.terminate();
        void fallback();
      };
      worker.postMessage(kind);
    } catch {
      void fallback();
    }
  }
  return () => listeners[kind].delete(fn);
}

const DEG = Math.PI / 180;
const STYLES: Record<Body, PlanetStyle> = {
  earth: { tilt: 23.4 * DEG, pitch: 0.2, atmo: [70, 140, 255], atmoStrength: 0.8, glow: [80, 150, 255], glowAlpha: 0.4, ambient: 0.035 },
  mars: { tilt: -25.2 * DEG, pitch: 0.12, atmo: [235, 150, 110], atmoStrength: 0.35, glow: [235, 140, 95], glowAlpha: 0.2, ambient: 0.03 },
  moon: { tilt: 6.7 * DEG, pitch: 0.05, atmo: [200, 205, 215], atmoStrength: 0.04, glow: [200, 210, 235], glowAlpha: 0.1, ambient: 0.02 },
};
const SPIN: Record<Body, number> = { earth: 1 / 90, mars: 1 / 120, moon: 1 / 160 }; // turns per second
/** One trip of the Moon around Earth in the hero, seconds (the real one takes 27.3 days). */
const ORBIT_S = 48;
const DEPTH = { stars: 5, nebula: 9, mars: 12, moon: 16, earth: 22 }; // parallax in px

interface Star { x: number; y: number; s: number; a: number; tw: number; ph: number; d: number; c: number }
interface Disc { x: number; y: number; r: number }

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function makeSprite(rgb: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, `rgba(${rgb},1)`);
  grad.addColorStop(0.18, `rgba(${rgb},0.85)`);
  grad.addColorStop(0.45, `rgba(${rgb},0.18)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return c;
}

function makeNebula(w: number, h: number) {
  const scale = 0.5;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round((w + 60) * scale));
  c.height = Math.max(1, Math.round((h + 60) * scale));
  const g = c.getContext('2d')!;
  g.scale(scale, scale);
  let seed = 1234;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const palette = ['110,80,190', '70,100,210', '150,90,170', '60,130,200'];
  // A soft galactic band running diagonally behind the planets
  const x0 = w * 0.3, y0 = h + 60, x1 = w * 1.05, y1 = -40;
  for (let i = 0; i < 28; i++) {
    const t = rnd();
    const off = (rnd() - 0.5) * h * 0.35;
    const x = x0 + (x1 - x0) * t + off * 0.6, y = y0 + (y1 - y0) * t + off;
    const r = (0.08 + rnd() * 0.16) * Math.max(w, h);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const col = palette[i % palette.length];
    grad.addColorStop(0, `rgba(${col},${0.035 + rnd() * 0.04})`);
    grad.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, w + 60, h + 60);
  }
  for (let i = 0; i < 900; i++) {
    const t = rnd();
    const off = (rnd() + rnd() + rnd() - 1.5) * h * 0.22;
    g.fillStyle = `rgba(220,225,255,${0.08 + rnd() * 0.25})`;
    g.fillRect(x0 + (x1 - x0) * t + off * 0.6, y0 + (y1 - y0) * t + off, 1.2, 1.2);
  }
  // distant sun glare in the top corner, warm and low-key
  const sun = g.createRadialGradient(w * 1.02, -h * 0.04, 0, w * 1.02, -h * 0.04, h * 0.6);
  sun.addColorStop(0, 'rgba(255,238,215,0.2)');
  sun.addColorStop(0.3, 'rgba(255,214,170,0.06)');
  sun.addColorStop(1, 'rgba(255,214,170,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, w + 60, h + 60);
  return c;
}

function layout(w: number, h: number, rtl: boolean): Record<Body, Disc> {
  let earth: Disc, mars: Disc;
  if (w >= 900) {
    const R = Math.min(h * 0.3, w * 0.16, 250);
    earth = { x: w * 0.64, y: h * 0.6, r: R };
    mars = { x: w * 0.9, y: h * 0.21, r: R * 0.5 };
  } else {
    const R = Math.min(112, w * 0.26);
    earth = { x: w * 0.36, y: 190, r: R };
    mars = { x: w * 0.79, y: 120, r: R * 0.55 };
  }
  if (rtl) {
    earth.x = w - earth.x;
    mars.x = w - mars.x;
  }
  // The Moon orbits Earth; its size is the real Moon/Earth ratio (0.27). Its position is set per frame.
  const moon = { x: earth.x, y: earth.y, r: Math.max(9, earth.r * 0.27) };
  return { earth, mars, moon };
}

/** Moon position on a tilted orbit around Earth whose long axis points toward Mars; z > 0 is in front of Earth. */
function moonOrbit(earth: Disc, mars: Disc, moonR: number, angle: number) {
  const dx = mars.x - earth.x, dy = mars.y - earth.y, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const gap = len - earth.r - mars.r;
  const a = Math.max(earth.r + moonR * 1.6, Math.min(earth.r * 1.42, earth.r + gap - moonR * 1.2));
  const b = a * 0.3;
  const c = Math.cos(angle), sn = Math.sin(angle);
  return { x: earth.x + ux * a * c + nx * b * sn, y: earth.y + uy * a * c + ny * b * sn, z: sn, a, b, ux, uy, nx, ny };
}

function bezier(p0: number, c: number, p1: number, t: number) {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * c + t * t * p1;
}

export default function SpaceHero({ earthSites, marsTargets, moonAnalogs }: { earthSites: number; marsTargets: number; moonAnalogs: number }) {
  const { t, dir } = useI18n();
  const navigate = useNavigate();
  const heroRef = useRef<HTMLElement>(null);
  const spaceRef = useRef<HTMLCanvasElement>(null);
  const earthRef = useRef<HTMLCanvasElement>(null);
  const marsRef = useRef<HTMLCanvasElement>(null);
  const moonRef = useRef<HTMLCanvasElement>(null);
  const earthTagRef = useRef<HTMLButtonElement>(null);
  const marsTagRef = useRef<HTMLAnchorElement>(null);
  const moonTagRef = useRef<HTMLAnchorElement>(null);
  const dirRef = useRef(dir);
  const relayoutRef = useRef<() => void>(() => {});
  const tagHover = useRef<Body | null>(null);
  const [interacted, setInteracted] = useState(false);

  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const goSites = () => document.getElementById('sites')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  const goMars = () => navigate('/explorer');
  const goMoon = () => navigate('/atlas?rank=moon');
  const actions = useRef({ earth: goSites, mars: goMars, moon: goMoon });
  actions.current = { earth: goSites, mars: goMars, moon: goMoon };

  useEffect(() => {
    dirRef.current = dir;
    relayoutRef.current();
  }, [dir]);

  useEffect(() => {
    const hero = heroRef.current!, space = spaceRef.current!;
    const sctx = space.getContext('2d')!;
    const canvases: Record<Body, HTMLCanvasElement> = { earth: earthRef.current!, mars: marsRef.current!, moon: moonRef.current! };
    const tags: Record<Body, HTMLElement> = { earth: earthTagRef.current!, mars: marsTagRef.current!, moon: moonTagRef.current! };
    const renderers: Record<Body, PlanetRenderer> = {
      earth: new PlanetRenderer(canvases.earth, STYLES.earth),
      mars: new PlanetRenderer(canvases.mars, STYLES.mars),
      moon: new PlanetRenderer(canvases.moon, STYLES.moon),
    };
    const sprites = [makeSprite('232,238,255'), makeSprite('190,210,255'), makeSprite('255,226,200')];
    const probeSprite = makeSprite('255,236,214');

    const st = {
      w: 0, h: 0, dpr: 1,
      discs: layout(1, 1, false),
      nebula: null as HTMLCanvasElement | null,
      orbit: 0.9, // Moon orbit angle, radians
      moonPos: { x: 0, y: 0, z: 1 },
      stars: [] as Star[],
      px: 0, py: 0, tpx: 0, tpy: 0,
      rot: { earth: 0.32, mars: 0.6, moon: 0.1 } as Record<Body, number>,
      vel: { earth: SPIN.earth * (reduced ? 0 : 14), mars: SPIN.mars * (reduced ? 0 : 14), moon: SPIN.moon * (reduced ? 0 : 14) } as Record<Body, number>,
      clouds: 0.1,
      hover: null as Body | null,
      glow: { earth: 0, mars: 0, moon: 0 } as Record<Body, number>,
      fade: { earth: 0, mars: 0, moon: 0 } as Record<Body, number>,
      readyAt: { earth: 0, mars: 0, moon: 0 } as Record<Body, number>,
      drag: null as null | { body: Body; id: number; x0: number; y0: number; lastX: number; lastT: number; moved: boolean },
      dirty: { earth: true, mars: true, moon: true } as Record<Body, boolean>,
      lastRot: { earth: -1, mars: -1, moon: -1 } as Record<Body, number>,
      frame: 0,
      visible: true,
      meteor: null as null | { x: number; y: number; vx: number; vy: number; life: number },
      nextMeteor: performance.now() + 6000,
    };

    const resize = () => {
      const rect = hero.getBoundingClientRect();
      st.w = rect.width;
      st.h = rect.height;
      st.dpr = Math.min(window.devicePixelRatio || 1, 2);
      space.width = Math.round(st.w * st.dpr);
      space.height = Math.round(st.h * st.dpr);
      st.nebula = makeNebula(st.w, st.h);
      let seed = 42;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const count = Math.min(560, Math.round((st.w * st.h) / 2300));
      st.stars = Array.from({ length: count }, () => {
        const k = rnd();
        return {
          x: rnd(), y: rnd(),
          s: k < 0.72 ? 0.5 + rnd() * 0.5 : k < 0.96 ? 0.9 + rnd() * 0.6 : 1.5 + rnd() * 0.7,
          a: 0.35 + rnd() * 0.55, tw: 0.4 + rnd() * 1.3, ph: rnd() * 6.28, d: 0.2 + rnd() * 0.8,
          c: rnd() < 0.7 ? 0 : rnd() < 0.6 ? 1 : 2,
        };
      });
      relayout();
    };

    const placeMoon = () => {
      const m = moonOrbit(st.discs.earth, st.discs.mars, st.discs.moon.r, st.orbit);
      st.moonPos = { x: m.x, y: m.y, z: m.z };
      st.discs.moon.x = m.x;
      st.discs.moon.y = m.y;
    };

    const relayout = () => {
      if (!st.w) return;
      st.discs = layout(st.w, st.h, dirRef.current === 'rtl');
      placeMoon();
      const pr = Math.min(st.dpr, 1.6);
      for (const b of BODIES) {
        const d = st.discs[b];
        renderers[b].resize(Math.min(d.r * 2 * pr, b === 'earth' ? 720 : b === 'mars' ? 400 : 240));
        const css = d.r * 2 * 1.4; // canvas includes 20% halo padding on each side
        const c = canvases[b];
        c.style.width = c.style.height = `${css}px`;
        // the Moon moves every frame: it is placed with a transform from the origin instead
        c.style.left = `${b === 'moon' ? -css / 2 : d.x - css / 2}px`;
        c.style.top = `${b === 'moon' ? -css / 2 : d.y - css / 2}px`;
        st.dirty[b] = true;
      }
    };
    relayoutRef.current = relayout;

    const unwatch = BODIES.map((b) =>
      watchTexture(b, (tex) => {
        renderers[b].setTexture(tex);
        st.dirty[b] = true;
      }),
    );

    const offset = (b: Body) => ({ x: st.px * DEPTH[b], y: st.py * DEPTH[b] });
    const hit = (x: number, y: number): Body | null => {
      // the Moon is tested first while it is in front of Earth, last while it is behind
      const order: Body[] = st.moonPos.z >= 0 ? ['moon', 'earth', 'mars'] : ['earth', 'mars', 'moon'];
      for (const b of order) {
        const d = st.discs[b], o = offset(b);
        if (Math.hypot(x - d.x - o.x, y - d.y - o.y) < d.r * 1.03) return b;
      }
      return null;
    };
    const local = (e: PointerEvent) => {
      const r = hero.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onControl = (e: Event) => !!(e.target as Element).closest('a, button');

    const onMove = (e: PointerEvent) => {
      const p = local(e);
      if (e.pointerType === 'mouse') {
        st.tpx = (p.x / st.w - 0.5) * 2;
        st.tpy = (p.y / st.h - 0.5) * 2;
      }
      if (st.drag && e.pointerId === st.drag.id) {
        const d = st.discs[st.drag.body];
        const dx = p.x - st.drag.lastX;
        const now = performance.now();
        const step = dx / (Math.PI * 2 * d.r);
        st.rot[st.drag.body] += step;
        st.vel[st.drag.body] = step / Math.max(0.008, (now - st.drag.lastT) / 1000);
        st.drag.lastX = p.x;
        st.drag.lastT = now;
        if (Math.hypot(p.x - st.drag.x0, p.y - st.drag.y0) > 6) st.drag.moved = true;
        return;
      }
      st.hover = onControl(e) ? null : hit(p.x, p.y);
      hero.style.cursor = st.hover ? 'grab' : '';
    };
    const onDown = (e: PointerEvent) => {
      if (onControl(e) || e.button > 0) return;
      const p = local(e);
      const b = hit(p.x, p.y);
      if (!b) return;
      e.preventDefault();
      hero.setPointerCapture(e.pointerId);
      st.drag = { body: b, id: e.pointerId, x0: p.x, y0: p.y, lastX: p.x, lastT: performance.now(), moved: false };
      st.vel[b] = 0;
      hero.style.cursor = 'grabbing';
    };
    const onUp = (e: PointerEvent) => {
      const drag = st.drag;
      if (!drag || e.pointerId !== drag.id) return;
      st.drag = null;
      hero.style.cursor = st.hover ? 'grab' : '';
      if (performance.now() - drag.lastT > 80) st.vel[drag.body] = 0; // held still before release: no fling
      if (drag.moved) setInteracted(true);
      else actions.current[drag.body]();
    };
    const onLeave = () => {
      st.tpx = st.tpy = 0;
      if (!st.drag) st.hover = null;
    };
    hero.addEventListener('pointermove', onMove);
    hero.addEventListener('pointerdown', onDown);
    hero.addEventListener('pointerup', onUp);
    hero.addEventListener('pointercancel', onUp);
    hero.addEventListener('pointerleave', onLeave);

    const ro = new ResizeObserver(resize);
    ro.observe(hero);
    const io = new IntersectionObserver(([entry]) => (st.visible = entry.isIntersecting));
    io.observe(hero);

    const drawSpace = (time: number) => {
      const { w, h } = st;
      sctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
      sctx.clearRect(0, 0, w, h);
      if (st.nebula) sctx.drawImage(st.nebula, -30 + st.px * DEPTH.nebula, -30 + st.py * DEPTH.nebula, w + 60, h + 60);

      for (const s of st.stars) {
        const tw = reduced ? 1 : 0.72 + 0.28 * Math.sin(time * 0.001 * s.tw + s.ph);
        sctx.globalAlpha = s.a * tw;
        const x = s.x * w + st.px * DEPTH.stars * s.d, y = s.y * h + st.py * DEPTH.stars * s.d;
        const size = s.s * 4;
        sctx.drawImage(sprites[s.c], x - size / 2, y - size / 2, size, size);
      }
      sctx.globalAlpha = 1;

      // occasional, faint shooting star
      if (!reduced) {
        if (!st.meteor && time > st.nextMeteor) {
          const fromLeft = Math.random() < 0.5;
          st.meteor = { x: fromLeft ? w * (0.1 + Math.random() * 0.4) : w * (0.5 + Math.random() * 0.4), y: h * Math.random() * 0.3, vx: (fromLeft ? 1 : -1) * 0.55, vy: 0.22, life: 0 };
          st.nextMeteor = time + 14000 + Math.random() * 12000;
        }
        const m = st.meteor;
        if (m) {
          m.life += 16;
          const a = Math.sin(Math.min(1, m.life / 900) * Math.PI) * 0.55;
          const hx = m.x + m.vx * m.life, hy = m.y + m.vy * m.life;
          const grad = sctx.createLinearGradient(hx, hy, hx - m.vx * 140, hy - m.vy * 140);
          grad.addColorStop(0, `rgba(235,240,255,${a})`);
          grad.addColorStop(1, 'rgba(235,240,255,0)');
          sctx.strokeStyle = grad;
          sctx.lineWidth = 1.2;
          sctx.beginPath();
          sctx.moveTo(hx, hy);
          sctx.lineTo(hx - m.vx * 140, hy - m.vy * 140);
          sctx.stroke();
          if (m.life > 900) st.meteor = null;
        }
      }

      // the Moon's orbit around Earth: a faint dashed ellipse
      {
        const m = moonOrbit(st.discs.earth, st.discs.mars, st.discs.moon.r, 0);
        const oe = offset('earth');
        sctx.save();
        sctx.translate(st.discs.earth.x + oe.x, st.discs.earth.y + oe.y);
        sctx.rotate(Math.atan2(m.uy, m.ux));
        sctx.strokeStyle = 'rgba(200,210,235,0.22)';
        sctx.lineWidth = 1;
        sctx.setLineDash([3, 7]);
        sctx.beginPath();
        sctx.ellipse(0, 0, m.a, m.b, 0, 0, Math.PI * 2);
        sctx.stroke();
        sctx.setLineDash([]);
        sctx.restore();
      }

      // transfer arc Earth -> Mars, with a probe travelling along it
      const E = st.discs.earth, M = st.discs.mars, oe = offset('earth'), om = offset('mars');
      const ex = E.x + oe.x, ey = E.y + oe.y, mx = M.x + om.x, my = M.y + om.y;
      const dx = mx - ex, dy = my - ey, dist = Math.hypot(dx, dy) || 1;
      const ux = dx / dist, uy = dy / dist;
      let nx = uy, ny = -ux;
      if (ny > 0) {
        nx = -nx;
        ny = -ny;
      }
      const a0 = 0.55, a1 = 0.5;
      const sx = ex + (ux * Math.cos(a0) + nx * Math.sin(a0)) * E.r * 1.12;
      const sy = ey + (uy * Math.cos(a0) + ny * Math.sin(a0)) * E.r * 1.12;
      const tx = mx + (-ux * Math.cos(a1) + nx * Math.sin(a1)) * M.r * 1.3;
      const ty = my + (-uy * Math.cos(a1) + ny * Math.sin(a1)) * M.r * 1.3;
      const cx = (sx + tx) / 2 + nx * dist * 0.3, cy = (sy + ty) / 2 + ny * dist * 0.3;
      const hot = Math.max(st.glow.earth, st.glow.mars);
      const stroke = sctx.createLinearGradient(sx, sy, tx, ty);
      stroke.addColorStop(0, `rgba(63,182,168,${0.42 + hot * 0.3})`);
      stroke.addColorStop(1, `rgba(224,112,63,${0.5 + hot * 0.3})`);
      sctx.strokeStyle = stroke;
      sctx.lineWidth = 1.3;
      sctx.setLineDash([2, 8]);
      sctx.lineDashOffset = reduced ? 0 : -time * 0.012;
      sctx.beginPath();
      sctx.moveTo(sx, sy);
      sctx.quadraticCurveTo(cx, cy, tx, ty);
      sctx.stroke();
      sctx.setLineDash([]);

      const cycle = reduced ? 0.55 : ((time / 1000) % 12) / 12;
      const p = cycle < 0.5 ? 2 * cycle * cycle : 1 - Math.pow(-2 * cycle + 2, 2) / 2;
      const fade = reduced ? 1 : smooth(0, 0.06, p) * (1 - smooth(0.93, 1, p));
      for (let i = 10; i >= 0; i--) {
        const q = Math.max(0, p - i * 0.006);
        const px = bezier(sx, cx, tx, q), py = bezier(sy, cy, ty, q);
        sctx.globalAlpha = fade * (i === 0 ? 1 : 0.35 * (1 - i / 11));
        const size = i === 0 ? 16 : 6;
        sctx.drawImage(probeSprite, px - size / 2, py - size / 2, size, size);
      }
      sctx.globalAlpha = 1;
    };

    let raf = 0, last = performance.now();
    const loop = (time: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (time - last) / 1000);
      last = time;
      if (!st.visible || document.hidden || !st.w) return;
      st.frame++;
      const ease = Math.min(1, dt * 3);
      st.px += (st.tpx - st.px) * ease;
      st.py += (st.tpy - st.py) * ease;

      for (const b of BODIES) {
        if (st.drag?.body !== b) {
          const base = reduced ? 0 : SPIN[b];
          st.vel[b] += (base - st.vel[b]) * Math.min(1, dt * 0.9);
          st.rot[b] += st.vel[b] * dt;
        }
        const target = st.hover === b || tagHover.current === b ? 1 : 0;
        const g = st.glow[b] + (target - st.glow[b]) * Math.min(1, dt * 6);
        if (Math.abs(g - st.glow[b]) > 0.002) st.dirty[b] = true;
        st.glow[b] = g;
      }
      if (!reduced) st.clouds += (SPIN.earth * 1.25) * dt;
      // the Moon keeps orbiting unless the pointer is on it or it is being spun
      if (!reduced && st.hover !== 'moon' && tagHover.current !== 'moon' && st.drag?.body !== 'moon') {
        st.orbit = (st.orbit + (dt * Math.PI * 2) / ORBIT_S) % (Math.PI * 2);
      }
      placeMoon();

      drawSpace(time);

      for (const b of BODIES) {
        const r = renderers[b];
        const moved = Math.abs(st.rot[b] - st.lastRot[b]) > 1e-5;
        // planets turn slowly: 30 fps is plenty unless the user is spinning one
        if (r.ready && (st.dirty[b] || moved) && (st.drag?.body === b || st.frame % 2 === 0 || st.dirty[b])) {
          r.draw(st.rot[b], b === 'earth' ? st.clouds : 0, st.glow[b]);
          st.lastRot[b] = st.rot[b];
          st.dirty[b] = false;
        }
        if (r.ready && st.fade[b] < 1) {
          // wall-clock based, so a throttled frame rate can't leave a planet half-faded
          st.fade[b] = reduced ? 1 : Math.min(1, (time - (st.readyAt[b] ||= time)) / 1400);
          const f = st.fade[b];
          canvases[b].style.opacity = String(f * f * (3 - 2 * f));
        }
        const o = offset(b), d = st.discs[b];
        if (b === 'moon') {
          canvases.moon.style.transform = `translate3d(${d.x + o.x}px, ${d.y + o.y}px, 0)`;
          canvases.moon.style.zIndex = st.moonPos.z >= 0 ? '1' : '0';
        } else {
          canvases[b].style.transform = `translate3d(${o.x}px, ${o.y}px, 0)`;
        }
        // Earth's label sits below it, Mars's above it, the Moon's just below the Moon
        const ty = b === 'earth' ? d.y + d.r + 14 : b === 'moon' ? d.y + d.r + 8 : Math.max(10, d.y - d.r - 14 - tags[b].offsetHeight);
        const half = tags[b].offsetWidth / 2;
        const tx = Math.min(st.w - half - 10, Math.max(half + 10, d.x + o.x)); // keep the label inside the hero
        tags[b].style.transform = `translate3d(${tx}px, ${ty + o.y}px, 0) translateX(-50%)`;
        tags[b].classList.toggle('hot', st.glow[b] > 0.5);
      }
    };
    resize();
    raf = requestAnimationFrame(loop);

    return () => {
      unwatch.forEach((u) => u());
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      hero.removeEventListener('pointermove', onMove);
      hero.removeEventListener('pointerdown', onDown);
      hero.removeEventListener('pointerup', onUp);
      hero.removeEventListener('pointercancel', onUp);
      hero.removeEventListener('pointerleave', onLeave);
      relayoutRef.current = () => {};
    };
  }, [reduced]);

  const tagProps = (b: Body) => ({
    onPointerEnter: () => (tagHover.current = b),
    onPointerLeave: () => (tagHover.current = null),
    onFocus: () => (tagHover.current = b),
    onBlur: () => (tagHover.current = null),
  });

  return (
    <section className="space-hero" ref={heroRef} aria-labelledby="hero-title">
      <canvas className="space-bg" ref={spaceRef} aria-hidden="true" />
      <canvas className="planet" ref={marsRef} aria-hidden="true" />
      <canvas className="planet" ref={earthRef} aria-hidden="true" />
      <canvas className="planet moon" ref={moonRef} aria-hidden="true" />
      <button type="button" className="planet-tag" ref={earthTagRef} onClick={goSites} {...tagProps('earth')}>
        <span className="dot earth" />
        <strong>{t('body.earth')}</strong>
        <span className="tag-sub">{t('home.earthTag', { n: earthSites })}</span>
      </button>
      <Link to="/atlas?rank=moon" className="planet-tag moon-tag" ref={moonTagRef} {...tagProps('moon')}>
        <span className="dot moon" />
        <strong>{t('body.moon')}</strong>
        <span className="tag-sub">{t('home.moonTag', { n: moonAnalogs })}</span>
      </Link>
      <Link to="/explorer" className="planet-tag" ref={marsTagRef} {...tagProps('mars')}>
        <span className="dot mars" />
        <strong>{t('body.mars')}</strong>
        <span className="tag-sub">{t('home.marsTag', { n: marsTargets })}</span>
      </Link>

      <div className="space-hero-inner">
        <div className="space-copy">
          <p className="kicker chip" title={t('home.kicker')}>
            <span className="pulse" aria-hidden="true" />
            {t('home.kickerShort')}
          </p>
          <h1 id="hero-title">{t('home.heroTitle')}</h1>
          <p className="lead">{t('home.heroText')}</p>
          <div className="actions">
            <Link to="/explorer" className="btn primary">{t('home.ctaExplore')}</Link>
            <Link to="/methodology" className="btn ghost glass">{t('home.ctaMethod')}</Link>
          </div>
          <LiveDistance />
        </div>
      </div>

      <p className={`space-hint${interacted ? ' done' : ''}`} aria-hidden="true">{t('home.dragHint')}</p>
      <button type="button" className="scroll-cue" onClick={() => (document.getElementById('twin') ?? document.getElementById('sites'))?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' })} aria-label={t('home.scrollLabel')}>
        <span />
      </button>
    </section>
  );
}

function LiveDistance() {
  const { t, num } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const at = new Date(now), later = new Date(now + 3_600_000);
  const mars = earthMarsDistanceKm(at);
  const marsRate = (earthMarsDistanceKm(later) - mars) / 3600; // km/s
  const marsSecs = Math.round(mars / LIGHT_KM_S);
  const moon = earthMoonDistanceKm(at);
  const moonRate = ((earthMoonDistanceKm(later) - moon) / 3600) * 1000; // m/s
  return (
    <div className="ld-pair">
      <div className="live-distance">
        <div className="ld-head">
          <span>{t('home.liveDistance')}</span>
          <span className="ld-live"><i />{t('home.live')}</span>
        </div>
        <div className="ld-val">
          {num(Math.round(mars))} <small>{t('home.km')}</small>
        </div>
        <div className="ld-meta">
          <span>{t('home.lightDelay', { min: Math.floor(marsSecs / 60), sec: marsSecs % 60 })}</span>
          <span className={marsRate < 0 ? 'closing' : 'receding'}>
            {t(marsRate < 0 ? 'home.closing' : 'home.receding', { v: num(Math.abs(marsRate), 1) })}
          </span>
        </div>
      </div>
      <div className="live-distance moon">
        <div className="ld-head">
          <span>{t('home.liveMoon')}</span>
          <span className="ld-live"><i />{t('home.live')}</span>
        </div>
        <div className="ld-val">
          {num(Math.round(moon))} <small>{t('home.km')}</small>
        </div>
        <div className="ld-meta">
          <span>{t('home.moonDelay', { sec: num(moon / LIGHT_KM_S, 2) })}</span>
          <span className={moonRate < 0 ? 'closing' : 'receding'}>
            {t(moonRate < 0 ? 'home.moonClosing' : 'home.moonReceding', { v: num(Math.abs(moonRate), 0) })}
          </span>
        </div>
      </div>
    </div>
  );
}
