import { QueryResult } from './query';
import { canonicalJson } from '@/src/domain/canonical-json';

export type QueryTransition = 'enter' | 'leave' | 'change';

export type QueryTransitionEvent = {
  kind: 'query_transition';
  id: string;
  transition: QueryTransition;
  addedIds: string[];
  removedIds: string[];
  changedIds: string[];
};

function rowId(row: Record<string, unknown>): string | null {
  return typeof row.id === 'string' && row.id.trim().length > 0 ? row.id : null;
}

function stableJson(value: unknown): string {
  return canonicalJson(value);
}

/** Compare two deterministic query results without mutating either result. */
export function detectQueryTransitions(
  queryId: string,
  before: QueryResult<Record<string, unknown>>,
  after: QueryResult<Record<string, unknown>>,
): QueryTransitionEvent[] {
  const beforeRows = new Map(before.rows.map((row) => [rowId(row), row]).filter(([id]) => id !== null) as [string, Record<string, unknown>][]);
  const afterRows = new Map(after.rows.map((row) => [rowId(row), row]).filter(([id]) => id !== null) as [string, Record<string, unknown>][]);
  const addedIds = [...afterRows.keys()].filter((id) => !beforeRows.has(id)).sort();
  const removedIds = [...beforeRows.keys()].filter((id) => !afterRows.has(id)).sort();
  const changedIds = [...afterRows.keys()]
    .filter((id) => beforeRows.has(id) && stableJson(beforeRows.get(id)) !== stableJson(afterRows.get(id)))
    .sort();

  const events: QueryTransitionEvent[] = [];
  if (addedIds.length) events.push({ kind: 'query_transition', id: queryId, transition: 'enter', addedIds, removedIds: [], changedIds: [] });
  if (removedIds.length) events.push({ kind: 'query_transition', id: queryId, transition: 'leave', addedIds: [], removedIds, changedIds: [] });
  if (changedIds.length) events.push({ kind: 'query_transition', id: queryId, transition: 'change', addedIds: [], removedIds: [], changedIds });
  return events;
}
