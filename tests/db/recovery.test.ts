import { describe, expect, it } from 'vitest';

import { sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import { exportRecoverySnapshot, runMigrations } from '@/src/db/migrations';
import { importRecoverySnapshot } from '@/src/db/recovery';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

describe('database recovery safety', () => {
  it('fails export when a required table cannot be read', async () => {
    const db = {
      async getFirstAsync() {
        return { user_version: 14 };
      },
      async getAllAsync(sql: string) {
        if (sql.endsWith('FROM records')) throw new Error('records unavailable');
        return [];
      },
      async runAsync() {
        throw new Error('runAsync should not be called');
      },
    };

    await expect(exportRecoverySnapshot(db as any)).rejects.toThrow('records unavailable');
  });

  it('rejects a tampered snapshot without deleting live data', async () => {
    const db = new NodeSqliteDb();
    await runMigrations(db as any);
    await db.runAsync(
      `INSERT INTO meta (key, value) VALUES (?, ?)`,
      ['survivor', 'keep me'],
    );
    const snapshot = await exportRecoverySnapshot(db as any);
    snapshot.tables.find((table) => table.name === 'meta')!.rows.push({ key: 'tampered', value: 'bad' });

    await expect(importRecoverySnapshot(db as any, snapshot)).rejects.toThrow('checksum mismatch');
    await expect(db.getFirstAsync('SELECT value FROM meta WHERE key = ?', ['survivor'])).resolves.toEqual({ value: 'keep me' });
    db.close();
  });

  it('rolls back a failed restore after validation', async () => {
    const source = new NodeSqliteDb();
    await runMigrations(source as any);

    const target = new NodeSqliteDb();
    await runMigrations(target as any);
    await target.runAsync(`INSERT INTO meta (key, value) VALUES (?, ?)`, ['survivor', 'keep me']);
    const validSnapshot = await exportRecoverySnapshot(source as any);
    const meta = validSnapshot.tables.find((table) => table.name === 'meta')!;
    meta.rows.push({ key: 'duplicate', value: 'one' });
    meta.rows.push({ key: 'duplicate', value: 'two' });
    validSnapshot.manifest = {
      ...validSnapshot.manifest!,
      table_checksums: Object.fromEntries(validSnapshot.tables.map((table) => [table.name, sha256Canonical(table.rows)])),
      snapshot_checksum: sha256Canonical({ schema_version: validSnapshot.schema_version, tables: validSnapshot.tables }),
    };

    await expect(importRecoverySnapshot(target as any, validSnapshot)).rejects.toThrow();
    await expect(target.getFirstAsync('SELECT value FROM meta WHERE key = ?', ['survivor'])).resolves.toEqual({ value: 'keep me' });
    source.close();
    target.close();
  });

  it('rejects snapshots with unsupported columns and preserves data', async () => {
    const source = new NodeSqliteDb();
    const target = new NodeSqliteDb();
    await runMigrations(source as any);
    await runMigrations(target as any);
    await target.runAsync(`INSERT INTO meta (key, value) VALUES (?, ?)`, ['survivor', 'keep me']);

    const snapshot = await exportRecoverySnapshot(source as any);
    const metaTable = snapshot.tables.find((table) => table.name === 'meta')!;
    metaTable.rows.push({ key: 'oops', value: 'x', __injected: 'bad' } as any);
    snapshot.manifest = {
      ...snapshot.manifest!,
      table_checksums: Object.fromEntries(snapshot.tables.map((table) => [table.name, sha256Canonical(table.rows)])),
      snapshot_checksum: sha256Canonical({ schema_version: snapshot.schema_version, tables: snapshot.tables }),
    };

    await expect(importRecoverySnapshot(target as any, snapshot)).rejects.toThrow('unsupported column');
    await expect(target.getFirstAsync('SELECT value FROM meta WHERE key = ?', ['survivor'])).resolves.toEqual({ value: 'keep me' });

    source.close();
    target.close();
  });

  it('rejects incomplete snapshots missing required tables and preserves data', async () => {
    const source = new NodeSqliteDb();
    const target = new NodeSqliteDb();
    await runMigrations(source as any);
    await runMigrations(target as any);
    await target.runAsync(`INSERT INTO meta (key, value) VALUES (?, ?)`, ['survivor', 'keep me']);

    const snapshot = await exportRecoverySnapshot(source as any);
    const filteredSnapshot = {
      ...snapshot,
      tables: snapshot.tables.filter((table) => table.name !== 'records'),
    };
    filteredSnapshot.manifest = {
      ...snapshot.manifest!,
      table_checksums: Object.fromEntries(filteredSnapshot.tables.map((table) => [table.name, sha256Canonical(table.rows)])),
      snapshot_checksum: sha256Canonical({ schema_version: filteredSnapshot.schema_version, tables: filteredSnapshot.tables }),
    };

    await expect(importRecoverySnapshot(target as any, filteredSnapshot)).rejects.toThrow('Recovery snapshot is incomplete');
    await expect(target.getFirstAsync('SELECT value FROM meta WHERE key = ?', ['survivor'])).resolves.toEqual({ value: 'keep me' });

    source.close();
    target.close();
  });
});
