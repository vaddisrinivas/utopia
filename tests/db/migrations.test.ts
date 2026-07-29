import { describe, expect, it, vi } from 'vitest';

import { DATABASE_VERSION, exportRecoverySnapshot, rollbackDatabase, runMigrations } from '@/src/db/migrations';

type Row = Record<string, unknown>;

const { manifest } = vi.hoisted(() => ({
  manifest: {
    schema_version: 'utopia.domain.v1',
    id: 'food',
    label: 'Food',
    surfaces: [],
    collections: ['inventory'],
    relations: [],
    skills: [],
    workflows: [],
    data_homes: [],
    mcp: { resources: [], tools: [] },
  } as const,
}));

vi.mock('@/src/domain/catalog', () => ({
  loadCatalog: () => ({
    activeDomainId: manifest.id,
    activeManifest: manifest,
    catalog: { domains: [] },
  }),
}));

class MigrationMemoryDb {
  userVersion = 0;
  tables = new Map<string, { columns: string[]; rows: Row[] }>();
  indexes = new Set<string>();
  statements: string[] = [];

  async withTransactionAsync(fn: () => Promise<void>) {
    await fn();
  }

  async execAsync(sql: string) {
    const compact = sql.replace(/\s+/g, ' ').trim();
    this.statements.push(compact);
    const userVersion = compact.match(/^PRAGMA user_version = (\d+)$/i);
    if (userVersion) {
      this.userVersion = Number(userVersion[1]);
      return;
    }
    if (/^PRAGMA (journal_mode|foreign_keys)/i.test(compact)) return;

    const create = compact.match(/^CREATE TABLE IF NOT EXISTS ([A-Za-z_][A-Za-z0-9_]*) \((.*)\)$/i);
    if (create) {
      const [, name, body] = create;
      const columns = Array.from(body.matchAll(/(?:^|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s+(TEXT|INTEGER)\b/gi)).map((match) => match[1]);
      const existing = this.tables.get(name);
      this.tables.set(name, { columns: existing ? Array.from(new Set([...existing.columns, ...columns])) : columns, rows: existing?.rows ?? [] });
      return;
    }

    const alter = compact.match(/^ALTER TABLE ([A-Za-z_][A-Za-z0-9_]*) ADD COLUMN ([A-Za-z_][A-Za-z0-9_]*) /i);
    if (alter) {
      const [, tableName, column] = alter;
      const table = this.tables.get(tableName);
      if (!table) throw new Error(`missing table ${tableName}`);
      if (!table.columns.includes(column)) table.columns.push(column);
      const rawDefault = compact.match(/\bDEFAULT\s+('[^']*'|\d+)/i)?.[1];
      const defaultValue = rawDefault == null ? null : rawDefault.startsWith("'") ? rawDefault.slice(1, -1) : Number(rawDefault);
      for (const row of table.rows) {
        row[column] = defaultValue;
      }
      return;
    }

    const createIndex = compact.match(/^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS ([A-Za-z_][A-Za-z0-9_]*) /i);
    if (createIndex) {
      this.indexes.add(createIndex[1]);
      return;
    }

    const dropIndex = compact.match(/^DROP INDEX IF EXISTS ([A-Za-z_][A-Za-z0-9_]*)$/i);
    if (dropIndex) {
      this.indexes.delete(dropIndex[1]);
      return;
    }

    const insertSelect = compact.match(/^INSERT(?: OR IGNORE)? INTO ([A-Za-z_][A-Za-z0-9_]*) \((.*?)\) SELECT (.*?) FROM ([A-Za-z_][A-Za-z0-9_]*)/i);
    if (insertSelect) {
      const [, targetName, targetColumnsRaw, selectRaw, sourceName] = insertSelect;
      const target = this.ensureTable(targetName);
      const source = this.ensureTable(sourceName);
      const targetColumns = splitSqlList(targetColumnsRaw);
      const selectValues = splitSqlList(selectRaw);
      for (const sourceRow of source.rows) {
        const next: Row = {};
        targetColumns.forEach((column, index) => {
          next[column] = sqlSelectValue(selectValues[index]?.trim() ?? 'NULL', sourceRow);
        });
        target.rows.push(next);
      }
      return;
    }

    const drop = compact.match(/^DROP TABLE IF EXISTS ([A-Za-z_][A-Za-z0-9_]*)$/i);
    if (drop) {
      this.tables.delete(drop[1]);
      return;
    }

    const rename = compact.match(/^ALTER TABLE ([A-Za-z_][A-Za-z0-9_]*) RENAME TO ([A-Za-z_][A-Za-z0-9_]*)$/i);
    if (rename) {
      const [, from, to] = rename;
      const table = this.tables.get(from);
      if (!table) throw new Error(`missing table ${from}`);
      this.tables.set(to, table);
      this.tables.delete(from);
      return;
    }

    if (compact.startsWith('INSERT OR IGNORE INTO app_installation_package_state')) {
      const source = this.tables.get('app_package_state')?.rows.find((row) => row.id === 'default');
      if (!source || (source.active_package_key == null && source.previous_package_key == null)) return;
      const table = this.ensureTable('app_installation_package_state');
      if (!table.rows.some((row) => row.installation_id === 'default')) {
        table.rows.push({
          installation_id: 'default',
          active_package_key: source.active_package_key,
          previous_package_key: source.previous_package_key,
          updated_at: source.updated_at,
        });
      }
      return;
    }

    throw new Error(`Unsupported execAsync SQL: ${compact}`);
  }

  async runAsync(sql: string, params: Row | unknown[] = []) {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (compact.startsWith('INSERT OR REPLACE INTO meta')) {
      const table = this.ensureTable('meta');
      const key = Array.isArray(params) ? params[0] : params.$key;
      const value = Array.isArray(params) ? params[1] : params.$value;
      table.rows = table.rows.filter((row) => row.key !== key);
      table.rows.push({ key, value });
      return;
    }
    if (compact.startsWith('INSERT OR IGNORE INTO workspaces')) {
      const table = this.ensureTable('workspaces');
      const row = params as Row;
      if (!table.rows.some((item) => item.id === row.$id)) {
        table.rows.push({
          id: row.$id,
          label: row.$label,
          created_at: row.$created_at,
          updated_at: row.$updated_at,
        });
      }
      return;
    }
    if (compact.startsWith('INSERT OR IGNORE INTO app_installations')) {
      const table = this.ensureTable('app_installations');
      const row = params as Row;
      if (!table.rows.some((item) => item.installation_id === row.$installation_id)) {
        table.rows.push({
          installation_id: row.$installation_id,
          workspace_id: row.$workspace_id,
          app_name: row.$app_name,
          status: 'active',
          launch_path: row.$launch_path,
          created_at: row.$created_at,
          updated_at: row.$updated_at,
        });
      }
      return;
    }
    throw new Error(`Unsupported runAsync SQL: ${compact}`);
  }

  async getFirstAsync<T>(sql: string): Promise<T | null> {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (compact === 'PRAGMA user_version') return { user_version: this.userVersion } as T;
    throw new Error(`Unsupported getFirstAsync SQL: ${compact}`);
  }

  async getAllAsync<T>(sql: string): Promise<T[]> {
    const compact = sql.replace(/\s+/g, ' ').trim();
    const tableInfo = compact.match(/^PRAGMA table_info\(([A-Za-z_][A-Za-z0-9_]*)\)$/i);
    if (tableInfo) {
      return (this.tables.get(tableInfo[1])?.columns ?? []).map((name, cid) => ({ cid, name })) as T[];
    }
    const selectAll = compact.match(/^SELECT \* FROM ([A-Za-z_][A-Za-z0-9_]*)$/i);
    if (selectAll) {
      return (this.tables.get(selectAll[1])?.rows ?? []) as T[];
    }
    throw new Error(`Unsupported getAllAsync SQL: ${compact}`);
  }

  insertRecordV1(row: Row) {
    const table = this.ensureTable('records');
    table.rows.push(row);
  }

  private ensureTable(name: string) {
    const table = this.tables.get(name);
    if (table) return table;
    const next = { columns: [], rows: [] as Row[] };
    this.tables.set(name, next);
    return next;
  }
}

describe('database migrations', () => {
  it('fresh install reaches current schema with operation, sync, package, and control-plane tables', async () => {
    const db = new MigrationMemoryDb();
    await runMigrations(db as any);

    expect(db.userVersion).toBe(DATABASE_VERSION);
    expect(db.tables.has('operations')).toBe(true);
    expect(db.tables.has('sync_conflicts')).toBe(true);
    expect(db.tables.has('config_sources')).toBe(true);
    expect(db.tables.has('config_snapshots')).toBe(true);
    expect(db.tables.has('config_conflicts')).toBe(true);
    expect(db.tables.has('app_packages')).toBe(true);
    expect(db.tables.has('app_package_state')).toBe(true);
    expect(db.tables.has('workspaces')).toBe(true);
    expect(db.tables.has('app_installations')).toBe(true);
    expect(db.tables.has('app_installation_package_state')).toBe(true);
    expect(db.tables.has('app_package_receipts')).toBe(true);
    expect(db.tables.has('cloud_accounts')).toBe(true);
    expect(db.tables.has('cloud_devices')).toBe(true);
    expect(db.tables.has('cloud_sessions')).toBe(true);
    const recordColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(records)');
    expect(recordColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'app_installation_id',
      'revision',
      'schema_version',
      'deleted',
      'privacy',
      'provenance_json',
    ]));
    expect(db.indexes.has('operations_installation_idem_idx')).toBe(true);
    expect(db.indexes.has('operations_installation_record_idx')).toBe(true);
    expect(db.indexes.has('sync_conflicts_record_idx')).toBe(true);
    expect(db.indexes.has('config_sources_enabled_precedence_idx')).toBe(true);
    expect(db.indexes.has('config_conflicts_status_idx')).toBe(true);
    expect(db.indexes.has('app_installations_workspace_status_idx')).toBe(true);
    expect(db.indexes.has('cloud_accounts_workspace_status_idx')).toBe(true);
    expect(db.indexes.has('cloud_devices_account_status_idx')).toBe(true);
    expect(db.indexes.has('cloud_sessions_account_status_idx')).toBe(true);
    expect(db.indexes.has('cloud_sessions_device_status_idx')).toBe(true);
    const installationColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(app_installations)');
    expect(installationColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'data_home_provider',
      'data_home_external_id',
      'data_home_status',
      'data_home_updated_at',
    ]));
  });

  it('keeps control-plane config separate from data-plane records', async () => {
    const db = new MigrationMemoryDb();
    await runMigrations(db as any);

    const recordColumns = (await db.getAllAsync<{ name: string }>('PRAGMA table_info(records)')).map((column) => column.name);
    expect(recordColumns).not.toEqual(expect.arrayContaining([
      'config_source_id',
      'config_snapshot_hash',
      'config_conflict_id',
      'location_json',
    ]));
    expect(db.statements.filter((statement) => /config_/i.test(statement) && /\brecords\b/i.test(statement))).toEqual([]);
  });

  it('upgrades v1 records with envelope defaults', async () => {
    const db = new MigrationMemoryDb();
    await runMigrations(db as any);
    await rollbackDatabase(db as any, 1);
    db.userVersion = 1;
    db.insertRecordV1({
      id: 'legacy-record',
      domain: 'food',
      collection: 'recipe',
      title: 'Legacy recipe',
      properties: '{}',
      source_provider: 'sqlite',
      source_external_id: 'legacy-record',
      source_observed_at: '2026-07-23T00:00:00.000Z',
      created_at: '2026-07-23T00:00:00.000Z',
      updated_at: '2026-07-23T00:00:00.000Z',
    });

    await runMigrations(db as any);
    const rows = await db.getAllAsync<Row>('SELECT * FROM records');
    expect(db.userVersion).toBe(DATABASE_VERSION);
    expect(rows[0]).toMatchObject({
      revision: 1,
      schema_version: '1.0.0',
      deleted: 0,
      privacy: 'personal',
      provenance_json: null,
    });
  });

  it('exports operations, sync conflicts, and control-plane tables in recovery snapshots', async () => {
    const db = new MigrationMemoryDb();
    await runMigrations(db as any);

    const snapshot = await exportRecoverySnapshot(db as any);
    expect(snapshot.schema_version).toBe(DATABASE_VERSION);
    expect(snapshot.tables.map((table) => table.name)).toEqual(expect.arrayContaining([
      'operations',
      'sync_conflicts',
      'config_sources',
      'config_snapshots',
      'config_conflicts',
      'app_packages',
      'app_package_state',
      'workspaces',
      'app_installations',
      'app_installation_package_state',
      'app_package_receipts',
    ]));
  });
});

function splitSqlList(value: string) {
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

function sqlSelectValue(expression: string, row: Row) {
  if (/^NULL$/i.test(expression)) return null;
  if (/^\d+$/.test(expression)) return Number(expression);
  if (expression.startsWith("'") && expression.endsWith("'")) return expression.slice(1, -1);
  return row[expression];
}
