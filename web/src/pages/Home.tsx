import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import SpaceHero from '../components/hero/SpaceHero';
import TwinSlider from '../components/home/TwinSlider';
import { useI18n } from '../i18n';
import { bestMatch, findSite, useDataset } from '../lib/data';
import { PAGES } from '../lib/pages';

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

/** Icons for "Why it matters": mission planners, Oman, open research. */
const IMPACT_ICONS = [
  svg(
    <>
      <path d="M12 3c3 2.5 4.5 6 4.5 10l-2 3h-5l-2-3C7.5 9 9 5.5 12 3z" />
      <circle cx="12" cy="10" r="1.6" />
      <path d="M9.5 16l-2 4M14.5 16l2 4" />
    </>,
  ),
  svg(
    <>
      <path d="M12 21s-6-5.3-6-10a6 6 0 0112 0c0 4.7-6 10-6 10z" />
      <circle cx="12" cy="11" r="2.2" />
    </>,
  ),
  svg(
    <>
      <path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />
    </>,
  ),
];

export default function Home() {
  const { t, loc, num } = useI18n();
  const data = useDataset();
  const v = data.validation;
  const meanMars = v.mean_mars_similarity;
  // Rank by mean similarity to Mars targets, the same ordering the validation check uses.
  const sites = [...data.earth_sites].sort((a, b) => (meanMars[b.id] ?? -1) - (meanMars[a.id] ?? -1));
  // Compact gallery: the home page tells the story; full breakdowns live on the site pages and in the explorer.
  const tiles = sites.map((s) => {
    const best = bestMatch(data, s);
    return { site: s, best, twin: findSite(data, best?.target) };
  });
  // Headline stat follows the same ranking as the cards: the site with the best mean Mars similarity.
  const top = sites.find((s) => meanMars[s.id] != null);
  const topMean = top ? meanMars[top.id] : null;
  const marsCount = data.targets.filter((x) => x.body === 'mars').length;
  const moonCount = data.targets.filter((x) => x.body === 'moon').length;

  return (
    <>
      <SpaceHero earthSites={data.earth_sites.length} marsTargets={marsCount} />
      <div className="page">
        <TwinSlider data={data} />

        <section id="sites">
          <div className="section-head">
            <h2>{t('home.galleryTitle')}</h2>
            <p className="muted">{t('home.gallerySubtitle')}</p>
          </div>
          <ul className="stats">
            <li>
              <span className="stat-val">{num(data.earth_sites.length)}</span>
              <span className="stat-label">{t('home.statSites')}</span>
            </li>
            <li>
              <span className="stat-val">{num(data.targets.length)}</span>
              <span className="stat-label">{t('home.statTargets', { mars: marsCount, moon: moonCount })}</span>
            </li>
            {top && topMean != null && (
              <li>
                <span className="stat-val">{num(topMean * 100)}%</span>
                <span className="stat-label">{t('home.statBestMean', { site: loc(top.name) })}</span>
              </li>
            )}
          </ul>
          <ol className="gallery">
            {tiles.map(({ site, best, twin }, i) => (
              <li key={site.id}>
                <Link to={`/site/${site.id}`} className={`tile${i === 0 ? ' lead-tile' : ''}${site.role === 'reference' ? ' is-ref' : ''}`} aria-label={`${loc(site.name)} · ${t('home.galleryOpen')}`}>
                  <span className="tile-img" aria-hidden="true">
                    <img src={`${import.meta.env.BASE_URL}layers/${site.id}/elevation.png`} alt="" loading="lazy" draggable={false} />
                  </span>
                  <span className="tile-body">
                    <span className="tile-top">
                      <span className="rank">#{i + 1}</span>
                      {site.role === 'reference' && <span className="pill ref">{t('explorer.reference')}</span>}
                      {meanMars[site.id] != null && (
                        <span className="tile-mean">
                          {t('home.meanMars')} <strong>{num(meanMars[site.id]! * 100)}%</strong>
                        </span>
                      )}
                    </span>
                    <span className="tile-name">{loc(site.name)}</span>
                    {best && twin && (
                      <span className="tile-twin">
                        <span className="muted">{t(twin.body === 'moon' ? 'home.galleryMoonTwin' : 'home.galleryTwin')}</span>
                        <span className="tile-twin-row">
                          <span>
                            <span className={`dot ${twin.body}`} /> {loc(twin.name)}
                          </span>
                          {best.overall != null && <strong className="tile-score">{num(best.overall * 100)}%</strong>}
                        </span>
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>

        <section className="directory" aria-labelledby="dir-title">
          <div className="section-head">
            <h2 id="dir-title">{t('home.dirTitle')}</h2>
            <p className="muted">{t('home.dirSubtitle')}</p>
          </div>
          <ul className="dir-grid">
            {PAGES.map((p, i) => (
              <li key={p.id}>
                <Link to={p.to} className="panel dir-card">
                  <span className="dir-num">{num(i + 1).padStart(2, '0')}</span>
                  <strong>{t(`nav.${p.id}`)}</strong>
                  <span className="muted small">{loc(p.job)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="impact" aria-labelledby="impact-title">
          <div className="section-head">
            <h2 id="impact-title">{t('home.impactTitle')}</h2>
            <p className="muted">{t('home.impactSubtitle')}</p>
          </div>
          <div className="grid three">
            {[1, 2, 3].map((i) => (
              <div key={i} className="panel impact-card">
                <span className="icon-badge mars">{IMPACT_ICONS[i - 1]}</span>
                <h3>{t(`home.impact${i}Title`)}</h3>
                <p>{t(`home.impact${i}Text`)}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="panel cta-band">
          <div>
            <h2>{t('home.ctaTitle')}</h2>
            <p className="muted">{t('home.ctaText')}</p>
          </div>
          <div className="actions">
            <Link to="/explorer?view=targets" className="btn primary">{t('explorer.tab_targets')}</Link>
            <Link to="/explorer" className="btn ghost">{t('home.ctaExplore')}</Link>
            <Link to="/mission" className="btn ghost">{t('nav.mission')}</Link>
          </div>
        </section>
      </div>
    </>
  );
}
