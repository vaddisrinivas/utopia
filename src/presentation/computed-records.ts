import type { AppPackage } from '@/packages/shared/contracts/package';
import type { CanonicalRecord } from '@/packages/shared/contracts/records';
import { applyComputedFieldsToRows } from '@/packages/runtime-kernel/computed-fields';
import { recordsToViews, type DomainRecordViewModel } from '@/src/domain/renderer';

export function recordsToComputedViews(
  records: readonly CanonicalRecord[],
  appPackage?: AppPackage | null,
): DomainRecordViewModel[] {
  const specs = appPackage?.computedFields ?? [];
  if (!specs.length) return recordsToViews([...records]);

  const rows = records.map(toRuntimeRow);
  const computedRows = applyComputedFieldsToRows(
    rows,
    specs,
    appPackage?.queries ?? {},
    rows,
  );

  return recordsToViews(records.map((record, index) => {
    const applicableIds = specs
      .filter((spec) => spec.collection === '*' || spec.collection === record.collection)
      .map((spec) => spec.id);
    const computed = computedRows[index] ?? {};
    const overlay = Object.fromEntries(applicableIds.map((id) => [id, computed[id]]));
    return {
      ...record,
      properties: {
        ...record.properties,
        ...overlay,
      },
    };
  }));
}

function toRuntimeRow(record: CanonicalRecord): Record<string, unknown> {
  return {
    id: record.id,
    domain: record.domain,
    collection: record.collection,
    title: record.title,
    updated_at: record.updated_at,
    created_at: record.created_at,
    archived_at: record.archived_at,
    revision: record.revision,
    deleted: record.deleted,
    privacy: record.privacy,
    ...record.properties,
  };
}
