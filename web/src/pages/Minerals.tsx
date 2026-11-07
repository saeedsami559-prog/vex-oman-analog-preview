import { Link } from 'react-router-dom';
import MetricValue from '../components/site/MetricValue';
import { useI18n } from '../i18n';
import { useDataset } from '../lib/data';
import { MINERALS } from '../lib/minerals';
import { REFERENCES } from '../lib/references';
import ContinueExploring from '../components/common/ContinueExploring';

export default function Minerals() {
  const { t, loc } = useI18n();
  const data = useDataset();
  const sites = [...data.earth_sites, ...data.targets.filter((s) => s.body === 'mars')];

  return (
    <div className="page">
      <h1>{t('minerals.title')}</h1>
      <p className="lead">{t('minerals.intro')}</p>
      <p className="note">{t('minerals.indexNote')}</p>

      <nav className="mineral-jump">
        {/* HashRouter owns the URL hash, so in-page jumps scroll instead of using #anchors */}
        {MINERALS.map((m) => (
          <button key={m.id} type="button" className="btn ghost small" onClick={() => document.getElementById(`m-${m.id}`)?.scrollIntoView({ behavior: 'smooth' })}>
            {loc(m.name)}
          </button>
        ))}
      </nav>

      {MINERALS.map((m) => (
        <section key={m.id} id={`m-${m.id}`} className="panel mineral">
          <header>
            <h2>{loc(m.name)}</h2>
            <code className="formula" dir="ltr">{m.formula}</code>
            {(() => {
              // Scored only if at least one site has a measured value (chloride has a feature but no calibration).
              const scored = !!m.feature && sites.some((s) => s.raw[m.feature!] != null);
              const key = scored ? 'minerals.scored' : m.feature ? 'minerals.notScored' : 'minerals.context';
              return <span className={`pill ${scored ? 'ok' : m.feature ? 'soft' : ''}`}>{t(key)}</span>;
            })()}
          </header>
          <p className="lead">{loc(m.what)}</p>
          <div className="grid two">
            <dl className="mineral-facts">
              <dt>{t('minerals.forms')}</dt><dd>{loc(m.forms)}</dd>
              <dt>{t('minerals.mars')}</dt><dd>{loc(m.mars)}</dd>
              <dt>{t('minerals.detect')}</dt><dd>{loc(m.detect)}</dd>
              <dt>{t('minerals.oman')}</dt><dd>{loc(m.oman)}</dd>
            </dl>
            <div>
              <h3>{t('minerals.uses')}</h3>
              <ul className="uses">{m.uses.map((u) => <li key={u.en}>{loc(u)}</li>)}</ul>
              {m.caution && <p className="note warn small">⚠ {loc(m.caution)}</p>}
              {m.feature && (
                <>
                  <h3>{t('minerals.values')}</h3>
                  <table className="table dense">
                    <tbody>
                      {sites.map((s) => (
                        <tr key={s.id}>
                          <th scope="row"><span className={`dot ${s.body}`} /> <Link to={`/site/${s.id}`}>{loc(s.name)}</Link></th>
                          <td><MetricValue site={s} feature={m.feature!} compact /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              <h3>{t('minerals.refs')}</h3>
              <ul className="refs">
                {m.refs.map((id) => REFERENCES.find((r) => r.id === id)).filter(Boolean).map((r) => (
                  <li key={r!.id}><a href={r!.url} target="_blank" rel="noreferrer">{r!.cite}</a> — <em>{r!.title}</em>. <span className="muted">{r!.venue}</span></li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ))}
      <section className="panel mineral moon-minerals" id="moon">
        <header>
          <h2><span className="dot moon" /> {t('minerals.moonTitle')}</h2>
        </header>
        <p className="lead">{t('minerals.moonLead')}</p>
        <div className="grid two">
          <dl className="mineral-facts">
            <dt>{t('minerals.moonRocks')}</dt><dd>{t('minerals.moonRocksText')}</dd>
            <dt>{t('minerals.moonIce')}</dt><dd>{t('minerals.moonIceText')}</dd>
            <dt>{t('minerals.moonWhy')}</dt><dd>{t('minerals.moonWhyText')}</dd>
          </dl>
          <div>
            <h3>{t('minerals.moonOman')}</h3>
            <p>{t('minerals.moonOmanText')}</p>
            <h3>{t('minerals.refs')}</h3>
            <ul className="refs">
              {['colaprete2010', 'li2018', 'smith2010', 'mazarico2011'].map((id) => REFERENCES.find((r) => r.id === id)).filter(Boolean).map((r) => (
                <li key={r!.id}><a href={r!.url} target="_blank" rel="noreferrer">{r!.cite}</a> — <em>{r!.title}</em>. <span className="muted">{r!.venue}</span></li>
              ))}
            </ul>
          </div>
        </div>
      </section>
      <ContinueExploring from="minerals" />
    </div>
  );
}
