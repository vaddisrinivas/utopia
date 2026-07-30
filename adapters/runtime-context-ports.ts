import { activateAppPackage as persistActivateAppPackage, getActiveAppPackage, getAppInstallation, rollbackAppPackage as persistRollbackAppPackage } from '@/src/db/app-package-registry';
import { loadAppPackage } from '@/src/domain/package-loader';
import { type RuntimeContextPorts } from '@/src/domain/runtime-context.ports';

export const defaultRuntimeContextPorts: RuntimeContextPorts = {
  registry: {
    getActiveAppPackage(database, installationId) {
      return getActiveAppPackage(database, installationId);
    },
    getAppInstallation(database, installationId) {
      return getAppInstallation(database, installationId);
    },
    activateAppPackage(database, installationId, candidate) {
      return persistActivateAppPackage(database, installationId, candidate);
    },
    rollbackAppPackage(database, installationId) {
      return persistRollbackAppPackage(database, installationId);
    },
  },
  loader: {
    loadAppPackage(candidate) {
      return loadAppPackage(candidate);
    },
  },
};
