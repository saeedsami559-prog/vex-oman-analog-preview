import { Legend, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useI18n } from '../../i18n';

export interface RadarSeries {
  name: string;
  color: string;
  values: Record<string, number | null>;
}

export default function CriteriaRadar({ criteria, series }: { criteria: string[]; series: RadarSeries[] }) {
  const { t, num } = useI18n();
  const data = criteria.map((c) => {
    const row: Record<string, string | number | null> = { criterion: t(`criteria.${c}`) };
    series.forEach((s, i) => (row[`s${i}`] = s.values[c] === null || s.values[c] === undefined ? 0 : (s.values[c] as number) * 100));
    return row;
  });

  return (
    <div className="chart" dir="ltr">
      <ResponsiveContainer width="100%" height={300}>
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="var(--grid)" />
          <PolarAngleAxis dataKey="criterion" tick={{ fill: 'var(--text)', fontSize: 13 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          {series.map((s, i) => (
            <Radar key={s.name} name={s.name} dataKey={`s${i}`} stroke={s.color} fill={s.color} fillOpacity={0.22} strokeWidth={2} isAnimationActive={false} />
          ))}
          <Tooltip
            formatter={(v) => `${num(Number(v))}%`}
            contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8 }}
            labelStyle={{ color: 'var(--text)' }}
          />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 13 }} />}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
