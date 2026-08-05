import { bundledEntries, bundledLoaders } from '@/src/generated/catalog';

import { parsePackage, type AppPackage } from './schema';
import { installedPackage } from './registry';

export const catalog = bundledEntries;

export function getPackage(id: string): AppPackage | undefined {
  const source = bundledLoaders[id]?.();
  return source ? parsePackage(source) : undefined;
}

export function allPackages(): AppPackage[] {
  return catalog.map((entry) => getPackage(entry.id)).filter((pkg): pkg is AppPackage => Boolean(pkg));
}

export async function findPackage(id: string): Promise<AppPackage | undefined> {
  return await installedPackage(id) ?? getPackage(id);
}
