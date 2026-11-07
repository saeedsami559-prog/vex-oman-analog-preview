import { useEffect, useState, type ReactNode } from 'react';
import { ImageOverlay, LayersControl } from 'react-leaflet';
import { useI18n } from '../../i18n';
import type { Site } from '../../types';

/** Written by analysis/src/analog/layers.py into web/public/layers/<site>/meta.json. */
export interface LayerMeta {
  site: string;
  bounds: [[number, number], [number, number]];
  half_km: number;
  source: { dataset: string; native_resolution_m: number };
  elevation_m: { min: number; max: number; p2: number; p98: number };
  slope: { bins_deg: number[]; colors: string[]; share: Record<string, number> };
  drainage: Drainage & { flat?: boolean };
  /** Same statistics on the 463 m scoring grid with one threshold set, comparable across sites. */
  common?: { res_m: number; shape: [number, number]; slope_share: Record<string, number>; drainage: Drainage };
  method: string;
}
interface Drainage { stream_km2: number; depression_m: number; channel_share: number; depression_km2: number; max_upstream_km2: number }

/** Like-for-like numbers when every shown site has them, else each map's native numbers. */
function statsOf(m: LayerMeta, common: boolean) {
  return common && m.common
    ? { share: m.common.slope_share, drainage: m.common.drainage }
    : { share: m.slope.share, drainage: m.drainage };
}

const KINDS = ['elevation', 'slope', 'drainage'] as const;
const cache = new Map<string, Promise<LayerMeta | null>>();

function layerUrl(id: string, file: string) {
  return `${import.meta.env.BASE_URL}layers/${id}/${file}`;
}

export function useLayerMeta(site: Site): LayerMeta | null {
  const [meta, setMeta] = useState<LayerMeta | null>(null);
  useEffect(() => {
    let live = true;
    // Terrain layers exist for Earth and Mars sites only (the lunar pole grid is polar, not lat/lon).
    if (site.body === 'moon') cache.set(site.id, Promise.resolve(null));
    if (!cache.has(site.id)) {
      cache.set(site.id, fetch(layerUrl(site.id, 'meta.json')).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    }
    setMeta(null);
    cache.get(site.id)!.then((m) => live && setMeta(m));
    return () => { live = false; };
  }, [site.id]);
  return meta;
}

/** Overlay entries for a LayersControl; renders nothing when the site has no layers. */
export function TerrainOverlays({ site, meta }: { site: Site; meta: LayerMeta | null }) {
  const { t } = useI18n();
  if (!meta) return null;
  return (
    <>
      {KINDS.map((k) => (
        <LayersControl.Overlay key={`${site.id}-${k}`} name={t(`terrain.${k}`)} checked={k === 'drainage'}>
          <ImageOverlay url={layerUrl(site.id, `${k}.png`)} bounds={meta.bounds} opacity={k === 'drainage' ? 1 : 0.8} />
        </LayersControl.Overlay>
      ))}
    </>
  );
}

// matplotlib "terrain" from 0.22 to 0.97, the part layers.py uses (no sea blues)
const ELEV_GRADIENT = 'linear-gradient(to right, #08c46a 0%, #ffff99 37%, #805c54 71%, #f5f3f2 100%)';

const CHANNEL_COLOR = '#1a73ff';
const BASIN_COLOR = 'rgba(77,217,242,0.6)';

/** Numbers with units always read left-to-right, also inside Arabic text. */
function Qty({ v, unit }: { v: string; unit?: string }) {
  return <bdi dir="ltr" className="qty">{v}{unit ? <small> {unit}</small> : null}</bdi>;
}

/**
 * The numbers behind the terrain layers of both sites, row by row, so each property can be read
 * across. Values are rounded once and every derived number (relief, shares) uses the rounded ones,
 * so the table never shows e.g. 379 − 123 = 257.
 */
export function TerrainTable({ sites }: { sites: { site: Site; meta: LayerMeta | null }[] }) {
  const { t, loc, num } = useI18n();
  const cols = sites;
  const cell = (fn: (m: LayerMeta) => ReactNode) =>
    cols.map(({ site, meta }) => <td key={site.id}>{meta ? fn(meta) : <span className="muted">—</span>}</td>);
  const windowKm2 = (m: LayerMeta) => (2 * m.half_km) ** 2;
  const bins = cols.find((c) => c.meta)?.meta?.slope;
  const missing = cols.filter((c) => !c.meta);
  const res = cols.map((c) => c.meta?.source.native_resolution_m).filter((r): r is number => !!r);
  const mixedRes = new Set(res).size > 1;
  const present = cols.flatMap((c) => (c.meta ? [c.meta] : []));
  const common = present.length > 0 && present.every((m) => m.common);
  const commonRes = present[0]?.common?.res_m ?? 463;
  const st = (m: LayerMeta) => statsOf(m, common);
  const gridTag = common ? ` · ${t('terrain.onGrid', { res: num(commonRes) })}` : '';

  return (
    <div className="panel terrain-table-panel">
      <div className="table-wrap flush">
        <table className="table terrain-table">
          <thead>
            <tr>
              <th scope="col">{t('terrain.colProperty')}</th>
              {cols.map(({ site }) => (
                <th scope="col" key={site.id}>
                  <span className={`dot ${site.body}`} /> {loc(site.name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="group-row"><th colSpan={cols.length + 1}>{t('terrain.gData')}</th></tr>
            <tr><th scope="row">{t('terrain.dataset')}</th>{cell((m) => <span className="small">{m.source.dataset}</span>)}</tr>
            <tr><th scope="row">{t('terrain.pixel')}</th>{cell((m) => <Qty v={num(m.source.native_resolution_m)} unit="m" />)}</tr>
            <tr>
              <th scope="row">{t('terrain.window')}</th>
              {cell((m) => <Qty v={`${num(2 * m.half_km)} × ${num(2 * m.half_km)}`} unit="km" />)}
            </tr>

            <tr className="group-row"><th colSpan={cols.length + 1}>{t('terrain.elevation')}</th></tr>
            <tr><th scope="row">{t('terrain.lowest')}</th>{cell((m) => <Qty v={num(Math.round(m.elevation_m.min))} unit="m" />)}</tr>
            <tr><th scope="row">{t('terrain.highest')}</th>{cell((m) => <Qty v={num(Math.round(m.elevation_m.max))} unit="m" />)}</tr>
            <tr>
              <th scope="row">{t('terrain.relief')}</th>
              {cell((m) => <strong><Qty v={num(Math.round(m.elevation_m.max) - Math.round(m.elevation_m.min))} unit="m" /></strong>)}
            </tr>
            <tr>
              <th scope="row">{t('terrain.colourScale')}</th>
              {cell((m) => (
                <div className="ramp-cell" dir="ltr">
                  <span className="ramp" style={{ background: ELEV_GRADIENT }} />
                  <span className="ramp-ends">
                    <span>{num(Math.round(m.elevation_m.p2))} m</span>
                    <span>{num(Math.round(m.elevation_m.p98))} m</span>
                  </span>
                </div>
              ))}
            </tr>

            {bins && (
              <>
                <tr className="group-row"><th colSpan={cols.length + 1}>{t('terrain.gSlope')}{gridTag}</th></tr>
                {bins.colors.map((color, i) => {
                  const key = `${bins.bins_deg[i]}-${bins.bins_deg[i + 1]}`;
                  const label = i === bins.colors.length - 1 ? `> ${bins.bins_deg[i]}°` : `${bins.bins_deg[i]}–${bins.bins_deg[i + 1]}°`;
                  return (
                    <tr key={key}>
                      <th scope="row">
                        <span className="swatch"><i style={{ background: color }} /><bdi dir="ltr">{label}</bdi></span>
                      </th>
                      {cell((m) => {
                        const share = st(m).share[key] ?? 0;
                        return (
                          <span className="share-bar">
                            <span className="track"><span className="fill" style={{ width: `${share * 100}%`, background: color }} /></span>
                            <Qty v={`${num(share * 100, 1)}%`} />
                          </span>
                        );
                      })}
                    </tr>
                  );
                })}
              </>
            )}

            <tr className="group-row"><th colSpan={cols.length + 1}>{t('terrain.drainage')}{gridTag}</th></tr>
            <tr>
              <th scope="row">{t('terrain.threshold')}</th>
              {cell((m) => <Qty v={num(st(m).drainage.stream_km2)} unit="km²" />)}
            </tr>
            <tr>
              <th scope="row"><span className="swatch"><i style={{ background: CHANNEL_COLOR }} />{t('terrain.channels')}</span></th>
              {cell((m) => <Qty v={`${num(st(m).drainage.channel_share * 100, 1)}%`} />)}
            </tr>
            <tr>
              <th scope="row"><span className="swatch"><i style={{ background: BASIN_COLOR }} />{t('terrain.basins')}</span></th>
              {cell((m) => (
                <>
                  <Qty v={num(st(m).drainage.depression_km2, 1)} unit="km²" />{' '}
                  <span className="muted small">({t('terrain.ofWindow', { v: num((st(m).drainage.depression_km2 / windowKm2(m)) * 100, 1) })})</span>
                </>
              ))}
            </tr>
            <tr>
              <th scope="row">{t('terrain.largest')}</th>
              {cell((m) => <Qty v={num(st(m).drainage.max_upstream_km2)} unit="km²" />)}
            </tr>
          </tbody>
        </table>
      </div>
      {cols.some((c) => c.meta?.drainage.flat) && <p className="note warn small">{t('terrain.flatWarn')}</p>}
      {common ? (
        <p className="note small">{t('terrain.commonNote', { res: num(commonRes) })}</p>
      ) : (
        mixedRes && <p className="note small">{t('terrain.resNote', { a: num(res[0]), b: num(res[1]) })}</p>
      )}
      {missing.map(({ site }) => (
        <p key={site.id} className="muted small">
          <span className={`dot ${site.body}`} /> {loc(site.name)}: {t(site.body === 'moon' ? 'terrain.noMoon' : 'terrain.none')}
        </p>
      ))}
    </div>
  );
}
