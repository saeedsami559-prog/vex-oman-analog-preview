import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AnalogMap from '../components/explorer/AnalogMap';
import CompareView from '../components/explorer/CompareView';
import SitesTable from '../components/explorer/SitesTable';
import TargetFinder from '../components/explorer/TargetFinder';
import TwinMaps from '../components/map/TwinMaps';
import ScoreBadge, { ScoreBar } from '../components/similarity/ScoreBadge';
import { useI18n } from '../i18n';
import { bestMatch, findSite, matchesFor, scoreFor, useDataset } from '../lib/data';
import ContinueExploring from '../components/common/ContinueExploring';
import { sharedFeatures } from '../lib/analysis';

type View = 'map' | 'compare' | 'targets' | 'map2' | 'table';
const VIEWS: View[] = ['map', 'compare', 'targets', 'map2', 'table'];

export default function Explorer() {
  const { t, loc, num } = useI18n();
  const data = useDataset();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const earth = data.earth_sites.find((s) => s.id === params.get('site')) ?? data.earth_sites[0];
  const matches = matchesFor(data, earth.id);
  const target =
    data.targets.find((s) => s.id === params.get('target')) ?? findSite(data, bestMatch(data, earth)?.target) ?? data.targets[0];
  const score = scoreFor(data, earth.id, target.id);

  const view: View = VIEWS.includes(params.get('view') as View) ? (params.get('view') as View) : 'map';

  const select = (site: string, tgt?: string, nextView: View = view) => {
    const next = new URLSearchParams({ site });
    if (tgt) next.set('target', tgt);
    if (nextView !== 'map') next.set('view', nextView);
    setParams(next, { replace: true });
  };
  const show = (v: View) => select(earth.id, target.id, v);

  return (
    <div className="page wide">
      <h1>{t('explorer.title')}</h1>
      <p className="lead">{t('explorer.intro')}</p>

      <div className="tabs" role="tablist">
        {VIEWS.map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'active' : ''} onClick={() => show(v)}>
            {t(`explorer.tab_${v}`)}
          </button>
        ))}
      </div>

      {view === 'table' ? (
        <SitesTable onOpen={(site, tgt) => select(site, tgt, tgt ? 'compare' : 'map')} />
      ) : view === 'map2' ? (
        <AnalogMap onOpen={(s) => navigate(`/site/${s.id}`)} />
      ) : view === 'targets' ? (
        <TargetFinder
          target={target}
          onSelectTarget={(id) => select(earth.id, id, 'targets')}
          onOpen={(site, v) => select(site, target.id, v)}
        />
      ) : (
      <div className="explorer">
        <aside className="panel site-list">
          <h2 className="small-title">{t('explorer.pickSite')}</h2>
          <ul>
            {data.earth_sites.map((s) => {
              const best = bestMatch(data, s);
              return (
                <li key={s.id}>
                  <button type="button" className={s.id === earth.id ? 'active' : ''} onClick={() => select(s.id)}>
                    <span className="name">{loc(s.name)}</span>
                    {s.role === 'reference' ? (
                      <span className="pill ref">{t('explorer.reference')}</span>
                    ) : (
                      best && <ScoreBar value={best.overall} />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="explorer-main">
          <div className="panel toolbar">
            <label className="field">
              <span>{t('explorer.target')}</span>
              <select value={target.id} onChange={(e) => select(earth.id, e.target.value)}>
                {matches.map((m) => {
                  const s = findSite(data, m.target)!;
                  const intended = earth.intended_targets?.includes(s.id);
                  return (
                    <option key={s.id} value={s.id}>
                      {t(`body.${s.body}`)} · {loc(s.name)} — {m.overall === null ? '–' : Math.round(m.overall * 100)}%
                      {intended ? ` ★ ${t('explorer.intended')}` : ''}
                    </option>
                  );
                })}
              </select>
            </label>
            {score && <ScoreBadge overall={score.overall} confidence={score.confidence} />}
            <div className="toolbar-links">
              <Link className="btn ghost small" to={`/site/${earth.id}`}>{t('explorer.openDetails')}</Link>
            </div>
          </div>

          {view === 'compare' ? (
            <CompareView earth={earth} target={target} />
          ) : (
          <>
          <TwinMaps
            earthSites={data.earth_sites}
            earth={earth}
            targets={data.targets}
            target={target}
            onSelectEarth={(id) => select(id)}
            onSelectTarget={(id) => select(earth.id, id)}
          />

          <div className="panel pair-strip">
            <p>
              <span className="dot earth" /> <strong>{loc(earth.name)}</strong> ↔ <span className={`dot ${target.body}`} /> <strong>{loc(target.name)}</strong>
            </p>
            <ul className="pair-coverage">
              {Object.keys(data.config.criteria).map((c) => {
                const sf = sharedFeatures(data, c, earth, target);
                return (
                  <li key={c} className={sf.shared === 0 ? 'muted' : undefined}>
                    {t(`criteria.${c}`)}: {t('explorer.sharedOf', { n: num(sf.shared), m: num(sf.total) })}
                  </li>
                );
              })}
            </ul>
            <button type="button" className="btn primary small" onClick={() => show('compare')}>
              {t('explorer.whyScore')} →
            </button>
          </div>
          </>
          )}
        </section>
      </div>
      )}
      <ContinueExploring from="explorer" />
    </div>
  );
}
