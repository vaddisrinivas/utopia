import { ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { type SQLiteDatabase } from 'expo-sqlite';

import type { AppInstallation } from '@/packages/shared/contracts/app-installation';
import type { AppPackage } from '@/packages/shared/contracts/package';
import { type DomainManifest, type ParsedCatalog } from '@/src/domain/catalog';
import type { AppRuntime } from '@/src/domain/package-runtime';

import { defaultRuntimeContextPorts, type RuntimeContextPorts } from '@/src/domain/runtime-context.ports';

type AppRuntimeContextValue = {
  db: SQLiteDatabase | null;
  installationId: string | null;
  installation: AppInstallation | null;
  runtime: AppRuntime | null;
  activePackage: AppPackage | null;
  activeManifest: DomainManifest | null;
  catalog: ParsedCatalog | null;
  activateAppPackage(candidate: unknown): Promise<AppPackage>;
  rollbackAppPackage(): Promise<AppPackage | null>;
  refreshRuntime(): Promise<AppRuntime | null>;
};

export const AppRuntimeContext = createContext<AppRuntimeContextValue | null>(null);

export function AppRuntimeProvider(
  {
    db,
    installationId = null,
    initialInstallation = null,
    initialPackage = null,
    ports = defaultRuntimeContextPorts,
    children,
  }: {
    db: SQLiteDatabase | null;
    installationId?: string | null;
    initialInstallation?: AppInstallation | null;
    initialPackage?: AppPackage | null;
    ports?: RuntimeContextPorts;
    children?: ReactNode;
  },
) {
  const [runtime, setRuntime] = useState<AppRuntime | null>(() => initialPackage ? ports.loader.loadAppPackage(initialPackage) : null);
  const [installation, setInstallation] = useState<AppInstallation | null>(initialInstallation);

  const scopedInstallationId = initialInstallation?.id ?? installationId?.trim() ?? null;

  useEffect(() => {
    setRuntime(initialPackage ? ports.loader.loadAppPackage(initialPackage) : null);
  }, [initialPackage]);

  useEffect(() => {
    setInstallation(initialInstallation);
  }, [initialInstallation]);

  useEffect(() => {
    if (!initialPackage) {
      setRuntime(null);
    }
    if (!initialInstallation) {
      setInstallation(null);
    }
  }, [initialInstallation, initialPackage, scopedInstallationId]);

  useEffect(() => {
    if (!db || initialPackage || !scopedInstallationId) {
      return;
    }
    let cancelled = false;
    void Promise.all([
      ports.registry.getActiveAppPackage(db, scopedInstallationId),
      ports.registry.getAppInstallation(db, scopedInstallationId),
    ]).then(([activePackage, nextInstallation]) => {
      if (cancelled) return;
      setRuntime(activePackage ? ports.loader.loadAppPackage(activePackage) : null);
      setInstallation(nextInstallation);
    }).catch(() => {
      if (cancelled) return;
      setRuntime(null);
      setInstallation(null);
    });
    return () => {
      cancelled = true;
    };
  }, [db, initialPackage, scopedInstallationId]);

  async function refreshRuntime(): Promise<AppRuntime | null> {
    const resolvedInstallationId = requireInstallationScope(scopedInstallationId);
    if (!db) {
      return null;
    }
    const [activePackage, nextInstallation] = await Promise.all([
      ports.registry.getActiveAppPackage(db, resolvedInstallationId),
      ports.registry.getAppInstallation(db, resolvedInstallationId),
    ]);
    const nextRuntime = activePackage ? ports.loader.loadAppPackage(activePackage) : null;
    setRuntime(nextRuntime);
    setInstallation(nextInstallation);
    return nextRuntime;
  }

  async function activateRuntimePackage(candidate: unknown): Promise<AppPackage> {
    if (!db) {
      throw new Error('app_runtime_db_unavailable');
    }
    const resolvedInstallationId = requireInstallationScope(scopedInstallationId);
    const activePackage = await ports.registry.activateAppPackage(db, resolvedInstallationId, candidate);
    const nextRuntime = ports.loader.loadAppPackage(activePackage);
    setRuntime(nextRuntime);
    setInstallation(await ports.registry.getAppInstallation(db, resolvedInstallationId));
    return nextRuntime.activePackage;
  }

  async function rollbackRuntimePackage(): Promise<AppPackage | null> {
    if (!db) {
      throw new Error('app_runtime_db_unavailable');
    }
    const resolvedInstallationId = requireInstallationScope(scopedInstallationId);
    const activePackage = await ports.registry.rollbackAppPackage(db, resolvedInstallationId);
    const nextRuntime = activePackage ? ports.loader.loadAppPackage(activePackage) : null;
    setRuntime(nextRuntime);
    setInstallation(await ports.registry.getAppInstallation(db, resolvedInstallationId));
    return nextRuntime?.activePackage ?? null;
  }

  return (
    <AppRuntimeContext.Provider
      value={{
        db,
        installationId: scopedInstallationId,
        installation,
        runtime,
        activePackage: runtime?.activePackage ?? null,
        activeManifest: runtime?.activeManifest ?? null,
        catalog: runtime?.catalog ?? null,
        activateAppPackage: activateRuntimePackage,
        rollbackAppPackage: rollbackRuntimePackage,
        refreshRuntime,
      }}
    >
      {children}
    </AppRuntimeContext.Provider>
  );
}

export function useAppRuntime(): AppRuntimeContextValue {
  const context = useContext(AppRuntimeContext);
  if (!context) {
    throw new Error('useAppRuntime must be used within AppRuntimeProvider');
  }
  return context;
}

function requireInstallationScope(installationId: string | null): string {
  const value = installationId?.trim() ?? '';
  if (!value) throw new Error('app_runtime_installation_scope_required');
  return value;
}
