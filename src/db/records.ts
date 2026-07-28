import {
  CanonicalProvenance,
  CanonicalRecord,
  RecordProvider,
} from '@/packages/shared/contracts/records';
import {
  DEFAULT_APP_INSTALLATION_ID,
  DEFAULT_WORKSPACE_ID,
} from '@/packages/shared/contracts/app-installation';
import { validateCanonicalRecord } from '@/src/domain/runtime';
import { getDomainManifest, loadCatalog, DomainManifest, DomainId } from '@/src/domain/catalog';
import type { SQLiteDatabase } from 'expo-sqlite';
import { applyOperation } from '@/src/ops/apply';
import { undoOperation } from '@/src/ops/undo';
import type { ApplyOperationOptions, Operation, OperationActor, OperationOrigin } from '@/packages/shared/contracts/operation';

type SqlRecordRow = {
  app_installation_id: string;
  id: string;
  domain: DomainId;
  collection: string;
  title: string;
  properties: string;
  source_provider: RecordProvider;
  source_external_id: string;
  source_url: string | null;
  source_observed_at: string;
  source_content_hash: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
  schema_version: string;
  deleted: number;
  privacy: CanonicalRecord['privacy'];
  provenance_json: string | null;
};

type SqlRelationRow = {
  app_installation_id: string;
  from_id: string;
  collection: string;
  name: string;
  target_id: string;
  target_domain: string;
  target_collection: string;
  created_at: string;
};

type CanonicalRelationInput = Pick<SqlRelationRow, 'name' | 'target_id'>;
export type InstallationRecordScope = {
  workspaceId: string;
  installationId: string;
};

type ScopedOperation = Operation & {
  app_installation_id?: string | null;
};

function operationId(parts: string[]) {
  const safe = parts.map((part) => part.replace(/[^A-Za-z0-9_-]/g, '-')).join('-');
  return `op-${safe}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeScope(scope?: Partial<InstallationRecordScope> | null): InstallationRecordScope {
  const workspaceId = scope?.workspaceId?.trim() || DEFAULT_WORKSPACE_ID;
  const installationId = scope?.installationId?.trim() || DEFAULT_APP_INSTALLATION_ID;
  return { workspaceId, installationId };
}

export async function getRecord(db: SQLiteDatabase, id: string): Promise<CanonicalRecord | null> {
  return getRecordForInstallation(db, DEFAULT_APP_INSTALLATION_ID, id);
}

export async function getRecordForInstallation(
  db: SQLiteDatabase,
  installationId: string,
  id: string,
): Promise<CanonicalRecord | null> {
  const scoped = normalizeScope({ installationId });
  const row = await db.getFirstAsync<SqlRecordRow>(
    `SELECT * FROM records WHERE app_installation_id = ? AND id = ?`,
    [scoped.installationId, id],
  );
  if (!row) return null;
  const [record, relations] = await Promise.all([
    inflateRecord(row),
    getRelationsForRecord(db, scoped.installationId, id),
  ]);
  return { ...record, relations };
}

export async function getRecordsByIds(db: SQLiteDatabase, ids: string[]): Promise<CanonicalRecord[]> {
  return getRecordsByIdsForInstallation(db, DEFAULT_APP_INSTALLATION_ID, ids);
}

export async function getRecordsByIdsForInstallation(
  db: SQLiteDatabase,
  installationId: string,
  ids: string[],
): Promise<CanonicalRecord[]> {
  const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  if (!uniqueIds.length) return [];
  const scoped = normalizeScope({ installationId });
  const placeholders = uniqueIds.map(() => '?').join(', ');
  const rows = await db.getAllAsync<SqlRecordRow>(
    `SELECT * FROM records WHERE app_installation_id = ? AND id IN (${placeholders}) AND archived_at IS NULL`,
    [scoped.installationId, ...uniqueIds]
  );
  return Promise.all(rows.map(async (row) => ({
    ...(await inflateRecord(row)),
    relations: await getRelationsForRecord(db, scoped.installationId, row.id),
  })));
}

export async function listRecordsForDomain(
  db: SQLiteDatabase,
  domainId: DomainId,
  collection?: string
): Promise<CanonicalRecord[]> {
  return listRecordsForDomainAndInstallation(db, DEFAULT_APP_INSTALLATION_ID, domainId, collection);
}

export async function listRecordsForDomainAndInstallation(
  db: SQLiteDatabase,
  installationId: string,
  domainId: DomainId,
  collection?: string
): Promise<CanonicalRecord[]> {
  const scoped = normalizeScope({ installationId });
  const where = collection ? 'domain = ? AND collection = ? AND archived_at IS NULL' : 'domain = ? AND archived_at IS NULL';
  const params = collection ? [domainId, collection] : [domainId];
  const rows = await db.getAllAsync<SqlRecordRow>(
    `SELECT * FROM records WHERE app_installation_id = ? AND ${where} ORDER BY updated_at DESC`,
    [scoped.installationId, ...params],
  );
  return Promise.all(rows.map(async (row) => ({
    ...(await inflateRecord(row)),
    relations: await getRelationsForRecord(db, scoped.installationId, row.id),
  })));
}

export async function listRecordsByCollections(
  db: SQLiteDatabase,
  domainId: DomainId,
  collections: string[]
): Promise<CanonicalRecord[]> {
  return listRecordsByCollectionsForInstallation(db, DEFAULT_APP_INSTALLATION_ID, domainId, collections);
}

export async function listRecordsByCollectionsForInstallation(
  db: SQLiteDatabase,
  installationId: string,
  domainId: DomainId,
  collections: string[]
): Promise<CanonicalRecord[]> {
  if (collections.length === 0) return [];
  const scoped = normalizeScope({ installationId });
  const placeholders = collections.map(() => '?').join(', ');
  const rows = await db.getAllAsync<SqlRecordRow>(
    `SELECT * FROM records WHERE app_installation_id = ? AND domain = ? AND collection IN (${placeholders}) AND archived_at IS NULL ORDER BY updated_at DESC`,
    [scoped.installationId, domainId, ...collections]
  );
  return Promise.all(rows.map(async (row) => ({
    ...(await inflateRecord(row)),
    relations: await getRelationsForRecord(db, scoped.installationId, row.id),
  })));
}

export async function upsertRecord(
  db: SQLiteDatabase,
  manifest: DomainManifest,
  input: Omit<CanonicalRecord, 'domain' | 'relations' | 'revision' | 'schema_version' | 'deleted' | 'privacy' | 'provenance'> & {
    id: string;
    relations?: CanonicalRelationInput[];
    source: CanonicalRecord['source'];
    created_at?: string;
    updated_at?: string;
    revision?: number;
    schema_version?: string;
    deleted?: boolean;
    privacy?: CanonicalRecord['privacy'];
    provenance?: CanonicalProvenance | null;
    operation_origin?: OperationOrigin;
    operation_actor?: OperationActor;
    operation_id?: string;
    idempotency_key?: string;
    app_installation_id?: string | null;
  }
): Promise<CanonicalRecord> {
  const appInstallationId = normalizeScope({ installationId: input.app_installation_id ?? undefined }).installationId;
  const now = new Date().toISOString();
  const validated = validateCanonicalRecord(
    {
      ...input,
      domain: manifest.id,
      relations: input.relations ?? [],
      updated_at: input.updated_at ?? now,
      created_at: input.created_at ?? now,
    },
    manifest.id,
    manifest,
    'record'
  );

  const current = await getRecordForInstallation(db, appInstallationId, validated.id);
  const result = await applyOperation(db, manifest, {
    op_id: input.operation_id?.trim() || operationId([validated.id]),
    app_installation_id: appInstallationId,
    kind: current ? 'update' : 'create',
    domain: manifest.id,
    collection: validated.collection,
    record_id: validated.id,
    expected_revision: current?.revision,
    record: validated,
    actor: input.operation_actor ?? validated.provenance?.actor ?? actorForProvider(validated.source.provider),
    origin: input.operation_origin ?? originForProvider(validated.source.provider),
    idempotency_key: input.idempotency_key,
    confidence: validated.provenance?.confidence ?? null,
    evidence: validated.provenance?.evidence ?? [],
    reason: validated.provenance?.reason ?? `Upsert ${validated.title}`,
  }, { appInstallationId });
  if (result.status === 'rejected') {
    throw new Error(`Record operation rejected: ${result.reject_reason}`);
  }
  const saved = result.record ?? await getRecordForInstallation(db, appInstallationId, validated.id);
  if (!saved) throw new Error(`Record operation did not return ${validated.id}`);
  return saved;
}

export async function archiveRecord(db: SQLiteDatabase, id: string): Promise<void> {
  return archiveRecordForInstallation(db, DEFAULT_APP_INSTALLATION_ID, id);
}

export async function archiveRecordForInstallation(
  db: SQLiteDatabase,
  installationId: string,
  id: string,
): Promise<void> {
  const appInstallationId = normalizeScope({ installationId }).installationId;
  const current = await getRecordForInstallation(db, appInstallationId, id);
  if (!current) return;
  const catalog = loadCatalog();
  const manifest = current.domain === catalog.activeManifest.id
    ? catalog.activeManifest
    : getDomainManifest(catalog.catalog.domains, current.domain) ?? catalog.activeManifest;
  const result = await applyOperation(db, manifest, {
    op_id: operationId([id, 'archive']),
    app_installation_id: appInstallationId,
    kind: 'archive',
    domain: manifest.id,
    collection: current.collection,
    record_id: id,
    expected_revision: current.revision,
    actor: 'user',
    origin: 'manual',
    reason: `Archive ${current.title}`,
  }, { appInstallationId });
  if (result.status === 'rejected') {
    throw new Error(`Archive operation rejected: ${result.reject_reason}`);
  }
}

export async function restoreRecord(db: SQLiteDatabase, id: string): Promise<void> {
  return restoreRecordForInstallation(db, DEFAULT_APP_INSTALLATION_ID, id);
}

export async function restoreRecordForInstallation(
  db: SQLiteDatabase,
  installationId: string,
  id: string,
): Promise<void> {
  const appInstallationId = normalizeScope({ installationId }).installationId;
  const current = await getRecordForInstallation(db, appInstallationId, id);
  if (!current) return;
  const catalog = loadCatalog();
  const manifest = current.domain === catalog.activeManifest.id
    ? catalog.activeManifest
    : getDomainManifest(catalog.catalog.domains, current.domain) ?? catalog.activeManifest;
  const result = await applyOperation(db, manifest, {
    op_id: operationId([id, 'restore']),
    app_installation_id: appInstallationId,
    kind: 'restore',
    domain: manifest.id,
    collection: current.collection,
    record_id: id,
    expected_revision: current.revision,
    actor: 'user',
    origin: 'manual',
    reason: `Restore ${current.title}`,
  }, { appInstallationId });
  if (result.status === 'rejected') {
    throw new Error(`Restore operation rejected: ${result.reject_reason}`);
  }
}

async function inflateRecord(row: SqlRecordRow): Promise<CanonicalRecord> {
  let properties: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.properties);
    if (parsed && typeof parsed === 'object') {
      properties = parsed as Record<string, unknown>;
    }
  } catch {
    properties = {};
  }

  return {
    id: row.id,
    domain: row.domain,
    collection: row.collection,
    title: row.title,
    properties,
    relations: [],
    source: {
      provider: row.source_provider,
      external_id: row.source_external_id,
      url: row.source_url,
      observed_at: row.source_observed_at,
      content_hash: row.source_content_hash,
    },
    archived_at: row.archived_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    revision: Number(row.revision) || 1,
    schema_version: row.schema_version || '1.0.0',
    deleted: Boolean(row.deleted),
    privacy: row.privacy === 'private' || row.privacy === 'shared' || row.privacy === 'personal' ? row.privacy : 'personal',
    provenance: parseProvenance(row.provenance_json),
  };
}

function parseProvenance(value: string | null): CanonicalProvenance | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as CanonicalProvenance : null;
  } catch {
    return null;
  }
}

function actorForProvider(provider: RecordProvider): OperationActor {
  if (provider === 'notion' || provider === 'google_sheets' || provider === 'postgres') return 'sync';
  if (provider === 'web') return 'api';
  return 'user';
}

function originForProvider(provider: RecordProvider): OperationOrigin {
  if (provider === 'notion' || provider === 'google_sheets' || provider === 'postgres') return 'sync';
  if (provider === 'web') return 'import';
  return 'manual';
}

export async function ensureSeedCollectionCounts(
  db: SQLiteDatabase,
  domainId: DomainId
): Promise<Record<string, number>> {
  return ensureSeedCollectionCountsForInstallation(db, DEFAULT_APP_INSTALLATION_ID, domainId);
}

export async function ensureSeedCollectionCountsForInstallation(
  db: SQLiteDatabase,
  installationId: string,
  domainId: DomainId
): Promise<Record<string, number>> {
  const appInstallationId = normalizeScope({ installationId }).installationId;
  const rows = await db.getAllAsync<{ collection: string; total: number }>(
    'SELECT collection, COUNT(*) as total FROM records WHERE app_installation_id = ? AND domain = ? AND archived_at IS NULL GROUP BY collection',
    [appInstallationId, domainId]
  );
  return rows.reduce((acc, row) => {
    acc[row.collection] = row.total;
    return acc;
  }, {} as Record<string, number>);
}

async function getRelationsForRecord(db: SQLiteDatabase, installationId: string, id: string): Promise<CanonicalRecord['relations']> {
  const rows = await db.getAllAsync<SqlRelationRow>(
    'SELECT name, target_id FROM record_relations WHERE app_installation_id = ? AND from_id = ?',
    [installationId, id],
  );
  return rows.map((relation) => ({ name: relation.name, target_id: relation.target_id }));
}

export async function countRecords(db: SQLiteDatabase, domainId: DomainId): Promise<number> {
  return countRecordsForInstallation(db, DEFAULT_APP_INSTALLATION_ID, domainId);
}

export async function countRecordsForInstallation(
  db: SQLiteDatabase,
  installationId: string,
  domainId: DomainId,
): Promise<number> {
  const appInstallationId = normalizeScope({ installationId }).installationId;
  const row = await db.getFirstAsync<{ total: number }>(
    'SELECT COUNT(*) as total FROM records WHERE app_installation_id = ? AND domain = ? AND archived_at IS NULL',
    [appInstallationId, domainId],
  );
  return row?.total ?? 0;
}

export async function listActiveConversationsForRecordLinks(db: SQLiteDatabase, ids: string[]): Promise<Record<string, string[]>> {
  return listActiveConversationsForRecordLinksForInstallation(db, DEFAULT_APP_INSTALLATION_ID, ids);
}

export async function listActiveConversationsForRecordLinksForInstallation(
  db: SQLiteDatabase,
  installationId: string,
  ids: string[],
): Promise<Record<string, string[]>> {
  const byRecord: Record<string, string[]> = Object.fromEntries(ids.map((id) => [id, []]));
  if (ids.length === 0) return byRecord;
  const appInstallationId = normalizeScope({ installationId }).installationId;

  const rows = await db.getAllAsync<{ from_id: string; conversation_id: string }>(
    `SELECT from_id, target_id as conversation_id FROM record_relations WHERE app_installation_id = ? AND from_id IN (${ids.map(() => '?').join(', ')})`,
    [appInstallationId, ...ids]
  );
  for (const row of rows) {
    if (row.conversation_id && byRecord[row.from_id]) {
      byRecord[row.from_id].push(row.conversation_id);
    }
  }
  return byRecord;
}

export function normalizeSeedRecord(record: CanonicalRecord) {
  const catalog = loadCatalog();
  return validateCanonicalRecord(record, catalog.activeDomainId, catalog.activeManifest);
}

export function createInstallationRepository(input: {
  db: SQLiteDatabase;
  workspaceId?: string | null;
  installationId: string;
}) {
  const scope = normalizeScope({
    workspaceId: input.workspaceId ?? DEFAULT_WORKSPACE_ID,
    installationId: input.installationId,
  });
  return {
    scope,
    getRecord: (id: string) => getRecordForInstallation(input.db, scope.installationId, id),
    getRecordsByIds: (ids: string[]) => getRecordsByIdsForInstallation(input.db, scope.installationId, ids),
    listRecordsForDomain: (domainId: DomainId, collection?: string) =>
      listRecordsForDomainAndInstallation(input.db, scope.installationId, domainId, collection),
    listRecordsByCollections: (domainId: DomainId, collections: string[]) =>
      listRecordsByCollectionsForInstallation(input.db, scope.installationId, domainId, collections),
    countRecords: (domainId: DomainId) => countRecordsForInstallation(input.db, scope.installationId, domainId),
    upsertRecord: (manifest: DomainManifest, record: Parameters<typeof upsertRecord>[2]) =>
      upsertRecord(input.db, manifest, { ...record, app_installation_id: scope.installationId }),
    archiveRecord: (id: string) => archiveRecordForInstallation(input.db, scope.installationId, id),
    restoreRecord: (id: string) => restoreRecordForInstallation(input.db, scope.installationId, id),
    applyOperation: (manifest: DomainManifest, operation: ScopedOperation, options: ApplyOperationOptions = {}) =>
      applyOperation(input.db, manifest, operation, { ...options, appInstallationId: scope.installationId }),
    undoOperation: (manifest: DomainManifest, opId: string) =>
      undoOperation(input.db, manifest, opId, { appInstallationId: scope.installationId }),
    listActiveConversationsForRecordLinks: (ids: string[]) =>
      listActiveConversationsForRecordLinksForInstallation(input.db, scope.installationId, ids),
  };
}
