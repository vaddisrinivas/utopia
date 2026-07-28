import type { SQLiteDatabase } from 'expo-sqlite';

import { DEFAULT_APP_INSTALLATION_ID } from '@/packages/shared/contracts/app-installation';
import type { DomainManifest } from '@/src/domain/catalog';
import type { CanonicalProvenance, CanonicalRecord, RecordProvider } from '@/src/domain/runtime';
import type { ApplyOperationOptions, Operation, OperationResult } from '@/src/ops/operation';
import { enqueueOutboxEvent } from '@/src/db/outbox';
import { planOperation } from '@/src/ops/plan';

type SqlRecordRow = {
  app_installation_id: string;
  id: string;
  domain: string;
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
  privacy: 'private' | 'personal' | 'shared';
  provenance_json: string | null;
};

type OperationRow = {
  op_id: string;
  app_installation_id: string;
  after_json: string | null;
  status: string;
};

type SqlRelationRow = {
  app_installation_id: string;
  name: string;
  target_id: string;
};

type CommittedOperationOutboxPayload = {
  schema_version: 'wonder.committed-operation.v1';
  app_installation_id: string;
  operation_id: string;
  cause_id: string;
  domain: string;
  collection: string;
  record_id: string;
  before_revision: number;
  after_revision: number;
  changed_fields: string[];
  committed_at: string;
};

type ScopedOperation = Operation & {
  app_installation_id?: string | null;
};

type ScopedApplyOperationOptions = ApplyOperationOptions & {
  appInstallationId?: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

function safeJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function parseProperties(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseProvenance(value: string | null): CanonicalProvenance | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as CanonicalProvenance;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function safeId(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 180);
}

function normalizeCauseId(op: Operation) {
  const candidate = op.idempotency_key?.trim();
  return candidate && candidate.length > 0 ? candidate : op.op_id;
}

async function persistCommittedOperationOutboxEvent(
  db: SQLiteDatabase,
  appInstallationId: string,
  op: Operation,
  before: CanonicalRecord | null,
  after: CanonicalRecord,
  changedFields: string[],
) {
  const payload: CommittedOperationOutboxPayload = {
    schema_version: 'wonder.committed-operation.v1',
    app_installation_id: appInstallationId,
    operation_id: op.op_id,
    cause_id: normalizeCauseId(op),
    domain: op.domain,
    collection: op.collection,
    record_id: op.record_id,
    before_revision: before?.revision ?? 0,
    after_revision: after.revision,
    changed_fields: changedFields,
    committed_at: after.updated_at,
  };

  await enqueueOutboxEvent(db, {
    id: `committed-operation-${safeId(op.op_id)}`,
    action_key: `committed-operation:${op.domain}:${safeId(appInstallationId)}:${op.op_id}`,
    domain: op.domain,
    app_installation_id: appInstallationId,
    payload_json: safeJson(payload),
  });
}

function normalizeAppInstallationId(value?: string | null): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_APP_INSTALLATION_ID;
}

function resolveOperationScope(op: ScopedOperation, options: ScopedApplyOperationOptions) {
  const optionId = options.appInstallationId ? normalizeAppInstallationId(options.appInstallationId) : null;
  const opId = op.app_installation_id ? normalizeAppInstallationId(op.app_installation_id) : null;
  const appInstallationId = optionId ?? opId ?? DEFAULT_APP_INSTALLATION_ID;
  if (optionId && opId && optionId !== opId) {
    return { ok: false as const, appInstallationId, reason: 'installation_scope_mismatch' };
  }
  return { ok: true as const, appInstallationId };
}

function withOperationScope(op: ScopedOperation, appInstallationId: string): ScopedOperation {
  return { ...op, app_installation_id: appInstallationId };
}

async function readRecord(db: SQLiteDatabase, appInstallationId: string, id: string): Promise<CanonicalRecord | null> {
  const row = await db.getFirstAsync<SqlRecordRow>(
    'SELECT * FROM records WHERE app_installation_id = ? AND id = ?',
    [appInstallationId, id],
  );
  if (!row) return null;
  const relations = await db.getAllAsync<SqlRelationRow>(
    'SELECT name, target_id FROM record_relations WHERE app_installation_id = ? AND from_id = ?',
    [appInstallationId, id],
  );
  return {
    id: row.id,
    domain: row.domain,
    collection: row.collection,
    title: row.title,
    properties: parseProperties(row.properties),
    relations: relations.map((relation) => ({ name: relation.name, target_id: relation.target_id })),
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
    revision: row.revision,
    schema_version: row.schema_version,
    deleted: Boolean(row.deleted),
    privacy: row.privacy,
    provenance: parseProvenance(row.provenance_json),
  };
}

async function insertOperation(
  db: SQLiteDatabase,
  appInstallationId: string,
  op: ScopedOperation,
  before: CanonicalRecord | null,
  after: CanonicalRecord | null,
  status: 'applied' | 'rejected',
  reason?: string,
) {
  await db.runAsync(
    `INSERT INTO operations (
      op_id, app_installation_id, kind, domain, collection, record_id, expected_revision, result_revision,
      actor, origin, idempotency_key, changes_json, before_json, after_json, inverse_op_id,
      status, reject_reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      op.op_id,
      appInstallationId,
      op.kind,
      op.domain,
      op.collection,
      op.record_id,
      op.expected_revision ?? null,
      after?.revision ?? null,
      op.actor,
      op.origin,
      op.idempotency_key ?? null,
      safeJson(op),
      before ? safeJson(before) : null,
      after ? safeJson(after) : null,
      after ? `${op.op_id}:undo` : null,
      status,
      reason ?? null,
      nowIso(),
    ]
  );
}

async function rejectOperation(
  db: SQLiteDatabase,
  appInstallationId: string,
  op: ScopedOperation,
  before: CanonicalRecord | null,
  rejectReason: string,
  dryRun: boolean,
): Promise<OperationResult> {
  if (!dryRun) {
    await insertOperation(db, appInstallationId, op, before, null, 'rejected', rejectReason);
  }
  return { status: 'rejected', op_id: op.op_id, reject_reason: rejectReason };
}

export async function applyOperation(
  db: SQLiteDatabase,
  manifest: DomainManifest,
  op: ScopedOperation,
  options: ScopedApplyOperationOptions = {},
): Promise<OperationResult> {
  const dryRun = options.dryRun === true;
  const scope = resolveOperationScope(op, options);
  const appInstallationId = scope.appInstallationId;
  const scopedOp = withOperationScope(op, appInstallationId);
  if (!scope.ok) {
    return rejectOperation(db, appInstallationId, scopedOp, null, scope.reason, dryRun);
  }

  let duplicate = null;
  if (!dryRun && scopedOp.idempotency_key) {
    const row = await db.getFirstAsync<OperationRow>(
      'SELECT op_id, app_installation_id, after_json, status FROM operations WHERE app_installation_id = ? AND idempotency_key = ?',
      [appInstallationId, scopedOp.idempotency_key],
    );
    duplicate = row ? {
      op_id: row.op_id,
      status: row.status,
      after: row.after_json ? JSON.parse(row.after_json) as CanonicalRecord : null,
    } : null;
  }

  const current = await readRecord(db, appInstallationId, scopedOp.record_id);
  const plan = planOperation({ manifest, operation: scopedOp, current, duplicate });
  if (plan.status === 'duplicate') {
    return { status: 'duplicate', op_id: plan.op_id, record: plan.record };
  }
  if (plan.status === 'rejected') {
    return rejectOperation(db, appInstallationId, scopedOp, plan.before, plan.reject_reason, dryRun);
  }
  const next = plan.after;

  if (dryRun) {
    return { status: 'dry_run', op_id: op.op_id, record: next, inverse: plan.inverse, diff: plan.diff };
  }

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO records (
        app_installation_id, id, domain, collection, title, properties, source_provider, source_external_id, source_url,
        source_observed_at, source_content_hash, archived_at, created_at, updated_at,
        revision, schema_version, deleted, privacy, provenance_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(app_installation_id, id) DO UPDATE SET
        domain = excluded.domain,
        collection = excluded.collection,
        title = excluded.title,
        properties = excluded.properties,
        source_provider = excluded.source_provider,
        source_external_id = excluded.source_external_id,
        source_url = excluded.source_url,
        source_observed_at = excluded.source_observed_at,
        source_content_hash = excluded.source_content_hash,
        archived_at = excluded.archived_at,
        updated_at = excluded.updated_at,
        revision = excluded.revision,
        schema_version = excluded.schema_version,
        deleted = excluded.deleted,
        privacy = excluded.privacy,
        provenance_json = excluded.provenance_json`,
      [
        appInstallationId,
        next.id,
        next.domain,
        next.collection,
        next.title,
        safeJson(next.properties),
        next.source.provider,
        next.source.external_id,
        next.source.url,
        next.source.observed_at,
        next.source.content_hash,
        next.archived_at,
        next.created_at,
        next.updated_at,
        next.revision,
        next.schema_version,
        next.deleted ? 1 : 0,
        next.privacy,
        next.provenance ? safeJson(next.provenance) : null,
      ]
    );
    await db.runAsync(
      'DELETE FROM record_relations WHERE app_installation_id = ? AND from_id = ?',
      [appInstallationId, next.id],
    );
    for (const relation of next.relations) {
      const targetParts = relation.target_id.split(':');
      await db.runAsync(
        `INSERT INTO record_relations (
          app_installation_id, from_id, collection, name, target_id, target_domain, target_collection, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          appInstallationId,
          next.id,
          next.collection,
          relation.name,
          relation.target_id,
          targetParts[0] || next.domain,
          targetParts.length > 1 ? targetParts[1] : next.collection,
          nowIso(),
        ]
      );
    }
    await insertOperation(db, appInstallationId, scopedOp, current, next, 'applied');
    await persistCommittedOperationOutboxEvent(db, appInstallationId, scopedOp, current, next, plan.diff.changed_fields);
  });

  return { status: 'applied', op_id: scopedOp.op_id, record: next, inverse: plan.inverse, diff: plan.diff };
}
