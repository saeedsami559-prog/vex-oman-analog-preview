import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { findSite, scoreFor } from '../../lib/data';
import { layerUrl, useLayerMeta } from '../../lib/layerMeta';
import type { Dataset, Site } from '../../types';

interface Pair {
  earth: Site;
  target: Site;
}

/** Earth sites paired with their best-scoring intended Mars target (Mars targets all have terrain layers). */
function marsPairs(data: Dataset): Pair[] {
  return data.earth_sites.flatMap((earth) => {
    const target = (earth.intended_targets ?? [])
      .map((id) => findSite(data, id))
      .filter((s): s is Site => !!s && s.body === 'mars')
      .sort((a, b) => (scoreFor(data, earth.id, b.id)?.overall ?? -1) - (scoreFor(data, earth.id, a.id)?.overall ?? -1))[0];
    return target ? [{ earth, target }] : [];
  });
}

/** Before/after slider: an Omani site and its Mars counterpart in the same shaded-relief style. */
export default function TwinSlider({ data }: { data: Dataset }) {
  const { t, loc, num } = useI18n();
  const pairs = marsPairs(data);
  const [index, setIndex] = useState(0);
  const [split, setSplit] = useState(50);
  const pair = pairs[Math.min(index, pairs.length - 1)];
  const earthMeta = useLayerMeta(pair?.earth.id);
  const marsMeta = useLayerMeta(pair?.target.id);
  const earthKm = earthMeta ? earthMeta.half_km * 2 : null;
  const marsKm = marsMeta ? marsMeta.half_km * 2 : null;
  if (!pair) return null;
  const score = scoreFor(data, pair.earth.id, pair.target.id);

  return (
    <section className="twin" aria-labelledby="twin-title">
      <div className="section-head">
        <h2 id="twin-title">{t('home.twinTitle')}</h2>
        <p className="muted">{t('home.twinSubtitle')}</p>
      </div>

      <div className="twin-tabs" role="tablist">
        {pairs.map((p, i) => (
          <button
            key={p.earth.id}
            type="button"
            role="tab"
            aria-selected={i === index}
            className={`twin-tab${i === index ? ' active' : ''}`}
            onClick={() => {
              setIndex(i);
              setSplit(50);
            }}
          >
            <span className="dot earth" /> {loc(p.earth.name)}
            <span className="twin-arrow" aria-hidden="true">↔</span>
            <span className="dot mars" /> {loc(p.target.name)}
          </button>
        ))}
      </div>

      <div className="twin-stage" dir="ltr" style={{ '--split': `${split}%` } as CSSProperties}>
        <img className="twin-img" src={layerUrl(pair.target.id, 'elevation.png')} alt={loc(pair.target.name)} draggable={false} />
        <img className="twin-img twin-top" src={layerUrl(pair.earth.id, 'elevation.png')} alt={loc(pair.earth.name)} draggable={false} />
        <span className="twin-label earth">
          <span className="dot earth" /> {loc(pair.earth.name)}
          {earthKm !== null && <small>{t('home.twinWindow', { n: num(earthKm) })}</small>}
        </span>
        <span className="twin-label mars">
          <span className="dot mars" /> {loc(pair.target.name)}
          {marsKm !== null && <small>{t('home.twinWindow', { n: num(marsKm) })}</small>}
        </span>
        <span className="twin-handle" aria-hidden="true">
          <span>‹ ›</span>
        </span>
        <input
          className="twin-range"
          type="range"
          min={0}
          max={100}
          value={split}
          onChange={(e) => setSplit(Number(e.target.value))}
          aria-label={t('home.twinHandle')}
        />
      </div>

      <div className="twin-foot">
        <p className="muted small">{t('home.twinCredit')}</p>
        <div className="twin-actions">
          {score?.overall != null && <span className="twin-score">{t('home.twinScore', { v: num(score.overall * 100) })}</span>}
          <Link to={`/explorer?site=${pair.earth.id}&target=${pair.target.id}`} className="btn ghost small">
            {t('home.twinOpen')}
          </Link>
        </div>
      </div>
    </section>
  );
}
