import { decide, type Body, type AiExample, type AiModel, type ScoutCell, type Verdict } from './scout';

/**
 * The VEX Scout AI second opinion, explained.
 *
 * The model itself is trained offline (analysis/src/analog/scout_ai.py): a k-nearest-neighbour similarity
 * to the Earth places space agencies already chose for Moon / Mars work. Each cell carries its score and the
 * signed per-feature differences from its nearest examples; this file turns those numbers into reasons.
 */

/** AI score bands (percent). */
export const AI_HIGH = 60;
export const AI_LOW = 35;

export type AiLevel = 'high' | 'mid' | 'low';
export const aiLevel = (p: number): AiLevel => (p >= AI_HIGH ? 'high' : p >= AI_LOW ? 'mid' : 'low');

/** |z| below this: "matches the expert-chosen places"; above DIFFER: "differs". */
export const MATCH_Z = 0.5;
export const DIFFER_Z = 0.8;

export interface Reason {
  feature: string;
  z: number;
}

export interface RuleNote {
  key: 'footprint' | 'steep' | 'hazard' | 'clean' | 'flat';
  value: number;
}

export interface Explanation {
  p: number;
  level: AiLevel;
  rank: number;
  total: number;
  nearest: AiExample[];
  matches: Reason[];
  differs: Reason[];
  notes: RuleNote[];
}

export function explain(cell: ScoutCell, body: Body, model: AiModel | undefined, total: number): Explanation | null {
  const ai = cell.ai?.[body];
  if (!ai || !model) return null;
  const byId = new Map(model.examples[body].map((e) => [e.id, e]));
  const reasons = model.features.map((feature, i) => ({ feature, z: ai.z[i] }));
  const matches = reasons.filter((r) => Math.abs(r.z) < MATCH_Z).sort((a, b) => Math.abs(a.z) - Math.abs(b.z)).slice(0, 3);
  const differs = reasons.filter((r) => Math.abs(r.z) >= DIFFER_Z).sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 3);
  const notes: RuleNote[] = [];
  const human = (cell.built_pct ?? 0) + (cell.crop_pct ?? 0);
  if (cell.built_pct != null) notes.push({ key: human < 1 ? 'clean' : 'footprint', value: human });
  if (cell.safe_pct != null) {
    if (cell.safe_pct < 15) notes.push({ key: 'steep', value: cell.safe_pct });
    else if (cell.safe_pct < 40) notes.push({ key: 'hazard', value: 100 - cell.safe_pct });
    else notes.push({ key: 'flat', value: cell.safe_pct });
  }
  return {
    p: ai.p, level: aiLevel(ai.p), rank: ai.rank, total,
    nearest: ai.nn.map((id) => byId.get(id)).filter((e): e is AiExample => !!e),
    matches, differs, notes,
  };
}

export type Confidence = 'strong_go' | 'strong_no' | 'check';

/** Combine the rule-based verdict and the AI level. Agreement -> high confidence; disagreement -> go and look. */
export function confidence(verdict: Verdict, level: AiLevel): Confidence {
  if (verdict !== 'nogo' && level === 'high') return 'strong_go';
  if (verdict === 'nogo' && level === 'low') return 'strong_no';
  return 'check';
}

export function kmBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Rule verdict for a whole cell before flying (uses the whole-cell safe share instead of a drone scan). */
export function preVerdict(cell: ScoutCell, rank: number | undefined, total: number): Verdict | null {
  if (cell.safe_pct == null) return null;
  return decide(cell, rank, total, cell.safe_pct / 100).verdict;
}

/** The nearest other cell where both opinions say yes: rules GO (whole cell) and AI high. */
export function alternative(
  cell: ScoutCell, cells: ScoutCell[], body: Body, ranks: Map<string, number>, total: number,
): { cell: ScoutCell; km: number } | null {
  let best: { cell: ScoutCell; km: number } | null = null;
  for (const c of cells) {
    if (c.id === cell.id) continue;
    const ai = c.ai?.[body];
    if (!ai || aiLevel(ai.p) !== 'high' || c.safe_pct == null) continue;
    // every rule passes; distance from Muscat is a cost, not a reason to skip a nearby place
    const d = decide(c, ranks.get(c.id), total, c.safe_pct / 100);
    if (d.criteria.some((x) => x.key !== 'access' && x.level !== 'pass')) continue;
    const km = kmBetween(cell, c);
    if (!best || km < best.km) best = { cell: c, km };
  }
  return best;
}
