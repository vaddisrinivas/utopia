import { Directory, File, Paths } from 'expo-file-system';
import { deleteDatabaseAsync, openDatabaseAsync } from 'expo-sqlite';

import {
  createRecoveryActivationAdapter,
  type RecoveryActivationFileDriver,
} from '@/src/db/recovery-activation-adapter';
import type { RecoveryActivationDatabase } from '@/src/db/recovery-activation';

const RECOVERY_DIRECTORY = 'utopia-recovery';

export function createExpoRecoveryActivationAdapter() {
  const directory = new Directory(Paths.document, RECOVERY_DIRECTORY);
  const files: RecoveryActivationFileDriver = {
    ensureDirectory: async () => {
      directory.create({ intermediates: true, idempotent: true });
    },
    readText: async (name) => new File(directory, name).text(),
    writeText: async (name, value) => {
      new File(directory, name).write(value);
    },
    replace: async (sourceName, targetName) => {
      await new File(directory, sourceName).move(new File(directory, targetName), { overwrite: true });
    },
    delete: async (name) => {
      new File(directory, name).delete();
    },
  };

  const sqliteDirectory = directory.uri;
  return createRecoveryActivationAdapter<RecoveryActivationDatabase>({
    files,
    sqlite: {
      open: (databaseName) => openDatabaseAsync(databaseName, undefined, sqliteDirectory),
      delete: (databaseName) => deleteDatabaseAsync(databaseName, sqliteDirectory),
    },
  });
}

