import { useEffect, useRef } from 'react';

/**
 * The hero's sky, behind every page: glowing star sprites that twinkle, a faint
 * nebula band, a gentle parallax on scroll and an occasional shooting star.
 * One fixed canvas, about 30 frames a second, paused when the tab is hidden.
 */

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
      grad.addColorStop(0, `rgba(${col},${0.025 + rnd() * 0.03})`);
      grad.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }
  }
  return c;
}

interface Star { x: number; y: number; s: number; a: number; c: number; tw: number; ph: number; d: number }

export default function StarField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    document.documentElement.classList.add('has-starfield');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sprites = [sprite('232,238,255'), sprite('190,210,255'), sprite('255,226,200')];
    let w = 0, h = 0, dpr = 1, raf = 0, last = 0;
    let stars: Star[] = [];
    let neb: HTMLCanvasElement | null = null;
    let meteor: null | { x: number; y: number; vx: number; vy: number; life: number } = null;
    let nextMeteor = 4000 + Math.random() * 6000;

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
      const n = Math.round(Math.min(520, (w * h) / 3200));
      stars = Array.from({ length: n }, () => {
        const big = rnd() < 0.07;
        return {
          x: rnd(), y: rnd() * 1.2,
          s: big ? 1.6 + rnd() * 1.4 : 0.5 + rnd() * 0.9,
          a: big ? 0.75 + rnd() * 0.25 : 0.25 + rnd() * 0.5,
          c: rnd() < 0.6 ? 0 : rnd() < 0.6 ? 1 : 2,
          tw: 0.6 + rnd() * 2.2, ph: rnd() * Math.PI * 2,
          d: 0.2 + rnd() * 0.8,
        };
      });
      neb = nebula(w, h);
    };

    const draw = (time: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (neb) ctx.drawImage(neb, 0, 0, w, h);
      const scroll = window.scrollY;
      for (const s of stars) {
        const tw = reduced ? 1 : 0.6 + 0.4 * Math.sin(time * 0.001 * s.tw + s.ph);
        // farther stars drift less as the page scrolls: a gentle depth effect
        let y = (s.y * h - scroll * 0.04 * s.d) % (h * 1.2);
        if (y < -10) y += h * 1.2;
        ctx.globalAlpha = s.a * tw;
        const size = s.s * 4;
        ctx.drawImage(sprites[s.c], s.x * w - size / 2, y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      if (reduced) return;
      if (!meteor && time > nextMeteor) {
        const fromLeft = Math.random() < 0.5;
        meteor = { x: fromLeft ? Math.random() * w * 0.3 : w * (0.7 + Math.random() * 0.3), y: Math.random() * h * 0.4, vx: (fromLeft ? 1 : -1) * (0.5 + Math.random() * 0.3), vy: 0.22 + Math.random() * 0.12, life: 0 };
        nextMeteor = time + 7000 + Math.random() * 9000;
      }
      if (meteor) {
        meteor.life += 16;
        const len = 90, k = Math.min(1, meteor.life / 200) * Math.max(0, 1 - meteor.life / 1100);
        const mx = meteor.x + meteor.vx * meteor.life, my = meteor.y + meteor.vy * meteor.life;
        const grad = ctx.createLinearGradient(mx, my, mx - meteor.vx * len, my - meteor.vy * len);
        grad.addColorStop(0, `rgba(235,240,255,${0.7 * k})`);
        grad.addColorStop(1, 'rgba(235,240,255,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx - meteor.vx * len, my - meteor.vy * len);
        ctx.stroke();
        if (meteor.life > 1100) meteor = null;
      }
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
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVis);
      document.documentElement.classList.remove('has-starfield');
    };
  }, []);

  return <canvas ref={ref} className="starfield" aria-hidden="true" />;
}
