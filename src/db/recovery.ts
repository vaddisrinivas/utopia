import type { SQLiteDatabase } from 'expo-sqlite';

import { DATABASE_VERSION, type RecoveryExport } from '@/src/db/migrations';

const RECOVERY_TABLES = [
  'meta',
  'records',
  'record_relations',
  'conversations',
  'conversation_messages',
  'source_snapshots',
  'provider_links',
  'outbox_events',
  'action_events',
  'operations',
  'sync_conflicts',
  'config_sources',
  'config_snapshots',
  'config_conflicts',
  'workspaces',
  'app_installations',
  'cloud_accounts',
  'cloud_devices',
  'cloud_sessions',
  'app_packages',
  'app_package_state',
  'app_installation_package_state',
  'app_package_receipts',
  'package_migration_journal',
  'undo_events',
  'workflow_runs',
  'agent_runs',
  'citations',
  'source_snapshot_relations',
] as const;

const tableSet = new Set<string>(RECOVERY_TABLES);
type BindValue = string | number | null | Uint8Array;

function assertSafeTable(name: string): asserts name is typeof RECOVERY_TABLES[number] {
  if (!tableSet.has(name)) {
    throw new Error(`Unsupported recovery table: ${name}`);
  }
}

function assertSafeColumn(column: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) {
    throw new Error(`Unsupported recovery column: ${column}`);
  }
}

function toBindValue(value: unknown): BindValue {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Uint8Array) return value;
  return JSON.stringify(value);
}

export async function importRecoverySnapshot(db: SQLiteDatabase, snapshot: RecoveryExport): Promise<void> {
  if (snapshot.schema_version > DATABASE_VERSION) {
    throw new Error(`Recovery snapshot schema ${snapshot.schema_version} is newer than app schema ${DATABASE_VERSION}`);
  }
  const rowsByTable = new Map(snapshot.tables.map((table) => {
    assertSafeTable(table.name);
    return [table.name, table.rows ?? []] as const;
  }));

  await db.withTransactionAsync(async () => {
    for (const table of [...RECOVERY_TABLES].reverse()) {
      await db.runAsync(`DELETE FROM ${table}`);
    }

    for (const table of RECOVERY_TABLES) {
      const rows = rowsByTable.get(table) ?? [];
      for (const row of rows) {
        const columns = Object.keys(row);
        if (!columns.length) continue;
        columns.forEach(assertSafeColumn);
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map((column) => toBindValue(row[column]));
        await db.runAsync(
          `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
          values,
        );
      }
    }

    await db.execAsync(`PRAGMA user_version = ${Math.min(snapshot.schema_version, DATABASE_VERSION)}`);
  });
}
