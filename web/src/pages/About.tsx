import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useI18n } from '../i18n';
import { useDataset } from '../lib/data';
import ContinueExploring from '../components/common/ContinueExploring';

const REPO = 'https://github.com/Abdulmnom/NASA-Oman-Analog-Explorer';

/** Challenge statement, how each part is answered, team, AI disclosure, licence and glossary. */
export default function About() {
  const { t, tl } = useI18n();
  const data = useDataset();
  const [copied, setCopied] = useState(false);
  const generated = data.generated ? data.generated.slice(0, 10) : '';
  const citation = `Team VEX (2026). Oman Analog Explorer: Earth analogs for Mars landing sites and the lunar south pole [software and data, version ${generated}]. NASA Space Apps Challenge 2026, Ibra, Oman. ${REPO}`;
  const bibtex = `@software{vex_oman_analog_explorer_2026,\n  author = {{Team VEX}},\n  title = {Oman Analog Explorer: Earth analogs for Mars landing sites and the lunar south pole},\n  year = {2026},\n  version = {${generated}},\n  note = {NASA Space Apps Challenge 2026, Ibra, Oman},\n  url = {${REPO}},\n  license = {Apache-2.0}\n}`;
  const rows = tl('about.rows') as unknown as [string, string, 'done' | 'partial' | 'notyet'][];
  const judges = tl('about.judges') as unknown as [string, string, string][];
  const glossary = tl('about.glossary') as unknown as [string, string][];
  const counts = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r[2]]: (acc[r[2]] ?? 0) + 1 }), {});

  return (
    <div className="page about">
      <h1>{t('about.title')}</h1>

      <section className="panel challenge-box">
        <h2>{t('about.challengeTitle')}</h2>
        <p className="challenge-name">{t('home.kicker')}</p>
        <p>{t('about.challengeText')}</p>
      </section>

      <h2>{t('about.mapTitle')}</h2>
      <p className="status-summary">
        <span className="status done">{t('about.done')} · {counts.done ?? 0}</span>
        <span className="status partial">{t('about.partial')} · {counts.partial ?? 0}</span>
        <span className="status notyet">{t('about.notyet')} · {counts.notyet ?? 0}</span>
      </p>
      <div className="table-wrap">
        <table className="table challenge-map">
          <thead>
            <tr>
              <th>{t('about.colAsk')}</th>
              <th>{t('about.colWhere')}</th>
              <th>{t('about.colStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([ask, where, status]) => (
              <tr key={ask}>
                <td>{ask}</td>
                <td className="muted">{where}</td>
                <td>
                  <span className={`status ${status}`}>{t(`about.${status}`)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>{t('about.judgesTitle')}</h2>
      <p className="muted">{t('about.judgesText')}</p>
      <div className="grid two judges">
        {judges.map(([crit, text, to]) => (
          <Link key={crit} to={to} className="panel judge-card">
            <strong>{crit} →</strong>
            <span className="small">{text}</span>
          </Link>
        ))}
      </div>

      <div className="grid two about-cols">
        <section className="panel">
          <h2>{t('about.teamTitle')}</h2>
          <ul className="team-list">
            {t('sources.team').split(' · ').map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <Link to="/present" className="btn primary small">
            {t('about.presentLink')}
          </Link>
        </section>
        <section className="panel">
          <h2>{t('about.aiTitle')}</h2>
          <p className="small">{t('about.aiText')}</p>
          <h2>{t('about.licenseTitle')}</h2>
          <p className="small">{t('about.licenseText')}</p>
        </section>
      </div>

      <section className="panel cite-box">
        <h2>{t('about.citeTitle')}</h2>
        <p className="small">{t('about.citeText', { date: generated })}</p>
        <p className="cite-text" dir="ltr">{citation}</p>
        <pre className="bibtex" dir="ltr">{bibtex}</pre>
        <button
          type="button"
          className="btn ghost small"
          onClick={() => {
            navigator.clipboard?.writeText(bibtex).then(() => setCopied(true), () => setCopied(false));
          }}
        >
          {copied ? t('about.copied') : t('about.copyBib')}
        </button>
      </section>

      <h2>{t('about.glossaryTitle')}</h2>
      <dl className="glossary">
        {glossary.map(([term, def]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{def}</dd>
          </div>
        ))}
      </dl>

      <ContinueExploring from="about" />
    </div>
  );
}
