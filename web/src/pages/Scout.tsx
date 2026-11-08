import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Rectangle, TileLayer, Tooltip, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { findSite, useDataset } from '../lib/data';
import {
  decide, GRID_URL, HAZARD_DEG, loadHeightmap, ranksFor, SAFE_DEG, scoreOf, slopeClass, slopeField, toKml,
  useScoutGrid, type Body, type Decision, type ScoutCell,
} from '../lib/scout';
import DroneView, { type DroneHandle, type Lens, type ScanResult, type Telemetry } from '../components/scout/DroneView';
import ContinueExploring from '../components/common/ContinueExploring';

/** Colour for a 0..1 screening score: dark blue (low) -> teal -> amber -> red (high). */
function heat(v: number | null): string {
  if (v == null) return '#3a4258';
  const stops: [number, number[]][] = [[0, [40, 52, 110]], [0.45, [40, 150, 160]], [0.75, [235, 180, 60]], [1, [225, 70, 50]]];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i];
      const t = (v - a) / (b - a);
      return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * t)).join(',')})`;
    }
  }
  return 'rgb(225,70,50)';
}

export default function Scout() {
  const { t, loc, num } = useI18n();
  const data = useDataset();
  const { grid, failed } = useScoutGrid();
  const [body, setBody] = useState<Body>('moon');
  const [marsTarget, setMarsTarget] = useState<string | null>(null); // null = each cell's best Mars target
  const [sel, setSel] = useState<ScoutCell | null>(null);
  const [hm, setHm] = useState<{ heights: Float32Array; slope: Float32Array; px: number; resM: number } | null>(null);
  const [hmErr, setHmErr] = useState(false);
  const [lens, setLens] = useState<Lens>('relief');
  const [satFail, setSatFail] = useState(false);
  const [tel, setTel] = useState<Telemetry | null>(null);
  const [scan, setScan] = useState<{ result: ScanResult; decision: Decision } | null>(null);
  const [marks, setMarks] = useState(0);
  const [auto, setAuto] = useState(false);
  const [mission, setMission] = useState<{ start: number; done?: number } | null>(null);
  const drone = useRef<DroneHandle>(null);
  const viewRef = useRef<HTMLDivElement>(null);

  const tgt = body === 'mars' ? marsTarget : null;
  const ranks = useMemo(() => (grid ? ranksFor(grid.cells, body, tgt) : new Map<string, number>()), [grid, body, tgt]);
  const ranked = useMemo(() => (grid ? grid.cells.filter((c) => ranks.has(c.id)) : []), [grid, ranks]);
  const top = useMemo(() => [...ranked].sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!).slice(0, 8), [ranked, ranks]);
  const score = (c: ScoutCell) => scoreOf(c, body, tgt);
  const moonRanks = useMemo(() => (grid ? ranksFor(grid.cells, 'moon') : new Map<string, number>()), [grid]);
  const jsCell = grid?.sites.find((x) => x.id === 'jebel_shams')?.cell ?? null;

  // start over Jebel Shams, our strongest Moon analog, so the first flight is over real mountains
  useEffect(() => {
    if (!grid || sel) return;
    const js = grid.sites.find((x) => x.id === 'jebel_shams')?.cell;
    setSel(grid.cells.find((c) => c.id === js) ?? [...grid.cells].sort((a, b) => (a.moon_rank ?? 1e9) - (b.moon_rank ?? 1e9))[0] ?? null);
  }, [grid, sel]);

  useEffect(() => {
    if (!sel?.heightmap) return;
    let alive = true;
    setHm(null);
    setHmErr(false);
    setScan(null);
    setMarks(0);
    setAuto(false);
    const resM = sel.heightmap.res_m;
    loadHeightmap(sel)
      .then(({ heights, px }) => alive && setHm({ heights, px, resM, slope: slopeField(heights, px, resM) }))
      .catch(() => alive && setHmErr(true));
    return () => {
      alive = false;
    };
  }, [sel]);

  if (failed) return <div className="page"><p className="center-msg">{t('scout.noGrid')}</p></div>;
  if (!grid) return <div className="page"><p className="center-msg">{t('common.loading')}</p></div>;

  const doScan = () => {
    if (!drone.current || !sel) return;
    const result = drone.current.scan();
    const decision = decide(sel, ranks.get(sel.id), ranked.length, result.safe);
    setScan({ result, decision });
    if (mission && !mission.done && body === 'moon' && decision.verdict === 'go') setMission({ ...mission, done: Date.now() });
  };
  const doMark = () => {
    if (!drone.current) return;
    drone.current.mark(`${t('scout.marker')} ${marks + 1}`);
    setMarks(marks + 1);
  };
  const doExport = () => {
    if (!drone.current || !sel) return;
    const kml = toKml(`VEX Scout ${sel.id}`, drone.current.path(), drone.current.markers());
    const url = URL.createObjectURL(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `vex-scout-${sel.id}.kml`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const toggleAuto = () => {
    const on = !auto;
    drone.current?.setAuto(on);
    setAuto(on);
    viewRef.current?.querySelector<HTMLElement>('.drone-view')?.focus();
  };
  const pick = (c: ScoutCell) => {
    setSel(c);
    setTimeout(() => viewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const target = data.targets.find((x) => x.id === (tgt ?? sel?.mars_best));
  const marsTargets = data.targets.filter((x) => x.body === 'mars');
  const moonT = data.targets.find((x) => x.body === 'moon');
  const nearSite = sel ? grid.sites.find((s) => s.cell === sel.id) : undefined;
  const nearSiteObj = nearSite ? findSite(data, nearSite.id) : null;
  const cls = tel ? slopeClass(tel.slope) : null;

  return (
    <div className="page scout">
      <header className="scout-head">
        <p className="kicker">{t('scout.kicker')}</p>
        <h1>{t('scout.title')}</h1>
        <p className="lead">{t('scout.lead', { n: num(grid.cells.length) })}</p>
        <p className="note small">{t('scout.honest')}</p>
        {jsCell && moonRanks.get(jsCell) && (
          <p className="cross-check small">{t('scout.crossCheck', { rank: num(moonRanks.get(jsCell)!), n: num(moonRanks.size) })}</p>
        )}
      </header>

      <div className="body-tabs" role="tablist">
        {(['mars', 'moon'] as Body[]).map((b) => (
          <button key={b} type="button" role="tab" aria-selected={body === b} className={body === b ? 'active' : ''} onClick={() => setBody(b)}>
            <span className={`dot ${b}`} /> {t(`scout.body_${b}`)}
          </button>
        ))}
      </div>

      {body === 'mars' && (
        <label className="target-pick">
          {t('scout.targetPick')}{' '}
          <select value={marsTarget ?? ''} onChange={(e) => setMarsTarget(e.target.value || null)}>
            <option value="">{t('scout.targetBest')}</option>
            {marsTargets.map((x) => (
              <option key={x.id} value={x.id}>{loc(x.name)}</option>
            ))}
          </select>
        </label>
      )}

      <section className="scout-grid">
        <div className="panel scout-map">
          <h2>{t('scout.mapTitle', { body: t(`scout.body_${body}`) })}</h2>
          <MapContainer center={[20.6, 56.5]} zoom={6} minZoom={5} maxZoom={10} scrollWheelZoom={false} className="scout-leaflet">
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Esri, Maxar, Earthstar Geographics" />
            {grid.cells.map((c) => {
              const v = score(c);
              const h = grid.method.cell_deg / 2;
              return (
                <Rectangle
                  key={`${c.id}-${body}-${tgt ?? ''}`}
                  bounds={[[c.lat - h, c.lon - h], [c.lat + h, c.lon + h]]}
                  pathOptions={{ color: sel?.id === c.id ? '#ffffff' : heat(v), weight: sel?.id === c.id ? 2.5 : 0.4, fillColor: heat(v), fillOpacity: 0.55 }}
                  eventHandlers={{ click: () => pick(c) }}
                >
                  <Tooltip direction="top">
                    {t('scout.cellTip', { score: v == null ? '–' : num(v * 100), rank: num(ranks.get(c.id) ?? 0), n: num(ranked.length) })}
                  </Tooltip>
                </Rectangle>
              );
            })}
            {grid.sites.map((s) => {
              const site = findSite(data, s.id);
              return (
                <CircleMarker key={s.id} center={[s.lat, s.lon]} radius={5} pathOptions={{ color: '#0b0f17', weight: 1.5, fillColor: '#ffffff', fillOpacity: 1 }}>
                  <Tooltip>{site ? loc(site.name) : s.id}</Tooltip>
                </CircleMarker>
              );
            })}
          </MapContainer>
          <div className="heat-legend" aria-hidden="true">
            <span>{t('scout.low')}</span>
            <i />
            <span>{t('scout.high')}</span>
            <span className="muted small"> · ○ {t('scout.legendSites')}</span>
          </div>
        </div>

        <div className="panel scout-top">
          <h2>{t('scout.topTitle', { body: t(`scout.body_${body}`) })}</h2>
          <ol>
            {top.map((c) => {
              const s = grid.sites.find((x) => x.cell === c.id);
              const site = s ? findSite(data, s.id) : null;
              return (
                <li key={c.id}>
                  <button type="button" className={sel?.id === c.id ? 'active' : ''} onClick={() => pick(c)}>
                    <span className="nowrap" dir="ltr">{num(c.lat, 2)}° N, {num(c.lon, 2)}° E</span>
                    {site && <span className="pill soft small">{loc(site.name)}</span>}
                    <strong>{num((score(c) ?? 0) * 100)}%</strong>
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="muted small">{t('scout.topNote')}</p>
        </div>
      </section>

      {sel && (
        <section className="scout-flight" ref={viewRef}>
          <div className="scout-flight-head">
            <h2>
              {t('scout.flightTitle')} · <span className="nowrap" dir="ltr">{num(sel.lat, 2)}° N, {num(sel.lon, 2)}° E</span>
            </h2>
            <p className="muted small">
              {t('scout.cellFacts', {
                score: num((score(sel) ?? 0) * 100), rank: num(ranks.get(sel.id) ?? 0), n: num(ranked.length),
                km: num(sel.km_muscat), lo: num(sel.elev_min ?? 0), hi: num(sel.elev_max ?? 0),
              })}{' '}
              {body === 'mars' && target && t('scout.closest', { target: loc(target.name) })}
              {body === 'moon' && moonT && t('scout.closest', { target: loc(moonT.name) })}
              {nearSiteObj && (
                <>
                  {' '}· <Link to={`/site/${nearSiteObj.id}`}>{t('scout.siteHere', { site: loc(nearSiteObj.name) })}</Link>
                </>
              )}
            </p>
          </div>

          <div className="scout-cockpit">
            <div className="scout-screen">
              {hm ? (
                <DroneView
                  ref={drone}
                  cell={sel}
                  heights={hm.heights}
                  slope={hm.slope}
                  px={hm.px}
                  resM={hm.resM}
                  lens={lens}
                  body={body}
                  onTelemetry={(x) => { setTel(x); if (!x.auto && auto) setAuto(false); }}
                  onSatelliteFail={() => setSatFail(true)}
                />
              ) : (
                <p className="center-msg">{hmErr ? t('scout.noHeight') : t('common.loading')}</p>
              )}
              {tel && (
                <div className="hud" dir="ltr" aria-live="off">
                  <span>ALT {Math.round(tel.altMsl)} m</span>
                  <span>AGL {Math.round(tel.agl)} m</span>
                  <span>SPD {Math.round((tel.speed * 3.6) / 10)} km/h · TIME ×10</span>
                  <span>HDG {Math.round(tel.heading).toString().padStart(3, '0')}°</span>
                  <span>{tel.lat.toFixed(4)}° N {tel.lon.toFixed(4)}° E</span>
                  <span className={tel.battery < 15 ? 'warn' : ''}>BAT {Math.round(tel.battery)}%</span>
                  {tel.auto && <span className="auto">AUTO</span>}
                </div>
              )}
              {tel && tel.battery <= 0 && (
                <div className="drone-alert">
                  {t('scout.batteryEmpty')}{' '}
                  <button type="button" className="btn small" onClick={() => drone.current?.recharge()}>{t('scout.recharge')}</button>
                </div>
              )}
            </div>

            <aside className="scout-side">
              <div className="lens-row" role="group" aria-label={t('scout.lens')}>
                {(['relief', 'satellite', 'slope', 'mars'] as Lens[]).map((l) => (
                  <button key={l} type="button" className={`btn small ${lens === l ? 'primary' : 'ghost'}`} onClick={() => setLens(l)} disabled={l === 'satellite' && satFail}>
                    {t(`scout.lens_${l}`)}
                  </button>
                ))}
              </div>
              {lens === 'slope' && (
                <p className="small slope-key">
                  <i className="k pass" /> &lt; {SAFE_DEG}° · <i className="k warn" /> {SAFE_DEG}–{HAZARD_DEG}° · <i className="k fail" /> &gt; {HAZARD_DEG}°
                </p>
              )}
              {satFail && lens === 'satellite' && <p className="small muted">{t('scout.satFail')}</p>}

              {tel && (
                <dl className="readings">
                  <div><dt>{t('scout.rGround')}</dt><dd>{num(tel.ground)} m</dd></div>
                  <div><dt>{t('scout.rSlope')}</dt><dd className={`lvl-${cls}`}>{num(tel.slope, 1)}° · {t(`scout.cls_${cls}`)}</dd></div>
                </dl>
              )}

              <div className="action-row">
                <button type="button" className="btn primary" onClick={doScan} disabled={!hm}>{t('scout.scan')}</button>
                <button type="button" className={`btn ${auto ? 'primary' : 'ghost'}`} onClick={toggleAuto} disabled={!hm}>{auto ? t('scout.autoOn') : t('scout.autoOff')}</button>
                <button type="button" className="btn ghost" onClick={doMark} disabled={!hm}>{t('scout.mark')}{marks ? ` (${num(marks)})` : ''}</button>
                <button type="button" className="btn ghost" onClick={doExport} disabled={!hm}>{t('scout.export')}</button>
              </div>

              {scan && (
                <div className={`decision ${scan.decision.verdict}`}>
                  <p className="verdict">{t(`scout.v_${scan.decision.verdict}`)}</p>
                  <ul>
                    {scan.decision.criteria.map((c) => (
                      <li key={c.key} className={`lvl-${c.level}`}>
                        <i aria-hidden="true" />
                        <span>{t(`scout.c_${c.key}`)}</span>
                        <strong dir="ltr">{c.value}</strong>
                      </li>
                    ))}
                  </ul>
                  <p className="muted small">
                    {t('scout.scanFacts', { r: num(scan.result.radiusM / 1000), slope: num(scan.result.meanSlope, 1), lo: num(scan.result.elevMin), hi: num(scan.result.elevMax) })}
                  </p>
                </div>
              )}

              <details className="controls-help">
                <summary>{t('scout.howTo')}</summary>
                <p className="small">{t('scout.keys')}</p>
                <p className="small">{t('scout.touch')}</p>
              </details>
            </aside>
          </div>
        </section>
      )}

      <section className="panel scout-mission">
        <h2>{t('scout.missionTitle')}</h2>
        <p>{t('scout.missionText')}</p>
        {!mission && (
          <button type="button" className="btn primary" onClick={() => { setBody('moon'); setMission({ start: Date.now() }); }}>
            {t('scout.missionStart')}
          </button>
        )}
        {mission && !mission.done && <p className="note">{t('scout.missionGoing')}</p>}
        {mission?.done && (
          <p className="decision go verdict-inline">
            {t('scout.missionDone', { s: num(Math.round((mission.done - mission.start) / 1000)) })}
          </p>
        )}
      </section>

      <section className="panel scout-method">
        <h2>{t('scout.methodTitle')}</h2>
        <ul className="small">
          <li>{t('scout.m1', { deg: num(grid.method.cell_deg, 2), land: num(grid.method.min_land * 100) })}</li>
          <li>{t('scout.m2')}</li>
          <li>{t('scout.m3', { safe: SAFE_DEG, hazard: HAZARD_DEG })}</li>
          <li>{t('scout.m4')}</li>
          <li>{t('scout.m5')}</li>
        </ul>
        <p className="muted small">
          {t('scout.sources')}: {grid.method.terrain_source} · {grid.method.landcover_source} · {grid.method.border} ·{' '}
          <a href={GRID_URL} download="vex-scout-oman-grid.json">{t('scout.download')}</a>
        </p>
      </section>

      <ContinueExploring from="scout" />
    </div>
  );
}
