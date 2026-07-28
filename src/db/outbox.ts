import type { SQLiteDatabase } from 'expo-sqlite';
import { DEFAULT_APP_INSTALLATION_ID } from '@/packages/shared/contracts/app-installation';

export type OutboxStatus = 'pending' | 'inflight' | 'failed' | 'done';

export type OutboxEvent = {
  id: string;
  app_installation_id: string;
  action_key: string;
  domain: string;
  payload_json: string;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export const OUTBOX_ACTION_PREFIXES = {
  provider_write: 'provider-write:',
  committed_operation: 'committed-operation:',
} as const;

export const OUTBOX_PAYLOAD_VERSIONS = {
  provider_write: 'utopia.provider-write.v1',
  committed_operation: 'wonder.committed-operation.v1',
} as const;

export function getOutboxSchemaVersion(event: OutboxEvent): string | null {
  try {
    const parsed = JSON.parse(event.payload_json) as { schema_version?: unknown };
    return typeof parsed?.schema_version === 'string' ? parsed.schema_version : null;
  } catch {
    return null;
  }
}

export function isProviderWriteOutboxEvent(event: OutboxEvent): boolean {
  return event.action_key.startsWith(OUTBOX_ACTION_PREFIXES.provider_write)
    || getOutboxSchemaVersion(event) === OUTBOX_PAYLOAD_VERSIONS.provider_write;
}

export async function enqueueOutboxEvent(
  db: SQLiteDatabase,
  event: Omit<OutboxEvent, 'status' | 'attempts' | 'last_error' | 'created_at' | 'updated_at' | 'app_installation_id'> & {
    app_installation_id?: string | null;
  }
): Promise<OutboxEvent> {
  const now = new Date().toISOString();
  const payload = event.payload_json;
  const status: OutboxStatus = 'pending';
  const appInstallationId = event.app_installation_id?.trim() || DEFAULT_APP_INSTALLATION_ID;
  await db.runAsync(
    `
      INSERT INTO outbox_events (id, app_installation_id, action_key, domain, payload_json, status, attempts, last_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
    `,
    [event.id, appInstallationId, event.action_key, event.domain, payload, status, now, now]
  );
  return {
    ...event,
    app_installation_id: appInstallationId,
    status,
    attempts: 0,
    last_error: null,
    created_at: now,
    updated_at: now,
  };
}

export async function listOutboxEvents(db: SQLiteDatabase, status?: OutboxStatus): Promise<OutboxEvent[]> {
  if (status) {
    return db.getAllAsync<OutboxEvent>('SELECT * FROM outbox_events WHERE status = ? ORDER BY updated_at ASC', [status]);
  }
  return db.getAllAsync<OutboxEvent>('SELECT * FROM outbox_events ORDER BY updated_at ASC');
}

export async function listOutboxEventsByActionKeyPrefix(
  db: SQLiteDatabase,
  actionKeyPrefix: string,
  status?: OutboxStatus,
): Promise<OutboxEvent[]> {
  if (status) {
    const rows = await db.getAllAsync<OutboxEvent>(
      'SELECT * FROM outbox_events WHERE status = ? AND action_key LIKE ? ORDER BY updated_at ASC',
      [status, `${actionKeyPrefix}%`],
    );
    return rows.filter((row) => row.action_key.startsWith(actionKeyPrefix));
  }
  const rows = await db.getAllAsync<OutboxEvent>(
    'SELECT * FROM outbox_events WHERE action_key LIKE ? ORDER BY updated_at ASC',
    [`${actionKeyPrefix}%`],
  );
  return rows.filter((row) => row.action_key.startsWith(actionKeyPrefix));
}

export async function listProviderWritebackOutboxEvents(
  db: SQLiteDatabase,
  status?: OutboxStatus,
): Promise<OutboxEvent[]> {
  return listOutboxEventsByActionKeyPrefix(db, OUTBOX_ACTION_PREFIXES.provider_write, status);
}

export async function getOutboxEventByActionKey(db: SQLiteDatabase, actionKey: string): Promise<OutboxEvent | null> {
  return db.getFirstAsync<OutboxEvent>(
    'SELECT * FROM outbox_events WHERE action_key = ? ORDER BY created_at DESC LIMIT 1',
    [actionKey],
  );
}

export async function markOutboxEvent(
  db: SQLiteDatabase,
  id: string,
  update: {
    status?: OutboxStatus;
    last_error?: string | null;
    attemptsDelta?: number;
  }
): Promise<void> {
  const now = new Date().toISOString();
  if (update.attemptsDelta !== undefined && update.attemptsDelta !== 0) {
    await db.runAsync(
      `UPDATE outbox_events SET attempts = attempts + ?, status = ?, last_error = ?, updated_at = ? WHERE id = ?`,
      [
        update.attemptsDelta,
        update.status ?? 'pending',
        update.last_error ?? null,
        now,
        id,
      ]
    );
    return;
  }

  const fields = [
    update.status !== undefined ? 'status = ?' : '',
    update.last_error !== undefined ? 'last_error = ?' : '',
  ].filter(Boolean).join(', ');

  if (!fields) return;

  const values: (string | number | null)[] = [];
  if (update.status !== undefined) values.push(update.status);
  if (update.last_error !== undefined) values.push(update.last_error);
  values.push(now);
  values.push(id);
  await db.runAsync(`UPDATE outbox_events SET ${fields}, updated_at = ? WHERE id = ?`, values);
}

export async function deleteOutboxEvent(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync(`DELETE FROM outbox_events WHERE id = ?`, [id]);
}
