export type QueryValue = string | number | boolean | null;

export type QueryPredicate =
  | { op: 'and' | 'or'; args: QueryPredicate[] }
  | { op: 'not'; arg: QueryPredicate }
  | { op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'; field: string; value: QueryValue }
  | { op: 'contains' | 'starts_with'; field: string; value: string }
  | { op: 'exists'; field: string; value?: boolean };

export type QuerySort = { field: string; direction?: 'asc' | 'desc' };

export type QuerySpec<T extends Record<string, unknown> = Record<string, unknown>> = {
  from: string;
  where?: QueryPredicate;
  orderBy?: QuerySort[];
  limit?: number;
  offset?: number;
  project?: string[];
  provenance?: string;
  getField?: (row: T, field: string) => unknown;
};

export type QueryResult<T> = {
  rows: T[];
  total: number;
  offset: number;
  limit: number | null;
  resultHash: string;
  provenance?: string;
};
