import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Rectangle, TileLayer, Tooltip, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { findSite, useDataset } from '../lib/data';
import {
  decide, GRID_URL, HAZARD_DEG, loadHeightmap, ranksFor, SAFE_DEG, scoreOf, slopeClass, slopeField, toKml,
  useScoutGrid, type Body, type Decision, type ScoutCell,
} from '../lib/scout';
import { AI_HIGH, AI_LOW } from '../lib/scoutAi';
import { MAX_PHOTOS, pathKm, saveFlight, type FlightRecord, type Photo } from '../lib/missionLog';
import DroneView, { type AutoMode, type DroneEvent, type DroneHandle, type Lens, type ScanResult, type Telemetry } from '../components/scout/DroneView';
import AiExplain from '../components/scout/AiExplain';
import SafeBox from '../components/common/SafeBox';
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

/** AI colour: purple ramp, low -> high. */
function aiHeat(p: number | null): string {
  if (p == null) return '#3a4258';
  const v = Math.max(0, Math.min(1, p / 100));
  const a = [38, 33, 92], b = [127, 119, 221], c = [238, 237, 254];
  const m = v < 0.5 ? a.map((x, i) => x + (b[i] - x) * (v / 0.5)) : b.map((x, i) => x + (c[i] - x) * ((v - 0.5) / 0.5));
  return `rgb(${m.map(Math.round).join(',')})`;
}

const mmss = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
const compass = (h: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(h / 45) % 8];

export default function Scout() {
  const { t, loc, num } = useI18n();
  const data = useDataset();
  const { grid, failed } = useScoutGrid();
  const [body, setBody] = useState<Body>('moon');
  const [colorBy, setColorBy] = useState<'rules' | 'ai'>('rules');
  const [marsTarget, setMarsTarget] = useState<string | null>(null); // null = each cell's best Mars target
  const [sel, setSel] = useState<ScoutCell | null>(null);
  const [hm, setHm] = useState<{ id: string; heights: Float32Array; slope: Float32Array; px: number; resM: number } | null>(null);
  const [hmErr, setHmErr] = useState(false);
  const [lens, setLens] = useState<Lens>('satellite');
  const [satFail, setSatFail] = useState(false);
  const [tel, setTel] = useState<Telemetry | null>(null);
  const [scan, setScan] = useState<{ result: ScanResult; decision: Decision } | null>(null);
  const [marks, setMarks] = useState(0);
  const [auto, setAuto] = useState<AutoMode>(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [alert, setAlert] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [mission, setMission] = useState<{ start: number; done?: number } | null>(null);
  const drone = useRef<DroneHandle>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const flight = useRef<FlightRecord | null>(null);

  const tgt = body === 'mars' ? marsTarget : null;
  const ranks = useMemo(() => (grid ? ranksFor(grid.cells, body, tgt) : new Map<string, number>()), [grid, body, tgt]);
  const ranked = useMemo(() => (grid ? grid.cells.filter((c) => ranks.has(c.id)) : []), [grid, ranks]);
  const aiOn = colorBy === 'ai' && !!grid?.ai;
  const top = useMemo(() => {
    if (aiOn) return [...ranked].filter((c) => c.ai?.[body]).sort((a, b) => b.ai![body]!.p - a.ai![body]!.p).slice(0, 8);
    return [...ranked].sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!).slice(0, 8);
  }, [ranked, ranks, aiOn, body]);
  const score = (c: ScoutCell) => scoreOf(c, body, tgt);
  const moonRanks = useMemo(() => (grid ? ranksFor(grid.cells, 'moon') : new Map<string, number>()), [grid]);
  const jsCell = grid?.sites.find((x) => x.id === 'jebel_shams')?.cell ?? null;
  const month = new Date().getMonth();
  const wind = sel?.env ? sel.env.wind_monthly[month] ?? sel.env.wind_ms : null;

  /** Write the current flight to the mission log (this browser only). */
  const persist = useCallback(() => {
    const f = flight.current;
    const d = drone.current;
    if (!f) return;
    if (d) {
      const st = d.stats();
      const path = d.path();
      Object.assign(f, {
        path, markers: d.markers(), droneSeconds: Math.round(st.droneSeconds), distanceKm: Math.round(Math.max(st.distanceKm, pathKm(path)) * 10) / 10,
        batteryUsed: Math.round(st.batteryUsed), maxAglM: Math.round(st.maxAglM), landings: st.landings,
      });
    }
    setSaved(saveFlight(f));
  }, []);

  const ensureFlight = useCallback((c: ScoutCell): FlightRecord => {
    if (!flight.current) {
      flight.current = {
        id: `f${Date.now().toString(36)}`, cellId: c.id, body, lat: c.lat, lon: c.lon, started: Date.now(), updated: Date.now(),
        droneSeconds: 0, distanceKm: 0, batteryUsed: 0, maxAglM: 0, windMs: wind, mode: 'manual', path: [], markers: [], photos: [],
        scan: null, aiP: c.ai?.[body]?.p ?? null, landings: 0,
      };
    }
    return flight.current;
  }, [body, wind]);

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
    setPhotos([]);
    setAlert(null);
    setSaved(false);
    const resM = sel.heightmap.res_m;
    loadHeightmap(sel)
      .then(({ heights, px }) => alive && setHm({ id: sel.id, heights, px, resM, slope: slopeField(heights, px, resM) }))
      .catch(() => alive && setHmErr(true));
    return () => {
      alive = false;
      persist();
      flight.current = null;
    };
  }, [sel, persist]);

  useEffect(() => {
    const bye = () => persist();
    window.addEventListener('pagehide', bye);
    return () => window.removeEventListener('pagehide', bye);
  }, [persist]);

  if (failed) return <div className="page"><p className="center-msg">{t('scout.noGrid')}</p></div>;
  if (!grid) return <div className="page"><p className="center-msg">{t('common.loading')}</p></div>;

  const onEvent = (e: DroneEvent) => {
    if (!sel) return;
    if (e.type === 'takeoff') { ensureFlight(sel); setAlert(null); persist(); }
    else if (e.type === 'photo') {
      const f = ensureFlight(sel);
      if (f.photos.length < MAX_PHOTOS) f.photos.push(e.photo);
      setPhotos([...f.photos]);
      persist();
    } else if (e.type === 'landed') {
      setAlert(e.safe ? null : t('scout.landedUnsafe', { s: num(e.slope, 1) }));
      if (!auto || auto === 'survey') setAuto(false);
      persist();
    } else if (e.type === 'rth') {
      setAuto(false);
      setAlert(e.reason === 'battery' ? t('scout.rthBattery') : t('scout.rthUser'));
    } else if (e.type === 'lz') persist();
  };

  const doScan = () => {
    if (!drone.current || !sel) return;
    const result = drone.current.scan();
    const decision = decide(sel, ranks.get(sel.id), ranked.length, result.safe);
    setScan({ result, decision });
    const f = ensureFlight(sel);
    f.scan = { verdict: decision.verdict, safe: Math.round(result.safe * 100), meanSlope: Math.round(result.meanSlope * 10) / 10 };
    persist();
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
  const focusView = () => viewRef.current?.querySelector<HTMLElement>('.drone-view')?.focus();
  const setMode = (m: AutoMode) => {
    const next = auto === m ? false : m;
    drone.current?.setAuto(next);
    setAuto(next);
    if (next && sel) ensureFlight(sel).mode = next;
    focusView();
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
  const landed = !tel || tel.phase === 'landed';
  const lenses: Lens[] = ['satellite', 'relief', 'hazard', 'slope', 'mars'];

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
        <p className="small"><Link to="/log" className="btn small ghost">{t('scout.toLog')}</Link></p>
      </header>

      <div className="scout-controls">
        <div className="tabs body-tabs" role="tablist">
          {(['mars', 'moon'] as Body[]).map((b) => (
            <button key={b} type="button" role="tab" aria-selected={body === b} className={body === b ? 'active' : ''} onClick={() => setBody(b)}>
              <span className={`dot ${b}`} /> {t(`scout.body_${b}`)}
            </button>
          ))}
        </div>
        {grid.ai && (
          <div className="seg" role="group" aria-label={t('scout.colorBy')}>
            <button type="button" className={colorBy === 'rules' ? 'active' : ''} onClick={() => setColorBy('rules')}>{t('scout.colorRules')}</button>
            <button type="button" className={colorBy === 'ai' ? 'active ai' : ''} onClick={() => setColorBy('ai')}><span className="ai-badge tiny">AI</span> {t('scout.colorAi')}</button>
          </div>
        )}
      </div>

      {body === 'mars' && colorBy === 'rules' && (
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
          <h2>{aiOn ? t('scout.mapTitleAi', { body: t(`scout.body_${body}`) }) : t('scout.mapTitle', { body: t(`scout.body_${body}`) })}</h2>
          <MapContainer center={[20.6, 56.5]} zoom={6} minZoom={5} maxZoom={10} scrollWheelZoom={false} className="scout-leaflet">
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Esri, Maxar, Earthstar Geographics" />
            {grid.cells.map((c) => {
              const v = score(c);
              const p = c.ai?.[body]?.p ?? null;
              const col = aiOn ? aiHeat(p) : heat(v);
              const h = grid.method.cell_deg / 2;
              return (
                <Rectangle
                  key={`${c.id}-${body}-${tgt ?? ''}-${colorBy}`}
                  bounds={[[c.lat - h, c.lon - h], [c.lat + h, c.lon + h]]}
                  pathOptions={{ color: sel?.id === c.id ? '#ffffff' : col, weight: sel?.id === c.id ? 2.5 : 0.4, fillColor: col, fillOpacity: 0.55 }}
                  eventHandlers={{ click: () => pick(c) }}
                >
                  <Tooltip direction="top">
                    {aiOn
                      ? t('scout.cellTipAi', { p: p == null ? '–' : num(p), rank: num(c.ai?.[body]?.rank ?? 0), n: num(ranked.length) })
                      : t('scout.cellTip', { score: v == null ? '–' : num(v * 100), rank: num(ranks.get(c.id) ?? 0), n: num(ranked.length) })}
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
          <div className={`heat-legend ${aiOn ? 'ai' : ''}`} aria-hidden="true">
            <span>{aiOn ? t('scout.aiLow') : t('scout.low')}</span>
            <i />
            <span>{aiOn ? t('scout.aiHigh') : t('scout.high')}</span>
            <span className="muted small"> · ○ {t('scout.legendSites')}</span>
          </div>
        </div>

        <div className="panel scout-top">
          <h2>{aiOn ? t('scout.topTitleAi', { body: t(`scout.body_${body}`) }) : t('scout.topTitle', { body: t(`scout.body_${body}`) })}</h2>
          <ol>
            {top.map((c) => {
              const s = grid.sites.find((x) => x.cell === c.id);
              const site = s ? findSite(data, s.id) : null;
              return (
                <li key={c.id}>
                  <button type="button" className={sel?.id === c.id ? 'active' : ''} onClick={() => pick(c)}>
                    <span className="nowrap" dir="ltr">{num(c.lat, 2)}° N, {num(c.lon, 2)}° E</span>
                    {site && <span className="pill soft small">{loc(site.name)}</span>}
                    <strong>{aiOn ? num(c.ai![body]!.p) : num((score(c) ?? 0) * 100)}%</strong>
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="muted small">{aiOn ? t('scout.topNoteAi') : t('scout.topNote')}</p>
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
              {hm && hm.id === sel.id ? (
                <SafeBox key={sel.id} fallback={<p className="center-msg">{t('scout.viewFail')}</p>}>
                <DroneView
                  key={sel.id}
                  ref={drone}
                  cell={sel}
                  heights={hm.heights}
                  slope={hm.slope}
                  px={hm.px}
                  resM={hm.resM}
                  lens={lens}
                  body={body}
                  wind={wind}
                  onTelemetry={(x) => { setTel(x); if (!x.auto && auto) setAuto(false); }}
                  onEvent={onEvent}
                  onSatelliteFail={() => { setSatFail(true); setLens((l) => (l === 'satellite' ? 'relief' : l)); }}
                />
                </SafeBox>
              ) : (
                <p className="center-msg">{hmErr ? t('scout.noHeight') : t('common.loading')}</p>
              )}
              {tel && (
                <>
                  <div className="hud hud-top" dir="ltr" aria-live="off">
                    <span className={`hud-phase ${tel.phase}`}>{t(`scout.ph_${tel.phase}`)}{tel.auto ? ` · ${t(`scout.mode_${tel.auto}`)}` : ''}</span>
                    <span className="hud-hdg">{Math.round(tel.heading).toString().padStart(3, '0')}° {compass(tel.heading)}</span>
                    <span>⏱ {mmss(tel.flightSec)}</span>
                    <span className={`hud-bat ${tel.battery < 20 ? 'warn' : ''}`}>
                      <i style={{ width: `${Math.max(0, tel.battery)}%` }} /> {Math.round(tel.battery)}%
                    </span>
                  </div>
                  <div className="hud hud-bottom" dir="ltr" aria-live="off">
                    <span><b>H</b> {num(Math.round(tel.agl))} m</span>
                    <span><b>D</b> {num(Math.round(tel.distHome))} m</span>
                    <span><b>H.S</b> {num(tel.speed / 10, 1)} m/s</span>
                    <span><b>V.S</b> {num(tel.vspeed / 10, 1)} m/s</span>
                    <span><b>ASL</b> {num(Math.round(tel.altMsl))} m</span>
                    <span><b>{t('scout.gimbal')}</b> {Math.round(tel.gimbal)}°</span>
                    {tel.wind != null && <span><b>{t('scout.windShort')}</b> {num(tel.wind, 1)} m/s</span>}
                    {tel.footprintM && <span><b>{t('scout.fpShort')}</b> {num(Math.round(tel.footprintM[0]))}×{num(Math.round(tel.footprintM[1]))} m</span>}
                    <span className="muted">{tel.lat.toFixed(4)}°N {tel.lon.toFixed(4)}°E · ×10</span>
                  </div>
                  {tel.dfStep && (
                    <div className="df-step">
                      {t(`scout.df_${tel.dfStep}`)} · {t('scout.dfLz', { n: num(tel.lzCount) })}
                    </div>
                  )}
                </>
              )}
              {alert && <div className="drone-alert">{alert}</div>}
              {tel && tel.battery <= 0 && tel.phase === 'landed' && (
                <div className="drone-alert">
                  {t('scout.batteryEmpty')}{' '}
                  <button type="button" className="btn small" onClick={() => drone.current?.recharge()}>{t('scout.recharge')}</button>
                </div>
              )}
              {landed && hm && tel && tel.battery > 0 && !tel.auto && (
                <button type="button" className="btn primary takeoff-btn" onClick={() => { drone.current?.takeOff(); focusView(); }}>
                  {t('scout.takeOff')}
                </button>
              )}
            </div>

            <aside className="scout-side">
              <div className="lens-row" role="group" aria-label={t('scout.lens')}>
                {lenses.map((l) => (
                  <button key={l} type="button" className={`btn small ${lens === l ? 'primary' : 'ghost'} ${l === 'hazard' ? 'hz' : ''}`} onClick={() => setLens(l)} disabled={l === 'satellite' && satFail}>
                    {t(`scout.lens_${l}`)}
                  </button>
                ))}
              </div>
              {lens === 'slope' && (
                <p className="small slope-key">
                  <i className="k pass" /> &lt; {SAFE_DEG}° · <i className="k warn" /> {SAFE_DEG}–{HAZARD_DEG}° · <i className="k fail" /> &gt; {HAZARD_DEG}°
                </p>
              )}
              {lens === 'hazard' && (
                <p className="small slope-key hazard-key">
                  <i className="k safest" /> {t('scout.hz_safest')} · <i className="k pass" /> {t('scout.hz_safe')} · <i className="k warn" /> {t('scout.hz_caution')} · <i className="k fail" /> {t('scout.hz_hazard')}
                  <br /><span className="muted">{t('scout.hzNote')}</span>
                </p>
              )}
              {satFail && <p className="small muted">{t('scout.satFail')}</p>}

              {tel && (
                <dl className="readings">
                  <div><dt>{t('scout.rGround')}</dt><dd>{num(tel.ground)} m</dd></div>
                  <div><dt>{t('scout.rSlope')}</dt><dd className={`lvl-${cls}`}>{num(tel.slope, 1)}° · {t(`scout.cls_${cls}`)}</dd></div>
                </dl>
              )}

              <div className="action-row">
                {landed ? (
                  <button type="button" className="btn primary" onClick={() => { drone.current?.takeOff(); focusView(); }} disabled={!hm}>{t('scout.takeOff')}</button>
                ) : (
                  <button type="button" className="btn ghost" onClick={() => { drone.current?.land(); setAuto(false); focusView(); }}>{t('scout.land')}</button>
                )}
                <button type="button" className="btn ghost" onClick={() => { drone.current?.returnHome(); focusView(); }} disabled={!hm || landed}>{t('scout.rth')}</button>
                <button type="button" className="btn ghost" onClick={() => drone.current?.photo()} disabled={!hm}>{t('scout.photo')}</button>
                <button type="button" className="btn primary" onClick={doScan} disabled={!hm}>{t('scout.scan')}</button>
              </div>
              <div className="action-row">
                <button type="button" className={`btn ${auto === 'survey' ? 'primary' : 'ghost'}`} onClick={() => setMode('survey')} disabled={!hm}>{auto === 'survey' ? t('scout.autoOn') : t('scout.autoOff')}</button>
                <button type="button" className={`btn ${auto === 'dragonfly' ? 'primary' : 'ghost'}`} onClick={() => setMode('dragonfly')} disabled={!hm}>{auto === 'dragonfly' ? t('scout.dfOn') : t('scout.dfOff')}</button>
                <button type="button" className="btn ghost" onClick={doMark} disabled={!hm}>{t('scout.mark')}{marks ? ` (${num(marks)})` : ''}</button>
                <button type="button" className="btn ghost" onClick={doExport} disabled={!hm}>{t('scout.export')}</button>
              </div>
              {auto === 'dragonfly' && <p className="small note">{t('scout.dfExplain')}</p>}

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

              {grid.ai && (
                <div className="ai-wrap">
                  <p className="small muted">{scan ? t('scout.ai.afterScan') : t('scout.ai.beforeScan')}</p>
                  <AiExplain grid={grid} cell={sel} body={body} ranks={ranks} total={ranked.length} verdict={scan?.decision.verdict ?? null} onGo={pick} />
                </div>
              )}

              {photos.length > 0 && (
                <div className="photo-strip">
                  <p className="small"><strong>{t('scout.photos', { n: num(photos.length), max: num(MAX_PHOTOS) })}</strong></p>
                  <div>
                    {photos.map((p, i) => (
                      <img key={i} src={p.url} alt={t('scout.photoAlt', { n: num(i + 1), agl: num(p.aglM) })} title={`${p.lat.toFixed(4)}, ${p.lon.toFixed(4)} · ${p.aglM} m AGL`} />
                    ))}
                  </div>
                </div>
              )}
              {saved && <p className="small muted">{t('scout.savedToLog')} <Link to="/log">{t('scout.openLog')}</Link></p>}

              <details className="controls-help">
                <summary>{t('scout.howTo')}</summary>
                <p className="small">{t('scout.keys')}</p>
                <p className="small">{t('scout.touch')}</p>
                <p className="small">{t('scout.realism')}</p>
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
          {grid.ai && <li>{t('scout.m6', { k: grid.ai.k, n: num(grid.ai.examples[body].length), hi: AI_HIGH, lo: AI_LOW })}</li>}
          {grid.ai && <li>{t('scout.m7')}</li>}
          <li>{t('scout.m8')}</li>
        </ul>
        {grid.ai && <AiValidation grid={grid} body={body} />}
        <p className="muted small">
          {t('scout.sources')}: {grid.method.terrain_source} · {grid.method.landcover_source} · {grid.method.climate_source ? `${grid.method.climate_source} · ` : ''}{grid.method.border} ·{' '}
          <a href={GRID_URL} download="vex-scout-oman-grid.json">{t('scout.download')}</a>
        </p>
      </section>

      <ContinueExploring from="scout" />
    </div>
  );
}

/** How well the AI does on places it never saw. */
function AiValidation({ grid, body }: { grid: NonNullable<ReturnType<typeof useScoutGrid>['grid']>; body: Body }) {
  const { t, num, loc } = useI18n();
  const data = useDataset();
  const v = grid.ai!.validation[body];
  const loo = v.leave_one_out;
  const avgBeat = loo.reduce((s, x) => s + x.beats_pct, 0) / Math.max(1, loo.length);
  const sites = v.omani_sites.filter((s) => {
    const site = data.earth_sites.find((x) => x.id === s.id);
    return site?.intended_targets?.some((tg) => data.targets.find((x) => x.id === tg)?.body === body);
  });
  return (
    <div className="ai-validation small">
      <p><strong>{t('scout.valTitle')}</strong></p>
      <p>{t('scout.valLoo', { n: num(loo.length), beat: num(Math.round(avgBeat)) })}</p>
      {body === 'mars' && <p className="muted">{t('scout.valMars')}</p>}
      {sites.length > 0 && (
        <p>
          {t('scout.valSites')}{' '}
          {sites.map((s, i) => {
            const site = findSite(data, s.id);
            return <span key={s.id}>{i > 0 && ' · '}{site ? loc(site.name) : s.id}: <strong>{num(s.p)}%</strong> ({t('scout.valRank', { r: num(s.rank), n: num(v.cells) })})</span>;
          })}
        </p>
      )}
    </div>
  );
}
