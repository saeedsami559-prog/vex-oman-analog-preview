import { useMemo } from 'react';
import { useI18n } from '../i18n';
import { weightSensitivity } from '../lib/analysis';
import { useDataset } from '../lib/data';
import type { Body } from '../types';
import ContinueExploring from '../components/common/ContinueExploring';
import PageToc from '../components/common/PageToc';

const FORMULA = `x'           = log10(x) for roughness and relief, x otherwise
norm(x)      = clip((x' − min) / (max − min), 0, 1)   min, max = measured over all sites
               (mineral indices: min, max over the same body's sites, one instrument each)
score_c      = mean over features measured on both sides of (1 − |norm_a − norm_b|)
               (minerals: skipped when both sides < 0.2 of their body's range)
overall      = Σ w_c · score_c  /  Σ w_c            (criteria with data)
coverage     = Σ w_c · (shared_c / n_c) / Σ w_c     (every missing feature lowers it)
res_factor_c = max(0.5, 1 − 0.1 · |log2(res_a / res_b)|)   (terrain: common grid → 1)
confidence   = coverage × weighted mean(res_factor_c)`;

export default function Methodology() {
  const { t, tl, num, loc } = useI18n();
  const data = useDataset();
  const { config, validation } = data;
  const sens = useMemo(() => weightSensitivity(data), [data]);
  const leader = sens.rows[0];
  const ref = sens.rows.find((r) => r.site.id === validation.reference_site);

  // Datasets actually used for this criterion on this body (from the exported provenance).
  const datasetsFor = (criterion: string, body: Body) =>
    [...new Set([...data.earth_sites, ...data.targets].filter((s) => s.body === body).flatMap((s) => s.sources[criterion] ?? []))].join('; ') ||
    t('metric.notAvailable');

  return (
    <div className="page prose">
      <h1>{t('methodology.title')}</h1>
      <p className="lead">{t('methodology.intro')}</p>
      <PageToc />

      <section className="pipeline" aria-labelledby="pipeline-title">
        <h2 id="pipeline-title">{t('methodology.pipelineTitle')}</h2>
        <ol className="pipeline-steps">
          {[1, 2, 3, 4].map((i) => (
            <li key={i}>
              <span className="pipeline-num">{num(i)}</span>
              <strong>{t(`methodology.step${i}`)}</strong>
              <span className="muted small">{t(`methodology.step${i}Text`)}</span>
            </li>
          ))}
        </ol>
      </section>

      <h2>{t('methodology.criteriaTitle')}</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('methodology.colCriterion')}</th>
              <th>{t('methodology.colFeatures')}</th>
              <th>{t('methodology.colWeight')}</th>
              <th>{t('methodology.colEarth')}</th>
              <th>{t('methodology.colMars')}</th>
              <th>{t('methodology.colMoon')}</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(config.criteria).map(([name, spec]) => (
              <tr key={name}>
                <td><strong>{t(`criteria.${name}`)}</strong></td>
                <td>
                  {spec.features.map((f) => (
                    <div key={f}>
                      {t(`features.${f}`)}{' '}
                      <span className="muted small">
                        {config.feature_ranges_by_body?.[f]
                          ? (['earth', 'mars'] as Body[]).map((b) => {
                              const r = config.feature_ranges_by_body![f][b];
                              return `${t(`body.${b}`)} [${r ? r.map((v) => num(v, 4)).join('–') : t('metric.notAvailable')}]`;
                            }).join(' · ')
                          : config.feature_ranges[f]
                            ? `[${config.feature_ranges[f]!.map((v) => num(v, 3)).join('–')}${config.feature_scale?.[f] ? ` ${config.feature_scale[f]}` : t(`units.${f}`) ? ` ${t(`units.${f}`)}` : ''}]`
                            : `[${t('metric.notAvailable')}]`}
                      </span>
                    </div>
                  ))}
                </td>
                <td className="num-cell">{num(spec.weight * 100)}%</td>
                <td>{datasetsFor(name, 'earth')}</td>
                <td>{datasetsFor(name, 'mars')}</td>
                <td>{datasetsFor(name, 'moon')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>{t('methodology.normTitle')}</h2>
      <p>{t('methodology.normText')}</p>

      <h2>{t('methodology.scoreTitle')}</h2>
      <p>{t('methodology.scoreText')}</p>
      <pre className="formula" dir="ltr">{FORMULA}</pre>

      <h2>{t('methodology.confTitle')}</h2>
      <p>{t('methodology.confText')}</p>

      <h2>{t('methodology.scaleTitle')}</h2>
      <p>{t('methodology.scaleText', { scale: config.common_terrain_scale_m })}</p>

      <h2>{t('methodology.validationTitle')}</h2>
      <p>{t('methodology.validationText', { rank: validation.reference_rank ?? '–', total: validation.ranking.length })}</p>

      <section className="sensitivity">
        <h2>{t('methodology.sensTitle')}</h2>
        <p>{t('methodology.sensText', { n: sens.combos })}</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('methodology.sensColSite')}</th>
                <th>{t('methodology.sensColDefault')}</th>
                <th>{t('methodology.sensColFirst')}</th>
                <th>{t('methodology.sensColRange')}</th>
              </tr>
            </thead>
            <tbody>
              {sens.rows.map((r) => (
                <tr key={r.site.id} className={r.site.id === validation.reference_site ? 'is-ref-row' : undefined}>
                  <td>{loc(r.site.name)}</td>
                  <td className="num-cell">#{r.defaultRank}</td>
                  <td>
                    <span className="sens-bar" aria-hidden="true">
                      <i style={{ width: `${r.firstShare * 100}%` }} />
                    </span>{' '}
                    <strong>{num(r.firstShare * 100)}%</strong>
                  </td>
                  <td className="num-cell">
                    #{r.bestRank} – #{r.worstRank}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {leader && ref && (
          <p className="note">
            {t('methodology.sensTakeaway', { site: loc(leader.site.name), share: num(leader.firstShare * 100), best: ref.bestRank, worst: ref.worstRank })}
          </p>
        )}
      </section>

      <h2>{t('methodology.limitsTitle')}</h2>
      <ul>{tl('methodology.limits').map((l) => <li key={l}>{l}</li>)}</ul>

      <section className="panel extend">
        <h2>{t('methodology.extendTitle')}</h2>
        <p>{t('methodology.extendIntro')}</p>
        <ol>
          {tl('methodology.extendSteps').map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="muted small">{t('methodology.extendNote')}</p>
      </section>

      <h2>{t('methodology.roadmapTitle')}</h2>
      <ul className="roadmap">{tl('methodology.roadmap').map((l) => <li key={l}>{l}</li>)}</ul>
      <ContinueExploring from="methodology" />
    </div>
  );
}
