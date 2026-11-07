import { Link } from 'react-router-dom';
import MetricValue from '../site/MetricValue';
import { ScoreBar } from '../similarity/ScoreBadge';
import { useI18n } from '../../i18n';
import { bestMatch, findSite, useDataset } from '../../lib/data';
import { referencesFor } from '../../lib/references';
import { DATA_SOURCES } from '../../lib/sources';
import type { Provenance, Site } from '../../types';

/** Short dataset tag (NASADEM, MOLA, CRISM...) for a provenance record. */
function sourceTag(p: Provenance | undefined): string | undefined {
  if (!p) return undefined;
  const d = p.dataset.toUpperCase();
  if (d.includes('MCD43') || d.includes('MODIS')) return 'MODIS';
  return DATA_SOURCES.find((s) => d.includes(s.id))?.id ?? p.dataset.split(/[\s(,]/)[0];
}

function Cell({ site, feature }: { site: Site; feature: string }) {
  const p = site.provenance[feature];
  const tag = sourceTag(p);
  return (
    <td>
      <MetricValue site={site} feature={feature} compact />
      {tag && (
        <span className="src-tag" title={`${p!.dataset} (${p!.version}) · ${p!.products.slice(0, 3).join(', ')}`}>{tag}</span>
      )}
    </td>
  );
}

interface Props {
  onOpen: (earthId: string, targetId?: string) => void;
}

/** Every site in one table, every value tagged with its dataset, plus the papers behind each pairing. */
export default function SitesTable({ onOpen }: Props) {
  const { t, loc } = useI18n();
  const data = useDataset();
  const criteria = Object.entries(data.config.criteria);
  const groups: [string, Site[]][] = [
    ['table.groupOman', data.earth_sites],
    ['table.groupTargets', data.targets],
  ];

  return (
    <div className="sites-table">
      <p className="lead">{t('table.intro')}</p>
      <div className="panel table-wrap">
        <table className="table dense">
          <thead>
            <tr>
              <th rowSpan={2}>{t('table.site')}</th>
              <th rowSpan={2}>{t('table.bestMatch')}</th>
              {criteria.map(([c, spec]) => (
                <th key={c} colSpan={spec.features.length} className="group-head">{t(`criteria.${c}`)}</th>
              ))}
            </tr>
            <tr>
              {criteria.flatMap(([, spec]) => spec.features.map((f) => <th key={f}>{t(`features.${f}`)}</th>))}
            </tr>
          </thead>
          {groups.map(([label, sites]) => (
            <tbody key={label}>
              <tr className="group-row"><th colSpan={2 + criteria.reduce((n, [, s]) => n + s.features.length, 0)}>{t(label)}</th></tr>
              {sites.map((s) => {
                const best = s.body === 'earth' ? bestMatch(data, s) : undefined;
                const bestSite = findSite(data, best?.target);
                return (
                  <tr key={s.id}>
                    <th scope="row">
                      <span className={`dot ${s.body}`} />{' '}
                      {s.body === 'earth' ? (
                        <button type="button" className="link-btn" onClick={() => onOpen(s.id)}>{loc(s.name)}</button>
                      ) : (
                        <Link to={`/site/${s.id}`}>{loc(s.name)}</Link>
                      )}
                    </th>
                    <td>
                      {best && bestSite ? (
                        <button type="button" className="link-btn match" onClick={() => onOpen(s.id, bestSite.id)}>
                          {loc(bestSite.name)}
                          <ScoreBar value={best.overall} />
                          <span className="muted small">{t('table.confidence', { pct: Math.round(best.confidence * 100) })}</span>
                        </button>
                      ) : (
                        <span className="muted">{s.role === 'reference' ? t('explorer.reference') : '—'}</span>
                      )}
                    </td>
                    {criteria.flatMap(([, spec]) => spec.features.map((f) => <Cell key={f} site={s} feature={f} />))}
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      <p className="muted small">{t('table.tagHelp')} <Link to="/sources">{t('nav.sources')}</Link></p>

      <h2>{t('table.evidenceTitle')}</h2>
      <p className="muted">{t('table.evidenceIntro')}</p>
      <div className="evidence-grid">
        {data.earth_sites.map((s) => {
          const targets = s.intended_targets ?? [];
          const refs = referencesFor(s.id, ...targets);
          const direct = refs.some((r) => r.sites.includes(s.id) && targets.some((id) => r.sites.includes(id)));
          return (
            <article key={s.id} className="panel evidence">
              <h3><span className="dot earth" /> {loc(s.name)}</h3>
              {targets.length > 0 && (
                <p className="muted small">
                  ↔ {targets.map((id) => findSite(data, id)).filter(Boolean).map((x) => loc(x!.name)).join(' · ')}
                </p>
              )}
              <ul className="refs">
                {refs.map((r) => (
                  <li key={r.id}>
                    <a href={r.url} target="_blank" rel="noreferrer">{r.cite}</a> — <em>{r.title}</em>. <span className="muted">{r.venue}</span>
                    <span className="ref-note">{loc(r.supports)}</span>
                  </li>
                ))}
              </ul>
              {!direct && targets.length > 0 && <p className="note small">{t('table.noDirect')}</p>}
            </article>
          );
        })}
      </div>
    </div>
  );
}
