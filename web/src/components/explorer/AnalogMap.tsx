import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { mds2d, pairwiseSimilarity } from '../../lib/analysis';
import { useDataset } from '../../lib/data';
import type { Site } from '../../types';

const W = 760;
const H = 460;
const PAD = 70;

/** 2-D "analog map": sites placed so that distance ≈ 1 − similarity (default weights). */
export default function AnalogMap({ onOpen }: { onOpen: (site: Site) => void }) {
  const { t, loc, num } = useI18n();
  const data = useDataset();
  const { sites, sim, pts } = useMemo(() => {
    const p = pairwiseSimilarity(data);
    return { ...p, pts: mds2d(p.sim) };
  }, [data]);
  const [hover, setHover] = useState<number | null>(null);

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  // One scale for both axes (distances must stay true), as large as the frame allows.
  const scale = Math.min((W - 2 * PAD) / (Math.max(...xs) - Math.min(...xs) || 1), (H - 2 * PAD) / (Math.max(...ys) - Math.min(...ys) || 1));
  const px = (i: number) => W / 2 + (pts[i].x - cx) * scale;
  const py = (i: number) => H / 2 - (pts[i].y - cy) * scale;
  // Simple label placement: above the point, or below if it would overlap a label already placed.
  const labelDy = (() => {
    const placed: { x: number; y: number; w: number }[] = [];
    return sites.map((s, i) => {
      const w = Math.min(loc(s.name).replace(/\s*\(.*\)$/, '').length, 28) * 6.6;
      for (const dy of [-14, 24, -30, 40]) {
        const box = { x: px(i), y: py(i) + dy, w };
        if (!placed.some((p) => Math.abs(p.x - box.x) < (p.w + box.w) / 2 && Math.abs(p.y - box.y) < 15)) {
          placed.push(box);
          return dy;
        }
      }
      return -14;
    });
  })();

  // For the hovered site: its three most similar other sites.
  const near =
    hover === null
      ? []
      : sim[hover]
          .map((s, j) => ({ j, s }))
          .filter((x) => x.j !== hover)
          .sort((a, b) => b.s - a.s)
          .slice(0, 3);

  return (
    <div className="analog-map">
      <div className="finder-head">
        <h2>{t('explorer.mapTitle')}</h2>
        <p className="muted">{t('explorer.mapIntro')}</p>
      </div>
      <div className="analog-map-body">
        <div className="panel analog-plot">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('explorer.mapTitle')} style={{ direction: 'ltr' }}>
            {near.map(({ j, s }) => (
              <line key={j} x1={px(hover!)} y1={py(hover!)} x2={px(j)} y2={py(j)} className="am-link" style={{ opacity: 0.3 + 0.6 * s }} />
            ))}
            {sites.map((s, i) => (
              <g
                key={s.id}
                className={`am-pt ${s.body}${hover === i ? ' hot' : ''}`}
                transform={`translate(${px(i)},${py(i)})`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                onClick={() => onOpen(s)}
                tabIndex={0}
                role="button"
                aria-label={loc(s.name)}
              >
                <circle r={s.body === 'earth' ? 9 : 8} />
                <text y={labelDy[i]} textAnchor="middle">
                  {loc(s.name).replace(/\s*\(.*\)$/, '')}
                </text>
              </g>
            ))}
          </svg>
          <p className="muted small">{t('explorer.mapAxes')}</p>
        </div>
        <div className="panel analog-side">
          <ul className="am-legend">
            {(['earth', 'mars', 'moon'] as const).map((b) => (
              <li key={b}>
                <span className={`dot ${b}`} /> {t(`body.${b}`)}
              </li>
            ))}
          </ul>
          {hover !== null ? (
            <>
              <h3>{t('explorer.mapNearest', { name: loc(sites[hover].name) })}</h3>
              <ol className="am-near">
                {near.map(({ j, s }) => (
                  <li key={j}>
                    <span>
                      <span className={`dot ${sites[j].body}`} /> {loc(sites[j].name)}
                    </span>
                    <strong>{num(s * 100)}%</strong>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="muted small">{t('explorer.mapHint')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
