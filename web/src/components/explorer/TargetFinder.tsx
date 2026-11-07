import { ScoreBar } from '../similarity/ScoreBadge';
import { useI18n } from '../../i18n';
import { kmFromMuscat, mineralsFromLowSignal, sharedFeatures } from '../../lib/analysis';
import { analogsFor, findSite, useDataset } from '../../lib/data';
import type { Site } from '../../types';

interface Props {
  target: Site;
  onSelectTarget: (id: string) => void;
  /** Open an Omani site against this target in the given explorer view. */
  onOpen: (earthId: string, view: 'map' | 'compare') => void;
}

/** Target-first view: pick a Mars landing region or the Moon base site, see the Omani sites ranked for it. */
export default function TargetFinder({ target, onSelectTarget, onOpen }: Props) {
  const { t, loc, lang, num } = useI18n();
  const data = useDataset();
  const ranked = analogsFor(data, target.id);
  const criteria = Object.keys(data.config.criteria);
  const hasLayer = target.body !== 'moon';
  // Shown once under the list when surface physics rests on fewer features than defined (same for every Omani site).
  const surfNote = ranked
    .map((m) => findSite(data, m.earth))
    .filter((e): e is Site => !!e)
    .map((e) => sharedFeatures(data, 'surface', e, target))
    .find((x) => x.shared > 0 && x.shared < x.total);

  return (
    <div className="finder">
      <div className="finder-head">
        <h2>{t('explorer.findTitle')}</h2>
        <p className="muted">{t('explorer.findIntro')}</p>
      </div>

      <div className="finder-targets" role="radiogroup" aria-label={t('explorer.target')}>
        {data.targets.map((tg) => (
          <button
            key={tg.id}
            type="button"
            role="radio"
            aria-checked={tg.id === target.id}
            className={`finder-target ${tg.body}${tg.id === target.id ? ' active' : ''}`}
            onClick={() => onSelectTarget(tg.id)}
          >
            <span className="finder-thumb" aria-hidden="true">
              {tg.body !== 'moon' ? (
                <img src={`${import.meta.env.BASE_URL}layers/${tg.id}/elevation.png`} alt="" loading="lazy" draggable={false} />
              ) : (
                <span className="moon-disc" />
              )}
            </span>
            <span className="finder-target-text">
              <span className="muted small">
                <span className={`dot ${tg.body}`} /> {t(`body.${tg.body}`)}
              </span>
              <strong>{loc(tg.name)}</strong>
            </span>
          </button>
        ))}
      </div>

      <div className="finder-body">
        <div className="panel finder-target-card">
          {hasLayer && (
            <img className="finder-hero" src={`${import.meta.env.BASE_URL}layers/${target.id}/elevation.png`} alt="" draggable={false} />
          )}
          <h3>
            <span className={`dot ${target.body}`} /> {loc(target.name)}
          </h3>
          <p>{target.card[lang].summary}</p>
          {target.body === 'moon' && <p className="note small">{t('explorer.findMoonNote')}</p>}
        </div>

        <div className="panel">
          <h3>{t('explorer.findRanked', { name: loc(target.name) })}</h3>
          <ol className="finder-list">
            {ranked.map((m, i) => {
              const earth = findSite(data, m.earth);
              if (!earth) return null;
              const low = mineralsFromLowSignal(data, earth, target);
              const km = kmFromMuscat(earth);
              return (
                <li key={earth.id} className={i === 0 ? 'top' : undefined}>
                  <span className="rank">#{i + 1}</span>
                  <div className="finder-main">
                    <div className="finder-name">
                      <strong>{loc(earth.name)}</strong>
                      {i === 0 && m.overall != null && <span className="pill ok">{t('explorer.findBest')}</span>}
                      {earth.role === 'reference' && <span className="pill ref">{t('explorer.reference')}</span>}
                    </div>
                    <ScoreBar value={m.overall} />
                    <div className="finder-crit muted small">
                      {criteria.map((c) => (
                        <span key={c}>
                          {t(`criteria.${c}`)}{' '}
                          {m.per_criterion[c] == null ? t('score.noData') : `${num(m.per_criterion[c]! * 100)}%`}
                        </span>
                      ))}
                      <span>
                        {t('score.confidence')} {num(m.confidence * 100)}%
                      </span>
                      {km !== null && <span>{t('explorer.findAccess', { km: num(km) })}</span>}
                    </div>
                    {low && (
                      <div className="finder-flags">
                        <span className="pill warn" title={t('explorer.flagLowSignalText')}>
                          {t('explorer.flagLowSignal')}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="finder-actions">
                    <button type="button" className="btn ghost small" onClick={() => onOpen(earth.id, 'map')}>
                      {t('explorer.findMap')}
                    </button>
                    <button type="button" className="btn ghost small" onClick={() => onOpen(earth.id, 'compare')}>
                      {t('explorer.findCompare')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          {surfNote && (
            <p className="note small">{t('explorer.flagSurfacePartial', { n: num(surfNote.shared), total: num(surfNote.total) })}</p>
          )}
        </div>
      </div>
    </div>
  );
}
