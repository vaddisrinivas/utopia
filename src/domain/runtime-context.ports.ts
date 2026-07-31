import type { AppInstallation } from '@/packages/shared/contracts/app-installation';
import type { AppPackage } from '@/packages/shared/contracts/package';
import type { AppRuntime } from '@/src/domain/package-runtime';
import type { DatabasePort } from '@/src/domain/database-port';

export interface RuntimePackageRegistryPort {
  getActiveAppPackage(database: DatabasePort, installationId: string): Promise<AppPackage | null>;
  getAppInstallation(database: DatabasePort, installationId: string): Promise<AppInstallation | null>;
  activateAppPackage(database: DatabasePort, installationId: string, candidate: unknown): Promise<AppPackage>;
  rollbackAppPackage(database: DatabasePort, installationId: string): Promise<AppPackage | null>;
}

export interface RuntimePackageLoaderPort {
  loadAppPackage(candidate: unknown): AppRuntime;
}

export interface RuntimeContextPorts {
  registry: RuntimePackageRegistryPort;
  loader: RuntimePackageLoaderPort;
}
