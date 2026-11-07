import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { NEXT, pageInfo, type PageId } from '../../lib/pages';

/** "Continue exploring" cards at the end of a page: points onward instead of repeating content. */
export default function ContinueExploring({ from }: { from: PageId | 'site' }) {
  const { t, loc } = useI18n();
  return (
    <nav className="continue" aria-label={t('common.continue')}>
      <h2>{t('common.continue')}</h2>
      <div className="grid two">
        {NEXT[from].map((id) => {
          const p = pageInfo(id);
          return (
            <Link key={id} to={p.to} className="panel continue-card">
              <strong>{t(`nav.${id}`)} →</strong>
              <span className="muted small">{loc(p.job)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
