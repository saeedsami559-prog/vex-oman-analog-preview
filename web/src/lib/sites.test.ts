// The dataset the website serves: every number must carry provenance, every null a reason.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Dataset } from '../types';

const file = fileURLToPath(new URL('../../public/data/sites.json', import.meta.url));
const data = JSON.parse(readFileSync(file, 'utf-8')) as Dataset;
const sites = [...data.earth_sites, ...data.targets];
const features = Object.values(data.config.criteria).flatMap((c) => c.features);
const REASONS = ['no_coverage', 'needs_login', 'not_implemented', 'calibration_missing', 'not_applicable', 'download_failed'];
const PROVENANCE_KEYS = ['dataset', 'version', 'products', 'urls', 'acquired', 'native_resolution_m', 'processing'] as const;

describe('served sites.json', () => {
  it('has no provisional flag', () => {
    expect(data).not.toHaveProperty('provisional');
    for (const s of sites) expect(s).not.toHaveProperty('provisional');
  });

  it.each(sites.flatMap((s) => features.map((f) => [`${s.id}.${f}`, s, f] as const)))('%s', (_label, s, f) => {
    const v = s.raw[f];
    const m = s.missing.find((x) => x.feature === f);
    if (v !== null && v !== undefined) {
      expect(m).toBeUndefined();
      const p = s.provenance[f];
      expect(p).toBeDefined();
      for (const k of PROVENANCE_KEYS) expect(p).toHaveProperty(k);
      expect(p.products.length + p.urls.length).toBeGreaterThan(0);
    } else {
      expect(m).toBeDefined();
      expect(REASONS).toContain(m!.reason_code);
      for (const k of ['reason_en', 'reason_ar', 'needed', 'needed_ar'] as const) expect(m![k].trim()).not.toBe('');
    }
  });
});
