import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { kmFromMuscat } from '../lib/analysis';
import { bestMatch, findSite, useDataset } from '../lib/data';
import { layerUrl } from '../lib/layerMeta';
import { MISSION_EXTENSION, MISSION_LEGS } from '../lib/mission';
import { envSite, meanOver, monthNames, monthRange, sharedCoolestMonths, useEnvironment } from '../lib/environment';
import ContinueExploring from '../components/common/ContinueExploring';

/** Proposed field campaign (a concept) that ground-truths the scores and fills the data gaps. */
export default function Mission() {
  const { t, tl, loc, lang, num } = useI18n();
  const data = useDataset();
  const env = useEnvironment();
  const months = monthNames(lang);
  const routeIds = MISSION_LEGS.map((l) => l.site);
  const coolWin = sharedCoolestMonths(env, routeIds);
  const routeClimate = routeIds.map((id) => envSite(env, id)).filter((e) => e !== null);
  const inWindow = routeClimate.map((e) => meanOver(e!.monthly.T2M, coolWin));
  const hottest = routeClimate.map((e) => Math.max(...e!.monthly.T2M));
  const ext = findSite(data, MISSION_EXTENSION);
  const extKm = ext ? kmFromMuscat(ext) : null;

  return (
    <div className="page mission">
      <p className="kicker">{t('mission.kicker')}</p>
      <h1>{t('mission.title')}</h1>
      <p className="lead">{t('mission.intro')}</p>
      <p className="note small">{t('mission.disclaimer')}</p>

      <h2>{t('mission.goalsTitle')}</h2>
      <div className="grid three">
        {tl('mission.goals').map((g, i) => (
          <div key={g} className="panel mission-goal">
            <span className="pipeline-num">{num(i + 1)}</span>
            <p>{g}</p>
          </div>
        ))}
      </div>

      {coolWin.length > 0 && routeClimate.length > 0 && (
        <section className="panel mission-season">
          <h2>
            {t('env.seasonTitle')} <span className="pill soft">NASA POWER</span>
          </h2>
          <p>
            {t('env.seasonText', {
              window: monthRange(months, coolWin),
              n: num(routeClimate.length),
              lo: num(Math.min(...inWindow), 1),
              hi: num(Math.max(...inWindow), 1),
              hot: num(Math.max(...hottest), 1),
            })}
          </p>
          <p className="muted small">{t('env.seasonNote')}</p>
        </section>
      )}

      <h2>{t('mission.routeTitle')}</h2>
      <ol className="mission-legs">
        {MISSION_LEGS.map((leg) => {
          const site = findSite(data, leg.site);
          if (!site) return null;
          const twin = findSite(data, bestMatch(data, site)?.target);
          const km = kmFromMuscat(site);
          return (
            <li key={leg.site} className="panel mission-leg">
              <img src={layerUrl(site.id, 'elevation.png')} alt="" loading="lazy" draggable={false} />
              <div className="mission-leg-body">
                <p className="muted small">
                  {t('mission.days', { d: leg.days })}
                  {km !== null && ` · ${t('explorer.findAccess', { km: num(km) })}`}
                </p>
                <h3>
                  <Link to={`/site/${site.id}`}>{loc(site.name)}</Link>
                </h3>
                {twin && (
                  <p className="small">
                    {t('mission.rehearses')} <span className={`dot ${twin.body}`} /> <strong>{loc(twin.name)}</strong>
                  </p>
                )}
                <ul>
                  {leg.tasks.map((task) => (
                    <li key={task.en}>{loc(task)}</li>
                  ))}
                </ul>
                <p className="small">
                  <span className="muted">{t('mission.fills')}</span>{' '}
                  {leg.fills.map((f) => (
                    <span key={f} className="pill soft">
                      {t(`features.${f}`)}
                    </span>
                  ))}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {ext && (
        <p className="note">
          {t('mission.extension', { site: loc(ext.name), km: extKm !== null ? num(extKm) : '–' })}
        </p>
      )}

      <div className="grid two">
        <div className="panel">
          <h2>{t('mission.kitTitle')}</h2>
          <ul>{tl('mission.kit').map((k) => <li key={k}>{k}</li>)}</ul>
        </div>
        <div className="panel">
          <h2>{t('mission.successTitle')}</h2>
          <ul>{tl('mission.success').map((k) => <li key={k}>{k}</li>)}</ul>
        </div>
      </div>
      <ContinueExploring from="mission" />
    </div>
  );
}
