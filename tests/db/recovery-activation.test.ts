import { describe, expect, it } from 'vitest';

import { exportRecoverySnapshot, runMigrations, type RecoveryExport } from '@/src/db/migrations';
import {
  activateRecoverySnapshot,
  type RecoveryActivationPort,
  RecoveryActivationError,
} from '@/src/db/recovery-activation';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';
import {
  createRecoveryActivationAdapter,
  type RecoveryActivationFileDriver,
} from '@/src/db/recovery-activation-adapter';

type TestDb = NodeSqliteDb & { marker?: string; closeAsync?: () => Promise<void> };

class PointerPort implements RecoveryActivationPort<any> {
  currentPointer = 'active-v1';
  readonly databases = new Map<string, TestDb>();
  readonly discarded: string[] = [];
  failStage = false;
  failSwap = false;
  failReopenFor: string | null = null;

  constructor(active: TestDb) {
    this.databases.set(this.currentPointer, active);
  }

  async readActive() {
    return { pointer: this.currentPointer, db: this.databases.get(this.currentPointer)! };
  }

  async stageSnapshot({ activationId }: { activationId: string; snapshot: RecoveryExport }) {
    if (this.failStage) throw new Error('storage exhausted while staging database');
    const pointer = `staged-${activationId}`;
    const db = new NodeSqliteDb();
    this.databases.set(pointer, db);
    return { pointer, db };
  }

  async closeDatabase(_db: TestDb) {
    // A real adapter closes native handles. The test port keeps the file-backed
    // database addressable so reopen/rollback can be deterministic.
  }

  async swapActivePointer({ expectedPointer, nextPointer }: { activationId: string; expectedPointer: string; nextPointer: string }) {
    if (this.failSwap) throw new Error('interrupted during pointer swap');
    if (this.currentPointer !== expectedPointer) throw new Error('active pointer changed');
    this.currentPointer = nextPointer;
  }

  async reopen(pointer: string) {
    if (pointer === this.failReopenFor) {
      this.failReopenFor = null;
      throw new Error('interrupted while reopening database');
    }
    const db = this.databases.get(pointer);
    if (!db) throw new Error(`missing database pointer: ${pointer}`);
    return db;
  }

  async restoreActivePointer({ expectedPointer, restorePointer }: { activationId: string; expectedPointer: string; restorePointer: string }) {
    // Idempotent restore handles an interruption before the pointer swap took effect.
    if (this.currentPointer !== expectedPointer && this.currentPointer !== restorePointer) {
      throw new Error('active pointer changed during rollback');
    }
    this.currentPointer = restorePointer;
  }

  async discardStaged(pointer: string) {
    this.discarded.push(pointer);
    this.databases.delete(pointer);
  }
}

async function migratedDb(marker: string): Promise<TestDb> {
  const db = new NodeSqliteDb();
  await runMigrations(db as any);
  await db.runAsync('INSERT INTO meta (key, value) VALUES (?, ?)', ['marker', marker]);
  return db;
}

async function recoverySnapshot(marker: string): Promise<RecoveryExport> {
  return exportRecoverySnapshot(await migratedDb(marker) as any);
}

async function marker(db: TestDb) {
  return (await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['marker']))?.value;
}

describe('database recovery activation', () => {
  it('stages, validates, swaps, reopens, and preserves the old database until activation succeeds', async () => {
    const active = await migratedDb('old');
    const port = new PointerPort(active);
    const snapshot = await recoverySnapshot('new');

    const result = await activateRecoverySnapshot(port, snapshot, { activationId: 'activation-success' });

    expect(result.version).toBe('utopia.recovery-activation.v1');
    expect(result.phases).toEqual([
      'validate', 'stage', 'migrate', 'import', 'integrity', 'close', 'swap', 'reopen', 'verify', 'complete',
    ]);
    expect(port.currentPointer).toBe('staged-activation-success');
    expect(await marker(await port.reopen(port.currentPointer))).toBe('new');
    expect(await marker(active)).toBe('old');
  });

  it('keeps the active pointer when storage is exhausted while staging', async () => {
    const active = await migratedDb('old');
    const port = new PointerPort(active);
    port.failStage = true;

    await expect(activateRecoverySnapshot(port, await recoverySnapshot('new'), { activationId: 'activation-storage' }))
      .rejects.toMatchObject({
        phase: 'stage',
        rollbackAttempted: false,
        rollbackSucceeded: false,
      });
    expect(port.currentPointer).toBe('active-v1');
    expect(await marker(active)).toBe('old');
  });

  it('rejects a tampered backup before staging and leaves the active database unchanged', async () => {
    const active = await migratedDb('old');
    const port = new PointerPort(active);
    const snapshot = await recoverySnapshot('new');
    snapshot.tables[0].rows.push({ key: 'tampered', value: 'backup' });

    await expect(activateRecoverySnapshot(port, snapshot, { activationId: 'tampered-backup' }))
      .rejects.toMatchObject({
        phase: 'validate',
        rollbackAttempted: false,
        rollbackSucceeded: false,
      });
    expect(port.currentPointer).toBe('active-v1');
    expect(port.databases.has('staged-tampered-backup')).toBe(false);
    expect(await marker(active)).toBe('old');
  });

  it('discards a staged database when interrupted before the pointer swap', async () => {
    const active = await migratedDb('old');
    const port = new PointerPort(active);

    await expect(activateRecoverySnapshot(port, await recoverySnapshot('new'), {
      activationId: 'activation-import-interrupt',
      onPhase: (phase) => {
        if (phase === 'integrity') throw new Error('interrupted during integrity validation');
      },
    })).rejects.toMatchObject({
      phase: 'integrity',
      rollbackAttempted: false,
      rollbackSucceeded: false,
    });

    expect(port.currentPointer).toBe('active-v1');
    expect(port.discarded).toEqual(['staged-activation-import-interrupt']);
    expect(await marker(active)).toBe('old');
  });

  it('rolls the active pointer back when reopening the new database is interrupted', async () => {
    const active = await migratedDb('old');
    const port = new PointerPort(active);
    port.failReopenFor = 'staged-reopen-interrupt';

    await expect(activateRecoverySnapshot(port, await recoverySnapshot('new'), { activationId: 'reopen-interrupt' }))
      .rejects.toMatchObject({
        phase: 'reopen',
        rollbackAttempted: true,
        rollbackSucceeded: true,
      });
    expect(port.currentPointer).toBe('active-v1');
    expect(await marker(active)).toBe('old');
  });

  it('keeps the old database active when pointer activation is interrupted', async () => {
    const active = await migratedDb('old');
    const port = new PointerPort(active);
    port.failSwap = true;

    await expect(activateRecoverySnapshot(port, await recoverySnapshot('new'), { activationId: 'swap-interrupt' }))
      .rejects.toMatchObject({
        phase: 'swap',
        rollbackAttempted: true,
        rollbackSucceeded: true,
      });
    expect(port.currentPointer).toBe('active-v1');
    expect(await marker(active)).toBe('old');
  });

  it('rolls back after reopened-database validation fails', async () => {
    const active = await migratedDb('old');
    const port = new PointerPort(active);
    const snapshot = await recoverySnapshot('new');

    await expect(activateRecoverySnapshot(port, snapshot, {
      activationId: 'verify-failure',
      verifyReopened: async (db) => {
        if (await marker(db) === 'new') throw new Error('reopened database failed application verification');
      },
    })).rejects.toMatchObject({
      phase: 'verify',
      rollbackAttempted: true,
      rollbackSucceeded: true,
    });
    expect(port.currentPointer).toBe('active-v1');
    expect(await marker(active)).toBe('old');
  });

  it('reports rollback failure instead of claiming recovery', async () => {
    const active = await migratedDb('old');
    const port = new PointerPort(active);
    const snapshot = await recoverySnapshot('new');
    const originalRestore = port.restoreActivePointer.bind(port);
    port.restoreActivePointer = async () => {
      await originalRestore({ activationId: 'rollback-failure', expectedPointer: 'unexpected', restorePointer: 'also-unexpected' });
    };

    const error = await activateRecoverySnapshot(port, snapshot, {
      activationId: 'rollback-failure',
      verifyReopened: async () => {
        throw new Error('verification failed');
      },
    }).catch((value) => value as RecoveryActivationError) as RecoveryActivationError;

    expect(error).toBeInstanceOf(RecoveryActivationError);
    expect(error.rollbackAttempted).toBe(true);
    expect(error.rollbackSucceeded).toBe(false);
    expect(error.rollbackError).toBeTruthy();
  });
});

describe('recovery activation Android adapter contract', () => {
  class FakeFiles implements RecoveryActivationFileDriver {
    readonly values = new Map<string, string>();
    replaceCalls: Array<{ source: string; target: string }> = [];
    failReplace = false;

    async ensureDirectory() {}
    async readText(name: string) {
      const value = this.values.get(name);
      if (value == null) throw new Error(`missing file: ${name}`);
      return value;
    }
    async writeText(name: string, value: string) { this.values.set(name, value); }
    async replace(source: string, target: string) {
      if (this.failReplace) throw new Error('atomic replace unavailable');
      const value = this.values.get(source);
      if (value == null) throw new Error(`missing source: ${source}`);
      this.values.set(target, value);
      this.values.delete(source);
      this.replaceCalls.push({ source, target });
    }
    async delete(name: string) { this.values.delete(name); }
  }

  function makeAdapter(files: FakeFiles) {
    const databases = new Map<string, TestDb>();
    const sqlite = {
      open: async (name: string) => {
        let db = databases.get(name);
        if (!db) {
          db = await migratedDb(name);
          // Keep fake handles reopenable so a second adapter models process restart.
          db.closeAsync = async () => {};
          databases.set(name, db);
        }
        return db;
      },
      delete: async (name: string) => {
        const db = databases.get(name);
        db?.close();
        databases.delete(name);
      },
    };
    return { adapter: createRecoveryActivationAdapter({ files, sqlite }), databases, sqlite };
  }

  it('uses injected SQLite/filesystem drivers and atomically swaps the pointer', async () => {
    const files = new FakeFiles();
    files.values.set('active-recovery-pointer.json', '{"format":"utopia.recovery-pointer.v1","pointer":"active-v1"}');
    const { adapter } = makeAdapter(files);
    const active = await adapter.readActive();
    expect(active.pointer).toBe('active-v1');

    const staged = await adapter.stageSnapshot({ activationId: 'android-test', snapshot: {} as RecoveryExport });
    await adapter.closeDatabase(staged.db);
    await adapter.closeDatabase(active.db);
    await adapter.swapActivePointer({ activationId: 'android-test', expectedPointer: 'active-v1', nextPointer: staged.pointer });

    expect(files.replaceCalls).toEqual([{ source: 'active-recovery-pointer.json.recovery-android-test.tmp', target: 'active-recovery-pointer.json' }]);
    expect((await adapter.readActive()).pointer).toBe('recovery-android-test');
  });

  it('fails closed on a stale pointer or non-atomic replacement', async () => {
    const files = new FakeFiles();
    files.values.set('active-recovery-pointer.json', '{"format":"utopia.recovery-pointer.v1","pointer":"active-v1"}');
    const { adapter } = makeAdapter(files);
    await expect(adapter.swapActivePointer({ activationId: 'stale', expectedPointer: 'other', nextPointer: 'next' }))
      .rejects.toThrow('Recovery active pointer changed');

    files.failReplace = true;
    await expect(adapter.swapActivePointer({ activationId: 'replace-fail', expectedPointer: 'active-v1', nextPointer: 'next' }))
      .rejects.toThrow('atomic replace unavailable');
    expect(files.values.get('active-recovery-pointer.json')).toContain('active-v1');
    expect(files.values.has('active-recovery-pointer.json.next.tmp')).toBe(false);
  });

  it('rejects missing or malformed pointer state instead of inventing device readiness', async () => {
    const files = new FakeFiles();
    const { adapter } = makeAdapter(files);
    await expect(adapter.readActive()).rejects.toThrow('missing file');
    files.values.set('active-recovery-pointer.json', '{"pointer":"../../untrusted"}');
    await expect(adapter.readActive()).rejects.toThrow('Recovery pointer manifest is invalid');
  });

  it('reopens the activated pointer after a process restart using the injected drivers', async () => {
    const files = new FakeFiles();
    files.values.set('active-recovery-pointer.json', '{"format":"utopia.recovery-pointer.v1","pointer":"active-v1"}');
    const first = makeAdapter(files);
    const active = await first.adapter.readActive();
    await active.db.runAsync('UPDATE meta SET value = ? WHERE key = ?', ['old', 'marker']);
    const result = await activateRecoverySnapshot(first.adapter, await recoverySnapshot('after-restart'), {
      activationId: 'restart-activation',
    });

    const second = createRecoveryActivationAdapter({ files, sqlite: first.sqlite });
    const reopened = await second.readActive();
    expect(result.toPointer).toBe('recovery-restart-activation');
    expect(reopened.pointer).toBe(result.toPointer);
    expect(await marker(reopened.db)).toBe('after-restart');
    expect(await marker(active.db)).toBe('old');
  });
});
