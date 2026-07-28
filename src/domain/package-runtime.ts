import type { AppPackage } from '@/packages/shared/contracts/package';
import { loadCatalog, type DomainManifest, type ParsedCatalog } from '@/src/domain/catalog';

export type AppRuntime = Readonly<{
  activePackage: AppPackage;
  activeManifest: DomainManifest;
  activeDomainId: string;
  catalog: ParsedCatalog;
}>;

export function createAppRuntime(appPackage: AppPackage): AppRuntime {
  const catalog = loadCatalog({ activeDomainId: appPackage.id, activePackage: appPackage });
  return {
    activePackage: appPackage,
    activeManifest: catalog.activeManifest,
    activeDomainId: catalog.activeDomainId,
    catalog,
  };
}
