import { useMemo, useState } from 'react';
import CriteriaRadar from '../charts/CriteriaRadar';
import FeatureBars from '../charts/FeatureBars';
import MetricValue from '../site/MetricValue';
import ScoreBadge, { ScoreBar } from '../similarity/ScoreBadge';
import WeightSliders from '../similarity/WeightSliders';
import { useI18n } from '../../i18n';
import { featureGaps, formatRaw, mineralsFromLowSignal, pairWeightRange, sharedFeatures, weightGrid } from '../../lib/analysis';
import { useDataset } from '../../lib/data';
import { defaultWeights, similarity } from '../../lib/similarity';
import type { Site, Weights } from '../../types';

const EARTH_HEX = '#3fb6a8';
const BODY_HEX = { earth: EARTH_HEX, mars: '#e0703f', moon: '#b8c2d6' } as const;

interface Props {
  earth: Site;
  target: Site;
}

/** Weight sliders, per-criterion scores and raw values for one Oman site and one target (Explorer tab). */
export default function CompareView({ earth, target }: Props) {
  const { t, loc, num } = useI18n();
  const data = useDataset();
  const [weights, setWeights] = useState<Weights>(() => defaultWeights(data.config));

  const result = useMemo(
    () => similarity(earth.raw, target.raw, earth.resolution_m, target.resolution_m, data.config, weights, earth.body, target.body),
    [earth, target, data.config, weights],
  );

  const criteria = Object.keys(data.config.criteria);
  const features = Object.values(data.config.criteria).flatMap((c) => c.features);
  const def = defaultWeights(data.config);
  // Illustrative lenses: the published weights plus three use cases (terrain / minerals / surface emphasis).
  const presets = [
    { key: 'default', weights: def },
    { key: 'rover', weights: { ...def, terrain: 0.8, mineralogy: 0, surface: 0.2 } },
    { key: 'science', weights: { ...def, terrain: 0.2, mineralogy: 0.7, surface: 0.1 } },
    { key: 'surface', weights: { ...def, terrain: 0.3, mineralogy: 0.1, surface: 0.6 } },
  ];
  const lowSignal = mineralsFromLowSignal(data, earth, target);
  // When the mineral match comes only from shared weak signals, do not present it as the "closest match".
  const gaps = useMemo(
    () => featureGaps(data, earth, target).filter((g) => !(lowSignal && g.criterion === 'mineralogy')),
    [data, earth, target, lowSignal],
  );
  const range = useMemo(() => pairWeightRange(data, earth, target), [data, earth, target]);
  const combos = useMemo(() => weightGrid(data).length, [data]);
  const notCompared = features.filter((f) => earth.raw[f] == null || target.raw[f] == null);
  const fmt = (f: string, v: number) => formatRaw(f, v, num);

  return (
    <div className="compare-view">
      <p className="lead">{t('compare.intro')}</p>

      <div className="grid compare-top">
        <div className="panel">
          <h2>{t('compare.weights')}</h2>
          <p className="muted small lens-intro">
            <strong>{t('compare.lensTitle')}.</strong> {t('compare.lensIntro')}
          </p>
          <WeightSliders weights={weights} onChange={setWeights} onReset={() => setWeights(def)} presets={presets} />
        </div>
        <div className="panel result-panel">
          {result.overall === null ? (
            <p className="muted">{t('compare.zeroWeights')}</p>
          ) : (
            <ScoreBadge overall={result.overall} confidence={result.confidence} size="lg" />
          )}
          <dl className="breakdown">
            <div><dt>{t('score.coverage')}</dt><dd>{num(result.coverage * 100)}%</dd></div>
            <div><dt>{t('score.resolution')}</dt><dd>{num(result.resolution_factor * 100)}%</dd></div>
          </dl>
          <p className="muted small">{t('compare.breakdown')}</p>
          {range && (
            <p className="small range-line">
              <strong>{t('compare.rangeTitle')}:</strong>{' '}
              {t('compare.rangeText', { n: combos, min: num(range.min * 100), max: num(range.max * 100) })}
            </p>
          )}
          {target.body === 'moon' && <p className="note">{t('compare.moonNote')}</p>}
          {lowSignal && (
            <p className="note warn small">
              <strong>{t('explorer.flagLowSignal')}.</strong> {t('explorer.flagLowSignalText')}
            </p>
          )}
          {(() => {
            const sf = sharedFeatures(data, 'surface', earth, target);
            return sf.shared > 0 && sf.shared < sf.total ? (
              <p className="note small">{t('explorer.flagSurfacePartial', { n: num(sf.shared), total: num(sf.total) })}</p>
            ) : null;
          })()}
        </div>
      </div>

      {gaps.length > 0 && (
        <div className="panel why-panel">
          <h2>{t('compare.whyTitle')}</h2>
          <ul>
            <li>
              {t('compare.whyClosest', { feature: t(`features.${gaps[0].feature}`), a: fmt(gaps[0].feature, gaps[0].a), b: fmt(gaps[0].feature, gaps[0].b) })}
            </li>
            {gaps.length > 1 && (
              <li>
                {t('compare.whyFurthest', {
                  feature: t(`features.${gaps[gaps.length - 1].feature}`),
                  a: fmt(gaps[gaps.length - 1].feature, gaps[gaps.length - 1].a),
                  b: fmt(gaps[gaps.length - 1].feature, gaps[gaps.length - 1].b),
                })}
              </li>
            )}
            {notCompared.length > 0 && <li className="muted">{t('compare.whyMissing', { list: notCompared.map((f) => t(`features.${f}`)).join(', ') })}</li>}
          </ul>
        </div>
      )}

      <div className="grid two">
        <div className="panel">
          <h2>{t('compare.perCriterion')}</h2>
          <CriteriaRadar criteria={criteria} series={[{ name: loc(target.name), color: BODY_HEX[target.body], values: result.per_criterion }]} />
          <table className="table">
            <tbody>
              {criteria.map((c) => (
                <tr key={c}>
                  <td>{t(`criteria.${c}`)}</td>
                  <td className="bar-cell"><ScoreBar value={result.per_criterion[c]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h2>{t('compare.features')}</h2>
          <FeatureBars config={data.config} a={earth} b={target} colorA={EARTH_HEX} colorB={BODY_HEX[target.body]} />
        </div>
      </div>

      <div className="panel">
        <h2>{t('compare.rawValues')}</h2>
        <table className="table">
          <thead>
            <tr>
              <th>{t('compare.feature')}</th>
              <th><span className="dot earth" /> {loc(earth.name)}</th>
              <th><span className={`dot ${target.body}`} /> {loc(target.name)}</th>
            </tr>
          </thead>
          <tbody>
            {features.map((f) => (
              <tr key={f}>
                <td>{t(`features.${f}`)}</td>
                <td><MetricValue site={earth} feature={f} /></td>
                <td><MetricValue site={target} feature={f} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
