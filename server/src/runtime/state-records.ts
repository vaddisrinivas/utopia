import { getDomainManifest, loadCatalog } from '../../../src/domain/catalog';
import { nowIso, type CanonicalRelation, type McpRecord, type RecordProvider, type RecordSource } from './state-types';

function getSupportedProviders(): RecordProvider[] {
  return ['notion', 'google_sheets', 'sqlite', 'postgres', 'web', 'user'];
}

export function parseRecordManifest(domain: string) {
  const catalog = loadCatalog();
  const manifest = getDomainManifest(catalog.catalog.domains, domain);
  if (!manifest) {
    throw new Error(`Unknown domain: ${domain}`);
  }
  return manifest;
}

export function normalizeRecord(
  record: Omit<McpRecord, 'created_at' | 'updated_at' | 'relations' | 'source' | 'archived_at'> & Partial<McpRecord>,
): McpRecord {
  if (!record.id || typeof record.id !== 'string') {
    throw new Error('record.id is required');
  }
  const id = record.id.trim();
  if (!id) {
    throw new Error('record.id cannot be empty');
  }

  if (!record.domain || typeof record.domain !== 'string') {
    throw new Error('record.domain is required');
  }
  const domain = record.domain.trim();
  if (!domain) {
    throw new Error('record.domain cannot be empty');
  }

  if (!record.collection || typeof record.collection !== 'string') {
    throw new Error('record.collection is required');
  }
  const collection = record.collection.trim();
  if (!collection) {
    throw new Error('record.collection cannot be empty');
  }

  const manifest = parseRecordManifest(domain);
  if (!manifest.collections.includes(collection)) {
    throw new Error(`collection ${collection} not in domain manifest`);
  }

  const parsedRelations = Array.isArray(record.relations)
    ? record.relations
        .filter(
          (relation): relation is CanonicalRelation =>
            Boolean(relation && typeof relation.name === 'string' && relation.name.trim() && typeof relation.target_id === 'string' && relation.target_id.trim()),
        )
        .map((relation) => ({
          name: relation.name.trim(),
          target_id: relation.target_id.trim(),
        }))
    : [];

  const seen = new Set<string>();
  const dedupedRelations = parsedRelations.filter((relation) => {
    const key = `${relation.name}:${relation.target_id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  const relationFromManifest = dedupedRelations.filter((relation) => {
    const edge = manifest.relations.find((item) => item.name === relation.name && item.from === collection);
    return !edge || edge.to === '*' || manifest.collections.includes(edge.to);
  });

  const sourceProvider = typeof record.source?.provider === 'string' ? record.source.provider : 'user';
  const provider =
    (getSupportedProviders() as string[]).includes(sourceProvider) ? (sourceProvider as RecordProvider) : 'user';

  const source: RecordSource = record.source
    ? {
        provider,
        external_id:
          typeof record.source.external_id === 'string' && record.source.external_id.trim().length > 0
            ? record.source.external_id
            : `${domain}:${collection}:${id}`,
        url: typeof record.source.url === 'string' ? record.source.url : null,
        observed_at:
          typeof record.source.observed_at === 'string' && record.source.observed_at.trim().length > 0
            ? record.source.observed_at
            : nowIso(),
        content_hash:
          typeof record.source.content_hash === 'string' && record.source.content_hash.length > 0
            ? record.source.content_hash
            : null,
      }
    : {
        provider: 'user',
        external_id: `${domain}:${collection}:${id}`,
        url: null,
        observed_at: nowIso(),
        content_hash: null,
      };

  return {
    id,
    domain,
    collection,
    title: typeof record.title === 'string' && record.title.trim().length > 0 ? record.title.trim() : id,
    properties: typeof record.properties === 'object' && record.properties !== null ? record.properties : {},
    relations: relationFromManifest,
    source,
    archived_at: typeof record.archived_at === 'string' && record.archived_at.trim().length > 0 ? record.archived_at : null,
    created_at: record.created_at ?? nowIso(),
    updated_at: record.updated_at ?? nowIso(),
    revision: typeof record.revision === 'number' && Number.isInteger(record.revision) && record.revision >= 0 ? record.revision : 1,
  };
}
