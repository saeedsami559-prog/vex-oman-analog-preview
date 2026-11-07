import { CircleMarker, MapContainer, TileLayer, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import { ARTEMIS_REGIONS, ARTEMIS_SOURCES, BENCHMARKS, CATEGORIES, OMAN_CANDIDATES, OMAN_SCORED_CATEGORIES, OMAN_TRACK, type AtlasSite } from '../lib/atlas';
import { findSite, useDataset } from '../lib/data';
import { meanMarsSimilarity } from '../lib/analysis';
import { similarity } from '../lib/similarity';
import { ENV_URL, ltr, meanOver, monthNames, monthRange, periodYears, useEnvironment } from '../lib/environment';
import ContinueExploring from '../components/common/ContinueExploring';
import PageToc from '../components/common/PageToc';

const COLORS = { scored: '#3fb6a8', candidate: '#e6b34a', benchmark: '#f1f4fa' } as const;

/** Oman among the world's analog sites: map, category coverage, candidate, track record, Moon regions. */
export default function Atlas() {
  const { t, loc, lang, num } = useI18n();
  const data = useDataset();
  const navigate = useNavigate();
  const env = useEnvironment();
  const months = monthNames(lang);
  const scored = data.earth_sites;

  // Oman among the world: every Earth site scored with the same index and the same normalisation ranges,
  // on the criteria measured at every site (terrain + surface; EMIT minerals are missing for the world sites),
  // so no site gains or loses from a criterion the others lack.
  const cw = data.config.criteria;
  const shared = { terrain: cw.terrain?.weight ?? 0.4, mineralogy: 0, surface: cw.surface?.weight ?? 0.2 };
  const allEarth = [...scored, ...(data.benchmarks ?? [])];
  const [rankBody, setRankBody] = useState<'mars' | 'moon'>('mars');
  // Similarity of an Earth site to each target of one body, on the shared criteria.
  const toBody = (site: (typeof allEarth)[number], body: 'mars' | 'moon') =>
    data.targets
      .filter((tg) => tg.body === body)
      .map((tg) => ({ target: tg.id, overall: similarity(site.raw, tg.raw, site.resolution_m, tg.resolution_m, data.config, shared, site.body, tg.body).overall }))
      .filter((x): x is { target: string; overall: number } => x.overall !== null);
  const meanOf = (id: string, body: 'mars' | 'moon' = 'mars'): number | null => {
    const site = allEarth.find((x) => x.id === id);
    if (!site) return null;
    if (body === 'mars') return meanMarsSimilarity(data, site, shared);
    const v = toBody(site, body);
    return v.length ? v.reduce((a, b) => a + b.overall, 0) / v.length : null;
  };
  // Omani sites are in both rankings; world sites only in the ranking of the body they are an analog for.
  const inRanking = (site: (typeof allEarth)[number], body: 'mars' | 'moon') =>
    site.role !== 'benchmark' || !site.analog_for || site.analog_for.includes(body);
  const worldRows = allEarth
    .filter((site) => inRanking(site, rankBody))
    .map((site) => ({ site, mean: meanOf(site.id, rankBody), twin: toBody(site, rankBody).sort((a, b) => b.overall - a.overall)[0] }))
    .sort((a, b) => (b.mean ?? -1) - (a.mean ?? -1));
  const computed = worldRows.filter((r) => r.mean != null);
  const pending = worldRows.filter((r) => r.mean == null);

  const pin = (s: AtlasSite, kind: 'candidate' | 'benchmark') => (
    <CircleMarker
      key={s.id}
      center={[s.lat, s.lon]}
      radius={kind === 'candidate' ? 8 : 6}
      pathOptions={{ color: '#0b0f17', weight: 1.5, fillColor: COLORS[kind], fillOpacity: 0.95 }}
      eventHandlers={{ click: () => findSite(data, s.id) && navigate(`/site/${s.id}`) }}
    >
      <Tooltip direction="top" offset={[0, -6]}>
        {loc(s.name)} · {loc(s.place)}
        {s.approx ? ` (${t('atlas.approx')})` : ''}
        {meanOf(s.id) != null && ` · ${t('atlas.marsAvg')} ${num(meanOf(s.id)! * 100)}%`}
      </Tooltip>
    </CircleMarker>
  );

  const coverage = CATEGORIES.map((c) => ({
    c,
    oman: scored.filter((s) => OMAN_SCORED_CATEGORIES[s.id]?.includes(c)),
    cand: OMAN_CANDIDATES.filter((s) => s.categories.includes(c)),
    world: BENCHMARKS.filter((s) => s.categories.includes(c)),
  }));

  return (
    <div className="page atlas">
      <h1>{t('atlas.title')}</h1>
      <p className="lead">{t('atlas.intro')}</p>
      <PageToc deps={[env]} />

      <div className="panel atlas-map-panel">
        <MapContainer center={[28, 20]} zoom={2} minZoom={2} maxZoom={17} scrollWheelZoom wheelPxPerZoomLevel={90} worldCopyJump className="map atlas-map">
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Esri, Maxar, Earthstar Geographics"
          />
          {BENCHMARKS.map((s) => pin(s, 'benchmark'))}
          {OMAN_CANDIDATES.map((s) => pin(s, 'candidate'))}
          {scored.map((s) => (
            <CircleMarker
              key={s.id}
              center={[s.lat, s.lon]}
              radius={7}
              pathOptions={{ color: '#0b0f17', weight: 1.5, fillColor: COLORS.scored, fillOpacity: 0.95 }}
              eventHandlers={{ click: () => navigate(`/site/${s.id}`) }}
            >
              <Tooltip direction="top" offset={[0, -6]}>
                {loc(s.name)}
              </Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
        <ul className="atlas-legend">
          <li><i style={{ background: COLORS.scored }} /> {t('atlas.legendScored')}</li>
          <li><i style={{ background: COLORS.candidate }} /> {t('atlas.legendCandidate')}</li>
          <li><i style={{ background: COLORS.benchmark }} /> {t('atlas.legendBenchmark')}</li>
        </ul>
      </div>

      {(data.benchmarks?.length ?? 0) > 0 && (
        <section className="world-rank">
          <h2>{t('atlas.worldTitle')}</h2>
          <p className="muted">{t('atlas.worldText')}</p>
          <div className="tabs body-tabs" role="tablist">
            {(['mars', 'moon'] as const).map((b) => (
              <button key={b} type="button" role="tab" aria-selected={rankBody === b} className={rankBody === b ? 'active' : ''} onClick={() => setRankBody(b)}>
                <span className={`dot ${b}`} /> {t(`atlas.rank_${b}`)}
              </button>
            ))}
          </div>
          {rankBody === 'moon' && <p className="small muted">{t('atlas.moonRankNote')}</p>}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('sources.colSite')}</th>
                  <th>{t('atlas.colType')}</th>
                  <th>{t(rankBody === 'mars' ? 'atlas.marsAvg' : 'atlas.moonScore')}</th>
                  <th>{t(rankBody === 'mars' ? 'site.bestMars' : 'site.bestMoon')}</th>
                  <th>{t('site.coverageFact')}</th>
                </tr>
              </thead>
              <tbody>
                {computed.map(({ site, mean, twin }, i) => {
                  const tw = findSite(data, twin?.target);
                  const oman = site.role !== 'benchmark';
                  return (
                    <tr key={site.id} className={oman ? 'is-oman' : undefined}>
                      <td>{num(i + 1)}</td>
                      <th scope="row">
                        <span className={`dot ${oman ? 'earth' : 'bench'}`} /> <Link to={`/site/${site.id}`}>{loc(site.name)}</Link>
                        {site.country && <span className="muted small"> · {loc(site.country)}</span>}
                      </th>
                      <td>
                        <span className={`pill ${site.role === 'benchmark' ? 'soft' : site.role === 'candidate' ? 'warn' : 'ok'} small`}>
                          {t(`atlas.type_${site.role ?? 'analog'}`)}
                        </span>
                      </td>
                      <td className="bar-cell">
                        <span className="world-bar"><i style={{ width: `${(mean ?? 0) * 100}%` }} /></span> {num((mean ?? 0) * 100)}%
                      </td>
                      <td className="small">{tw && twin?.overall != null ? `${loc(tw.name)} · ${num(twin.overall * 100)}%` : '–'}</td>
                      <td className="small nowrap">
                        {num(site.measured.length)}/{num(site.measured.length + site.missing.filter((m) => m.status === 'unavailable').length)}
                        {rankBody === 'mars' && (data.config.criteria.surface?.features ?? []).every((f) => site.raw[f] == null) && (
                          <span className="pill warn small"> {t('atlas.terrainOnly')}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pending.length > 0 && (
            <p className="small muted">
              {t('atlas.worldPending')} {pending.map((r) => loc(r.site.name)).join(' · ')}
            </p>
          )}
          <p className="note small">{t('atlas.worldNote')}</p>
        </section>
      )}

      <h2>{t('atlas.coverageTitle')}</h2>
      <p className="muted">{t('atlas.coverageText')}</p>
      <div className="table-wrap">
        <table className="table atlas-coverage">
          <thead>
            <tr>
              <th>{t('atlas.colCategory')}</th>
              <th>{t('atlas.colOman')}</th>
              <th>{t('atlas.colCandidate')}</th>
              <th>{t('atlas.colWorld')}</th>
            </tr>
          </thead>
          <tbody>
            {coverage.map(({ c, oman, cand, world }) => (
              <tr key={c}>
                <th scope="row">{t(`atlas.cat_${c}`)}</th>
                <td>
                  {oman.length ? (
                    oman.map((s) => (
                      <Link key={s.id} to={`/site/${s.id}`} className="chip-link">
                        <span className="dot earth" /> {loc(s.name).replace(/\s*\(.*\)$/, '')}
                      </Link>
                    ))
                  ) : (
                    <span className="muted">–</span>
                  )}
                </td>
                <td>{cand.length ? cand.map((s) => <span key={s.id} className="chip-link cand">{loc(s.name)}</span>) : <span className="muted">–</span>}</td>
                <td className="small">{world.length ? world.map((s) => loc(s.name)).join(' · ') : <span className="muted">–</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">{t('atlas.omanAdds')}</p>

      <h2>{t('atlas.candidateTitle')}</h2>
      {OMAN_CANDIDATES.map((s) => (
        <section key={s.id} className="panel atlas-candidate">
          <div className="atlas-candidate-head">
            <h3>{loc(s.name)}</h3>
            <span className="pill warn">{meanOf(s.id) != null ? t('atlas.candidateScored') : loc(s.programme)}</span>
          </div>
          <p className="muted small">
            {loc(s.place)} · {s.lat.toFixed(4)}° N, {s.lon.toFixed(4)}° E
          </p>
          <p>{loc(s.what)}</p>
          <p className="small">
            {s.bodies.map((b) => (
              <span key={b} className="body-tag">
                <span className={`dot ${b}`} /> {t(b === 'moon' ? 'atlas.forMoon' : 'atlas.forMars')}
              </span>
            ))}
          </p>
          {meanOf(s.id) != null ? (
            <p className="small">
              {t('atlas.marsAvg')} <strong>{num(meanOf(s.id)! * 100)}%</strong> ·{' '}
              <Link to={`/site/${s.id}`}>{t('atlas.openProfile')} →</Link>
            </p>
          ) : (
            <p className="note small">{t('atlas.candidateNote')}</p>
          )}
          <p className="small">
            {t('atlas.source')}: <a href={s.source.url} target="_blank" rel="noreferrer">{s.source.label}</a>
          </p>
        </section>
      ))}

      {env && (
        <>
          <h2>{t('env.atlasTitle')}</h2>
          <p className="muted">{t('env.atlasIntro')}</p>
          <div className="table-wrap">
            <table className="table env-table">
              <thead>
                <tr>
                  <th>{t('sources.colSite')}</th>
                  <th>{t('env.annualMean')}</th>
                  <th>{t('env.coolest')}</th>
                  <th>{t('env.hottest')}</th>
                  <th>{t('env.dailyRange')}</th>
                  <th>{t('env.rain')}</th>
                  <th>{t('env.sun')} <span className="muted small">{ltr('kWh/m²')}</span></th>
                  <th>{t('env.humidity')}</th>
                  <th>{t('env.cell')}</th>
                </tr>
              </thead>
              <tbody>
                {env.sites.map((e) => {
                  const scoredSite = findSite(data, e.id);
                  const cand = OMAN_CANDIDATES.find((c) => c.id === e.id);
                  const T = e.monthly.T2M;
                  const hot = T.indexOf(Math.max(...T));
                  return (
                    <tr key={e.id}>
                      <th scope="row">
                        {scoredSite ? (
                          <Link to={`/site/${e.id}`}>{loc(scoredSite.name)}</Link>
                        ) : (
                          <>
                            {cand ? loc(cand.name) : e.id} <span className="pill warn small">{t('atlas.legendCandidate')}</span>
                          </>
                        )}
                      </th>
                      <td>{ltr(`${num(e.annual.T2M, 1)} °C`)}</td>
                      <td className="nowrap">{monthRange(months, e.derived.coolest_months)} · {ltr(`${num(meanOver(T, e.derived.coolest_months), 1)} °C`)}</td>
                      <td className="nowrap">{months[hot]} · {ltr(`${num(T[hot], 1)} °C`)}</td>
                      <td>{ltr(`${num(e.annual.T2M_RANGE, 1)} °C`)}</td>
                      <td className="nowrap">{t('env.rainVal', { mm: num(e.derived.precip_mm_per_year) })}</td>
                      <td>{num(e.annual.ALLSKY_SFC_SW_DWN, 2)}</td>
                      <td>{num(e.annual.RH2M)}%</td>
                      <td>{num(e.cell_elevation_m)} m</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="note small">{t('env.atlasNote')}</p>
          <p className="muted small">
            {t('env.source', { api: env.source.api, period: periodYears(env.source.period) })}{' '}
            <a href={ENV_URL} download="oman-analog-explorer-environment.json">{t('env.download')}</a>
          </p>
        </>
      )}

      <h2>{t('atlas.benchTitle')}</h2>
      <div className="atlas-grid">
        {BENCHMARKS.map((s) => (
          <article key={s.id} className="panel atlas-card">
            <h3>{loc(s.name)}</h3>
            <p className="muted small">{loc(s.place)}</p>
            <p className="atlas-tags">
              {s.categories.map((c) => (
                <span key={c} className="pill soft">{t(`atlas.cat_${c}`)}</span>
              ))}
              {s.bodies.map((b) => (
                <span key={b} className="body-tag">
                  <span className={`dot ${b}`} /> {t(b === 'moon' ? 'atlas.forMoon' : 'atlas.forMars')}
                </span>
              ))}
            </p>
            <p className="small"><strong>{loc(s.programme)}.</strong> {loc(s.what)}</p>
            <p className="small muted">
              {t('atlas.source')}: <a href={s.source.url} target="_blank" rel="noreferrer">{s.source.label}</a>
            </p>
          </article>
        ))}
      </div>

      <div className="grid two atlas-bottom">
        <section className="panel">
          <h2>{t('atlas.trackTitle')}</h2>
          <ol className="timeline">
            {OMAN_TRACK.map((e) => (
              <li key={e.source.url}>
                <strong>{loc(e.when)}</strong>
                <p className="small">{loc(e.what)}</p>
                <a className="small" href={e.source.url} target="_blank" rel="noreferrer">{e.source.label}</a>
              </li>
            ))}
          </ol>
        </section>
        <section className="panel">
          <h2>
            <span className="dot moon" /> {t('atlas.moonTitle')}
          </h2>
          <p className="small">{t('atlas.moonText')}</p>
          <p className="muted small">{t('atlas.moonList')}</p>
          <ul className="artemis-list">
            {ARTEMIS_REGIONS.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {findSite(data, 'moon_south_pole') && (
            <Link to="/site/moon_south_pole" className="btn ghost small">
              {loc(findSite(data, 'moon_south_pole')!.name)} →
            </Link>
          )}
          <ul className="small muted source-list">
            {ARTEMIS_SOURCES.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <ContinueExploring from="atlas" />
    </div>
  );
}
