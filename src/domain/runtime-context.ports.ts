import type { SQLiteDatabase } from 'expo-sqlite';

import type { AppInstallation } from '@/packages/shared/contracts/app-installation';
import type { AppPackage } from '@/packages/shared/contracts/package';
import type { AppRuntime } from '@/src/domain/package-runtime';
import { defaultRuntimeContextPorts } from '../../adapters/runtime-context-ports';

export interface RuntimePackageRegistryPort {
  getActiveAppPackage(database: SQLiteDatabase, installationId: string): Promise<AppPackage | null>;
  getAppInstallation(database: SQLiteDatabase, installationId: string): Promise<AppInstallation | null>;
  activateAppPackage(database: SQLiteDatabase, installationId: string, candidate: unknown): Promise<AppPackage>;
  rollbackAppPackage(database: SQLiteDatabase, installationId: string): Promise<AppPackage | null>;
}

export interface RuntimePackageLoaderPort {
  loadAppPackage(candidate: unknown): AppRuntime;
}

export interface RuntimeContextPorts {
  registry: RuntimePackageRegistryPort;
  loader: RuntimePackageLoaderPort;
}

export { defaultRuntimeContextPorts };
