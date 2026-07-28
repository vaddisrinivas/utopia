import type { AppPackage, AppPackageV3, CollectionSpec } from '@/packages/shared/contracts/package';
import type { QueryPredicate } from '@/packages/shared/contracts/query';
import type { DomainManifest } from '@/src/domain/catalog';
import { canonicalJson, sha256Canonical } from '@/src/domain/canonical-json';

const CORE_FIELDS: CollectionSpec['fields'] = {
  id: { type: 'text', required: true, indexed: true },
  title: { type: 'text', required: true, indexed: true },
  collection: { type: 'text', required: true, indexed: true },
  updated_at: { type: 'timestamp', required: true, indexed: true },
  properties: { type: 'json', required: true },
};

const DEFAULT_VIEW_FIELDS = ['id', 'title', 'collection', 'updated_at'];

export type AppPackageBridgeResult = {
  package: AppPackage;
  warnings: string[];
};

/**
 * Compatibility bridge from the compiled v1 domain manifest to the bounded
 * server package/query/view contracts. It deliberately does not translate
 * regex dashboard matching: widening a query silently would be unsafe.
 */
export function buildAppPackageFromManifest(
  manifest: DomainManifest,
  options: { version?: string; pinnedAt?: string } = {},
): AppPackageBridgeResult {
  const warnings: string[] = [];
  const collections = Object.fromEntries(
    manifest.collections.map((id) => [
      id,
      {
        id,
        fields: {
          ...CORE_FIELDS,
          ...providerFields(manifest),
        },
      } satisfies CollectionSpec,
    ]),
  );

  const queries: AppPackage['queries'] = {};
  const views: AppPackage['views'] = {};

  for (const surface of manifest.surfaces) {
    const queryId = `surface:${surface.id}`;
    const where = collectionPredicate(surface.collections);
    queries[queryId] = {
      from: 'records',
      ...(where ? { where } : {}),
      orderBy: [{ field: 'updated_at', direction: 'desc' }],
    };
    views[surface.id] = {
      id: surface.id,
      query: queryId,
      mode: 'list',
      fields: [...DEFAULT_VIEW_FIELDS],
    };
  }

  const version = options.version?.trim() || bundledManifestVersion(manifest);
  const basePackage = {
    schemaVersion: 'wonder.app-package.v2' as const,
    id: manifest.id,
    version,
    collections,
    queries,
    views,
    presentation: {
      label: manifest.label,
      ...(manifest.home_surface ? { homeSurface: manifest.home_surface } : {}),
      surfaces: manifest.surfaces.map((surface) => ({
        id: surface.id,
        label: surface.label,
        ...(surface.icon ? { icon: surface.icon } : {}),
        ...(surface.image_url ? { imageUrl: surface.image_url } : {}),
        ...(surface.views ? { views: surface.views } : {}),
        collections: [...surface.collections],
      })),
      ...(manifest.visual_identity ? { visualIdentity: cleanJson(manifest.visual_identity) as Record<string, unknown> } : {}),
      ...(manifest.render ? { render: cleanJson(manifest.render) as Record<string, unknown> } : {}),
      ...(manifest.ui ? { ui: cleanJson(manifest.ui) as Record<string, unknown> } : {}),
      ...(manifest.rich_detail_schema ? { richDetailSchema: manifest.rich_detail_schema } : {}),
      ...(manifest.provider_template_fields ? { providerTemplateFields: cleanJson(manifest.provider_template_fields) as Record<string, unknown> } : {}),
      sourceSchemaVersion: manifest.schema_version,
    },
    rules: [],
    capabilities: [
      ...manifest.data_homes.map((home) => `data-home:${home}`),
      ...manifest.mcp.resources.map((resource) => `mcp-resource:${resource}`),
      ...manifest.mcp.tools.map((tool) => `mcp-tool:${tool}`),
    ],
    acceptanceTests: [
      'manifest-collections-map-to-package',
      'surface-queries-use-bounded-ast',
      'views-reference-existing-queries',
    ],
  };

  if (!manifest.native_capabilities) {
    return { package: basePackage, warnings };
  }

  const dependencyPins = cleanJson(manifest.dependency_pins ?? []) as AppPackageV3['dependencyPins'];
  const nativeCapabilities = cleanJson(manifest.native_capabilities) as AppPackageV3['nativeCapabilities'];
  const pinnedAt = options.pinnedAt?.trim() || '1970-01-01T00:00:00.000Z';
  const contractLock = {
    schemaVersion: 'wonder.package-contract-lock.v1' as const,
    algorithm: 'sha256' as const,
    pinnedAt,
    dependencyPins,
    nativeCapabilities,
    checksum: '',
  };
  contractLock.checksum = hashValue({
    schemaVersion: contractLock.schemaVersion,
    algorithm: contractLock.algorithm,
    dependencyPins: contractLock.dependencyPins,
    nativeCapabilities: contractLock.nativeCapabilities,
    pinnedAt: contractLock.pinnedAt,
  });

  return {
    package: {
      ...basePackage,
      schemaVersion: 'wonder.app-package.v3',
      dependencyPins,
      nativeCapabilities,
      contractLock,
    },
    warnings,
  };
}

function bundledManifestVersion(manifest: DomainManifest): string {
  return `1.0.0+bundle.${hashString(canonicalJson(cleanJson(manifest))).slice(0, 8)}`;
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function hashValue(value: unknown): string {
  return sha256Canonical(value);
}

function cleanJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .map(([key, child]) => [key, cleanJson(child)]),
    );
  }
  return value;
}

function providerFields(manifest: DomainManifest): CollectionSpec['fields'] {
  const fields: CollectionSpec['fields'] = {};
  for (const field of manifest.provider_template_fields?.required ?? []) {
    if (field in CORE_FIELDS) continue;
    fields[field] = { type: 'text' };
  }
  for (const field of manifest.provider_template_fields?.rich_detail_json ?? []) {
    fields[field] = { type: 'json' };
  }
  for (const field of manifest.provider_template_fields?.relations_json ?? []) {
    fields[field] = { type: 'json' };
  }
  return fields;
}

function collectionPredicate(collections: string[]): QueryPredicate | undefined {
  if (collections.length === 0) {
    return undefined;
  }
  if (collections.length === 1) {
    return { op: 'eq', field: 'collection', value: collections[0] };
  }
  return {
    op: 'or',
    args: collections.map((collection) => ({ op: 'eq', field: 'collection', value: collection })),
  };
}
