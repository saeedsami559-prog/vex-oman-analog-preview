import { useI18n } from '../../i18n';
import { confidenceLevel } from '../../lib/similarity';

interface Props {
  overall: number | null;
  confidence: number;
  size?: 'sm' | 'lg';
}

export function scoreHue(score: number): string {
  // red (low) -> amber -> green (high), tuned to stay readable on the dark theme.
  // Squaring spreads the crowded high end so 85% and 95% no longer look the same.
  const s = Math.min(1, Math.max(0, score));
  return `hsl(${Math.round(10 + s * s * 130)} 65% 55%)`;
}

export default function ScoreBadge({ overall, confidence, size = 'sm' }: Props) {
  const { t, num } = useI18n();
  const level = confidenceLevel(confidence);
  return (
    <div className={`score-badge ${size}`}>
      <div className="score-ring" dir="ltr" style={{ ['--pct' as string]: `${(overall ?? 0) * 100}%`, ['--hue' as string]: overall === null ? 'var(--muted)' : scoreHue(overall) }}>
        <span>{overall === null ? '–' : num(overall * 100)}</span>
        {overall !== null && <small>%</small>}
      </div>
      <div className="score-meta">
        <span className="label">{t('score.similarity')}</span>
        <span className={`conf conf-${level}`} title={`${t('score.confidence')}: ${num(confidence * 100)}%`}>
          {t('score.confidence')}: {t(`score.${level}`)} ({num(confidence * 100)}%)
        </span>
      </div>
    </div>
  );
}

export function ScoreBar({ value }: { value: number | null }) {
  const { num, t } = useI18n();
  if (value === null) return <span className="muted">{t('score.noData')}</span>;
  return (
    <span className="score-bar">
      <span className="track">
        <span className="fill" style={{ width: `${value * 100}%`, background: scoreHue(value) }} />
      </span>
      <span className="val">{num(value * 100)}%</span>
    </span>
  );
}
