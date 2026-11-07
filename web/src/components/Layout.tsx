import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useI18n } from '../i18n';
import StarField from './common/StarField';

type Theme = 'dark' | 'light';
const THEME_KEY = 'oae-theme';

export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

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
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable: the theme just won't persist */
    }
  }, [theme]);
  const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <div className="app">
      <StarField />
      <a href="#main" className="skip-link" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>
        {t('common.skip')}
      </a>
      <header className="topbar">
        <NavLink to="/" className="brand">
          <img className="brand-mark" src={`${import.meta.env.BASE_URL}brand/vex-mark.png`} width="34" height="34" alt="" />
          <span>{t('app.title')}</span>
        </NavLink>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.key} to={n.to} end={n.end}>
              {t(`nav.${n.key}`)}
            </NavLink>
          ))}
        </nav>
        <div className="top-actions">
          <button
            type="button"
            className="btn ghost small theme-toggle"
            onClick={() => setTheme(nextTheme)}
            aria-label={t(nextTheme === 'light' ? 'theme.toLight' : 'theme.toDark')}
            title={t(nextTheme === 'light' ? 'theme.toLight' : 'theme.toDark')}
          >
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4.2" />
                <path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />
              </svg>
            )}
          </button>
          <button type="button" className="btn ghost small lang" onClick={toggle} aria-label={t('lang.switchLabel')}>
            {t('lang.switch')}
          </button>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <img className="vex-logo" src={`${import.meta.env.BASE_URL}brand/vex-logo.jpg`} width="120" height="90" alt="Team VEX" loading="lazy" />
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
