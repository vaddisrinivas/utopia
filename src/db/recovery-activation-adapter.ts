import type {
  RecoveryActivationDatabase,
  RecoveryActivationPort,
} from '@/src/db/recovery-activation';
import type { RecoveryExport } from '@/src/db/migrations';

const POINTER_FORMAT = 'utopia.recovery-pointer.v1' as const;
const POINTER_FILE = 'active-recovery-pointer.json';
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type RecoveryActivationSqliteDriver<Db extends RecoveryActivationDatabase> = {
  open(databaseName: string): Promise<Db>;
  delete(databaseName: string): Promise<void>;
};

export type RecoveryActivationFileDriver = {
  ensureDirectory(): Promise<void>;
  readText(name: string): Promise<string>;
  writeText(name: string, value: string): Promise<void>;
  /** Replace target with source atomically, or reject without changing target. */
  replace(sourceName: string, targetName: string): Promise<void>;
  delete(name: string): Promise<void>;
};

type PointerManifest = {
  format: typeof POINTER_FORMAT;
  pointer: string;
};

export type ExpoRecoveryActivationAdapterInput<Db extends RecoveryActivationDatabase> = {
  sqlite: RecoveryActivationSqliteDriver<Db>;
  files: RecoveryActivationFileDriver;
};

function assertSafeName(value: string, label: string): void {
  if (!SAFE_NAME.test(value)) throw new Error(`Invalid recovery ${label}`);
}

function databaseName(pointer: string): string {
  assertSafeName(pointer, 'pointer');
  return `${pointer}.sqlite`;
}

function parsePointerManifest(value: string): PointerManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Recovery pointer manifest is not valid JSON');
  }
  if (
    !parsed
    || typeof parsed !== 'object'
    || (parsed as PointerManifest).format !== POINTER_FORMAT
    || typeof (parsed as PointerManifest).pointer !== 'string'
  ) {
    throw new Error('Recovery pointer manifest is invalid');
  }
  assertSafeName((parsed as PointerManifest).pointer, 'pointer');
  return parsed as PointerManifest;
}

function manifest(pointer: string): string {
  assertSafeName(pointer, 'pointer');
  return JSON.stringify({ format: POINTER_FORMAT, pointer });
}

export function createRecoveryActivationAdapter<Db extends RecoveryActivationDatabase>({
  sqlite,
  files,
}: ExpoRecoveryActivationAdapterInput<Db>): RecoveryActivationPort<Db> {
  const openDatabases = new Map<string, Db>();
  const readPointer = async (): Promise<string> => {
    const value = await files.readText(POINTER_FILE);
    return parsePointerManifest(value).pointer;
  };

  const openPointer = async (pointer: string): Promise<Db> => {
    const db = await sqlite.open(databaseName(pointer));
    openDatabases.set(pointer, db);
    return db;
  };

  const replacePointer = async (expectedPointer: string, nextPointer: string): Promise<void> => {
    const currentPointer = await readPointer();
    if (currentPointer !== expectedPointer) {
      throw new Error(`Recovery active pointer changed: expected ${expectedPointer}, found ${currentPointer}`);
    }
    const temporaryName = `${POINTER_FILE}.${nextPointer}.tmp`;
    await files.writeText(temporaryName, manifest(nextPointer));
    try {
      await files.replace(temporaryName, POINTER_FILE);
    } catch (error) {
      try {
        await files.delete(temporaryName);
      } catch {
        // Preserve the replacement failure; a later activation can clean the temp file.
      }
      throw error;
    }
  };

  return {
    async readActive() {
      await files.ensureDirectory();
      const pointer = await readPointer();
      return { pointer, db: await openPointer(pointer) };
    },

    async stageSnapshot({ activationId }: { activationId: string; snapshot: RecoveryExport }) {
      assertSafeName(activationId, 'activation id');
      const pointer = `recovery-${activationId}`;
      return { pointer, db: await openPointer(pointer) };
    },

    async closeDatabase(db) {
      if (typeof db.closeAsync !== 'function') {
        throw new Error('Recovery database driver cannot close native database');
      }
      await db.closeAsync();
      for (const [pointer, openDb] of openDatabases) {
        if (openDb === db) openDatabases.delete(pointer);
      }
    },

    async swapActivePointer({ expectedPointer, nextPointer }) {
      await replacePointer(expectedPointer, nextPointer);
    },

    async reopen(pointer) {
      return openPointer(pointer);
    },

    async restoreActivePointer({ expectedPointer, restorePointer }) {
      const currentPointer = await readPointer();
      if (currentPointer === restorePointer) return;
      await replacePointer(expectedPointer, restorePointer);
    },

    async discardStaged(pointer) {
      const db = openDatabases.get(pointer);
      if (db) {
        if (typeof db.closeAsync !== 'function') {
          throw new Error('Recovery database driver cannot close staged native database');
        }
        await db.closeAsync();
        openDatabases.delete(pointer);
      }
      await sqlite.delete(databaseName(pointer));
    },
  };
}
