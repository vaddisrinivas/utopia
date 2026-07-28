import {
  collectAppPackageValidationIssues,
  formatAppPackageValidationIssues,
  type AppPackage,
} from './package';
import { nativeCapabilitySupportErrors } from './native-capabilities';
import { sha256Canonical } from './canonical-json';

export const UTOPIA_REGISTRY_SCHEMA_VERSION = 'utopia.registry.v1' as const;
export const UTOPIA_INSTALL_PREVIEW_SCHEMA_VERSION = 'utopia.install-preview.v1' as const;
export const UTOPIA_INSTALL_APPROVAL_SCHEMA_VERSION = 'utopia.install-approval.v1' as const;
export const UTOPIA_APP_INSTALLATION_SCHEMA_VERSION = 'utopia.app-installation.v1' as const;

export type UtopiaRegistryPackage = Readonly<{
  id: string;
  name: string;
  version: string;
  url: string;
  checksum?: string;
  description?: string;
}>;

export type UtopiaRegistryManifest = Readonly<{
  schemaVersion: typeof UTOPIA_REGISTRY_SCHEMA_VERSION;
  name: string;
  packages: readonly UtopiaRegistryPackage[];
}>;

export type PackageInstallTarget = Readonly<{
  source: 'deep_link' | 'universal_link' | 'package_url';
  packageUrl: string;
}>;

export type PackageInstallTrustStatus = 'checksum_verified' | 'checksum_missing' | 'checksum_mismatch';

export type PackageInstallPreview = Readonly<{
  schemaVersion: typeof UTOPIA_INSTALL_PREVIEW_SCHEMA_VERSION;
  status: 'ready_for_review' | 'blocked';
  approvalRequired: true;
  sourceUrl: string;
  appName: string;
  icon?: string;
  description?: string;
  packageId: string | null;
  version: string | null;
  runtimeCompatibility: {
    status: 'compatible' | 'blocked';
    reasons: string[];
  };
  screensIncluded: string[];
  dataCollections: string[];
  providersRequested: string[];
  nativePermissionsRequested: string[];
  widgetsRequired: string[];
  pluginsRequired: string[];
  fallbacks: string[];
  trust: {
    status: PackageInstallTrustStatus;
    checksum?: string;
    computedChecksum: string | null;
  };
  validationErrors: string[];
}>;

export type PackageInstallApprovalReceipt = Readonly<{
  schemaVersion: typeof UTOPIA_INSTALL_APPROVAL_SCHEMA_VERSION;
  approved: true;
  sourceUrl: string;
  packageId: string;
  version: string;
  checksum: string;
  compatibility: PackageInstallPreview['runtimeCompatibility'];
  previewHash: string;
  approvedBy: string;
  approvedAt: string;
}>;

export type AppInstallation = Readonly<{
  schemaVersion: typeof UTOPIA_APP_INSTALLATION_SCHEMA_VERSION;
  installationId: string;
  packageId: string;
  version: string;
  packageKey: string;
  sourceUrl: string;
  checksum: string;
  appName: string;
  status: 'active';
  launchPath: string;
  approvalHash: string;
  approvedBy: string;
  createdAt: string;
  updatedAt: string;
}>;

const WONDER_INSTALL_HOST = 'install';
const WONDER_UNIVERSAL_HOST = 'wonder.app';
const CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/;

export function parsePackageInstallTarget(input: string): PackageInstallTarget {
  const raw = input.trim();
  if (!raw) throw new Error('install_url_empty');

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('install_url_invalid');
  }

  if (parsed.protocol === 'wonder:' && parsed.hostname === WONDER_INSTALL_HOST) {
    return { source: 'deep_link', packageUrl: parseNestedPackageUrl(parsed) };
  }

  if (parsed.protocol === 'https:' && parsed.hostname === WONDER_UNIVERSAL_HOST && parsed.pathname === '/install') {
    return { source: 'universal_link', packageUrl: parseNestedPackageUrl(parsed) };
  }

  if (parsed.protocol === 'https:') {
    return { source: 'package_url', packageUrl: normalizeHttpsUrl(parsed) };
  }

  throw new Error('install_url_must_be_https');
}

export function collectRegistryManifestValidationErrors(input: unknown): string[] {
  if (!isRecord(input)) return ['registry manifest must be an object'];

  const manifest = input as Partial<UtopiaRegistryManifest>;
  const errors: string[] = [];
  if (manifest.schemaVersion !== UTOPIA_REGISTRY_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${UTOPIA_REGISTRY_SCHEMA_VERSION}`);
  }
  if (!isText(manifest.name)) errors.push('name is required');
  if (!Array.isArray(manifest.packages)) {
    errors.push('packages must be an array');
    return errors;
  }

  const ids = new Set<string>();
  for (const [index, entry] of manifest.packages.entries()) {
    const path = `packages[${index}]`;
    if (!isRecord(entry)) {
      errors.push(`${path} must be an object`);
      continue;
    }
    if (!isText(entry.id)) errors.push(`${path}.id is required`);
    if (!isText(entry.name)) errors.push(`${path}.name is required`);
    if (!isText(entry.version)) errors.push(`${path}.version is required`);
    if (!isText(entry.url)) {
      errors.push(`${path}.url is required`);
    } else {
      try {
        requireHttpsUrl(entry.url);
      } catch (error) {
        errors.push(`${path}.url ${error instanceof Error ? error.message : 'invalid'}`);
      }
    }
    if (entry.checksum !== undefined && (!isText(entry.checksum) || !CHECKSUM_PATTERN.test(entry.checksum))) {
      errors.push(`${path}.checksum must be sha256:<64 hex chars>`);
    }
    if (entry.description !== undefined && !isText(entry.description)) {
      errors.push(`${path}.description must be text`);
    }
    const key = isText(entry.id) && isText(entry.version) ? `${entry.id}@${entry.version}` : null;
    if (key) {
      if (ids.has(key)) errors.push(`${path} duplicates ${key}`);
      ids.add(key);
    }
  }

  return errors;
}

export function validateRegistryManifest(input: unknown): UtopiaRegistryManifest {
  const errors = collectRegistryManifestValidationErrors(input);
  if (errors.length) throw new Error(`registry_manifest_invalid:${errors.join('|')}`);
  return input as UtopiaRegistryManifest;
}

export function buildPackageInstallPreview(
  candidate: unknown,
  options: {
    sourceUrl: string;
    registryPackage?: UtopiaRegistryPackage;
    expectedChecksum?: string;
  },
): PackageInstallPreview {
  const packageIssues = collectAppPackageValidationIssues(candidate);
  const packageErrors = formatAppPackageValidationIssues(packageIssues);
  const pkg = packageErrors.length === 0 ? candidate as AppPackage : null;
  const computedChecksum = pkg ? sha256Canonical(pkg) : null;
  const expectedChecksum = options.expectedChecksum ?? options.registryPackage?.checksum;
  const trust = resolveTrustStatus(expectedChecksum, computedChecksum);
  const compatibilityReasons = pkg ? collectRuntimeCompatibilityReasons(pkg) : packageErrors;
  const blocked = packageErrors.length > 0 || compatibilityReasons.length > 0 || trust.status === 'checksum_mismatch';

  return {
    schemaVersion: UTOPIA_INSTALL_PREVIEW_SCHEMA_VERSION,
    status: blocked ? 'blocked' : 'ready_for_review',
    approvalRequired: true,
    sourceUrl: requireHttpsUrl(options.sourceUrl),
    appName: options.registryPackage?.name ?? pkg?.presentation?.label ?? pkg?.id ?? 'Unknown package',
    ...(homeIcon(pkg) ? { icon: homeIcon(pkg) } : {}),
    ...(options.registryPackage?.description ? { description: options.registryPackage.description } : {}),
    packageId: pkg?.id ?? null,
    version: pkg?.version ?? null,
    runtimeCompatibility: {
      status: compatibilityReasons.length > 0 ? 'blocked' : 'compatible',
      reasons: compatibilityReasons,
    },
    screensIncluded: pkg ? screenIds(pkg) : [],
    dataCollections: pkg ? Object.keys(pkg.collections).sort() : [],
    providersRequested: pkg ? providerRequests(pkg) : [],
    nativePermissionsRequested: pkg ? nativePermissionLabels(pkg) : [],
    widgetsRequired: pkg ? widgetRequests(pkg) : [],
    pluginsRequired: pkg ? pluginRequests(pkg) : [],
    fallbacks: pkg ? fallbackLabels(pkg) : [],
    trust: {
      status: trust.status,
      ...(expectedChecksum ? { checksum: expectedChecksum } : {}),
      computedChecksum,
    },
    validationErrors: [...packageErrors, ...(trust.error ? [trust.error] : [])],
  };
}

export function buildPackageInstallApprovalReceipt(
  preview: PackageInstallPreview,
  approvedBy: string,
  approvedAt = new Date().toISOString(),
): PackageInstallApprovalReceipt {
  assertPreviewReadyForApproval(preview);
  if (!approvedBy.trim()) throw new Error('package_install_approval_actor_required');
  if (Number.isNaN(Date.parse(approvedAt))) throw new Error('package_install_approval_time_invalid');

  return {
    schemaVersion: UTOPIA_INSTALL_APPROVAL_SCHEMA_VERSION,
    approved: true,
    sourceUrl: preview.sourceUrl,
    packageId: preview.packageId,
    version: preview.version,
    checksum: preview.trust.computedChecksum,
    compatibility: {
      status: preview.runtimeCompatibility.status,
      reasons: [...preview.runtimeCompatibility.reasons],
    },
    previewHash: hashPackageInstallPreview(preview),
    approvedBy: approvedBy.trim(),
    approvedAt,
  };
}

export function hashPackageInstallPreview(preview: PackageInstallPreview): string {
  return sha256Canonical(preview);
}

export function hashPackageInstallApprovalReceipt(approval: PackageInstallApprovalReceipt): string {
  return sha256Canonical(approval);
}

export function assertPackageInstallApprovalMatchesPreview(
  approval: PackageInstallApprovalReceipt,
  preview: PackageInstallPreview,
): void {
  assertPreviewReadyForApproval(preview);
  if (
    !approval
    || approval.schemaVersion !== UTOPIA_INSTALL_APPROVAL_SCHEMA_VERSION
    || approval.approved !== true
    || approval.sourceUrl !== preview.sourceUrl
    || approval.packageId !== preview.packageId
    || approval.version !== preview.version
    || approval.checksum !== preview.trust.computedChecksum
    || approval.compatibility.status !== preview.runtimeCompatibility.status
    || approval.compatibility.reasons.join('\n') !== preview.runtimeCompatibility.reasons.join('\n')
    || approval.previewHash !== hashPackageInstallPreview(preview)
    || !approval.approvedBy?.trim()
    || Number.isNaN(Date.parse(approval.approvedAt))
  ) {
    throw new Error('package_install_approval_mismatch');
  }
}

function assertPreviewReadyForApproval(preview: PackageInstallPreview): asserts preview is PackageInstallPreview & {
  packageId: string;
  version: string;
  trust: PackageInstallPreview['trust'] & { computedChecksum: string };
} {
  if (preview.status !== 'ready_for_review') throw new Error('package_install_preview_blocked');
  if (!preview.packageId || !preview.version || !preview.trust.computedChecksum) {
    throw new Error('package_install_preview_incomplete');
  }
  if (preview.runtimeCompatibility.status !== 'compatible') throw new Error('package_install_compatibility_blocked');
  if (preview.validationErrors.length > 0) throw new Error('package_install_preview_invalid');
}

function parseNestedPackageUrl(url: URL): string {
  const nested = url.searchParams.get('url');
  if (!nested) throw new Error('install_url_missing_package_url');
  return requireHttpsUrl(nested);
}

function requireHttpsUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('must be a valid URL');
  }
  if (url.protocol !== 'https:') throw new Error('must be HTTPS');
  return normalizeHttpsUrl(url);
}

function normalizeHttpsUrl(url: URL): string {
  url.hash = '';
  return url.toString();
}

function resolveTrustStatus(expectedChecksum: string | undefined, computedChecksum: string | null): {
  status: PackageInstallTrustStatus;
  error?: string;
} {
  if (!expectedChecksum) return { status: 'checksum_missing' };
  if (!CHECKSUM_PATTERN.test(expectedChecksum)) {
    return { status: 'checksum_mismatch', error: 'checksum format invalid' };
  }
  if (computedChecksum && expectedChecksum === computedChecksum) return { status: 'checksum_verified' };
  return { status: 'checksum_mismatch', error: 'checksum mismatch' };
}

function collectRuntimeCompatibilityReasons(pkg: AppPackage): string[] {
  if (pkg.schemaVersion !== 'wonder.app-package.v3') return [];
  return nativeCapabilitySupportErrors(pkg.nativeCapabilities);
}

function screenIds(pkg: AppPackage): string[] {
  const screens = Object.keys(pkg.presentation?.ui?.screens ?? {});
  if (screens.length) return screens.sort();
  return (pkg.presentation?.surfaces ?? []).map((surface) => surface.id).sort();
}

function homeIcon(pkg: AppPackage | null): string | undefined {
  if (!pkg?.presentation?.homeSurface) return undefined;
  return pkg.presentation.surfaces.find((surface) => surface.id === pkg.presentation?.homeSurface)?.icon;
}

function providerRequests(pkg: AppPackage): string[] {
  return pkg.capabilities.filter((capability) => capability.startsWith('provider:')).sort();
}

function pluginRequests(pkg: AppPackage): string[] {
  return pkg.capabilities.filter((capability) => capability.startsWith('plugin:')).sort();
}

function fallbackLabels(pkg: AppPackage): string[] {
  return pkg.capabilities.filter((capability) => capability.startsWith('fallback:')).sort();
}

function widgetRequests(pkg: AppPackage): string[] {
  const screens = Object.values(pkg.presentation?.ui?.screens ?? {});
  return uniqueStrings(screens.flatMap((screen) =>
    (screen.components ?? [])
      .filter((component) => component.kind === 'widget' && typeof component.widget === 'string')
      .map((component) => String(component.widget)),
  ));
}

function nativePermissionLabels(pkg: AppPackage): string[] {
  if (pkg.schemaVersion !== 'wonder.app-package.v3') return [];
  return uniqueStrings((pkg.nativeCapabilities.permissions ?? []).map((permission) => {
    if (typeof permission === 'string') return permission;
    return permission.permission;
  }));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
