import { Link, useParams } from 'react-router-dom';
import CriteriaRadar from '../components/charts/CriteriaRadar';
import MetricValue from '../components/site/MetricValue';
import ScoreBadge, { ScoreBar } from '../components/similarity/ScoreBadge';
import { useI18n } from '../i18n';
import { analogsFor, bestMatch, findSite, isExtraSite, matchesFor, useDataset } from '../lib/data';
import { BENCHMARKS, OMAN_CANDIDATES } from '../lib/atlas';
import { formatCoords } from '../lib/geo';
import { kmFromMuscat, mineralsFromLowSignal, sharedFeatures } from '../lib/analysis';
import { FIELD_NOTES } from '../lib/fieldNotes';
import { layerUrl, useLayerMeta } from '../lib/layerMeta';
import { envSite, useEnvironment } from '../lib/environment';
import EnvironmentPanel from '../components/site/EnvironmentPanel';
import ContinueExploring from '../components/common/ContinueExploring';

const BODY_HEX = { earth: '#3fb6a8', mars: '#e0703f', moon: '#b8c2d6' } as const;

export default function SiteDetail() {
  const { id } = useParams();
  const { t, loc, lang, num } = useI18n();
  const data = useDataset();
  const site = findSite(data, id);
  const meta = useLayerMeta(site && site.body !== 'moon' ? site.id : null);
  const env = useEnvironment();
  const climate = envSite(env, site?.id);

  if (!site) {
    return (
      <div className="page">
        <p>{t('site.notFound')}</p>
        <Link to="/explorer">{t('site.back')}</Link>
      </div>
    );
  }

  const isEarth = site.body === 'earth';
  const ranked = isEarth ? matchesFor(data, site.id) : analogsFor(data, site.id);
  const headline = isEarth ? bestMatch(data, site) : ranked[0];
  const counterpart = findSite(data, headline ? (isEarth ? headline.target : headline.earth) : null);
  const card = site.card[lang];
  const criteria = Object.keys(data.config.criteria);
  const features = Object.values(data.config.criteria).flatMap((c) => c.features);
  const bodyOf = (tid: string) => findSite(data, tid)?.body;
  const marsTwin = isEarth ? bestMatch(data, site) : undefined;
  const moonTwin = isEarth ? ranked.find((m) => m.overall !== null && bodyOf(m.target) === 'moon') : undefined;
  const applicable = site.measured.length + site.missing.filter((m) => m.status === 'unavailable').length;
  const glance: { label: string; value: string; body?: string }[] = [];
  if (isEarth) {
    const mars = findSite(data, marsTwin?.target);
    const moon = findSite(data, moonTwin?.target);
    if (mars && marsTwin?.overall != null) glance.push({ label: t('site.bestMars'), value: `${loc(mars.name)} · ${num(marsTwin.overall * 100)}%`, body: 'mars' });
    if (moon && moonTwin?.overall != null) glance.push({ label: t('site.bestMoon'), value: `${loc(moon.name)} · ${num(moonTwin.overall * 100)}%`, body: 'moon' });
  } else {
    const top = ranked[0];
    const oman = findSite(data, top?.earth);
    if (oman && top?.overall != null) glance.push({ label: t('site.bestOman'), value: `${loc(oman.name)} · ${num(top.overall * 100)}%`, body: 'earth' });
  }
  glance.push({ label: t('site.coverageFact'), value: t('site.coverageVal', { m: num(site.measured.length), n: num(applicable) }) });
  glance.push({ label: t('home.area'), value: t('home.areaValue', { n: num(site.bbox_km * 2) }) });
  const extra = isExtraSite(site);
  const atlasEntry = [...BENCHMARKS, ...OMAN_CANDIDATES].find((a) => a.id === site.id);
  const km = site.role === 'benchmark' ? null : kmFromMuscat(site);
  if (km !== null) glance.push({ label: t('site.access'), value: t('site.accessVal', { km: num(km) }) });
  // Honest flags on the headline pair (same checks as the explorer).
  const pairEarth = isEarth ? site : counterpart;
  const pairTarget = isEarth ? counterpart : site;
  const lowSignal = !!(pairEarth && pairTarget && mineralsFromLowSignal(data, pairEarth, pairTarget));
  const surf = pairEarth && pairTarget ? sharedFeatures(data, 'surface', pairEarth, pairTarget) : null;
  const notes = FIELD_NOTES[site.id];
  const slopeKeys = meta?.common ? Object.keys(meta.common.slope_share) : [];
  const slopeLabel = (k: string) => {
    const [lo, hi] = k.split('-');
    return hi === '90' ? `> ${lo}°` : `${lo}–${hi}°`;
  };

  return (
    <div className="page">
      <div className="detail-tools no-print">
        <nav className="breadcrumb" aria-label={t('common.breadcrumb')}>
          <Link to="/">{t('nav.home')}</Link>
          <span aria-hidden="true">›</span>
          {isExtraSite(site) ? (
            <Link to="/atlas">{t('nav.atlas')}</Link>
          ) : (
            <Link to={isEarth ? `/explorer?site=${site.id}` : '/explorer?view=targets'}>{t('nav.explorer')}</Link>
          )}
          <span aria-hidden="true">›</span>
          <span>{t(`body.${site.body}`)}</span>
          <span aria-hidden="true">›</span>
          <span aria-current="page">{loc(site.name)}</span>
        </nav>
        <button type="button" className="btn ghost small" onClick={() => window.print()}>
          {t('site.print')}
        </button>
      </div>

      {site.body !== 'moon' && (
        <div className={`detail-banner ${site.body}`}>
          <img src={layerUrl(site.id, 'elevation.png')} alt={t('site.reliefImgAlt')} draggable={false} />
        </div>
      )}

      <header className="detail-head">
        <div>
          <p className="kicker">
            <span className={`dot ${site.body}`} /> {t(`body.${site.body}`)}
            {isEarth && ` · ${t(`site.role_${site.role ?? 'analog'}`)}`}
            {site.country && ` · ${loc(site.country)}`}
          </p>
          <h1>{loc(site.name)}</h1>
          <p className="coords-line muted">
            {t('site.coords')}: <bdi dir="ltr">{formatCoords(site.lat, site.lon)}</bdi>
            {site.coords_approximate && <> <span className="pill warn">{t('site.coordsApprox')}</span></>}
          </p>
          {site.coords_note && <p className="muted small">{loc(site.coords_note)}</p>}
        </div>
        {headline && counterpart && (
          <div className="detail-score">
            <ScoreBadge overall={headline.overall} confidence={headline.confidence} size="lg" />
            <span className="muted">{t('site.profileVs', { name: loc(counterpart.name) })}</span>
          </div>
        )}
      </header>

      <dl className="glance" aria-label={t('site.glance')}>
        {glance.map((g) => (
          <div key={g.label}>
            <dt>{g.label}</dt>
            <dd>
              {g.body && <span className={`dot ${g.body}`} />} {g.value}
            </dd>
          </div>
        ))}
      </dl>

      {(lowSignal || (surf && surf.shared > 0 && surf.shared < surf.total)) && (
        <div className="flags">
          {lowSignal && (
            <p className="note warn small">
              <strong>{t('explorer.flagLowSignal')}.</strong> {t('explorer.flagLowSignalText')}
            </p>
          )}
          {surf && surf.shared > 0 && surf.shared < surf.total && (
            <p className="note small">{t('explorer.flagSurfacePartial', { n: num(surf.shared), total: num(surf.total) })}</p>
          )}
        </div>
      )}

      <p className="lead">{card.summary}</p>

      {extra && (
        <p className="note small">
          {t(site.role === 'candidate' ? 'site.extraCandidate' : 'site.extraBenchmark')}
          {atlasEntry && (
            <>
              {' '}
              {t('atlas.source')}: <a href={atlasEntry.source.url} target="_blank" rel="noreferrer">{atlasEntry.source.label}</a>
            </>
          )}
          {site.coords_source && <span className="muted"> · {t('site.coordsFrom', { src: site.coords_source })}</span>}
        </p>
      )}

      {notes && (
        <section className="panel field-notes">
          <h2>
            {t('site.notesTitle')} <span className="pill soft">{t('site.notesBadge')}</span>
          </h2>
          <div className="grid two">
            <div>
              <h3>{t('site.rehearse')}</h3>
              <ul>
                {notes.rehearse.map((r) => (
                  <li key={r.en}>{loc(r)}</li>
                ))}
              </ul>
            </div>
            {notes.resources && (
              <div>
                <h3>{t('site.resources')}</h3>
                <p>{loc(notes.resources)}</p>
              </div>
            )}
          </div>
        </section>
      )}

      {env && climate && <EnvironmentPanel env={env} site={climate} demRange={meta?.elevation_m ?? null} />}

      {meta?.common && (
        <section className="panel slope-profile">
          <h2>{t('site.slopeTitle')}</h2>
          <p className="muted small">{t('site.slopeText', { n: num(meta.half_km * 2) })}</p>
          <div className="slope-bar" role="img" aria-label={slopeKeys.map((k) => `${slopeLabel(k)} ${num(meta.common!.slope_share[k] * 100)}%`).join(', ')}>
            {slopeKeys.map((k, i) => (
              <span key={k} style={{ width: `${meta.common!.slope_share[k] * 100}%`, background: meta.slope.colors[i] }} />
            ))}
          </div>
          <ul className="slope-legend">
            {slopeKeys.map((k, i) => (
              <li key={k}>
                <i style={{ background: meta.slope.colors[i] }} /> {slopeLabel(k)} <strong>{num(meta.common!.slope_share[k] * 100)}%</strong>
              </li>
            ))}
          </ul>
          <p className="muted small">{t('site.slopeSource', { dataset: meta.source.dataset })}</p>
        </section>
      )}

      {(card.similarities || card.differences) && (
        <div className="grid two">
          {card.similarities && (
            <div className="panel list-panel good">
              <h2>{t('site.similarities')}</h2>
              <ul>{card.similarities.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          )}
          {card.differences && (
            <div className="panel list-panel warn">
              <h2>{t('site.differences')}</h2>
              <ul>{card.differences.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      <div className="grid two">
        <div className="panel">
          <h2>{isEarth ? t('site.matches') : t('site.omanRanked')}</h2>
          <div className="table-wrap flush"><table className="table">
            <tbody>
              {ranked.map((m) => {
                const other = findSite(data, isEarth ? m.target : m.earth)!;
                const earthId = isEarth ? site.id : other.id;
                const targetId = isEarth ? other.id : site.id;
                return (
                  <tr key={other.id}>
                    <td>
                      <span className={`dot ${other.body}`} /> <Link to={`/site/${other.id}`}>{loc(other.name)}</Link>
                    </td>
                    <td className="bar-cell"><ScoreBar value={m.overall} /></td>
                    <td className="muted nowrap">{t('score.confidence')} {num(m.confidence * 100)}%</td>
                    <td>{!extra && !isExtraSite(other) && <Link className="btn ghost small" to={`/explorer?view=compare&site=${earthId}&target=${targetId}`}>{t('site.compare')}</Link>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>

        {headline && counterpart && (
          <div className="panel">
            <h2>{t('site.profile')} <span className="muted small">{t('site.profileVs', { name: loc(counterpart.name) })}</span></h2>
            <CriteriaRadar criteria={criteria} series={[{ name: loc(counterpart.name), color: BODY_HEX[isEarth ? counterpart.body : site.body], values: headline.per_criterion }]} />
          </div>
        )}
      </div>

      <div className="grid two">
        <div className="panel">
          <h2>{t('site.data')}</h2>
          <div className="table-wrap flush"><table className="table">
            <thead>
              <tr><th>{t('site.criterion')}</th><th>{t('site.datasets')}</th><th>{t('site.resolution')}</th></tr>
            </thead>
            <tbody>
              {criteria.map((c) => {
                const provs = data.config.criteria[c].features.map((f) => site.provenance[f]).filter(Boolean);
                const res = [...new Set(provs.map((p) => p.native_resolution_m))];
                return (
                  <tr key={c}>
                    <td>{t(`criteria.${c}`)}</td>
                    <td>{site.sources[c]?.length ? site.sources[c].join('; ') : t('metric.notAvailable')}</td>
                    <td className="nowrap">{res.length ? res.map((r) => `${num(r)} ${t('units.relief_m')}`).join(' / ') : t('site.none')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
        <div className="panel">
          <h2>{t('site.rawMetrics')}</h2>
          <div className="table-wrap flush"><table className="table">
            <tbody>
              {features.map((f) => (
                <tr key={f}>
                  <td>
                    {t(`features.${f}`)}{' '}
                    {site.raw[f] != null && <span className="pill ok">{t('site.tagMeasured')}</span>}
                  </td>
                  <td><MetricValue site={site} feature={f} detailed /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      </div>
      <ContinueExploring from="site" />
    </div>
  );
}
