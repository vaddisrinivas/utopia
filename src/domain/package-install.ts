import {
  buildPackageInstallPreview,
  parsePackageInstallTarget,
  validateRegistryManifest,
  type PackageInstallPreview,
  type PackageInstallTarget,
  type UtopiaRegistryManifest,
  type UtopiaRegistryPackage,
} from '@/packages/shared/contracts/package-install';
import { sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import { buildAppPackageFromManifest } from '@/src/domain/app-package-bridge';
import { getBundledDomainManifest } from '@/src/domain/catalog';

export const BUNDLED_UTOPIA_REGISTRY_URL = 'https://wonder.app/registry/bundled.json';
export const BUNDLED_DEMO_PACKAGE_URL = 'https://wonder.app/bundled/demo.package.json';

export type PackageInstallFetchResponse = Readonly<{
  ok: boolean;
  status: number;
  headers?: {
    get(name: string): string | null;
  };
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}>;

export type PackageInstallFetcher = (url: string) => Promise<PackageInstallFetchResponse>;

export type PackageInstallCandidate = Readonly<{
  target: PackageInstallTarget;
  packageJson: unknown;
  preview: PackageInstallPreview;
}>;

export type PackageInstallPreviewRow = Readonly<{
  label: string;
  values: readonly string[];
}>;

export function packageInstallPreviewRows(preview: PackageInstallPreview): PackageInstallPreviewRow[] {
  return [
    { label: 'Screens', values: preview.screensIncluded },
    { label: 'Collections', values: preview.dataCollections },
    { label: 'Providers', values: preview.providersRequested },
    { label: 'Native permissions', values: preview.nativePermissionsRequested },
    { label: 'Widgets', values: preview.widgetsRequired },
    { label: 'Plugins', values: preview.pluginsRequired },
    { label: 'Fallbacks', values: preview.fallbacks },
  ];
}

export function packageInstallTrustLabel(preview: PackageInstallPreview): string {
  if (preview.trust.status === 'checksum_verified') return 'Checksum verified';
  if (preview.trust.status === 'checksum_mismatch') return 'Checksum mismatch';
  return 'Unknown remote package - review required';
}

export async function fetchPackageInstallCandidate(
  input: string,
  fetcher: PackageInstallFetcher,
  options: {
    registryPackage?: UtopiaRegistryPackage;
    expectedChecksum?: string;
  } = {},
): Promise<PackageInstallCandidate> {
  const target = parsePackageInstallTarget(input);
  const packageJson = await fetchJson(target.packageUrl, fetcher);
  const preview = buildPackageInstallPreview(packageJson, {
    sourceUrl: target.packageUrl,
    registryPackage: options.registryPackage,
    expectedChecksum: options.expectedChecksum,
  });
  assertInstallDescriptorMatchesPreview(options.registryPackage, preview);
  return {
    target,
    packageJson,
    preview,
  };
}

export async function fetchRegistryManifest(url: string, fetcher: PackageInstallFetcher): Promise<UtopiaRegistryManifest> {
  parsePackageInstallTarget(url);
  return validateRegistryManifest(await fetchJson(url, fetcher));
}

export function getBundledDemoPackage(): unknown {
  return buildAppPackageFromManifest(getBundledDomainManifest()).package;
}

export function getBundledRegistryManifest(): UtopiaRegistryManifest {
  const bundledPackage = getBundledDemoPackage() as { id: string; version: string; presentation?: { label?: string } };
  return {
    schemaVersion: 'utopia.registry.v1',
    name: 'Bundled apps',
    packages: [
      {
        id: bundledPackage.id,
        name: bundledPackage.presentation?.label ?? bundledPackage.id,
        version: bundledPackage.version,
        url: BUNDLED_DEMO_PACKAGE_URL,
        checksum: sha256Canonical(bundledPackage),
        description: 'Local bundled demo app.',
      },
    ],
  };
}

export function createPackageInstallFetcher(remoteFetch: PackageInstallFetcher = defaultRemoteFetch): PackageInstallFetcher {
  return async (url) => {
    const normalized = parsePackageInstallTarget(url).packageUrl;
    if (normalized === BUNDLED_UTOPIA_REGISTRY_URL) {
      return jsonResponse(getBundledRegistryManifest());
    }
    if (normalized === BUNDLED_DEMO_PACKAGE_URL) {
      return jsonResponse(getBundledDemoPackage());
    }
    return remoteFetch(normalized);
  };
}

async function fetchJson(url: string, fetcher: PackageInstallFetcher): Promise<unknown> {
  let response: PackageInstallFetchResponse;
  try {
    response = await fetcher(url);
  } catch (error) {
    throw new Error(`package_fetch_failed:${error instanceof Error ? error.message : 'network_error'}`);
  }

  if (!response.ok) throw new Error(`package_fetch_failed:http_${response.status}`);
  const contentType = response.headers?.get('content-type') ?? '';
  if (contentType && !contentType.toLowerCase().includes('json')) {
    throw new Error('package_fetch_not_json');
  }

  if (response.json) return response.json();
  if (!response.text) throw new Error('package_fetch_no_body_reader');

  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('package_fetch_invalid_json');
  }
}

async function defaultRemoteFetch(url: string): Promise<PackageInstallFetchResponse> {
  if (typeof fetch !== 'function') throw new Error('fetch_unavailable');
  return fetch(url);
}

function jsonResponse(value: unknown): PackageInstallFetchResponse {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name) => name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    json: async () => value,
  };
}

function assertInstallDescriptorMatchesPreview(
  registryPackage: UtopiaRegistryPackage | undefined,
  preview: PackageInstallPreview,
): void {
  if (!registryPackage) return;
  if (preview.packageId !== registryPackage.id || preview.version !== registryPackage.version) {
    throw new Error(`package_descriptor_identity_mismatch:${registryPackage.id}@${registryPackage.version}`);
  }
}
