import { useI18n } from '../../i18n';
import { missingFor } from '../../lib/data';
import type { Site } from '../../types';

interface Props {
  site: Site;
  feature: string;
  /** Also show "what would fix it" and full provenance (site detail page). */
  detailed?: boolean;
  /** Dense tables: only the label and reason code; the full reason goes in the tooltip. */
  compact?: boolean;
}

/** A measured value with its dataset, or "Not available" with the reason. Never a number for null. */
export default function MetricValue({ site, feature, detailed, compact }: Props) {
  const { t, lang, num } = useI18n();
  const v = site.raw[feature];
  if (v === null || v === undefined) {
    const m = missingFor(site, feature);
    const na = m?.status === 'not_applicable';
    if (compact) {
      return (
        <span className={`metric-missing${na ? ' na' : ''}`} title={m ? (lang === 'ar' ? m.reason_ar : m.reason_en) : undefined}>
          <span className={`pill ${na ? '' : 'warn'}`}>{t(na ? 'metric.notApplicable' : 'metric.notAvailable')}</span>
          {m && !na && <span className="muted small"> {t(`reason.${m.reason_code}`)}</span>}
        </span>
      );
    }
    return (
      <span className={`metric-missing${na ? ' na' : ''}`}>
        <span className={`pill ${na ? '' : 'warn'}`}>{t(na ? 'metric.notApplicable' : 'metric.notAvailable')}</span>
        {m && !na && <span className="muted small"> {t(`reason.${m.reason_code}`)}</span>}
        {m && (detailed || !na) && <span className="reason small">{lang === 'ar' ? m.reason_ar : m.reason_en}</span>}
        {m && detailed && !na && (
          <span className="needed small">
            <strong>{t('metric.needed')}:</strong> {lang === 'ar' ? m.needed_ar : m.needed}
          </span>
        )}
      </span>
    );
  }
  const p = site.provenance[feature];
  const value = `${num(v, Math.abs(v) < 0.01 ? 4 : v < 1 ? 3 : v < 10 ? 1 : 0)} ${t(`units.${feature}`)}`.trim();
  if (!detailed || !p) {
    return <span className="num-cell" title={p ? `${p.dataset} · ${p.products.join(', ')}` : undefined}>{value}</span>;
  }
  return (
    <span className="metric-measured">
      <span className="num-cell">{value}</span>
      <details className="prov small">
        <summary>{t('metric.showDetails')}</summary>
        <dl>
          <dt>{t('metric.source')}</dt><dd>{p.dataset} ({p.version})</dd>
          <dt>{t('metric.products')}</dt><dd dir="ltr">{p.products.join(', ')}</dd>
          <dt>{t('metric.acquired')}</dt><dd dir="ltr">{p.acquired.join(', ')}</dd>
          <dt>{t('metric.resolution')}</dt><dd>{num(p.native_resolution_m)} m</dd>
          {p.window_coverage !== undefined && (
            <><dt /><dd>{t('metric.windowCoverage', { pct: num(p.window_coverage * 100) })}</dd></>
          )}
          <dt>{t('metric.processing')}</dt><dd dir="ltr">{p.processing}</dd>
        </dl>
      </details>
    </span>
  );
}
