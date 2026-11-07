import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { scoresCsv } from '../lib/analysis';
import { useDataset } from '../lib/data';
import { DATA_SOURCES } from '../lib/sources';
import { ENV_URL } from '../lib/environment';
import ContinueExploring from '../components/common/ContinueExploring';
import PageToc from '../components/common/PageToc';
import type { Provenance } from '../types';

interface UsedRow {
  siteId: string;
  features: string[];
  prov: Provenance;
}

export default function Sources() {
  const { t, loc, lang } = useI18n();
  const data = useDataset();
  const sites = [...data.earth_sites, ...data.targets];
  const name = (id: string) => loc(sites.find((s) => s.id === id)!.name);

  // One row per site x dataset (features sharing the same provenance are grouped).
  const used: UsedRow[] = [];
  for (const s of sites) {
    for (const [f, p] of Object.entries(s.provenance)) {
      const row = used.find((r) => r.siteId === s.id && r.prov.dataset === p.dataset && r.prov.products.join() === p.products.join());
      if (row) row.features.push(f);
      else used.push({ siteId: s.id, features: [f], prov: p });
    }
  }
  const missing = sites.flatMap((s) => s.missing.map((m) => ({ siteId: s.id, m })));
  const features = Object.values(data.config.criteria).flatMap((c) => c.features);
  const cellState = (siteId: string, f: string) => {
    const s = sites.find((x) => x.id === siteId)!;
    if (s.measured.includes(f)) return 'measured';
    return s.missing.find((m) => m.feature === f)?.status === 'not_applicable' ? 'na' : 'missing';
  };
  const MARK = { measured: '✓', missing: '–', na: '·' } as const;
  const LABEL = { measured: 'sources.matrixMeasured', missing: 'sources.matrixMissing', na: 'sources.matrixNa' } as const;

  return (
    <div className="page prose">
      <h1>{t('sources.title')}</h1>
      <p className="lead">{t('sources.intro')}</p>
      <PageToc />

      <section className="panel download-band">
        <div>
          <h2>{t('sources.downloadTitle')}</h2>
          <p className="muted">{t('sources.downloadText')}</p>
        </div>
        <div className="actions">
          <a className="btn primary" href={`${import.meta.env.BASE_URL}data/sites.json`} download="oman-analog-explorer-sites.json">
            {t('sources.downloadJson')}
          </a>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              const blob = new Blob([scoresCsv(data, (s) => s.name.en)], { type: 'text/csv;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'oman-analog-explorer-scores.csv';
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            {t('sources.downloadCsv')}
          </button>
        </div>
      </section>

      <section className="panel context-source">
        <h2>
          {t('env.ctxTitle')} <span className="pill soft">{t('env.badge')}</span>
        </h2>
        <p>{t('env.ctxText')}</p>
        <p className="small">
          <a href="https://power.larc.nasa.gov/" target="_blank" rel="noreferrer">NASA POWER (power.larc.nasa.gov)</a> ·{' '}
          <a href={ENV_URL} download="oman-analog-explorer-environment.json">{t('env.download')}</a> ·{' '}
          <Link to="/atlas">{t('env.ctxAtlas')}</Link>
        </p>
      </section>

      <h2>{t('sources.matrixTitle')}</h2>
      <p className="muted">{t('sources.matrixIntro')}</p>
      <div className="table-wrap">
        <table className="table coverage-matrix">
          <thead>
            <tr>
              <th>{t('sources.colSite')}</th>
              {features.map((f) => (
                <th key={f} scope="col">{t(`features.${f}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s.id}>
                <th scope="row">
                  <span className={`dot ${s.body}`} /> <Link to={`/site/${s.id}`}>{loc(s.name)}</Link>
                </th>
                {features.map((f) => {
                  const st = cellState(s.id, f);
                  return (
                    <td key={f} className={`cov ${st}`} title={t(LABEL[st])}>
                      <span aria-hidden="true">{MARK[st]}</span>
                      <span className="sr-only">{t(LABEL[st])}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="cov-legend small muted">
        <span className="cov measured">✓</span> {t('sources.matrixMeasured')} · <span className="cov missing">–</span> {t('sources.matrixMissing')} · <span className="cov na">·</span> {t('sources.matrixNa')}
      </p>

      <h2>{t('sources.usedTitle')}</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('sources.colSite')}</th>
              <th>{t('sources.colFeature')}</th>
              <th>{t('sources.colDataset')}</th>
              <th>{t('sources.colProducts')}</th>
              <th>{t('sources.colAcquired')}</th>
              <th>{t('sources.colRes')}</th>
            </tr>
          </thead>
          <tbody>
            {used.map((r) => (
              <tr key={`${r.siteId}-${r.prov.dataset}-${r.features[0]}`}>
                <td><Link to={`/site/${r.siteId}`}>{name(r.siteId)}</Link></td>
                <td>{r.features.map((f) => t(`features.${f}`)).join(', ')}</td>
                <td>{r.prov.dataset} <span className="muted small">({r.prov.version})</span></td>
                <td dir="ltr" className="small">
                  {r.prov.products.map((pid, i) =>
                    r.prov.urls.length === r.prov.products.length ? <a key={pid} href={r.prov.urls[i]} target="_blank" rel="noreferrer">{pid} </a> : <span key={pid}>{pid} </span>,
                  )}
                </td>
                <td dir="ltr" className="small">{r.prov.acquired.join(', ')}</td>
                <td className="nowrap">{r.prov.native_resolution_m} m</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>{t('sources.missingTitle')}</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('sources.colSite')}</th>
              <th>{t('sources.colFeature')}</th>
              <th>{t('sources.colReason')}</th>
              <th>{t('sources.colNeeded')}</th>
            </tr>
          </thead>
          <tbody>
            {missing.map(({ siteId, m }) => (
              <tr key={`${siteId}-${m.feature}`}>
                <td><Link to={`/site/${siteId}`}>{name(siteId)}</Link></td>
                <td>{t(`features.${m.feature}`)}</td>
                <td>
                  <span className={`pill ${m.status === 'not_applicable' ? '' : 'warn'}`}>{t(`reason.${m.reason_code}`)}</span>{' '}
                  {lang === 'ar' ? m.reason_ar : m.reason_en}
                </td>
                <td className="small">{lang === 'ar' ? m.needed_ar : m.needed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>{t('sources.candidatesTitle')}</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('sources.colDataset')}</th>
              <th>{t('sources.colBody')}</th>
              <th>{t('sources.colUse')}</th>
              <th>{t('sources.colRes')}</th>
              <th>{t('sources.colProvider')}</th>
            </tr>
          </thead>
          <tbody>
            {DATA_SOURCES.map((d) => (
              <tr key={d.id}>
                <td><a href={d.url} target="_blank" rel="noreferrer">{d.name}</a></td>
                <td className="nowrap"><span className={`dot ${d.body}`} /> {t(`body.${d.body}`)}</td>
                <td>{loc(d.use)}</td>
                <td className="nowrap" dir="ltr">{d.resolution}</td>
                <td>{d.provider}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>{t('sources.mapsTitle')}</h2>
      <p>{t('sources.mapsText')}</p>
      <ContinueExploring from="sources" />
    </div>
  );
}
