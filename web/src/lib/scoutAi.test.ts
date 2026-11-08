import { describe, expect, it } from 'vitest';
import type { AiModel, ScoutCell } from './scout';
import { aiLevel, alternative, confidence, explain, kmBetween } from './scoutAi';

const model: AiModel = {
  features: ['slope', 'roughness', 'relief', 'aridity', 'dry_air', 'thermal_swing'],
  k: 3, mean: [0, 0, 0, 0, 0, 0], std: [1, 1, 1, 1, 1, 1],
  examples: {
    moon: [{ id: 'meteor_crater', name: { en: 'Meteor Crater', ar: 'فوهة النيزك' }, lat: 35, lon: -111, x: [] }],
    mars: [],
  },
  validation: { moon: { leave_one_out: [], omani_sites: [], cells: 2, median_p: 30 }, mars: { leave_one_out: [], omani_sites: [], cells: 2, median_p: 50 } },
  note: '',
};

const cell = (over: Partial<ScoutCell> = {}): ScoutCell => ({
  id: 'a', lat: 23, lon: 58, land_frac: 1, slope_deg: 5, roughness_m: 10, relief_m: 200,
  elev_min: 0, elev_max: 100, elev_mean: 50, built_pct: 0.2, crop_pct: 0.1, km_muscat: 100,
  mars: {}, mars_best: null, mars_score: 0.8, moon_score: 0.7, heightmap: null, safe_pct: 80,
  ai: { moon: { p: 72, nn: ['meteor_crater'], z: [0.1, -0.3, 1.5, -2.0, 0.9, 0.0], rank: 3 } },
  ...over,
});

describe('AI levels and confidence', () => {
  it('bands the score', () => {
    expect(aiLevel(60)).toBe('high');
    expect(aiLevel(59.9)).toBe('mid');
    expect(aiLevel(34)).toBe('low');
  });
  it('agreement gives confidence, disagreement asks for a field visit', () => {
    expect(confidence('go', 'high')).toBe('strong_go');
    expect(confidence('nogo', 'low')).toBe('strong_no');
    expect(confidence('go', 'low')).toBe('check');
    expect(confidence('nogo', 'high')).toBe('check');
  });
});

describe('explain', () => {
  it('turns small differences into reasons for and large ones into differences', () => {
    const ex = explain(cell(), 'moon', model, 449)!;
    expect(ex.level).toBe('high');
    expect(ex.nearest.map((e) => e.id)).toEqual(['meteor_crater']);
    expect(ex.matches.map((r) => r.feature)).toEqual(['thermal_swing', 'slope', 'roughness']);
    expect(ex.differs.map((r) => r.feature)).toEqual(['aridity', 'relief', 'dry_air']);
    expect(ex.notes.map((n) => n.key)).toEqual(['clean', 'flat']);
  });
  it('flags footprint and steep ground', () => {
    const ex = explain(cell({ built_pct: 4, crop_pct: 3, safe_pct: 10 }), 'moon', model, 449)!;
    expect(ex.notes.map((n) => n.key)).toEqual(['footprint', 'steep']);
  });
  it('returns null without an AI opinion', () => {
    expect(explain(cell(), 'mars', model, 449)).toBeNull();
  });
});

describe('alternative', () => {
  it('picks the nearest cell where every rule passes and the AI agrees', () => {
    const here = cell({ id: 'here', ai: { moon: { p: 20, nn: [], z: [0, 0, 0, 0, 0, 0], rank: 300 } } });
    const near = cell({ id: 'near', lat: 23.3, lon: 58 });
    const far = cell({ id: 'far', lat: 25, lon: 58 });
    const dirty = cell({ id: 'dirty', lat: 23.1, lon: 58, built_pct: 9 });
    const ranks = new Map([['here', 300], ['near', 2], ['far', 1], ['dirty', 3]]);
    const alt = alternative(here, [here, far, dirty, near], 'moon', ranks, 400)!;
    expect(alt.cell.id).toBe('near');
    expect(alt.km).toBeCloseTo(kmBetween(here, near), 6);
    expect(alt.km).toBeGreaterThan(30);
    expect(alt.kind).toBe('both');
  });
  it('falls back to a GO the AI does not like, and never offers a far place as if it were a GO', () => {
    const here = cell({ id: 'here', ai: { moon: { p: 20, nn: [], z: [0, 0, 0, 0, 0, 0], rank: 300 } } });
    const goLowAi = cell({ id: 'go', lat: 23.5, ai: { moon: { p: 10, nn: [], z: [0, 0, 0, 0, 0, 0], rank: 400 } } });
    const farAi = cell({ id: 'far', lat: 23.2, km_muscat: 700 });
    const ranks = new Map([['here', 300], ['go', 2], ['far', 1]]);
    expect(alternative(here, [here, farAi, goLowAi], 'moon', ranks, 400)!.kind).toBe('rules');
    expect(alternative(here, [here, farAi], 'moon', ranks, 400)!.kind).toBe('far');
  });
});
