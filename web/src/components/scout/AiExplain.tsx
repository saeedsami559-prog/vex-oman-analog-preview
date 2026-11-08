import { useI18n } from '../../i18n';
import type { Body, CellLayerStats, ScoutCell, ScoutGrid, Verdict } from '../../lib/scout';
import { alternative, confidence, explain, type Reason } from '../../lib/scoutAi';

/** Above this distance the 'better place' is not called nearby. */
const NEAR_KM = 150;

/** Month index list -> "Dec – Feb" in the page language. */
export function monthSpan(months: number[], lang: string): string {
  const f = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-OM' : 'en-GB', { month: 'long' });
  const name = (m: number) => f.format(new Date(2025, m, 15));
  return months.length ? `${name(months[0])} – ${name(months[months.length - 1])}` : '';
}

interface Props {
  grid: ScoutGrid;
  cell: ScoutCell;
  body: Body;
  ranks: Map<string, number>;
  total: number;
  verdict?: Verdict | null;
  onGo?: (c: ScoutCell) => void;
  compact?: boolean;
  layers?: CellLayerStats | null;
}

/** The AI second opinion for one cell: score, why it matches, why it does not, and a better place nearby. */
export default function AiExplain({ grid, cell, body, ranks, total, verdict, onGo, compact, layers }: Props) {
  const { t, loc, num, lang } = useI18n();
  const aiTotal = grid.cells.filter((c) => c.ai?.[body]).length;
  const ex = explain(cell, body, grid.ai, aiTotal);
  if (!ex) return <p className="muted small">{t('scout.ai.none')}</p>;
  const conf = verdict ? confidence(verdict, ex.level) : null;
  const alt = verdict !== 'go' || ex.level !== 'high' ? alternative(cell, grid.cells, body, ranks, total) : null;
  const reason = (r: Reason) => {
    const dir = r.z > 0 ? 'more' : 'less';
    return t(`scout.ai.${dir}_${r.feature}`);
  };
  const env = cell.env;
  return (
    <div className={`ai-card lvl-${ex.level}`}>
      <div className="ai-head">
        <span className="ai-badge" aria-hidden="true">AI</span>
        <div>
          <p className="ai-title">{t(`scout.ai.level_${ex.level}`)}</p>
          <p className="muted small">{t('scout.ai.score', { p: num(ex.p), rank: num(ex.rank), n: num(ex.total) })}</p>
        </div>
        <strong className="ai-p" dir="ltr">{num(ex.p)}%</strong>
      </div>

      {conf && <p className={`ai-conf ${conf}`}>{t(`scout.ai.conf_${conf}`)}</p>}

      <p className="small ai-nearest">
        {t('scout.ai.nearest')}{' '}
        {ex.nearest.map((e, i) => (
          <span key={e.id}>{i > 0 && ' · '}<strong>{loc(e.name)}</strong></span>
        ))}
      </p>

      {ex.matches.length > 0 && (
        <div className="ai-list good">
          <p className="small"><strong>{t('scout.ai.whyYes')}</strong></p>
          <ul>{ex.matches.map((r) => <li key={r.feature}>{t(`scout.ai.match_${r.feature}`)}</li>)}</ul>
        </div>
      )}
      {(ex.differs.length > 0 || ex.notes.some((n) => n.key === 'footprint' || n.key === 'steep' || n.key === 'hazard')) && (
        <div className="ai-list bad">
          <p className="small"><strong>{t('scout.ai.whyNo')}</strong></p>
          <ul>
            {ex.differs.map((r) => <li key={r.feature}>{reason(r)}</li>)}
            {ex.notes.filter((n) => n.key === 'footprint' || n.key === 'steep' || n.key === 'hazard').map((n) => (
              <li key={n.key}>{t(`scout.ai.note_${n.key}`, { v: num(n.value, 1) })}</li>
            ))}
            {layers?.water_any_pct != null && layers.water_any_pct >= 1 && (
              <li>{t('scout.ai.note_flood', { v: num(layers.water_any_pct, 1) })}</li>
            )}
          </ul>
        </div>
      )}
      {!compact && ex.notes.some((n) => n.key === 'clean' || n.key === 'flat') && (
        <ul className="ai-plain small">
          {ex.notes.filter((n) => n.key === 'clean' || n.key === 'flat').map((n) => (
            <li key={n.key}>{t(`scout.ai.note_${n.key}`, { v: num(n.value, 1) })}</li>
          ))}
        </ul>
      )}

      {!compact && env && (
        <p className="small muted ai-env">
          {t('scout.ai.env', { rain: num(env.rain_mm), rh: num(env.rh), wind: num(env.wind_ms, 1), months: monthSpan(env.coolest, lang) })}
        </p>
      )}
      {!compact && lstText(layers, t, num)}

      {alt && (
        <div className="ai-alt">
          <p className="small">{t(alt.kind === 'both' ? (alt.km <= NEAR_KM ? 'scout.ai.alt' : 'scout.ai.altBothFar') : alt.kind === 'rules' ? 'scout.ai.altRules' : 'scout.ai.altFar', { km: num(Math.round(alt.km)), p: num(alt.cell.ai?.[body]?.p ?? 0) })}</p>
          {onGo && <button type="button" className="btn small primary" onClick={() => onGo(alt.cell)}>{t('scout.ai.altGo')}</button>}
        </div>
      )}
    </div>
  );
}

/** Ground (not air) temperature from MODIS: hottest-month day and coldest-month night. */
function lstText(l: CellLayerStats | null | undefined, t: (k: string, v?: Record<string, string | number>) => string, num: (n: number, d?: number) => string) {
  const day = (l?.lst_day ?? []).filter((v): v is number => v != null);
  const night = (l?.lst_night ?? []).filter((v): v is number => v != null);
  if (!day.length || !night.length) return null;
  return <p className="small muted ai-env">{t('scout.ai.lst', { hot: num(Math.max(...day), 0), cold: num(Math.min(...night), 0) })}</p>;
}
