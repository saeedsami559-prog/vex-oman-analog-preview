import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { findSite, useDataset } from '../lib/data';
import { ranksFor, toKml, useCellLayers, useScoutGrid, type ScoutCell } from '../lib/scout';
import { clearLog, deleteFlight, loadLog, type FlightRecord } from '../lib/missionLog';
import AiExplain, { monthSpan } from '../components/scout/AiExplain';
import ContinueExploring from '../components/common/ContinueExploring';
import { describePlace, usePlaces } from '../lib/places';

const mmss = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

function useLog(): FlightRecord[] {
  const [log, setLog] = useState<FlightRecord[]>(loadLog);
  useEffect(() => {
    const re = () => setLog(loadLog());
    window.addEventListener('vex-log', re);
    window.addEventListener('storage', re);
    return () => {
      window.removeEventListener('vex-log', re);
      window.removeEventListener('storage', re);
    };
  }, []);
  return log;
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function Log() {
  const { t, num, lang, loc } = useI18n();
  const log = useLog();
  const places = usePlaces();
  const { grid } = useScoutGrid();
  const [openId, setOpenId] = useState<string | null>(null);
  const [cmp, setCmp] = useState<string[]>([]);
  const open = log.find((f) => f.id === openId) ?? log[0] ?? null;
  const date = (ms: number) => new Date(ms).toLocaleString(lang === 'ar' ? 'ar-OM' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const toggleCmp = (id: string) => setCmp((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c.slice(-1), id]));

  return (
    <div className="page log">
      <header className="scout-head">
        <p className="kicker">{t('log.kicker')}</p>
        <h1>{t('log.title')}</h1>
        <p className="lead">{t('log.lead')}</p>
        <p className="note small">{t('log.local')}</p>
      </header>

      {log.length === 0 ? (
        <section className="panel log-empty">
          <h2>{t('log.emptyTitle')}</h2>
          <p>{t('log.emptyText')}</p>
          <Link to="/scout" className="btn primary">{t('log.goFly')}</Link>
        </section>
      ) : (
        <div className="log-grid">
          <section className="panel log-list no-print">
            <h2>{t('log.flights', { n: num(log.length) })}</h2>
            <ul>
              {log.map((f) => (
                <li key={f.id} className={open?.id === f.id ? 'active' : ''}>
                  <button type="button" onClick={() => setOpenId(f.id)}>
                    <span className="log-when">{date(f.started)}</span>
                    <span className="log-place">{describePlace(places, f.lat, f.lon, t, loc) ?? ''}</span>
                    <span className="nowrap muted small" dir="ltr">{num(f.lat, 2)}° N, {num(f.lon, 2)}° E</span>
                    <span className="log-meta">
                      <span className={`dot ${f.body}`} /> {t(`scout.body_${f.body}`)} · {t(`log.mode_${f.mode}`)} · {mmss(f.droneSeconds)} · {num(f.distanceKm, 1)} km
                    </span>
                    {f.scan && <span className={`pill small v-${f.scan.verdict}`}>{t(`log.v_${f.scan.verdict}`)}</span>}
                  </button>
                  <label className="small cmp">
                    <input type="checkbox" checked={cmp.includes(f.id)} onChange={() => toggleCmp(f.id)} /> {t('log.compare')}
                  </label>
                </li>
              ))}
            </ul>
            <button type="button" className="btn small ghost" onClick={() => { if (window.confirm(t('log.clearConfirm'))) clearLog(); }}>{t('log.clear')}</button>
          </section>

          {open && <FlightReport f={open} cell={grid?.cells.find((c) => c.id === open.cellId) ?? null} date={date} />}
        </div>
      )}

      {cmp.length === 2 && grid && <Compare a={log.find((f) => f.id === cmp[0])!} b={log.find((f) => f.id === cmp[1])!} cells={grid.cells} />}

      <ContinueExploring from="log" />
    </div>
  );
}

function FlightReport({ f, cell, date }: { f: FlightRecord; cell: ScoutCell | null; date: (ms: number) => string }) {
  const { t, num, lang, loc } = useI18n();
  const data = useDataset();
  const places = usePlaces();
  const { grid } = useScoutGrid();
  const cellLayers = useCellLayers();
  const ranks = useMemo(() => (grid ? ranksFor(grid.cells, f.body) : new Map<string, number>()), [grid, f.body]);
  const site = grid?.sites.find((s) => s.cell === f.cellId);
  const siteObj = site ? findSite(data, site.id) : null;
  const pts = f.path.map((p) => [p.lat, p.lon] as [number, number]);
  const center: [number, number] = pts.length ? pts[Math.floor(pts.length / 2)] : [f.lat, f.lon];
  const env = cell?.env;

  return (
    <section className="panel log-report print-area">
      <div className="report-head">
        <div>
          <p className="kicker">{t('log.report')}</p>
          <h2>{describePlace(places, f.lat, f.lon, t, loc) ?? ''} · {t(`scout.body_${f.body}`)}</h2>
          <p className="muted small" dir="ltr">{num(f.lat, 4)}° N, {num(f.lon, 4)}° E</p>
          <p className="muted small">{date(f.started)} · VEX Scout · {f.cellId}{siteObj ? ` · ${loc(siteObj.name)}` : ''}</p>
        </div>
        <div className="report-actions no-print">
          <button type="button" className="btn small primary" onClick={() => window.print()}>{t('log.print')}</button>
          <button type="button" className="btn small ghost" onClick={() => download(`vex-scout-${f.cellId}.kml`, toKml(`VEX Scout ${f.cellId}`, f.path, f.markers), 'application/vnd.google-earth.kml+xml')} disabled={f.path.length < 2}>{t('scout.export')}</button>
          <button type="button" className="btn small ghost" onClick={() => { if (window.confirm(t('log.deleteConfirm'))) deleteFlight(f.id); }}>{t('log.delete')}</button>
        </div>
      </div>

      <div className="report-stats">
        <div><span>{t('log.sTime')}</span><strong>{mmss(f.droneSeconds)}</strong></div>
        <div><span>{t('log.sDist')}</span><strong>{num(f.distanceKm, 1)} km</strong></div>
        <div><span>{t('log.sMaxAgl')}</span><strong>{num(f.maxAglM)} m</strong></div>
        <div><span>{t('log.sWind')}</span><strong>{f.windMs != null ? `${num(f.windMs, 1)} m/s` : '–'}</strong></div>
        <div><span>{t('log.sPhotos')}</span><strong>{num(f.photos.length)}</strong></div>
        <div><span>{t('log.sLandings')}</span><strong>{num(f.landings)}</strong></div>
        <div><span>{t('log.sMode')}</span><strong>{t(`log.mode_${f.mode}`)}</strong></div>
      </div>

      {pts.length > 1 ? (
        <MapContainer key={f.id} center={center} zoom={11} scrollWheelZoom={false} className="log-map">
          <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Esri, Maxar, Earthstar Geographics" />
          <Polyline positions={pts} pathOptions={{ color: '#7fd8ff', weight: 3 }} />
          <CircleMarker center={pts[0]} radius={6} pathOptions={{ color: '#0b0f17', fillColor: '#ffd34d', fillOpacity: 1 }}><Tooltip>{t('log.home')}</Tooltip></CircleMarker>
          {f.markers.map((m, i) => (
            <CircleMarker key={i} center={[m.lat, m.lon]} radius={5} pathOptions={{ color: '#0b0f17', fillColor: m.label.startsWith(t('scout.lzVerified')) ? '#3b82f6' : '#7fd8ff', fillOpacity: 1 }}>
              <Tooltip>{m.label}</Tooltip>
            </CircleMarker>
          ))}
          {f.photos.map((p, i) => (
            <CircleMarker key={`p${i}`} center={[p.lat, p.lon]} radius={4} pathOptions={{ color: '#fff', fillColor: '#e2559a', fillOpacity: 1 }}>
              <Tooltip>{t('log.photoN', { n: num(i + 1) })}</Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
      ) : (
        <p className="muted small">{t('log.noPath')}</p>
      )}

      <div className="report-cols">
        <div>
          <h3>{t('log.decision')}</h3>
          {f.scan ? (
            <p className={`decision ${f.scan.verdict} verdict-inline`}>
              {t(`scout.v_${f.scan.verdict}`)} · {t('log.scanFacts', { safe: num(f.scan.safe), slope: num(f.scan.meanSlope, 1) })}
            </p>
          ) : (
            <p className="muted small">{t('log.noScan')}</p>
          )}
          {env && (
            <>
              <h3>{t('log.field')}</h3>
              <ul className="small plain">
                <li>{t('log.bestMonths', { m: monthSpan(env.coolest, lang) })}</li>
                <li>{t('log.climate', { rain: num(env.rain_mm), rh: num(env.rh), t: num(env.t2m, 1), range: num(env.t_range, 1) })}</li>
                <li>{t('log.access', { km: num(cell!.km_muscat) })}</li>
                <li>{t('log.footprint', { v: num((cell!.built_pct ?? 0) + (cell!.crop_pct ?? 0), 1) })}</li>
              </ul>
            </>
          )}
        </div>
        <div>
          <h3>{t('log.whyTitle')}</h3>
          {grid && cell ? (
            <AiExplain grid={grid} cell={cell} body={f.body} ranks={ranks} total={ranks.size} verdict={f.scan?.verdict ?? null} layers={cellLayers?.cells[f.cellId] ?? null} />
          ) : (
            <p className="muted small">{t('common.loading')}</p>
          )}
        </div>
      </div>

      {f.photos.length > 0 && (
        <>
          <h3>{t('log.photos')}</h3>
          <div className="log-photos">
            {f.photos.map((p, i) => (
              <figure key={i}>
                <img src={p.url} alt={t('scout.photoAlt', { n: num(i + 1), agl: num(p.aglM) })} />
                <figcaption className="small muted" dir="ltr">{p.lat.toFixed(4)}, {p.lon.toFixed(4)} · {p.aglM} m AGL · T+{mmss(p.t)}</figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
      <p className="muted small report-foot">{t('log.sources')}</p>
    </section>
  );
}

function Compare({ a, b, cells }: { a: FlightRecord; b: FlightRecord; cells: ScoutCell[] }) {
  const { t, num } = useI18n();
  const row = (f: FlightRecord) => {
    const c = cells.find((x) => x.id === f.cellId);
    return {
      where: `${num(f.lat, 2)}° N, ${num(f.lon, 2)}° E`,
      body: t(`scout.body_${f.body}`),
      verdict: f.scan ? t(`log.v_${f.scan.verdict}`) : '–',
      ai: c?.ai?.[f.body] ? `${num(c.ai[f.body]!.p)}%` : '–',
      safe: c?.safe_pct != null ? `${num(c.safe_pct)}%` : '–',
      human: c ? `${num((c.built_pct ?? 0) + (c.crop_pct ?? 0), 1)}%` : '–',
      rain: c?.env ? `${num(c.env.rain_mm)} mm` : '–',
      km: c ? `${num(c.km_muscat)} km` : '–',
      relief: c ? `${num(Math.round(c.relief_m))} m` : '–',
    };
  };
  const ra = row(a), rb = row(b);
  const keys = Object.keys(ra) as (keyof typeof ra)[];
  return (
    <section className="panel log-compare">
      <h2>{t('log.compareTitle')}</h2>
      <table>
        <thead><tr><th /><th dir="ltr">{ra.where}</th><th dir="ltr">{rb.where}</th></tr></thead>
        <tbody>
          {keys.filter((k) => k !== 'where').map((k) => (
            <tr key={k}><th>{t(`log.c_${k}`)}</th><td>{ra[k]}</td><td>{rb[k]}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
