import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useI18n } from '../../i18n';
import { normalizeValue, rangeFor } from '../../lib/similarity';
import type { SimilarityConfig, Site } from '../../types';

interface Props {
  config: SimilarityConfig;
  a: Site;
  b: Site;
  colorA: string;
  colorB: string;
}

/** Normalised (0..1) value of every feature for both sites; a missing value draws no bar. */
export default function FeatureBars({ config, a, b, colorA, colorB }: Props) {
  const { t, loc, num } = useI18n();
  const features = Object.values(config.criteria).flatMap((c) => c.features);
  const data = features.map((f) => ({
    feature: t(`features.${f}`),
    a: normalizeValue(a.raw[f], rangeFor(config, f, a.body), config.feature_scale?.[f]),
    b: normalizeValue(b.raw[f], rangeFor(config, f, b.body), config.feature_scale?.[f]),
  }));

  return (
    <div className="chart" dir="ltr">
      <ResponsiveContainer width="100%" height={340}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }} barGap={2}>
          <CartesianGrid stroke="var(--grid)" horizontal={false} />
          <XAxis type="number" domain={[0, 1]} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
          <YAxis type="category" dataKey="feature" width={130} tick={{ fill: 'var(--text)', fontSize: 12 }} />
          <Tooltip
            formatter={(v) => (typeof v === 'number' ? num(v, 2) : t('metric.notAvailable'))}
            contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8 }}
            labelStyle={{ color: 'var(--text)' }}
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          />
          <Legend wrapperStyle={{ fontSize: 13 }} />
          <Bar dataKey="a" name={loc(a.name)} fill={colorA} radius={[0, 3, 3, 0]} isAnimationActive={false} />
          <Bar dataKey="b" name={loc(b.name)} fill={colorB} radius={[0, 3, 3, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
