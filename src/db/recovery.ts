import type { SQLiteDatabase } from 'expo-sqlite';

import { sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import { DATABASE_VERSION, RECOVERY_TABLES, type RecoveryExport } from '@/src/db/migrations';

const tableSet = new Set<string>(RECOVERY_TABLES);
const MAX_RECOVERY_ROWS = 100_000;
const MAX_RECOVERY_BYTES = 32 * 1024 * 1024;
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

type PrismaColumns = Set<string>;

async function getTableColumns(db: SQLiteDatabase, table: string): Promise<PrismaColumns> {
  const info = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return new Set(info.map((column) => column.name));
}

async function getRecoveryTableSchemas(db: SQLiteDatabase) {
  const entries = await Promise.all(
    RECOVERY_TABLES.map(async (table) => [table, await getTableColumns(db, table)] as const),
  );
  return new Map(entries);
}

function assertTableSupportsColumns(table: string, row: Record<string, unknown>, validColumns: PrismaColumns) {
  for (const column of Object.keys(row)) {
    if (!validColumns.has(column)) {
      throw new Error(`Recovery table ${table} has unsupported column: ${column}`);
    }
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
  if (!snapshot || !Number.isInteger(snapshot.schema_version) || snapshot.schema_version < 1) {
    throw new Error('Invalid recovery snapshot schema');
  }
  if (snapshot.schema_version > DATABASE_VERSION) {
    throw new Error(`Recovery snapshot schema ${snapshot.schema_version} is newer than app schema ${DATABASE_VERSION}`);
  }
  if (!Array.isArray(snapshot.tables) || snapshot.tables.length !== RECOVERY_TABLES.length) {
    throw new Error('Recovery snapshot is incomplete');
  }
  const rowsByTable = new Map(snapshot.tables.map((table) => {
    assertSafeTable(table.name);
    if (!Array.isArray(table.rows)) throw new Error(`Recovery table ${table.name} has invalid rows`);
    if (table.rows.some((row) => row == null || typeof row !== 'object' || Array.isArray(row))) {
      throw new Error(`Recovery table ${table.name} has invalid row`);
    }
    table.rows.forEach((row) => Object.keys(row).forEach(assertSafeColumn));
    return [table.name, table.rows] as const;
  }));
  if (rowsByTable.size !== RECOVERY_TABLES.length || RECOVERY_TABLES.some((table) => !rowsByTable.has(table))) {
    throw new Error('Recovery snapshot is incomplete');
  }
  const rowCount = snapshot.tables.reduce((count, table) => count + table.rows.length, 0);
  if (rowCount > MAX_RECOVERY_ROWS || JSON.stringify(snapshot).length > MAX_RECOVERY_BYTES) {
    throw new Error('Recovery snapshot exceeds safety limits');
  }
  if (snapshot.manifest?.algorithm !== 'sha256') throw new Error('Recovery snapshot manifest is invalid');
  if (!snapshot.manifest) throw new Error('Recovery snapshot manifest is missing');
  for (const table of snapshot.tables) {
    if (snapshot.manifest.table_checksums[table.name] !== sha256Canonical(table.rows)) {
      throw new Error(`Recovery table ${table.name} checksum mismatch`);
    }
  }
  const { manifest: _manifest, ...payload } = snapshot;
  if (snapshot.manifest.snapshot_checksum !== sha256Canonical(payload)) {
    throw new Error('Recovery snapshot checksum mismatch');
  }
  const currentFkStateRow = await db.getFirstAsync<{ foreign_keys: number | string }>('PRAGMA foreign_keys');
  const restoreForeignKeys = (() => {
    if (currentFkStateRow == null) return true;
    if (typeof currentFkStateRow.foreign_keys === 'number') return currentFkStateRow.foreign_keys === 1;
    if (typeof currentFkStateRow.foreign_keys === 'string') {
      if (/^on$/i.test(currentFkStateRow.foreign_keys)) return true;
      if (/^off$/i.test(currentFkStateRow.foreign_keys)) return false;
    }
    return Boolean(currentFkStateRow.foreign_keys);
  })();
  const tableSchemas = await getRecoveryTableSchemas(db);

  for (const table of RECOVERY_TABLES) {
    const columns = tableSchemas.get(table);
    if (!columns?.size) {
      throw new Error(`Recovery table ${table} is missing or empty schema`);
    }
    const rows = rowsByTable.get(table) ?? [];
    for (const row of rows) {
      assertTableSupportsColumns(table, row, columns);
    }
  }

  await db.withTransactionAsync(async () => {
    if (!restoreForeignKeys) {
      await db.execAsync('PRAGMA foreign_keys = ON');
    }
    for (const table of [...RECOVERY_TABLES].reverse()) {
      await db.runAsync(`DELETE FROM ${table}`);
    }

    for (const table of RECOVERY_TABLES) {
      const rows = rowsByTable.get(table) ?? [];
      for (const row of rows) {
        const columns = Object.keys(row);
        if (!columns.length) continue;
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map((column) => toBindValue(row[column]));
        await db.runAsync(
          `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
          values,
        );
      }
    }

    await db.execAsync(`PRAGMA user_version = ${Math.min(snapshot.schema_version, DATABASE_VERSION)}`);
  }).finally(() => {
    if (!restoreForeignKeys) {
      return db.execAsync('PRAGMA foreign_keys = OFF');
    }
  });
}
