import type { SQLiteDatabase } from 'expo-sqlite';

import { loadCatalog } from '@/src/domain/catalog';
import { CanonicalRecord } from '@/packages/shared/contracts/records';
import { getRecord, listRecordsByCollections, listRecordsForDomain } from '@/src/db/records';
import { getAllProviderLinks } from '@/src/db/sources';
import { toRecordView, DomainRecordViewModel, recordsToViews } from '@/src/domain/renderer';
import { buildSurfaceCatalog } from '@/src/domain/surface';

export type DomainRecordFeed = {
  domainId: string;
  manifest: ReturnType<typeof loadCatalog>['activeManifest'];
};

export type SourceRow = {
  name: string;
  status: string;
  freshness: string;
  workspace: string | null;
};

function mapSourceRowFromLink(link: Awaited<ReturnType<typeof getAllProviderLinks>>[number]): SourceRow {
  return {
    name: link.provider,
    status: link.status ?? 'Configured',
    freshness: link.freshness ?? 'Local snapshot',
    workspace: link.workspace,
  };
}

export function getActiveDomainFeed() {
  const catalog = loadCatalog();
  return {
    domainId: catalog.activeDomainId,
    manifest: catalog.activeManifest,
    catalog,
  };
}

export async function queryDomainCollections(
  db: SQLiteDatabase | null,
  collections: string[]
): Promise<DomainRecordViewModel[]> {
  if (!db) {
    return [];
  }

  const { domainId, manifest } = getActiveDomainFeed();
  const records: CanonicalRecord[] = collections.length
    ? await listRecordsByCollections(db, domainId, collections)
    : await listRecordsForDomain(db, domainId);
  return recordsToViews(records)
    .filter((item) => !item.collection || manifest.collections.includes(item.collection) || collections.includes(item.collection));
}

export async function queryDomainRecords(
  db: SQLiteDatabase | null
): Promise<DomainRecordViewModel[]> {
  const { domainId } = getActiveDomainFeed();
  if (!db) {
    return [];
  }

  const records = await listRecordsForDomain(db, domainId);
  return recordsToViews(records);
}

export async function searchDomainRecords(db: SQLiteDatabase | null, query: string): Promise<DomainRecordViewModel[]> {
  if (!query.trim()) {
    return [];
  }

  const records = await queryDomainRecords(db);
  const normalized = query.toLowerCase();
  return records.filter((item) => [item.title, item.collection, item.body, item.meta].join(' ').toLowerCase().includes(normalized));
}

export function getSurfaceCollectionsForLabel(label: string): string[] {
  const { manifest } = getActiveDomainFeed();
  const catalog = buildSurfaceCatalog(manifest);
  const surface = catalog.byLabel.get(label);
  return surface ? surface.collections : [];
}

export async function getDomainRecord(db: SQLiteDatabase | null, id: string): Promise<DomainRecordViewModel | null> {
  if (!db) {
    return null;
  }

  const { domainId } = getActiveDomainFeed();
  const record = await getRecord(db, id);
  if (!record || record.domain !== domainId) {
    return null;
  }
  return toRecordView(record);
}

export async function getDomainRecordCanonical(
  db: SQLiteDatabase | null,
  id: string
): Promise<CanonicalRecord | null> {
  if (!db) {
    return null;
  }

  const { domainId } = getActiveDomainFeed();
  const record = await getRecord(db, id);
  if (!record || record.domain !== domainId) {
    return null;
  }

  return record;
}

export async function listSourceRows(db: SQLiteDatabase | null): Promise<SourceRow[]> {
  if (!db) {
    return [];
  }

  const links = await getAllProviderLinks(db);
  const mapped = links.map(mapSourceRowFromLink);
  const { domainId } = getActiveDomainFeed();
  const records = await listRecordsForDomain(db, domainId);
  if (!records.length) return mapped;

  const latest = records
    .map((record) => record.updated_at || record.created_at)
    .filter(Boolean)
    .sort()
    .at(-1);

  const localRow = {
    name: 'sqlite',
    status: 'Local ready',
    freshness: latest ? `Updated ${new Date(latest).toLocaleDateString()}` : 'Seeded local records',
    workspace: `${records.length} local records`,
  };

  return mapped.some((row) => row.name.toLowerCase() === 'sqlite') ? mapped : [localRow, ...mapped];
}
export type { DomainRecordViewModel };
