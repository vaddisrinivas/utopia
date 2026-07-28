import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import { DomainManifest } from '@/src/domain/catalog';
import { CanonicalRecord } from '@/src/domain/runtime';
import { getRecord, upsertRecord } from '@/src/db/records';
import {
  getLatestSourceSnapshotForExternalId,
  linkSnapshotToRecord,
  upsertProviderLink,
  upsertSourceSnapshot,
} from '@/src/db/sources';
import { mergeRemoteRecord } from '@/src/providers/merge';
import { UtopiaSettings } from '@/src/settings/utopia-settings';
export { clearProviderLocalCopy, disconnectProviderLocalCopy, restoreClearedProviderLocalCopy } from '@/src/providers/provider-local-copy';
export type { DirectSyncProvider, DirectSyncReceipt } from '@/src/providers/provider-local-copy';
import type { DirectSyncProvider, DirectSyncReceipt } from '@/src/providers/provider-local-copy';

type NotionPage = {
  id?: string;
  url?: string;
  created_time?: string;
  last_edited_time?: string;
  properties?: Record<string, unknown>;
};

type SheetValuesResponse = {
  values?: unknown[][];
};

type DirectSourceSnapshot = { id: string; provider: DirectSyncProvider; externalId: string; payload: unknown; checksum: string };
type CanonicalSnapshotPayload = { provider_payload: unknown; canonical_record: CanonicalRecord };

const NOTION_VERSION = '2026-03-11';
const foodDetailKeys = ['Food detail', 'food_detail', 'Food Detail', 'Detail JSON', 'detail_json'];
const relationKeys = ['Relations', 'relations', 'Related records', 'related_records'];

export async function syncConfiguredSources(input: {
  db: SQLiteDatabase | null;
  manifest: DomainManifest;
  settings: UtopiaSettings;
}): Promise<DirectSyncReceipt[]> {
  const receipts: DirectSyncReceipt[] = [];
  if (input.settings.notion.enabled) {
    receipts.push(await syncNotionDirect(input));
  }
  if (input.settings.sheets.enabled) {
    receipts.push(await syncSheetsDirect(input));
  }
  if (!receipts.length) {
    receipts.push({
      provider: 'notion',
      status: 'blocked',
      message: 'Enable Notion or Sheets in Connections first.',
      records: 0,
      snapshots: 0,
      observedAt: new Date().toISOString(),
    });
  }
  return receipts;
}

export async function syncNotionDirect(input: {
  db: SQLiteDatabase | null;
  manifest: DomainManifest;
  settings: UtopiaSettings;
}): Promise<DirectSyncReceipt> {
  const observedAt = new Date().toISOString();
  const config = input.settings.notion;
  if (!input.db) return blocked('notion', 'Local graph is not ready yet.', observedAt);
  if (!config.enabled || !config.token.trim()) return blocked('notion', 'Notion is not enabled or token is missing.', observedAt);
  const dataSourceIds = config.dataSourceIds.split(',').map((id) => id.trim()).filter(Boolean);
  if (!dataSourceIds.length) return blocked('notion', 'Add at least one Notion data source ID in Connections.', observedAt);
  if (Platform.OS === 'web') {
    return blocked('notion', 'Direct Notion sync is available in the Android and iOS app. Browser CORS blocks direct Notion API calls.', observedAt);
  }

  try {
    const records: CanonicalRecord[] = [];
    const snapshots: Array<{ id: string; provider: DirectSyncProvider; externalId: string; payload: unknown; checksum: string }> = [];
    for (const dataSourceId of dataSourceIds) {
      const payload = await queryNotionPages(config.token, dataSourceId);
      for (const page of payload.results ?? []) {
        const record = notionPageToRecord(page, input.manifest, observedAt);
        records.push(record);
        snapshots.push({
          id: `notion-snapshot-${safeId(page.id || record.id)}`,
          provider: 'notion',
          externalId: page.id || record.id,
          payload: page,
          checksum: checksum(JSON.stringify(page)),
        });
      }
    }
    await applyRecords(input.db, input.manifest, records, snapshots, {
      provider: 'notion',
      externalId: dataSourceIds.join(','),
      name: 'Notion',
      workspace: config.pageId || dataSourceIds[0] || 'Notion workspace',
      url: config.pageId ? `https://www.notion.so/${config.pageId.replace(/-/g, '')}` : 'https://www.notion.so',
      observedAt,
    });
    return {
      provider: 'notion',
      status: 'synced',
      message: `Pulled ${records.length} Notion records into ${input.manifest.label}.`,
      records: records.length,
      snapshots: snapshots.length,
      observedAt,
    };
  } catch (err) {
    return error('notion', err instanceof Error ? err.message : 'Notion sync failed.', observedAt);
  }
}

export async function syncSheetsDirect(input: {
  db: SQLiteDatabase | null;
  manifest: DomainManifest;
  settings: UtopiaSettings;
}): Promise<DirectSyncReceipt> {
  const observedAt = new Date().toISOString();
  const config = input.settings.sheets;
  if (!input.db) return blocked('google_sheets', 'Local graph is not ready yet.', observedAt);
  if (!config.enabled || !config.token.trim()) return blocked('google_sheets', 'Google Sheets is not enabled or token is missing.', observedAt);
  if (!config.workbookId.trim()) return blocked('google_sheets', 'Add a Google Sheets workbook ID in Connections.', observedAt);

  try {
    const range = encodeURIComponent(config.sheetName || 'Utopia Canonical');
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.workbookId)}/values/${range}`, {
      headers: { authorization: `Bearer ${config.token}` },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return error('google_sheets', `Sheets pull failed ${response.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`, observedAt);
    }
    const payload = (await response.json()) as SheetValuesResponse;
    const records = sheetValuesToRecords(payload.values ?? [], input.manifest, config.workbookId, observedAt);
    const snapshots = records.map((record) => ({
      id: `sheets-snapshot-${safeId(record.source.external_id)}`,
      provider: 'google_sheets' as const,
      externalId: record.source.external_id,
      payload: record.properties,
      checksum: checksum(JSON.stringify(record.properties)),
    }));
    await applyRecords(input.db, input.manifest, records, snapshots, {
      provider: 'google_sheets',
      externalId: config.workbookId,
      name: 'Google Sheets',
      workspace: config.sheetName || 'Utopia Canonical',
      url: `https://docs.google.com/spreadsheets/d/${config.workbookId}/edit`,
      observedAt,
    });
    return {
      provider: 'google_sheets',
      status: 'synced',
      message: `Pulled ${records.length} Sheets rows into ${input.manifest.label}.`,
      records: records.length,
      snapshots: snapshots.length,
      observedAt,
    };
  } catch (err) {
    return error('google_sheets', err instanceof Error ? err.message : 'Sheets sync failed.', observedAt);
  }
}

async function queryNotionPages(token: string, sourceId: string): Promise<{ results?: NotionPage[] }> {
  const dataSource = await queryNotionEndpoint(token, `https://api.notion.com/v1/data_sources/${encodeURIComponent(sourceId)}/query`, NOTION_VERSION);
  if (dataSource.ok) return dataSource.payload;
  if (dataSource.status !== 404) throw new Error(dataSource.message);
  const database = await queryNotionEndpoint(token, `https://api.notion.com/v1/databases/${encodeURIComponent(sourceId)}/query`, '2022-06-28');
  if (database.ok) return database.payload;
  throw new Error(database.message);
}

async function queryNotionEndpoint(
  token: string,
  url: string,
  notionVersion: string,
): Promise<{ ok: true; payload: { results?: NotionPage[] } } | { ok: false; status: number; message: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'notion-version': notionVersion,
    },
    body: JSON.stringify({ page_size: 100 }),
  });
  if (response.ok) return { ok: true, payload: (await response.json()) as { results?: NotionPage[] } };
  const detail = await response.text().catch(() => '');
  return {
    ok: false,
    status: response.status,
    message: `Notion pull failed ${response.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`,
  };
}

function notionPageToRecord(page: NotionPage, manifest: DomainManifest, observedAt: string): CanonicalRecord {
  const props = page.properties ?? {};
  const id = `notion-${safeId(page.id || String(Date.now()))}`;
  const title = pickTitle(props) || 'Notion record';
  const collection = pickCollection(props, manifest);
  return {
    id,
    domain: manifest.id,
    collection,
    title,
    properties: {
      status: readPlainProperty(props.Status) || readPlainProperty(props.status) || 'Active',
      meta: readPlainProperty(props.Meta) || readPlainProperty(props.Type) || collection,
      body: readPlainProperty(props.Body) || readPlainProperty(props.Notes) || readPlainProperty(props.Description) || title,
      source: 'Notion',
      food_detail: readJsonProperty(props, foodDetailKeys),
      raw: props,
    },
    relations: readRelations(props, relationKeys),
    source: {
      provider: 'notion',
      external_id: page.id || id,
      url: page.url || null,
      observed_at: observedAt,
      content_hash: checksum(JSON.stringify(page)),
    },
    archived_at: null,
    created_at: page.created_time || observedAt,
    updated_at: page.last_edited_time || observedAt,
    revision: 1,
    schema_version: manifest.schema_version,
    deleted: false,
    privacy: 'personal',
    provenance: {
      actor: 'sync',
      confidence: null,
      evidence: [page.url || page.id || id],
      reason: 'Pulled from Notion direct source.',
    },
  };
}

function sheetValuesToRecords(values: unknown[][], manifest: DomainManifest, workbookId: string, observedAt: string): CanonicalRecord[] {
  const [headerRow, ...rows] = values;
  const headers = (headerRow ?? []).map((value) => String(value || '').trim());
  if (!headers.length) return [];
  return rows
    .map((row, index) => {
      const object = Object.fromEntries(headers.map((header, headerIndex) => [header, row[headerIndex] ?? '']));
      const idRaw = stringField(object, ['id', 'record_id', 'Record ID']) || `${workbookId}-${index + 2}`;
      const title = stringField(object, ['title', 'Title', 'name', 'Name']) || `Sheet row ${index + 2}`;
      const collection = normalizeCollection(stringField(object, ['collection', 'Collection']) || '', manifest);
      return {
        id: `sheets-${safeId(idRaw)}`,
        domain: manifest.id,
        collection,
        title,
        properties: {
          status: stringField(object, ['status', 'Status']) || 'Active',
          meta: stringField(object, ['meta', 'Meta', 'type', 'Type']) || collection,
          body: stringField(object, ['body', 'Body', 'notes', 'Notes', 'description', 'Description']) || title,
          source: 'Google Sheets',
          food_detail: jsonField(object, foodDetailKeys),
          row: index + 2,
          raw: object,
        },
        relations: relationField(object, relationKeys),
        source: {
          provider: 'google_sheets' as const,
          external_id: idRaw,
          url: `https://docs.google.com/spreadsheets/d/${workbookId}/edit`,
          observed_at: observedAt,
          content_hash: checksum(JSON.stringify(object)),
        },
        archived_at: null,
        created_at: observedAt,
        updated_at: observedAt,
        revision: 1,
        schema_version: manifest.schema_version,
        deleted: false,
        privacy: 'personal',
        provenance: {
          actor: 'sync',
          confidence: null,
          evidence: [`row:${index + 2}`],
          reason: 'Pulled from Google Sheets direct source.',
        },
      } satisfies CanonicalRecord;
    })
    .filter((record) => record.title.trim().length > 0);
}

export async function applyDirectSourceRecords(
  db: SQLiteDatabase,
  manifest: DomainManifest,
  records: CanonicalRecord[],
  snapshots: DirectSourceSnapshot[],
  link: { provider: DirectSyncProvider; externalId: string; name: string; workspace: string; url: string; observedAt: string },
) {
  const now = new Date().toISOString();
  await upsertProviderLink(db, {
    id: `${link.provider}:${safeId(link.externalId)}`,
    provider: link.provider,
    external_id: link.externalId,
    name: link.name,
    status: 'Synced',
    freshness: link.observedAt,
    workspace: link.workspace,
    url: link.url,
    created_at: now,
    updated_at: now,
  });
  for (const record of records) {
    const snapshot = snapshots.find((item) => record.source.external_id === item.externalId);
    const previousSnapshot = snapshot
      ? await getLatestSourceSnapshotForExternalId(db, snapshot.provider, snapshot.externalId)
      : null;
    const local = await getRecord(db, record.id);
    if (local) {
      await mergeRemoteRecord({
        db,
        manifest,
        provider: record.source.provider,
        externalId: record.source.external_id,
        base: canonicalRecordFromSnapshot(previousSnapshot?.payload_json ?? null),
        local,
        remote: record,
      });
    } else {
      await upsertRecord(db, manifest, {
        ...record,
        operation_actor: 'sync',
        operation_origin: 'sync',
        idempotency_key: `direct-source-create:${record.source.provider}:${record.source.external_id}:${record.id}:${record.source.content_hash ?? ''}`,
      });
    }
    if (snapshot) {
      await upsertSourceSnapshot(db, {
        id: snapshot.id,
        provider: snapshot.provider,
        external_id: snapshot.externalId,
        scope: manifest.id,
        observed_at: link.observedAt,
        payload_json: JSON.stringify(snapshotPayload(snapshot.payload, record)),
        checksum: snapshot.checksum,
        created_at: now,
        updated_at: now,
      });
      await linkSnapshotToRecord(db, { snapshot_id: snapshot.id, record_id: record.id });
    }
  }
}

async function applyRecords(
  db: SQLiteDatabase,
  manifest: DomainManifest,
  records: CanonicalRecord[],
  snapshots: DirectSourceSnapshot[],
  link: { provider: DirectSyncProvider; externalId: string; name: string; workspace: string; url: string; observedAt: string },
) {
  await applyDirectSourceRecords(db, manifest, records, snapshots, link);
}

function snapshotPayload(providerPayload: unknown, canonicalRecord: CanonicalRecord): CanonicalSnapshotPayload {
  return {
    provider_payload: providerPayload,
    canonical_record: canonicalRecord,
  };
}

function canonicalRecordFromSnapshot(payloadJson: string | null): CanonicalRecord | null {
  if (!payloadJson) return null;
  try {
    const parsed = JSON.parse(payloadJson) as Partial<CanonicalSnapshotPayload>;
    if (parsed && typeof parsed === 'object' && parsed.canonical_record && typeof parsed.canonical_record === 'object') {
      return parsed.canonical_record;
    }
  } catch {
    return null;
  }
  return null;
}

function pickTitle(props: Record<string, unknown>): string {
  for (const key of ['Name', 'Title', 'title', 'name']) {
    const value = readPlainProperty(props[key]);
    if (value) return value;
  }
  for (const value of Object.values(props)) {
    const plain = readPlainProperty(value);
    if (plain) return plain;
  }
  return '';
}

function pickCollection(props: Record<string, unknown>, manifest: DomainManifest): string {
  return normalizeCollection(readPlainProperty(props.Collection) || readPlainProperty(props.collection) || '', manifest);
}

function normalizeCollection(value: string, manifest: DomainManifest): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
  return manifest.collections.includes(normalized) ? normalized : manifest.collections[0] || 'source_record';
}

function readPlainProperty(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (typeof record.plain_text === 'string') return record.plain_text.trim();
  if (typeof record.name === 'string') return record.name.trim();
  if (typeof record.content === 'string') return record.content.trim();
  if (typeof record.number === 'number') return String(record.number);
  if (typeof record.checkbox === 'boolean') return record.checkbox ? 'true' : 'false';
  if (Array.isArray(record.title)) return record.title.map(readPlainProperty).filter(Boolean).join(' ').trim();
  if (Array.isArray(record.rich_text)) return record.rich_text.map(readPlainProperty).filter(Boolean).join(' ').trim();
  if (record.select) return readPlainProperty(record.select);
  if (Array.isArray(record.multi_select)) return record.multi_select.map(readPlainProperty).filter(Boolean).join(', ');
  if (record.date && typeof record.date === 'object') {
    const date = record.date as Record<string, unknown>;
    return [date.start, date.end].filter((item) => typeof item === 'string').join(' to ');
  }
  if (record.formula && typeof record.formula === 'object') return readPlainProperty(record.formula);
  return '';
}

function readJsonProperty(props: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const raw = readPlainProperty(props[key]);
    const parsed = parseJson(raw);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function jsonField(object: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const parsed = parseJson(stringField(object, [key]));
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function parseJson(value: string): unknown {
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function readRelations(props: Record<string, unknown>, keys: string[]): CanonicalRecord['relations'] {
  for (const key of keys) {
    const raw = readPlainProperty(props[key]);
    const parsed = parseRelations(raw);
    if (parsed.length) return parsed;
  }
  return [];
}

function relationField(object: Record<string, unknown>, keys: string[]): CanonicalRecord['relations'] {
  for (const key of keys) {
    const parsed = parseRelations(stringField(object, [key]));
    if (parsed.length) return parsed;
  }
  return [];
}

function parseRelations(value: string): CanonicalRecord['relations'] {
  if (!value.trim()) return [];
  const parsed = parseJson(value);
  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const relation = item as Record<string, unknown>;
        const name = typeof relation.name === 'string' ? relation.name : '';
        const targetId = typeof relation.target_id === 'string' ? relation.target_id : '';
        return name && targetId ? { name, target_id: targetId } : null;
      })
      .filter((item): item is CanonicalRecord['relations'][number] => item !== null);
  }
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((targetId) => ({ name: 'supports', target_id: targetId }));
}

function stringField(object: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = object[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function safeId(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || String(Date.now());
}

function checksum(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return `c${Math.abs(hash)}`;
}

function blocked(provider: DirectSyncProvider, message: string, observedAt: string): DirectSyncReceipt {
  return { provider, status: 'blocked', message, records: 0, snapshots: 0, observedAt };
}

function error(provider: DirectSyncProvider, message: string, observedAt: string): DirectSyncReceipt {
  return { provider, status: 'error', message, records: 0, snapshots: 0, observedAt };
}

function providerDisplayName(provider: DirectSyncProvider) {
  return provider === 'google_sheets' ? 'Sheets' : 'Notion';
}
