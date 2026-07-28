import { AppPackage, ViewSpec } from './package';
import { executeQuery, QueryResult } from './query';
import { renderView, ViewModel } from './view';
import { applyComputedFieldsToRows, createComputedFieldEvaluationContext } from './computed-fields';

export type PackageRuntimeInput = {
  package: AppPackage;
  collections: Record<string, readonly Record<string, unknown>[]>;
};

export type PackageRuntimeOutput = {
  packageId: string;
  packageVersion: string;
  queries: Record<string, QueryResult<Record<string, unknown>>>;
  views: Record<string, ViewModel>;
};

/**
 * Evaluate an executable-data package without giving it a write capability.
 * Queries and views are pure; mutations still require a kernel Operation.
 */
export function evaluatePackage(input: PackageRuntimeInput): PackageRuntimeOutput {
  const { package: appPackage, collections } = input;
  const allRows = Object.values(collections).flatMap((rows) => [...rows]);
  const computedContext = createComputedFieldEvaluationContext();
  const computedCollections = Object.fromEntries(
    Object.entries(collections).map(([id, rows]) => [
      id,
      applyComputedFieldsToRows(rows, appPackage.computedFields ?? [], appPackage.queries, allRows, computedContext),
    ]),
  );
  const queries: Record<string, QueryResult<Record<string, unknown>>> = {};

  for (const [queryId, spec] of Object.entries(appPackage.queries)) {
    const rows = computedCollections[spec.from];
    if (!rows) throw new Error(`package_collection_missing:${spec.from}`);
    queries[queryId] = executeQuery(rows, {
      from: spec.from,
      where: spec.where,
      orderBy: spec.orderBy,
      limit: spec.limit,
      provenance: `${appPackage.id}@${appPackage.version}/query:${queryId}`,
    });
  }

  const views: Record<string, ViewModel> = {};
  for (const [viewId, view] of Object.entries(appPackage.views)) {
    const result = queries[view.query];
    if (!result) throw new Error(`package_query_missing:${view.query}`);
    views[viewId] = renderView({ ...view, id: viewId } as ViewSpec, result);
  }

  return {
    packageId: appPackage.id,
    packageVersion: appPackage.version,
    queries,
    views,
  };
}
