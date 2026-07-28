import { ViewSpec } from './package';
import { QueryResult } from './query';

export type ViewModel = {
  id: string;
  mode: ViewSpec['mode'];
  fields: string[];
  rows: Array<Record<string, unknown>>;
  groups?: Record<string, Array<Record<string, unknown>>>;
  provenance?: string;
};

export function renderView<T extends Record<string, unknown>>(view: ViewSpec, result: QueryResult<T>): ViewModel {
  const rows = result.rows.map((row) => Object.fromEntries(view.fields.map((field) => [field, row[field]])));
  const groups = view.groupBy
    ? rows.reduce<Record<string, Array<Record<string, unknown>>>>((acc, row) => {
        const key = String(row[view.groupBy!] ?? '');
        (acc[key] ??= []).push(row);
        return acc;
      }, {})
    : undefined;
  return { id: view.id, mode: view.mode, fields: [...view.fields], rows, groups, provenance: result.provenance };
}
