import { CanonicalRecord } from '@/packages/shared/contracts/records';

export type CanonicalTone = 'neutral' | 'moss' | 'amber' | 'plum' | 'blue';

export type DomainRecordViewModel = {
  id: string;
  collection: string;
  title: string;
  body: string;
  source: string;
  status: string;
  tone: CanonicalTone;
  meta: string;
  properties: Record<string, unknown>;
};

function detectTone(value: unknown): CanonicalTone {
  if (value === 'moss' || value === 'amber' || value === 'plum' || value === 'blue') {
    return value;
  }
  return 'neutral';
}

function buildSourceLabel(record: CanonicalRecord): string {
  const provider = record.source.provider.replace('_', ' ');
  const host = record.source.external_id ? ` · ${record.source.external_id}` : '';
  return `${provider}${host}`;
}

function buildStatus(record: CanonicalRecord): string {
  return String(record.properties.status ?? 'Active');
}

function buildMeta(record: CanonicalRecord): string {
  if (typeof record.properties.meta === 'string' && record.properties.meta.trim()) {
    return record.properties.meta;
  }

  const collection = record.collection;
  const source = typeof record.source.provider === 'string' ? record.source.provider : 'local';
  const observed = typeof record.properties.observed_at === 'string' ? ` · ${record.properties.observed_at}` : '';
  return `${collection} · ${source}${observed}`;
}

export function toRecordView(record: CanonicalRecord): DomainRecordViewModel {
  return {
    id: record.id,
    collection: record.collection,
    title: record.title,
    body: typeof record.properties.body === 'string' ? record.properties.body : '',
    source: buildSourceLabel(record),
    status: buildStatus(record),
    tone: detectTone(record.properties.tone),
    meta: buildMeta(record),
    properties: record.properties,
  };
}

export function matchRecordText(record: CanonicalRecord, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;
  const haystack = [
    record.title,
    record.collection,
    String(record.properties.body ?? ''),
    String(record.properties.meta ?? ''),
    buildSourceLabel(record),
    record.id,
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(normalized);
}

export function recordsToViews(records: CanonicalRecord[]): DomainRecordViewModel[] {
  return records.map(toRecordView);
}
