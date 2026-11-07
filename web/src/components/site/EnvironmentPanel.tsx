import { useI18n } from '../../i18n';
import { ltr, meanOver, monthNames, monthRange, periodYears, type EnvData, type EnvSite } from '../../lib/environment';

interface Props {
  env: EnvData;
  site: EnvSite;
  /** Elevation range of the 40 km NASADEM window (from the site's layer meta), when known. */
  demRange?: { min: number; max: number } | null;
  /** A single quoted elevation (e.g. for a candidate without a DEM layer). */
  quotedElevation?: number | null;
}

const W = 600;
const H = 150;
const PAD = { top: 22, bottom: 24, side: 6 };

/** Monthly NASA POWER climatology for one site: mean temperature bars, coolest window, key figures. */
export default function EnvironmentPanel({ env, site, demRange, quotedElevation }: Props) {
  const { t, lang, num } = useI18n();
  const names = monthNames(lang);
  const temp = site.monthly.T2M;
  const cool = site.derived.coolest_months;
  const maxT = Math.max(...temp);
  const bw = (W - PAD.side * 2) / 12;
  const y = (v: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - v / (Math.ceil(maxT / 5) * 5));
  const a = site.annual;
  const hottest = temp.indexOf(maxT);

  const highGround = demRange ? demRange.max : quotedElevation ?? null;
  const offsetKm = highGround !== null ? (highGround - site.cell_elevation_m) / 1000 : 0;

  const facts: [string, string][] = [
    [t('env.annualMean'), ltr(`${num(a.T2M, 1)} °C`)],
    [t('env.coolest'), `${monthRange(names, cool)} · ${ltr(`${num(meanOver(temp, cool), 1)} °C`)}`],
    [t('env.hottest'), `${names[hottest]} · ${ltr(`${num(maxT, 1)} °C`)}`],
    [t('env.dailyRange'), ltr(`${num(a.T2M_RANGE, 1)} °C`)],
    [t('env.extremes'), ltr(`${num(a.T2M_MAX, 1)} / ${num(a.T2M_MIN, 1)} °C`)],
    [t('env.rain'), t('env.rainVal', { mm: num(site.derived.precip_mm_per_year) })],
    [t('env.sun'), t('env.sunVal', { v: ltr(`${num(a.ALLSKY_SFC_SW_DWN, 2)} kWh/m²`) })],
    [t('env.humidity'), `${num(a.RH2M)}%`],
    [t('env.wind'), ltr(`${num(a.WS2M, 1)} m/s`)],
  ];

  return (
    <section className="panel env-panel">
      <h2>
        {t('env.title')} <span className="pill soft">{t('env.badge')}</span>
      </h2>
      <p className="muted small">{t('env.intro')}</p>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="env-chart"
        style={{ direction: 'ltr' }}
        role="img"
        aria-label={t('env.chartLabel') + ': ' + temp.map((v, i) => `${names[i]} ${num(v, 1)} °C`).join(', ')}
      >
        {temp.map((v, i) => {
          const x = PAD.side + i * bw;
          const top = y(v);
          const isCool = cool.includes(i);
          return (
            <g key={i}>
              <rect x={x + 4} y={top} width={bw - 8} height={H - PAD.bottom - top} rx={3} className={isCool ? 'env-bar cool' : 'env-bar'} />
              <text x={x + bw / 2} y={top - 5} textAnchor="middle" className="env-val">
                {num(v)}
              </text>
              <text x={x + bw / 2} y={H - 7} textAnchor="middle" className="env-month">
                {names[i]}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="small muted env-legend">
        <i className="env-key cool" /> {t('env.legendCool')} · <i className="env-key" /> {t('env.legendMean')}
      </p>

      <dl className="env-facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <p className="note small">
        {t('env.grid', { cell: num(site.cell_elevation_m) })}{' '}
        {demRange && t('env.gridDem', { min: num(demRange.min), max: num(demRange.max) })}
        {!demRange && quotedElevation != null && t('env.gridQuoted', { m: num(quotedElevation) })}{' '}
        {offsetKm > 0.5 && t('env.gridCooler', { km: num(offsetKm, 1), c: num(offsetKm * 6.5) })}
      </p>
      <p className="muted small">
        {t('env.source', { api: env.source.api, period: periodYears(env.source.period) })}{' '}
        <a href={site.request_url} target="_blank" rel="noreferrer">
          {t('env.request')}
        </a>
      </p>
    </section>
  );
}
