import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { formatCoords } from '../../lib/geo';
import type { Score, Site } from '../../types';
import ScoreBadge, { ScoreBar } from '../similarity/ScoreBadge';

interface Props {
  site: Site;
  best?: Score;
  bestTarget?: Site;
  /** Best of the originally intended targets, shown when it is not the best match. */
  intended?: { score: Score; target: Site };
  /** Next-best targets after the headline match. */
  others?: { score: Score; target: Site }[];
  rank?: number;
  meanMars?: number | null;
  featured?: boolean;
}

/** Card for the home page grid: headline match, its per-criterion breakdown and quick terrain facts. */
export default function SiteCard({ site, best, bestTarget, intended, others = [], rank, meanMars, featured }: Props) {
  const { t, loc, lang, num } = useI18n();
  const { relief_m, slope_deg } = site.raw;
  const unavailable = site.missing.filter((m) => m.status === 'unavailable').length;
  const facts = [
    { label: t('features.relief_m'), text: relief_m != null ? `${num(relief_m)} ${t('units.relief_m')}` : t('metric.notAvailable') },
    { label: t('features.slope_deg'), text: slope_deg != null ? `${num(slope_deg, 1)}${t('units.slope_deg')}` : t('metric.notAvailable') },
    { label: t('home.area'), text: t('home.areaValue', { n: num(site.bbox_km * 2) }) },
    meanMars != null && { label: t('home.meanMars'), text: `${num(meanMars * 100)}%` },
  ].filter((f): f is { label: string; text: string } => Boolean(f));
  return (
    <Link to={`/site/${site.id}`} className={`site-card${featured ? ' featured' : ''}${site.role === 'reference' ? ' is-ref' : ''}`}>
      {site.body === 'earth' && (
        <div className="site-thumb" aria-hidden="true">
          <img src={`${import.meta.env.BASE_URL}layers/${site.id}/elevation.png`} alt="" loading="lazy" draggable={false} />
        </div>
      )}
      <div className="site-card-head">
        {rank !== undefined && (
          <span className="rank" title={t('home.rankTitle')}>
            #{rank}
          </span>
        )}
        <div className="site-card-title">
          <h3>{loc(site.name)}</h3>
          <p className="coords">{formatCoords(site.lat, site.lon)}</p>
        </div>
        {site.role === 'reference' && <span className="pill ref">{t('explorer.reference')}</span>}
      </div>
      <p className="card-flags">
        {site.coords_approximate && (
          <span className="pill soft" title={site.coords_note ? loc(site.coords_note) : undefined}>{t('site.coordsApprox')}</span>
        )}
        <span className={`pill ${unavailable ? 'soft' : 'ok'}`}>
          {unavailable ? t('site.someMissing', { n: unavailable }) : t('site.allMeasured')}
        </span>
      </p>

      <ul className="facts">
        {facts.map((f) => (
          <li key={f.label}>
            <span className="fact-label">{f.label}</span>
            <span className="fact-val">{f.text}</span>
          </li>
        ))}
      </ul>

      <p className="summary">{site.card[lang].summary}</p>

      {featured &&
        (['similarities', 'differences'] as const).map(
          (kind) =>
            !!site.card[lang][kind]?.length && (
              <div key={kind} className={`highlights ${kind}`}>
                <span className="muted">{t(`home.${kind}`)}</span>
                <ul>
                  {site.card[lang][kind]!.slice(0, 2).map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            ),
        )}

      {best && bestTarget && (
        <div className="best">
          <div className="best-head">
            <ScoreBadge overall={best.overall} confidence={best.confidence} size={featured ? 'lg' : 'sm'} />
            <span className="best-label">
              <span className="muted">{t('home.bestMatch')}</span>
              <span>
                <span className={`dot ${bestTarget.body}`} /> {loc(bestTarget.name)}
              </span>
            </span>
          </div>
          <dl className="crit-bars">
            {Object.entries(best.per_criterion).map(([k, v]) => (
              <div key={k}>
                <dt>{t(`criteria.${k}`)}</dt>
                <dd>
                  <ScoreBar value={v} />
                </dd>
              </div>
            ))}
          </dl>
          {intended && (
            <div className="also">
              <span className="muted">{t('home.intended')}</span>
              <ul>
                <li>
                  <span>
                    <span className={`dot ${intended.target.body}`} /> {loc(intended.target.name)}
                  </span>
                  <span className="also-val">{intended.score.overall === null ? t('metric.notAvailable') : `${num(intended.score.overall * 100)}%`}</span>
                </li>
              </ul>
            </div>
          )}
          {others.length > 0 && (
            <div className="also">
              <span className="muted">{t('home.alsoMatches')}</span>
              <ul>
                {others.map(({ score, target }) => (
                  <li key={target.id}>
                    <span>
                      <span className={`dot ${target.body}`} /> {loc(target.name)}
                    </span>
                    <span className="also-val">{score.overall === null ? t('metric.notAvailable') : `${num(score.overall * 100)}%`}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Link>
  );
}
