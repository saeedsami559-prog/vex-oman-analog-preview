import { useEffect, useState } from 'react';

/** The parts of web/public/layers/<site>/meta.json (written by `python -m analog.layers`) the UI reads. */
export interface LayerMeta {
  half_km: number;
  source: { dataset: string; native_resolution_m: number };
  slope: { bins_deg: number[]; colors: string[] };
  /** Elevation range of the window (metres). */
  elevation_m?: { min: number; max: number };
  /** Slope shares on the common 463 m grid, keyed "0-2", "2-5", ... "30-90". */
  common?: { res_m: number; slope_share: Record<string, number> };
}

export const layerUrl = (id: string, file: string) => `${import.meta.env.BASE_URL}layers/${id}/${file}`;

/** Fetch a site's layer metadata; null while loading, when id is empty, or when the site has no layers. */
export function useLayerMeta(id: string | null | undefined): LayerMeta | null {
  const [meta, setMeta] = useState<LayerMeta | null>(null);
  useEffect(() => {
    let alive = true;
    setMeta(null);
    if (!id) return;
    fetch(layerUrl(id, 'meta.json'))
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((m: LayerMeta) => alive && setMeta(m))
      .catch(() => alive && setMeta(null));
    return () => {
      alive = false;
    };
  }, [id]);
  return meta;
}
