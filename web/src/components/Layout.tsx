import { NavLink, Outlet } from 'react-router-dom';
import { useI18n } from '../i18n';

const NAV = [
  { to: '/', key: 'home', end: true },
  { to: '/explorer', key: 'explorer' },
  { to: '/atlas', key: 'atlas' },
  { to: '/minerals', key: 'minerals' },
  { to: '/methodology', key: 'methodology' },
  { to: '/sources', key: 'sources' },
  { to: '/mission', key: 'mission' },
  { to: '/about', key: 'about' },
];

export default function Layout() {
  const { t, toggle } = useI18n();
  return (
    <div className="app">
      <a href="#main" className="skip-link" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>
        {t('common.skip')}
      </a>
      <header className="topbar">
        <NavLink to="/" className="brand">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
            <circle cx="12" cy="16" r="10" fill="#3fb6a8" />
            <circle cx="22" cy="16" r="8" fill="#e0703f" opacity="0.92" />
          </svg>
          <span>{t('app.title')}</span>
        </NavLink>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.key} to={n.to} end={n.end}>
              {t(`nav.${n.key}`)}
            </NavLink>
          ))}
        </nav>
        <button type="button" className="btn ghost small lang" onClick={toggle} aria-label={t('lang.switchLabel')}>
          {t('lang.switch')}
        </button>
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <span className="vex-mark" aria-hidden="true">VEX</span>
            <div>
              <p className="footer-built">{t('home.footerBuilt')}</p>
              <p className="muted small">
                <NavLink to="/about">{t('common.meetTeam')}</NavLink>
              </p>
            </div>
          </div>
          <p className="footer-challenge">
            <span className="muted">{t('home.footerChallenge')}:</span> {t('home.kicker')}
            <span className="footer-theme">The Next Frontier</span>
          </p>
          <p className="muted small">{t('home.footerData')}</p>
          <div className="footer-links">
            <a href="https://github.com/Abdulmnom/NASA-Oman-Analog-Explorer" target="_blank" rel="noreferrer">
              {t('home.footerCode')}
            </a>
            <a href="https://www.spaceappschallenge.org" target="_blank" rel="noreferrer">
              {t('home.footerSpaceApps')}
            </a>
          </div>
          <p className="muted small footer-note">{t('home.footerNote')}</p>
        </div>
      </footer>
    </div>
  );
}
