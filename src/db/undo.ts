import type { SQLiteDatabase } from 'expo-sqlite';
import { DEFAULT_APP_INSTALLATION_ID } from '@/packages/shared/contracts/app-installation';

export type UndoRecord = {
  id: string;
  app_installation_id: string;
  action_id: string;
  payload_json: string;
  expires_at: string | null;
  created_at: string;
};

function normalizeAppInstallationId(value?: string | null): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_APP_INSTALLATION_ID;
}

export async function createUndoEvent(
  db: SQLiteDatabase,
  input: {
    id: string;
    app_installation_id?: string | null;
    action_id: string;
    payload: unknown;
    expires_at?: string | null;
  }
): Promise<void> {
  const now = new Date().toISOString();
  const appInstallationId = normalizeAppInstallationId(input.app_installation_id);
  await db.runAsync(
    `
      INSERT OR REPLACE INTO undo_events (id, app_installation_id, action_id, payload_json, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [input.id, appInstallationId, input.action_id, JSON.stringify(input.payload), input.expires_at ?? null, now]
  );
}

export async function getUndoForAction(
  db: SQLiteDatabase,
  actionId: string,
  appInstallationId: string = DEFAULT_APP_INSTALLATION_ID,
): Promise<UndoRecord | null> {
  return db.getFirstAsync<UndoRecord>(
    'SELECT * FROM undo_events WHERE app_installation_id = ? AND action_id = ?',
    [normalizeAppInstallationId(appInstallationId), actionId],
  );
}

export async function listUndoEvents(db: SQLiteDatabase): Promise<UndoRecord[]> {
  return db.getAllAsync<UndoRecord>('SELECT * FROM undo_events ORDER BY created_at DESC');
}

export async function removeUndoEvent(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM undo_events WHERE id = ?', [id]);
}
