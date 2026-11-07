import { useEffect, useRef } from 'react';

/**
 * The sky behind every page, in two moods that follow the theme toggle:
 *  - night (dark theme): the hero's stars, brighter and more varied, twinkling, with diffraction
 *    sparkles on the brightest ones, a faint nebula, scroll parallax and shooting stars;
 *  - day (light theme): the Sun just off the top corner, a slowly turning crown of rays, a pulsing
 *    corona, a lens flare and golden motes of light drifting upward.
 * One fixed canvas, about 30 frames a second, paused when the tab is hidden.
 */

const isDay = () => document.documentElement.dataset.theme === 'light';

function sprite(rgb: string) {
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

function nebula(w: number, h: number) {
  const scale = 0.4;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const g = c.getContext('2d')!;
  g.scale(scale, scale);
  let seed = 4321;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const palette = ['110,80,190', '70,100,210', '150,90,170', '60,130,200'];
  // two soft bands, one on each side, where wide screens have empty space
  for (const [x0, y0, x1, y1] of [[-0.05, 0.1, 0.25, 1.0], [0.78, 0.0, 1.08, 0.85]]) {
    for (let i = 0; i < 14; i++) {
      const t = rnd();
      const x = (x0 + (x1 - x0) * t) * w + (rnd() - 0.5) * w * 0.12;
      const y = (y0 + (y1 - y0) * t) * h + (rnd() - 0.5) * h * 0.2;
      const r = (0.1 + rnd() * 0.18) * Math.max(w, h);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const col = palette[i % palette.length];
      grad.addColorStop(0, `rgba(${col},${0.03 + rnd() * 0.035})`);
      grad.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }
  }
  return c;
}

interface Star { x: number; y: number; s: number; a: number; c: number; tw: number; ph: number; d: number; big: boolean }
interface Mote { x: number; y: number; r: number; vy: number; vx: number; ph: number; a: number }

export default function StarField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    document.documentElement.classList.add('has-starfield');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sprites = [sprite('232,238,255'), sprite('190,210,255'), sprite('255,226,200'), sprite('255,200,170')];
    const gold = sprite('255,196,110');
    let w = 0, h = 0, dpr = 1, raf = 0, last = 0;
    let stars: Star[] = [];
    let motes: Mote[] = [];
    let neb: HTMLCanvasElement | null = null;
    let meteor: null | { x: number; y: number; vx: number; vy: number; life: number } = null;
    let nextMeteor = 3000 + Math.random() * 4000;

    const build = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      let seed = 97;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const n = Math.round(Math.min(760, (w * h) / 2300));
      stars = Array.from({ length: n }, () => {
        const big = rnd() < 0.08;
        return {
          x: rnd(), y: rnd() * 1.2,
          s: big ? 1.8 + rnd() * 1.6 : 0.5 + rnd() * 1.0,
          a: big ? 0.8 + rnd() * 0.2 : 0.3 + rnd() * 0.55,
          c: rnd() < 0.55 ? 0 : rnd() < 0.55 ? 1 : rnd() < 0.7 ? 2 : 3,
          tw: 0.5 + rnd() * 2.6, ph: rnd() * Math.PI * 2,
          d: 0.2 + rnd() * 0.8, big,
        };
      });
      motes = Array.from({ length: Math.round(Math.min(90, (w * h) / 16000)) }, () => ({
        x: rnd() * w, y: rnd() * h, r: 1.5 + rnd() * 3.5,
        vy: -(0.08 + rnd() * 0.25), vx: (rnd() - 0.5) * 0.12, ph: rnd() * Math.PI * 2, a: 0.25 + rnd() * 0.45,
      }));
      neb = nebula(w, h);
    };

    const drawNight = (time: number) => {
      if (neb) ctx.drawImage(neb, 0, 0, w, h);
      const scroll = window.scrollY;
      for (const s of stars) {
        const wave = Math.sin(time * 0.001 * s.tw + s.ph);
        const tw = reduced ? 1 : 0.5 + 0.5 * (0.5 + 0.5 * wave) + (s.big ? 0.15 * wave : 0);
        // farther stars drift less as the page scrolls: a gentle depth effect
        let y = (s.y * h - scroll * 0.04 * s.d) % (h * 1.2);
        if (y < -10) y += h * 1.2;
        const x = s.x * w;
        ctx.globalAlpha = Math.min(1, s.a * tw);
        const size = s.s * 4.2;
        ctx.drawImage(sprites[s.c], x - size / 2, y - size / 2, size, size);
        // soft diffraction sparkle on the brightest stars as they peak
        if (s.big && !reduced && wave > 0.6) {
          const k = (wave - 0.6) / 0.4;
          const len = s.s * (3 + 4 * k);
          ctx.globalAlpha = 0.4 * k * s.a;
          for (const [dx, dy] of [[1, 0], [0, 1]]) {
            const g = ctx.createLinearGradient(x - dx * len, y - dy * len, x + dx * len, y + dy * len);
            g.addColorStop(0, 'rgba(235,240,255,0)');
            g.addColorStop(0.5, 'rgba(235,240,255,1)');
            g.addColorStop(1, 'rgba(235,240,255,0)');
            ctx.strokeStyle = g;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(x - dx * len, y - dy * len);
            ctx.lineTo(x + dx * len, y + dy * len);
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
      if (reduced) return;
      if (!meteor && time > nextMeteor) {
        const fromLeft = Math.random() < 0.5;
        meteor = { x: fromLeft ? Math.random() * w * 0.3 : w * (0.7 + Math.random() * 0.3), y: Math.random() * h * 0.4, vx: (fromLeft ? 1 : -1) * (0.55 + Math.random() * 0.3), vy: 0.24 + Math.random() * 0.12, life: 0 };
        nextMeteor = time + 5000 + Math.random() * 7000;
      }
      if (meteor) {
        meteor.life += 33;
        const len = 120, k = Math.min(1, meteor.life / 200) * Math.max(0, 1 - meteor.life / 1100);
        const mx = meteor.x + meteor.vx * meteor.life, my = meteor.y + meteor.vy * meteor.life;
        const grad = ctx.createLinearGradient(mx, my, mx - meteor.vx * len, my - meteor.vy * len);
        grad.addColorStop(0, `rgba(240,244,255,${0.85 * k})`);
        grad.addColorStop(1, 'rgba(235,240,255,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx - meteor.vx * len, my - meteor.vy * len);
        ctx.stroke();
        if (meteor.life > 1100) meteor = null;
      }
    };

    const drawDay = (time: number) => {
      // the Sun sits just off the top-right corner, the side the hero planets are lit from
      const sx = w * 0.96, sy = -h * 0.06;
      const R = Math.max(w, h);
      const pulse = reduced ? 1 : 1 + 0.04 * Math.sin(time * 0.0012);
      // warm sky wash
      const wash = ctx.createRadialGradient(sx, sy, 0, sx, sy, R * 0.9);
      wash.addColorStop(0, 'rgba(255,214,150,0.55)');
      wash.addColorStop(0.25, 'rgba(255,190,120,0.22)');
      wash.addColorStop(0.6, 'rgba(255,170,110,0.06)');
      wash.addColorStop(1, 'rgba(255,170,110,0)');
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, w, h);
      // crown of rays, turning very slowly
      const rot = reduced ? 0 : time * 0.00003;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(rot);
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        const spread = i % 2 ? 0.035 : 0.06;
        const len = R * (i % 3 ? 0.75 : 1.05);
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, len);
        grad.addColorStop(0, `rgba(255,214,150,${i % 2 ? 0.16 : 0.26})`);
        grad.addColorStop(1, 'rgba(255,220,160,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, len, a - spread, a + spread);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      // corona and disc
      const core = ctx.createRadialGradient(sx, sy, 0, sx, sy, 190 * pulse);
      core.addColorStop(0, 'rgba(255,253,240,1)');
      core.addColorStop(0.25, 'rgba(255,236,190,0.9)');
      core.addColorStop(0.55, 'rgba(255,200,120,0.35)');
      core.addColorStop(1, 'rgba(255,190,110,0)');
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(sx, sy, 190 * pulse, 0, Math.PI * 2);
      ctx.fill();
      // lens flare: soft rings along the line from the Sun through the screen centre
      const cx = w / 2, cy = h / 2;
      const flares: [number, number, string][] = [[0.35, 26, '255,210,150'], [0.6, 14, '180,210,255'], [0.85, 42, '255,190,140'], [1.15, 20, '200,170,255']];
      for (const [t, r, col] of flares) {
        const fx = sx + (cx - sx) * t, fy = sy + (cy - sy) * t;
        const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, r);
        g.addColorStop(0, `rgba(${col},0.12)`);
        g.addColorStop(0.7, `rgba(${col},0.07)`);
        g.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(fx, fy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // golden motes drifting up through the light
      for (const m of motes) {
        if (!reduced) {
          m.y += m.vy * 2;
          m.x += m.vx * 2 + Math.sin(time * 0.0006 + m.ph) * 0.15;
          if (m.y < -10) { m.y = h + 10; m.x = Math.random() * w; }
        }
        ctx.globalAlpha = m.a * (0.6 + 0.4 * Math.sin(time * 0.0015 + m.ph));
        const size = m.r * 4;
        ctx.drawImage(gold, m.x - size / 2, m.y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    };

    const draw = (time: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (isDay()) drawDay(time);
      else drawNight(time);
    };

    const loop = (time: number) => {
      raf = requestAnimationFrame(loop);
      if (time - last < 33) return; // ~30 fps is plenty for a background
      last = time;
      draw(time);
    };

    build();
    draw(0);
    if (!reduced) raf = requestAnimationFrame(loop);
    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => { build(); draw(performance.now()); }, 150);
    };
    const onScroll = () => { if (reduced) draw(0); };
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduced) raf = requestAnimationFrame(loop);
    };
    // redraw at once when the theme or the language direction changes
    const observer = new MutationObserver(() => draw(performance.now()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'dir'] });
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVis);
      document.documentElement.classList.remove('has-starfield');
    };
  }, []);

  return <canvas ref={ref} className="starfield" aria-hidden="true" />;
}
