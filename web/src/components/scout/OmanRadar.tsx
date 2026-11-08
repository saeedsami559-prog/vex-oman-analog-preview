import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useI18n } from '../../i18n';
import { polygons, type Places } from '../../lib/places';
import type { ScoutCell } from '../../lib/scout';

/**
 * Game-style map of Oman over the drone screen: border, governorates, towns, every screening cell and the
 * drone. Mouse wheel zooms from the whole country down to a few km, drag pans, a click on a square flies
 * there. "M" (or the button) opens it full size; Esc closes it. North is up.
 */

interface Props {
  places: Places;
  cells: ScoutCell[];
  cellDeg: number;
  colorOf: (c: ScoutCell) => string;
  sel: ScoutCell;
  drone: { lat: number; lon: number; heading: number } | null;
  hereLabel: string | null;
  onPick: (c: ScoutCell) => void;
}

const MIN_K = 24; // pixels per degree: all of Oman
const MAX_K = 12000; // a few km across

export default function OmanRadar({ places, cells, cellDeg, colorOf, sel, drone, hereLabel, onPick }: Props) {
  const { t, lang } = useI18n();
  const ref = useRef<HTMLCanvasElement>(null);
  const [open, setOpen] = useState(false);
  const [k, setK] = useState(300);
  const [follow, setFollow] = useState(true);
  const [pan, setPan] = useState<{ lat: number; lon: number }>({ lat: sel.lat, lon: sel.lon });
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const me = drone ?? { lat: sel.lat, lon: sel.lon, heading: 0 };
  const center = follow ? me : pan;

  // keyboard: M toggles the big map, Esc closes it
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'm' || e.key === 'M') setOpen((o) => !o);
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => { if (open) setK((v) => Math.min(v, 140)); }, [open]);

  // wheel zoom, non-passive so the page does not scroll while zooming the map
  useEffect(() => {
    const c = ref.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      setK((v) => Math.max(MIN_K, Math.min(MAX_K, v * Math.pow(1.0018, -e.deltaY))));
    };
    c.addEventListener('wheel', wheel, { passive: false });
    return () => c.removeEventListener('wheel', wheel);
  }, []);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cos = Math.cos((center.lat * Math.PI) / 180);
    const X = (lon: number) => W / 2 + (lon - center.lon) * k * cos;
    const Y = (lat: number) => H / 2 - (lat - center.lat) * k;
    const path = (rings: [number, number][][]) => {
      g.beginPath();
      for (const ring of rings) ring.forEach(([lo, la], i) => (i ? g.lineTo(X(lo), Y(la)) : g.moveTo(X(lo), Y(la))));
    };

    // sea with a faint graticule
    const sea = g.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, Math.max(W, H));
    sea.addColorStop(0, '#11294a');
    sea.addColorStop(1, '#071222');
    g.fillStyle = sea;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(120,170,255,0.08)';
    g.lineWidth = 1;
    const step = k > 2500 ? 0.05 : k > 500 ? 0.25 : 1;
    for (let lo = Math.floor((center.lon - W / (2 * k * cos)) / step) * step; X(lo) < W; lo += step) { g.beginPath(); g.moveTo(X(lo), 0); g.lineTo(X(lo), H); g.stroke(); }
    for (let la = Math.floor((center.lat - H / (2 * k)) / step) * step; Y(la) > 0; la += step) { g.beginPath(); g.moveTo(0, Y(la)); g.lineTo(W, Y(la)); g.stroke(); }

    // land, then the screening cells tinted like the big map
    for (const poly of polygons(places.border)) {
      path(poly);
      g.fillStyle = '#3b3326';
      g.fill('evenodd');
    }
    const h = cellDeg / 2;
    g.globalAlpha = k < 700 ? 0.6 : 0.3;
    for (const cell of cells) {
      const x0 = X(cell.lon - h), x1 = X(cell.lon + h), y0 = Y(cell.lat + h), y1 = Y(cell.lat - h);
      if (x1 < 0 || x0 > W || y1 < 0 || y0 > H) continue;
      g.fillStyle = colorOf(cell);
      g.fillRect(x0, y0, x1 - x0 + 0.5, y1 - y0 + 0.5);
    }
    g.globalAlpha = 1;
    for (const poly of polygons(places.border)) {
      path(poly);
      g.strokeStyle = 'rgba(255,214,150,0.75)';
      g.lineWidth = 1.4;
      g.stroke();
    }
    g.setLineDash([4, 4]);
    g.strokeStyle = 'rgba(255,255,255,0.32)';
    g.lineWidth = 1;
    for (const gov of places.governorates) for (const poly of polygons(gov.geometry)) { path(poly); g.stroke(); }
    g.setLineDash([]);
    // selected cell
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2;
    g.strokeRect(X(sel.lon - h), Y(sel.lat + h), X(sel.lon + h) - X(sel.lon - h), Y(sel.lat - h) - Y(sel.lat + h));

    // labels: governorates zoomed out, towns by importance as you zoom in; no overlaps
    const boxes: [number, number, number, number][] = [];
    const dx = X(me.lon), dy = Y(me.lat);
    boxes.push([dx - 14, dy - 14, dx + 14, dy + 14]);
    const free = (x: number, y: number, w: number, hh: number) => !boxes.some(([a, b, c2, d]) => x < c2 && x + w > a && y < d && y + hh > b);
    const label = (txt: string, x: number, y: number, size: number, weight: number, fill: string, dot: boolean) => {
      g.font = `${weight} ${size}px system-ui, sans-serif`;
      const w = g.measureText(txt).width + 6;
      const bx = x + (dot ? 5 : -w / 2), by = y - size / 2 - 3;
      if (x < -60 || x > W + 60 || y < -10 || y > H + 10 || !free(bx, by, w, size + 6)) return;
      boxes.push([bx, by, bx + w, by + size + 6]);
      if (dot) { g.fillStyle = fill; g.beginPath(); g.arc(x, y, size > 11 ? 3.2 : 2.4, 0, Math.PI * 2); g.fill(); }
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(4,10,20,0.9)';
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.strokeText(txt, bx + 3, y);
      g.fillStyle = fill;
      g.fillText(txt, bx + 3, y);
    };
    if (k < 300) {
      for (const gov of places.governorates) label(lang === 'ar' ? gov.ar : gov.en, X(gov.lon), Y(gov.lat), open ? 12 : 10, 700, 'rgba(160,195,255,0.95)', false);
    }
    const minRank = k < 70 ? 3 : k < 260 ? 2 : k < 1100 ? 1 : 0;
    const big = open ? 1.15 : 1;
    for (const tw of places.towns) {
      if (tw[4] < minRank) continue;
      const name = lang === 'ar' ? tw[1] ?? tw[0] : tw[0];
      const major = tw[4] >= 3;
      label(name, X(tw[3]), Y(tw[2]), Math.round((major ? 12 : 10.5) * big), major ? 700 : 500, major ? '#ffe2a8' : '#e6edf7', true);
    }

    // the drone
    g.save();
    g.translate(dx, dy);
    g.rotate((me.heading * Math.PI) / 180);
    g.shadowColor = 'rgba(127,216,255,0.9)';
    g.shadowBlur = 10;
    g.fillStyle = '#7fd8ff';
    g.strokeStyle = '#04101f';
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -11); g.lineTo(7.5, 8); g.lineTo(0, 4); g.lineTo(-7.5, 8); g.closePath();
    g.fill(); g.stroke();
    g.restore();

    // scale bar and north
    const kmPx = k / 111.32;
    const nice = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500].find((v) => v * kmPx >= 40) ?? 500;
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillRect(10, H - 30, nice * kmPx, 3);
    g.font = '600 10px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText(`${nice} km`, 10, H - 38);
    g.textAlign = 'center';
    g.fillText('N', W / 2, 12);
  }, [places, cells, cellDeg, colorOf, sel, center.lat, center.lon, me.lat, me.lon, me.heading, k, lang, open]);

  const toLatLon = (cx: number, cy: number) => {
    const r = ref.current!.getBoundingClientRect();
    const cos = Math.cos((center.lat * Math.PI) / 180);
    return { lat: center.lat - (cy - r.top - r.height / 2) / k, lon: center.lon + (cx - r.left - r.width / 2) / (k * cos) };
  };
  const down = (e: RPointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: RPointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d || !e.buttons) return;
    const ddx = e.clientX - d.x, ddy = e.clientY - d.y;
    if (!d.moved && Math.hypot(ddx, ddy) < 4) return;
    d.moved = true;
    const cos = Math.cos((center.lat * Math.PI) / 180);
    setPan({ lat: center.lat + ddy / k, lon: center.lon - ddx / (k * cos) });
    setFollow(false);
    d.x = e.clientX; d.y = e.clientY;
  };
  const up = (e: RPointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && !d.moved) {
      const p = toLatLon(e.clientX, e.clientY);
      const h = cellDeg / 2;
      const cell = cells.find((x) => Math.abs(x.lat - p.lat) <= h && Math.abs(x.lon - p.lon) <= h);
      if (cell && cell.id !== sel.id) { onPick(cell); setFollow(true); setOpen(false); }
    }
  };

  return (
    <div className={`oman-radar ${open ? 'open' : ''}`}>
      <canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} aria-label={t('scout.radarLabel')} />
      <div className="radar-tools">
        <button type="button" title="+" onClick={() => setK((v) => Math.min(MAX_K, v * 1.6))}>+</button>
        <button type="button" title="−" onClick={() => setK((v) => Math.max(MIN_K, v / 1.6))}>−</button>
        {!follow && <button type="button" title={t('scout.radarFollow')} onClick={() => setFollow(true)}>◎</button>}
        <button type="button" title={open ? t('scout.radarClose') : t('scout.radarOpen')} onClick={() => setOpen((o) => !o)}>{open ? '✕' : '⤢'}</button>
      </div>
      {open && <p className="radar-hint">{t('scout.radarHint')}</p>}
      {hereLabel && <p className="radar-here"><i />{hereLabel}</p>}
    </div>
  );
}
