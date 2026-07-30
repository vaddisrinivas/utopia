import {
  collectAppPackageValidationIssues,
  formatAppPackageValidationIssues,
  type AppPackage,
} from './package';
import { nativeCapabilitySupportErrors, nativeCapabilitySupportFindings, type NativeCapabilityFinding } from './native-capabilities';
import { canonicalJson, sha256Canonical } from './canonical-json';

export const UTOPIA_REGISTRY_SCHEMA_VERSION = 'utopia.registry.v1' as const;
export const UTOPIA_INSTALL_PREVIEW_SCHEMA_VERSION = 'utopia.install-preview.v1' as const;
export const UTOPIA_INSTALL_APPROVAL_SCHEMA_VERSION = 'utopia.install-approval.v1' as const;
export const UTOPIA_APP_INSTALLATION_SCHEMA_VERSION = 'utopia.app-installation.v1' as const;
export const UTOPIA_PACKAGE_CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/;
export const UTOPIA_INSTALL_DISCLOSURE_LINES = [
  'Utopia shows package data collections, providers, and permissions during install review.',
  'No API keys, tokens, secrets, files, audio content, health data, contacts, email, phone, or location trails are collected.',
] as const;
export const UTOPIA_PUBLISH_DISCLOSURE_LINES = [
  'Publish payloads should not include API keys, tokens, secrets, user records, prompts, files, audio, health data, contacts, email, phone, or location trails.',
  'Publishers must request only capabilities that are needed and document required permissions and providers.',
] as const;

export type UtopiaRegistryPackage = Readonly<{
  id: string;
  name: string;
  version: string;
  url: string;
  checksum?: string;
  description?: string;
  publisher?: UtopiaRegistryPublisher;
  signature?: UtopiaRegistrySignature;
}>;

export type UtopiaRegistryPublisher = Readonly<{
  id: string;
  name?: string;
  homepage?: string;
  verified?: boolean;
}>;

export type UtopiaRegistrySignature = Readonly<{
  algorithm: string;
  value: string;
  keyId?: string;
  publicKey?: string;
  signedAt?: string;
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
export type PackageInstallSignatureStatus = 'signature_verified' | 'signature_present' | 'signature_missing' | 'signature_invalid';

export type PackageInstallSignatureVerifierInput = Readonly<{
  canonicalPackage: string;
  computedChecksum: string;
  signature: UtopiaRegistrySignature;
  publisher?: UtopiaRegistryPublisher;
}>;

export type PackageInstallSignatureVerifierResult = boolean | Readonly<{
  verified: boolean;
  error?: string;
}>;

export type PackageInstallSignatureVerifier = (
  input: PackageInstallSignatureVerifierInput,
) => PackageInstallSignatureVerifierResult;

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
  nativeCapabilitySupport: readonly NativeCapabilityFinding[];
  widgetsRequired: string[];
  pluginsRequired: string[];
  fallbacks: string[];
  installDisclosures: readonly string[];
  publishDisclosures: readonly string[];
  trust: {
    status: PackageInstallTrustStatus;
    checksum?: string;
    computedChecksum: string | null;
    publisher?: UtopiaRegistryPublisher;
    signatureStatus: PackageInstallSignatureStatus;
    signatureAlgorithm?: string;
    signatureKeyId?: string;
    signatureSignedAt?: string;
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

export const UTOPIA_INSTALL_SCHEME = 'utopia:' as const;
export const UTOPIA_INSTALL_HOST = 'install' as const;
export const UTOPIA_REGISTRY_HOST = 'utoia.thetechcruise.com' as const;
export const UTOPIA_INSTALL_URL_BASE = `https://${UTOPIA_REGISTRY_HOST}/install` as const;

const LEGACY_WONDER_INSTALL_SCHEME = 'wonder:';
const LEGACY_WONDER_INSTALL_HOST = 'install';
const LEGACY_WONDER_UNIVERSAL_HOST = 'wonder.app';
export function isCanonicalPackageChecksum(value: unknown): value is string {
  return typeof value === 'string' && UTOPIA_PACKAGE_CHECKSUM_PATTERN.test(value);
}

export function parsePackageInstallTarget(input: string): PackageInstallTarget {
  const raw = input.trim();
  if (!raw) throw new Error('install_url_empty');

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('install_url_invalid');
  }

  if (
    (parsed.protocol === UTOPIA_INSTALL_SCHEME && parsed.hostname === UTOPIA_INSTALL_HOST)
    || (parsed.protocol === LEGACY_WONDER_INSTALL_SCHEME && parsed.hostname === LEGACY_WONDER_INSTALL_HOST)
  ) {
    return { source: 'deep_link', packageUrl: parseNestedPackageUrl(parsed) };
  }

  if (
    parsed.protocol === 'https:'
    && (parsed.hostname === UTOPIA_REGISTRY_HOST || parsed.hostname === LEGACY_WONDER_UNIVERSAL_HOST)
    && parsed.pathname === '/install'
  ) {
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
    if (entry.checksum !== undefined && !isCanonicalPackageChecksum(entry.checksum)) {
      errors.push(`${path}.checksum must be sha256:<64 hex chars>`);
    }
    if (entry.description !== undefined && !isText(entry.description)) {
      errors.push(`${path}.description must be text`);
    }
    errors.push(...collectPublisherValidationErrors(entry.publisher, `${path}.publisher`));
    errors.push(...collectSignatureValidationErrors(entry.signature, `${path}.signature`));
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
    signatureVerifier?: PackageInstallSignatureVerifier;
  },
): PackageInstallPreview {
  const packageIssues = collectAppPackageValidationIssues(candidate);
  const packageErrors = formatAppPackageValidationIssues(packageIssues);
  const pkg = packageErrors.length === 0 ? candidate as AppPackage : null;
  const canonicalPackage = isRecord(candidate) ? canonicalJson(candidate) : null;
  const computedChecksum = isRecord(candidate) ? sha256Canonical(candidate) : null;
  const expectedChecksum = options.expectedChecksum ?? options.registryPackage?.checksum;
  const trust = resolveTrustStatus(expectedChecksum, computedChecksum);
  const signature = resolveSignatureTrust(options.registryPackage?.signature, {
    canonicalPackage,
    computedChecksum,
    publisher: options.registryPackage?.publisher,
    verifier: options.signatureVerifier,
  });
  const compatibilityReasons = pkg ? collectRuntimeCompatibilityReasons(pkg) : packageErrors;
  const nativeCapabilitySupport = pkg?.schemaVersion === 'wonder.app-package.v3'
    ? nativeCapabilitySupportFindings(pkg.nativeCapabilities)
    : [];
  const dataCollections = pkg ? Object.keys(pkg.collections).sort() : [];
  const providersRequested = pkg ? providerRequests(pkg) : [];
  const nativePermissionsRequested = pkg
    ? nativePermissionLabels(pkg)
    : candidateNativePermissionLabels(candidate);
  const blocked = packageErrors.length > 0
    || compatibilityReasons.length > 0
    || trust.status === 'checksum_mismatch'
    || signature.status === 'signature_invalid';

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
    dataCollections,
    providersRequested,
    nativePermissionsRequested,
    nativeCapabilitySupport,
    widgetsRequired: pkg ? widgetRequests(pkg) : [],
    pluginsRequired: pkg ? pluginRequests(pkg) : [],
    fallbacks: pkg ? fallbackLabels(pkg) : [],
    installDisclosures: buildInstallDisclosures({
      dataCollections,
      providersRequested,
      nativePermissionsRequested,
    }),
    publishDisclosures: UTOPIA_PUBLISH_DISCLOSURE_LINES,
    trust: {
      status: trust.status,
      ...(expectedChecksum ? { checksum: expectedChecksum } : {}),
      computedChecksum,
      ...(options.registryPackage?.publisher ? { publisher: options.registryPackage.publisher } : {}),
      signatureStatus: signature.status,
      ...(signature.algorithm ? { signatureAlgorithm: signature.algorithm } : {}),
      ...(signature.keyId ? { signatureKeyId: signature.keyId } : {}),
      ...(signature.signedAt ? { signatureSignedAt: signature.signedAt } : {}),
    },
    validationErrors: [...packageErrors, ...(trust.error ? [trust.error] : []), ...(signature.error ? [signature.error] : [])],
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
  if (!isCanonicalPackageChecksum(expectedChecksum)) {
    return { status: 'checksum_mismatch', error: 'checksum format invalid' };
  }
  if (computedChecksum && expectedChecksum === computedChecksum) return { status: 'checksum_verified' };
  return { status: 'checksum_mismatch', error: 'checksum mismatch' };
}

function resolveSignatureTrust(
  signature: UtopiaRegistrySignature | undefined,
  options: {
    canonicalPackage: string | null;
    computedChecksum: string | null;
    publisher?: UtopiaRegistryPublisher;
    verifier?: PackageInstallSignatureVerifier;
  },
): {
  status: PackageInstallSignatureStatus;
  algorithm?: string;
  keyId?: string;
  signedAt?: string;
  error?: string;
} {
  if (signature === undefined) return { status: 'signature_missing' };
  const errors = collectSignatureValidationErrors(signature, 'signature');
  if (errors.length) return { status: 'signature_invalid', error: errors.join('|') };
  const metadata = {
    algorithm: signature.algorithm,
    ...(signature.keyId ? { keyId: signature.keyId } : {}),
    ...(signature.signedAt ? { signedAt: signature.signedAt } : {}),
  };
  if (options.verifier) {
    if (!options.canonicalPackage || !options.computedChecksum) {
      return { status: 'signature_invalid', ...metadata, error: 'signature verification package unavailable' };
    }
    try {
      const result = options.verifier({
        canonicalPackage: options.canonicalPackage,
        computedChecksum: options.computedChecksum,
        signature,
        ...(options.publisher ? { publisher: options.publisher } : {}),
      });
      const verified = typeof result === 'boolean' ? result : result.verified;
      if (!verified) {
        const error = typeof result === 'boolean' ? undefined : result.error;
        return { status: 'signature_invalid', ...metadata, error: error ?? 'signature verification failed' };
      }
      return { status: 'signature_verified', ...metadata };
    } catch (error) {
      return {
        status: 'signature_invalid',
        ...metadata,
        error: `signature verification failed:${error instanceof Error ? error.message : 'unknown_error'}`,
      };
    }
  }
  return {
    status: 'signature_present',
    ...metadata,
  };
}

function collectPublisherValidationErrors(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  if (!isRecord(value)) return [`${path} must be an object`];
  const errors: string[] = [];
  if (!isText(value.id)) errors.push(`${path}.id is required`);
  if (value.name !== undefined && !isText(value.name)) errors.push(`${path}.name must be text`);
  if (value.homepage !== undefined) {
    if (!isText(value.homepage)) {
      errors.push(`${path}.homepage must be text`);
    } else {
      try {
        requireHttpsUrl(value.homepage);
      } catch (error) {
        errors.push(`${path}.homepage ${error instanceof Error ? error.message : 'invalid'}`);
      }
    }
  }
  if (value.verified !== undefined && typeof value.verified !== 'boolean') {
    errors.push(`${path}.verified must be boolean`);
  }
  return errors;
}

function collectSignatureValidationErrors(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  if (!isRecord(value)) return [`${path} must be an object`];
  const errors: string[] = [];
  if (!isText(value.algorithm)) errors.push(`${path}.algorithm is required`);
  if (!isText(value.value)) errors.push(`${path}.value is required`);
  if (value.keyId !== undefined && !isText(value.keyId)) errors.push(`${path}.keyId must be text`);
  if (value.publicKey !== undefined && !isText(value.publicKey)) errors.push(`${path}.publicKey must be text`);
  if (value.signedAt !== undefined) {
    if (!isText(value.signedAt)) {
      errors.push(`${path}.signedAt must be text`);
    } else if (Number.isNaN(Date.parse(value.signedAt))) {
      errors.push(`${path}.signedAt must be ISO date`);
    }
  }
  return errors;
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

function buildInstallDisclosures(input: {
  dataCollections: readonly string[];
  providersRequested: readonly string[];
  nativePermissionsRequested: readonly string[];
}): string[] {
  const disclosures: string[] = [...UTOPIA_INSTALL_DISCLOSURE_LINES];
  if (input.dataCollections.length) {
    disclosures.push(`Data collections: ${input.dataCollections.join(', ')}`);
  } else {
    disclosures.push('No data collections declared.');
  }

  if (input.providersRequested.length) {
    disclosures.push(`Providers: ${input.providersRequested.join(', ')}`);
  } else {
    disclosures.push('No external providers requested.');
  }

  if (input.nativePermissionsRequested.length) {
    disclosures.push(`Native permissions: ${input.nativePermissionsRequested.join(', ')}`);
  } else {
    disclosures.push('No native permissions requested.');
  }

  return disclosures;
}

function candidateNativePermissionLabels(candidate: unknown): string[] {
  if (!isRecord(candidate) || !isRecord(candidate.nativeCapabilities)) return [];
  const permissions = candidate.nativeCapabilities.permissions;
  if (!Array.isArray(permissions)) return [];
  return uniqueStrings(permissions.flatMap((permission) => {
    if (typeof permission === 'string' && permission.trim()) return [permission.trim()];
    if (isRecord(permission) && typeof permission.permission === 'string' && permission.permission.trim()) {
      return [permission.permission.trim()];
    }
    return [];
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
