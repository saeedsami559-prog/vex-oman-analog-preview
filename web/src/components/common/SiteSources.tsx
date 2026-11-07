import { useI18n } from '../../i18n';
import { BENCHMARKS, OMAN_CANDIDATES, ARTEMIS_SOURCES } from '../../lib/atlas';
import { sourcesForSite } from '../../lib/references';

/** Programme or reference page for a site that has no paper in REFERENCES. */
function programmeSource(id: string) {
  const atlas = [...BENCHMARKS, ...OMAN_CANDIDATES].find((s) => s.id === id);
  if (atlas) return atlas.source;
  if (id === 'moon_south_pole') return ARTEMIS_SOURCES[0];
  return undefined;
}

/** "Sources for this site": the papers and programme pages behind one or more sites. */
export default function SiteSources({ ids, title }: { ids: string[]; title?: string }) {
  const { t, loc } = useI18n();
  const items = ids.flatMap((id) => sourcesForSite(id, programmeSource(id)));
  const unique = items.filter((s, i) => items.findIndex((o) => o.url === s.url) === i);
  if (!unique.length) return null;
  return (
    <div className="panel site-sources">
      <h3>{title ?? t('sources.siteSources')}</h3>
      <ol>
        {unique.map((s) => (
          <li key={s.url}>
            <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a>
            {s.note && <span className="muted small"> · {loc(s.note)}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
