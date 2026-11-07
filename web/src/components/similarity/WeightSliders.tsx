import { useI18n } from '../../i18n';
import type { Weights } from '../../types';

interface Props {
  weights: Weights;
  onChange: (w: Weights) => void;
  onReset: () => void;
  /** Optional named weightings shown as quick buttons ("mission lenses"). */
  presets?: { key: string; weights: Weights }[];
}

const same = (a: Weights, b: Weights) => {
  const ta = Object.values(a).reduce((x, y) => x + y, 0) || 1;
  const tb = Object.values(b).reduce((x, y) => x + y, 0) || 1;
  return Object.keys(b).every((k) => Math.abs((a[k] ?? 0) / ta - b[k] / tb) < 1e-6);
};

export default function WeightSliders({ weights, onChange, onReset, presets }: Props) {
  const { t, num } = useI18n();
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  return (
    <div className="weights">
      {presets && (
        <div className="lens-row" role="group" aria-label={t('compare.lensTitle')}>
          {presets.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`lens${same(weights, p.weights) ? ' active' : ''}`}
              aria-pressed={same(weights, p.weights)}
              onClick={() => onChange(p.weights)}
            >
              {t(`compare.lens_${p.key}`)}
            </button>
          ))}
        </div>
      )}
      {Object.entries(weights).map(([name, w]) => (
        <label key={name} className="weight-row">
          <span className="weight-name">{t(`criteria.${name}`)}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={w}
            onChange={(e) => onChange({ ...weights, [name]: Number(e.target.value) })}
          />
          <span className="weight-val">{total > 0 ? `${num((w / total) * 100)}%` : '0%'}</span>
        </label>
      ))}
      <button type="button" className="btn ghost small" onClick={onReset}>
        {t('compare.reset')}
      </button>
    </div>
  );
}
