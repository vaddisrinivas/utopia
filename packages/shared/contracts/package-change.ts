const APP_PACKAGE_PATCH_ROOTS = [
  '/collections',
  '/presentation',
  '/queries',
  '/views',
  '/rules',
  '/computedFields',
  '/capabilities',
  '/acceptanceTests',
  '/nativeCapabilities',
] as const;

const APP_PACKAGE_PATCH_EXACT_PATHS = new Set<string>([
  '/version',
  '/contractLock/checksum',
  '/contractLock/pinnedAt',
  '/contractLock/nativeCapabilities',
]);

export function isAllowedAppPackagePatchPath(path: string): boolean {
  if (APP_PACKAGE_PATCH_EXACT_PATHS.has(path)) return true;
  return APP_PACKAGE_PATCH_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}
