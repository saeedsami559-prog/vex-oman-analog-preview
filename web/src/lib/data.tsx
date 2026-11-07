import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Dataset, MissingMetric, Score, Site } from '../types';

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: Dataset };

const DataContext = createContext<State>({ status: 'loading' });

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/sites.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: Dataset) => setState({ status: 'ready', data }))
      .catch(() => setState({ status: 'error' }));
  }, []);

  return <DataContext.Provider value={state}>{children}</DataContext.Provider>;
}

export function useDataState(): State {
  return useContext(DataContext);
}

/** Only call inside components rendered after the dataset is ready (see App). */
export function useDataset(): Dataset {
  const state = useContext(DataContext);
  if (state.status !== 'ready') throw new Error('Dataset not loaded');
  return state.data;
}

export function findSite(data: Dataset, id: string | null | undefined): Site | undefined {
  return [...data.earth_sites, ...data.targets].find((s) => s.id === id);
}

/** Scores for one Earth site against every target, best first. */
export function matchesFor(data: Dataset, earthId: string): Score[] {
  return data.scores.filter((s) => s.earth === earthId).sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));
}

/** Scores for one target against every Earth site, best first. */
export function analogsFor(data: Dataset, targetId: string): Score[] {
  return data.scores.filter((s) => s.target === targetId).sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));
}

export function scoreFor(data: Dataset, earthId: string, targetId: string): Score | undefined {
  return data.scores.find((s) => s.earth === earthId && s.target === targetId);
}

/** Headline match: the highest-scoring Mars target, whatever the site was originally chosen for.
 *  Sites intended only for the Moon (terrain-only comparison) use their best Moon target. */
export function bestMatch(data: Dataset, earth: Site): Score | undefined {
  const pool = matchesFor(data, earth.id).filter((s) => s.overall !== null);
  const bodyOf = (id: string) => data.targets.find((t) => t.id === id)?.body;
  const moonOnly = !!earth.intended_targets?.length && earth.intended_targets.every((id) => bodyOf(id) === 'moon');
  return pool.find((s) => bodyOf(s.target) === (moonOnly ? 'moon' : 'mars'));
}

/** Best-scoring of the targets the site was originally chosen for (may differ from bestMatch). */
export function intendedMatch(data: Dataset, earth: Site): Score | undefined {
  if (!earth.intended_targets?.length) return undefined;
  return matchesFor(data, earth.id).find((s) => earth.intended_targets!.includes(s.target));
}

export function missingFor(site: Site, feature: string): MissingMetric | undefined {
  return site.missing.find((m) => m.feature === feature);
}
