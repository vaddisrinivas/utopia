import { evaluateExpression, validateExpressionBudget, type Expression } from './expression';
import { executeQuery } from './query';
import type { AppPackage } from '@/packages/shared/contracts/package';
import type { ComputedFieldSpec } from '@/packages/shared/contracts/package';
import { canonicalJson } from '@/src/domain/canonical-json';

export type { ComputedFieldSpec };

export type ComputedFieldInput = {
  specs: readonly ComputedFieldSpec[];
  record: Readonly<Record<string, unknown>>;
  rows?: readonly Record<string, unknown>[];
  queries?: AppPackage['queries'];
  context?: ComputedFieldEvaluationContext;
  budget?: {
    maxFields?: number;
    maxDependencyEdges?: number;
    maxQueries?: number;
    maxRows?: number;
    maxQueryEvaluations?: number;
    maxExpressionNodes?: number;
    maxExpressionDepth?: number;
  };
};

export type ComputedFieldResult = {
  order: string[];
  values: Record<string, unknown>;
  queryHashes: Record<string, string>;
  resultHash: string;
};

export type ComputedFieldGraphInput = {
  specs: readonly ComputedFieldSpec[];
  collections: readonly string[];
  budget?: ComputedFieldInput['budget'];
};

export type ComputedFieldEvaluationContext = {
  queryCache: Map<string, {
    summaries: Record<string, { total: number; rows: Record<string, unknown>[]; resultHash: string }>;
    hashes: Record<string, string>;
  }>;
  queryEvaluations: number;
  budget: typeof DEFAULT_BUDGET;
};

const DEFAULT_BUDGET = {
  maxFields: 128,
  maxDependencyEdges: 512,
  maxQueries: 128,
  maxRows: 10_000,
  maxQueryEvaluations: 128,
  maxExpressionNodes: 256,
  maxExpressionDepth: 32,
};

/**
 * Package-install validation for the computed-field graph. This performs no
 * expression evaluation and applies the same graph/expression limits as runtime.
 */
export function validateComputedFieldGraph(input: ComputedFieldGraphInput): void {
  const budget = { ...DEFAULT_BUDGET, ...(input.budget ?? {}) };
  if (input.specs.length > budget.maxFields) throw new Error('computed_field_budget_exceeded');

  let dependencyEdges = 0;
  for (const spec of input.specs) {
    computedId(spec.id);
    const collection = text(spec.collection, 'computed_field_collection');
    if (collection !== '*' && !input.collections.includes(collection)) {
      throw new Error(`computed_field_collection_missing:${spec.id}:${collection}`);
    }
    if (!Array.isArray(spec.dependsOn)) {
      throw new Error(`computed_field_dependencies_invalid:${spec.id}`);
    }
    dependencyEdges += spec.dependsOn.length;
    validateExpressionBudget(spec.expression as Expression, {
      maxNodes: budget.maxExpressionNodes,
      maxDepth: budget.maxExpressionDepth,
    });
  }
  if (dependencyEdges > budget.maxDependencyEdges) {
    throw new Error('computed_field_dependency_budget_exceeded');
  }

  const targets = [...new Set(input.collections.map((collection) => text(
    collection,
    'computed_field_collection',
  )))].sort();
  if (targets.length === 0 && input.specs.some((spec) => spec.collection === '*')) {
    targets.push('*');
  }
  for (const collection of targets) {
    validateScopedGraph(input.specs.filter(
      (spec) => spec.collection === '*' || spec.collection === collection,
    ));
  }
}

/**
 * Pure computed-field evaluation. Values are returned as an overlay; the input
 * record and query rows are never mutated or persisted.
 */
export function evaluateComputedFields(input: ComputedFieldInput): ComputedFieldResult {
  const budget = { ...DEFAULT_BUDGET, ...(input.context?.budget ?? {}), ...(input.budget ?? {}) };
  const collection = text(input.record.collection, 'computed_record_collection');
  const specs = input.specs.filter((spec) => spec.collection === '*' || spec.collection === collection);
  if (specs.length > budget.maxFields) throw new Error('computed_field_budget_exceeded');

  const byId = new Map<string, ComputedFieldSpec>();
  let dependencyEdges = 0;
  for (const spec of specs) {
    const id = computedId(spec.id);
    if (byId.has(id)) throw new Error(`computed_field_duplicate:${id}`);
    dependencyEdges += spec.dependsOn.length;
    byId.set(id, { ...spec, id, dependsOn: [...new Set(spec.dependsOn.map(computedId))] });
  }
  if (dependencyEdges > budget.maxDependencyEdges) {
    throw new Error('computed_field_dependency_budget_exceeded');
  }

  for (const spec of byId.values()) {
    for (const dependency of spec.dependsOn) {
      if (!byId.has(dependency)) {
        throw new Error(`computed_field_dependency_missing:${spec.id}:${dependency}`);
      }
    }
  }

  const order = topologicalOrder(byId);
  const { summaries: queries, hashes: queryHashes } = evaluateQueries(input, budget);
  const values: Record<string, unknown> = {};

  for (const id of order) {
    const spec = byId.get(id)!;
    values[id] = evaluateExpression(
      {
        record: input.record,
        computed: { ...values },
        queries,
      },
      spec.expression as Expression,
      {
        maxNodes: budget.maxExpressionNodes,
        maxDepth: budget.maxExpressionDepth,
      },
    );
  }

  return {
    order,
    values,
    queryHashes,
    resultHash: stableId({ collection, order, values, queryHashes }),
  };
}

/** Return an immutable row overlay with computed values available to queries/views. */
export function applyComputedFieldsToRows(
  rows: readonly Record<string, unknown>[],
  specs: readonly ComputedFieldSpec[] = [],
  queries: AppPackage['queries'] = {},
  queryRows: readonly Record<string, unknown>[] = rows,
  context = createComputedFieldEvaluationContext(),
): Record<string, unknown>[] {
  if (!specs.length) return rows.map((row) => ({ ...row }));
  return rows.map((row) => ({
    ...row,
    ...evaluateComputedFields({ specs, record: row, rows: queryRows, queries, context }).values,
  }));
}

export function createComputedFieldEvaluationContext(
  budget: ComputedFieldInput['budget'] = {},
): ComputedFieldEvaluationContext {
  return {
    queryCache: new Map(),
    queryEvaluations: 0,
    budget: { ...DEFAULT_BUDGET, ...budget },
  };
}

function evaluateQueries(
  input: ComputedFieldInput,
  budget: typeof DEFAULT_BUDGET,
): {
  summaries: Record<string, { total: number; rows: Record<string, unknown>[]; resultHash: string }>;
  hashes: Record<string, string>;
} {
  const rows = input.rows ?? [];
  if (rows.length > budget.maxRows) throw new Error('computed_field_row_budget_exceeded');
  const entries = Object.entries(input.queries ?? {}).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length > budget.maxQueries) throw new Error('computed_field_query_budget_exceeded');
  const cacheKey = stableId({
    rows: rows.map(stableJson).sort(),
    queries: input.queries ?? {},
  });
  const context = input.context;
  const cached = context?.queryCache.get(cacheKey);
  if (cached) return cached;
  if (context) {
    context.queryEvaluations += entries.length;
    if (context.queryEvaluations > context.budget.maxQueryEvaluations) {
      throw new Error('computed_field_query_evaluation_budget_exceeded');
    }
  }

  const stableRows = [...rows].sort((left, right) => rowKey(left).localeCompare(rowKey(right)));
  const summaries: Record<string, { total: number; rows: Record<string, unknown>[]; resultHash: string }> = {};
  const hashes: Record<string, string> = {};
  for (const [id, query] of entries) {
    const scoped = query.from === 'records'
      ? stableRows
      : stableRows.filter((row) => row.collection === query.from);
    const result = executeQuery(scoped, { ...query, provenance: `computed:${id}` });
    summaries[id] = {
      total: result.total,
      rows: result.rows,
      resultHash: result.resultHash,
    };
    hashes[id] = result.resultHash;
  }
  const result = { summaries, hashes };
  context?.queryCache.set(cacheKey, result);
  return result;
}

function topologicalOrder(byId: Map<string, ComputedFieldSpec>): string[] {
  const dependents = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const id of byId.keys()) {
    dependents.set(id, []);
    inDegree.set(id, 0);
  }
  for (const spec of byId.values()) {
    inDegree.set(spec.id, spec.dependsOn.length);
    for (const dependency of spec.dependsOn) {
      dependents.get(dependency)!.push(spec.id);
    }
  }

  const ready = [...inDegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id)
    .sort();
  const order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const dependent of dependents.get(id)!.sort()) {
      const next = inDegree.get(dependent)! - 1;
      inDegree.set(dependent, next);
      if (next === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }

  if (order.length !== byId.size) {
    const cycle = [...inDegree.entries()]
      .filter(([, degree]) => degree > 0)
      .map(([id]) => id)
      .sort()
      .join(',');
    throw new Error(`computed_field_cycle:${cycle}`);
  }
  return order;
}

function validateScopedGraph(specs: readonly ComputedFieldSpec[]): void {
  const byId = new Map<string, ComputedFieldSpec>();
  for (const spec of specs) {
    const id = computedId(spec.id);
    if (byId.has(id)) throw new Error(`computed_field_duplicate:${id}`);
    byId.set(id, {
      ...spec,
      id,
      dependsOn: [...new Set(spec.dependsOn.map(computedId))],
    });
  }
  for (const spec of byId.values()) {
    for (const dependency of spec.dependsOn) {
      if (!byId.has(dependency)) {
        throw new Error(`computed_field_dependency_missing:${spec.id}:${dependency}`);
      }
    }
  }
  topologicalOrder(byId);
}

function computedId(value: string) {
  const id = text(value, 'computed_field_id');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) throw new Error(`computed_field_id_invalid:${id}`);
  return id;
}

function text(value: unknown, error: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(error);
  return value.trim();
}

function rowKey(row: Record<string, unknown>) {
  return typeof row.id === 'string' ? row.id : stableJson(row);
}

function stableId(value: unknown) {
  const encoded = stableJson(value);
  let hash = 2166136261;
  for (let index = 0; index < encoded.length; index += 1) {
    hash ^= encoded.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `computed:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function stableJson(value: unknown): string {
  return canonicalJson(value);
}
