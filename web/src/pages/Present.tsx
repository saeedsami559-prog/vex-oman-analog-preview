import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { weightSensitivity } from '../lib/analysis';
import { bestMatch, findSite, useDataset } from '../lib/data';
import { layerUrl } from '../lib/layerMeta';

/** Seven-slide presentation built live from the data (fits the Space Apps 7-slide demo limit). */
export default function Present() {
  const { t, tl, loc, num } = useI18n();
  const data = useDataset();
  const [i, setI] = useState(0);
  const sens = useMemo(() => weightSensitivity(data), [data]);
  const v = data.validation;
  const mean = v.mean_mars_similarity;
  const ranked = [...data.earth_sites].sort((a, b) => (mean[b.id] ?? -1) - (mean[a.id] ?? -1));
  const all = [...data.earth_sites, ...data.targets];
  const measured = all.reduce((n, s) => n + s.measured.length, 0);
  const applicable = all.reduce((n, s) => n + s.measured.length + s.missing.filter((m) => m.status === 'unavailable').length, 0);
  const marsN = data.targets.filter((x) => x.body === 'mars').length;
  const moonN = data.targets.filter((x) => x.body === 'moon').length;
  const datasets = { earth: ['NASADEM', 'EMIT', 'MODIS'], mars: ['MGS MOLA', 'MRO CRISM', 'MGS TES', 'Odyssey THEMIS'], moon: ['LRO LOLA'] };
  const leader = sens.rows[0];

  const slides: ReactNode[] = [
    <div className="slide-title" key="s1">
      <img className="slide-logo" src={`${import.meta.env.BASE_URL}brand/vex-logo.jpg`} alt="Team VEX" />
      <p className="kicker">{t('present.s1Kicker')}</p>
      <h1>{t('app.title')}</h1>
      <p className="slide-sub">{t('home.kicker')}</p>
      <p className="slide-team">
        <span className="vex-mark">VEX</span> {t('present.s1Team')} · {t('home.footerTeam')}
      </p>
    </div>,
    <div key="s2">
      <h2>{t('present.s2Title')}</h2>
      <p className="slide-big">{t('home.heroTitle')}</p>
      <p>{t('about.challengeText')}</p>
      <p className="muted">{t('present.s2Point')}</p>
    </div>,
    <div key="s3">
      <h2>{t('present.s3Title')}</h2>
      <p className="slide-big">
        {t('present.s3Text', { e: data.earth_sites.length, m: marsN, mo: moonN, d: datasets.earth.length + datasets.mars.length + datasets.moon.length })}
      </p>
      <div className="slide-cols three">
        {(['earth', 'mars', 'moon'] as const).map((b) => (
          <div key={b} className="panel">
            <h3>
              <span className={`dot ${b}`} /> {t(`present.s3${b[0].toUpperCase()}${b.slice(1)}`)}
            </h3>
            <ul>{datasets[b].map((d) => <li key={d}>{d}</li>)}</ul>
          </div>
        ))}
      </div>
    </div>,
    <div key="s4">
      <h2>{t('present.s4Title')}</h2>
      <ol className="pipeline-steps">
        {[1, 2, 3, 4].map((k) => (
          <li key={k}>
            <span className="pipeline-num">{num(k)}</span>
            <strong>{t(`methodology.step${k}`)}</strong>
            <span className="muted small">{t(`methodology.step${k}Text`)}</span>
          </li>
        ))}
      </ol>
      <p className="muted">{t('home.p2Text')}</p>
    </div>,
    <div key="s5">
      <h2>{t('present.s5Title')}</h2>
      <p className="muted">{t('present.s5Text')}</p>
      <ol className="slide-results">
        {ranked.map((s, k) => {
          const bm = bestMatch(data, s);
          const twin = findSite(data, bm?.target);
          return (
            <li key={s.id}>
              <img src={layerUrl(s.id, 'elevation.png')} alt="" />
              <span className="rank">#{k + 1}</span>
              <strong>{loc(s.name)}</strong>
              <span className="muted">{mean[s.id] != null ? `${num(mean[s.id]! * 100)}%` : '–'}</span>
              <span>
                {twin && (
                  <>
                    <span className={`dot ${twin.body}`} /> {loc(twin.name)} {bm?.overall != null && <strong>{num(bm.overall * 100)}%</strong>}
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>,
    <div key="s6">
      <h2>{t('present.s6Title')}</h2>
      <ul className="slide-checks">
        {leader && <li>{t('present.s6a', { site: loc(leader.site.name), share: num(leader.firstShare * 100), n: sens.combos })}</li>}
        {v.reference_rank !== null && <li>{t('present.s6b', { rank: v.reference_rank, total: v.ranking.length })}</li>}
        <li>{t('present.s6c', { m: measured, n: applicable })}</li>
        <li>{t('present.s6d')}</li>
      </ul>
    </div>,
    <div key="s7">
      <h2>{t('present.s7Title')}</h2>
      <div className="slide-cols three">
        {[1, 2, 3].map((k) => (
          <div key={k} className="panel">
            <h3>{t(`home.impact${k}Title`)}</h3>
            <p className="small">{t(`home.impact${k}Text`)}</p>
          </div>
        ))}
      </div>
      <p>{t('present.s7Mission')}</p>
      <ul className="small muted">{tl('methodology.roadmap').slice(0, 2).map((r) => <li key={r}>{r}</li>)}</ul>
      <p className="slide-link">{t('present.s7Link')}</p>
    </div>,
  ];
  const n = slides.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const rtl = document.documentElement.dir === 'rtl';
      if (['PageDown', ' ', rtl ? 'ArrowLeft' : 'ArrowRight'].includes(e.key)) setI((x) => Math.min(n - 1, x + 1));
      else if (['PageUp', rtl ? 'ArrowRight' : 'ArrowLeft'].includes(e.key)) setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [n]);

  return (
    <div className="present">
      <div className="present-bar no-print">
        <Link to="/about" className="btn ghost small">
          {t('present.exit')}
        </Link>
        <span className="muted small">{t('present.counter', { i: i + 1, n })}</span>
        <div className="present-nav">
          <button type="button" className="btn ghost small" onClick={() => window.print()}>
            {t('present.print')}
          </button>
          <button type="button" className="btn ghost small" disabled={i === 0} onClick={() => setI(i - 1)}>
            {t('present.prev')}
          </button>
          <button type="button" className="btn primary small" disabled={i === n - 1} onClick={() => setI(i + 1)}>
            {t('present.next')}
          </button>
        </div>
      </div>
      <div className="slides">
        {slides.map((s, k) => (
          <section key={k} className={`slide${k === i ? ' on' : ''}`} aria-hidden={k !== i}>
            {s}
          </section>
        ))}
      </div>
      <div className="present-dots no-print">
        {slides.map((_, k) => (
          <button key={k} type="button" className={k === i ? 'on' : undefined} aria-label={t('present.counter', { i: k + 1, n })} onClick={() => setI(k)} />
        ))}
      </div>
    </div>
  );
}
