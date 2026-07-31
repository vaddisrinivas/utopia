import { activateAppPackage as persistActivateAppPackage, getActiveAppPackage, getAppInstallation, rollbackAppPackage as persistRollbackAppPackage } from '@/src/db/app-package-registry';
import { loadAppPackage } from '@/src/domain/package-loader';
import { type RuntimeContextPorts } from '@/src/domain/runtime-context.ports';
import type { SQLiteDatabase } from 'expo-sqlite';

export const defaultRuntimeContextPorts: RuntimeContextPorts = {
  registry: {
    getActiveAppPackage(database, installationId) {
      return getActiveAppPackage(database as SQLiteDatabase, installationId);
    },
    getAppInstallation(database, installationId) {
      return getAppInstallation(database as SQLiteDatabase, installationId);
    },
    activateAppPackage(database, installationId, candidate) {
      return persistActivateAppPackage(database as SQLiteDatabase, installationId, candidate);
    },
    rollbackAppPackage(database, installationId) {
      return persistRollbackAppPackage(database as SQLiteDatabase, installationId);
    },
  },
  loader: {
    loadAppPackage(candidate) {
      return loadAppPackage(candidate);
    },
  },
};
