import type { CanonicalProvenance, CanonicalRecord, CanonicalRelation, CanonicalSource, RecordProvider } from '@/packages/shared/contracts/records';
import { DomainManifest, DomainId, ManifestRelation, Surface } from './catalog';
export type {
  CanonicalProvenance,
  CanonicalRecord,
  CanonicalRelation,
  CanonicalSource,
  RecordProvider,
} from '@/packages/shared/contracts/records';

export type RecordStatus = 'active' | 'archived';

export interface CanonicalCitation {
  label: string;
  detail: string;
  href: string;
  tone: 'moss' | 'blue' | 'amber' | 'plum' | 'neutral';
}

export interface CanonicalMessage {
  role: 'user' | 'assistant';
  id: string;
  text: string;
  answer?: {
    title: string;
    intro: string;
    rows: Array<{
      meal: string;
      use: string;
      next: string;
    }>;
    citations: CanonicalCitation[];
  };
  created_at: string;
}

export interface CanonicalThread {
  id: string;
  title: string;
  detail: string;
  domain: DomainId;
  messages: CanonicalMessage[];
  updated_at: string;
  archived_at: string | null;
}

export interface DomainSurfaceSummary {
  id: string;
  label: string;
  collections: string[];
  views: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertRecord(condition: boolean, message: string): never | void {
  if (!condition) {
    throw new Error(`[domain-runtime] ${message}`);
  }
}

export function formatIsoDate(value = new Date()): string {
  return value.toISOString();
}

export function buildSurfaceSummary(manifest: DomainManifest): DomainSurfaceSummary[] {
  return manifest.surfaces.map((surface: Surface) => ({
    id: surface.id,
    label: surface.label,
    collections: surface.collections,
    views: surface.views ?? ['Default'],
  }));
}

export function normalizeRelations(input: unknown, allowedCollections: Set<string>): CanonicalRelation[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const parsed = input
    .map((relation) => {
      if (!isPlainObject(relation)) return null;
      const relationRecord = relation as Record<string, unknown>;
      const name = typeof relationRecord.name === 'string' ? relationRecord.name : '';
      const targetId = typeof relationRecord.target_id === 'string' ? relationRecord.target_id : '';
      const relationIsValid = name.length > 0 && targetId.length > 0;
      if (!relationIsValid) {
        return null;
      }

      const explicitParts = targetId.split(':');
      if (explicitParts.length >= 2) {
        const explicitCollection = explicitParts.length >= 3 ? explicitParts[1] : explicitParts[0];
        if (explicitCollection && !allowedCollections.has(explicitCollection)) {
          return null;
        }
      }

      return { name, target_id: targetId };
    })
    .filter((relation): relation is CanonicalRelation => relation !== null);

  const seen = new Set<string>();
  return parsed.filter((relation) => {
    const key = `${relation.name}:${relation.target_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeSource(input: unknown): CanonicalSource {
  assertRecord(isPlainObject(input), 'Source must be object');
  const source = input as Record<string, unknown>;
  const provider = typeof source.provider === 'string' ? source.provider : '';
  const observedAt = typeof source.observed_at === 'string' ? source.observed_at : new Date().toISOString();

  assertRecord(
    provider === 'notion' || provider === 'google_sheets' || provider === 'sqlite' || provider === 'postgres' || provider === 'web' || provider === 'user',
    `Unsupported provider: ${provider}`
  );

  return {
    provider: provider as RecordProvider,
    external_id: typeof source.external_id === 'string' ? source.external_id : 'local',
    url: typeof source.url === 'string' ? source.url : null,
    observed_at: observedAt,
    content_hash: typeof source.content_hash === 'string' ? source.content_hash : null,
  };
}

export function validateCanonicalRecord(
  input: unknown,
  domain: DomainId,
  manifest: DomainManifest,
  context = 'record'
): CanonicalRecord {
  assertRecord(isPlainObject(input), `Invalid ${context}: not an object`);
  const record = input as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  const collection = typeof record.collection === 'string' ? record.collection : '';
  const properties = isPlainObject(record.properties) ? record.properties : {};
  assertRecord(id.length > 0, `Invalid ${context}: missing id`);
  assertRecord(title.length > 0, `Invalid ${context}: missing title`);
  assertRecord(collection.length > 0, `Invalid ${context}: missing collection`);
  assertRecord(manifest.collections.includes(collection), `Invalid ${context}: unknown collection ${collection}`);

  const relationIds = new Set(manifest.collections);
  const relations = normalizeRelations(record.relations, relationIds);
  const source = normalizeSource(record.source);
  const archivedAt = typeof record.archived_at === 'string' ? record.archived_at : null;
  const revision = typeof record.revision === 'number' && Number.isFinite(record.revision) && record.revision > 0 ? Math.floor(record.revision) : 1;
  const schemaVersion = typeof record.schema_version === 'string' && record.schema_version.trim() ? record.schema_version.trim() : manifest.schema_version ?? '1.0.0';
  const deleted = record.deleted === true;
  const privacy = record.privacy === 'private' || record.privacy === 'shared' || record.privacy === 'personal' ? record.privacy : 'personal';
  const provenance = normalizeProvenance(record.provenance);
  const createdAt =
    typeof record.created_at === 'string' ? record.created_at : new Date().toISOString();
  const updatedAt =
    typeof record.updated_at === 'string' ? record.updated_at : new Date().toISOString();

  for (const relation of relations) {
    const relationDef = manifest.relations.find((item) => item.name === relation.name && item.from === collection);
    if (relationDef) {
      assertRecord(
        relationDef.to === '*' || manifest.collections.includes(relationDef.to),
        `Invalid relation target for ${relationDef.name}`
      );
    }
  }

  return {
    id,
    domain,
    collection,
    title,
    properties,
    relations,
    source,
    archived_at: archivedAt,
    created_at: createdAt,
    updated_at: updatedAt,
    revision,
    schema_version: schemaVersion,
    deleted,
    privacy,
    provenance,
  };
}

function normalizeProvenance(input: unknown): CanonicalProvenance | null {
  if (!isPlainObject(input)) {
    return null;
  }
  const actor = input.actor;
  if (actor !== 'user' && actor !== 'ai' && actor !== 'import' && actor !== 'sync' && actor !== 'agent' && actor !== 'api' && actor !== 'workflow') {
    return null;
  }
  const confidence = typeof input.confidence === 'number' && Number.isFinite(input.confidence)
    ? Math.max(0, Math.min(1, input.confidence))
    : null;
  const evidence = Array.isArray(input.evidence) ? input.evidence.filter((item): item is string => typeof item === 'string') : [];
  const reason = typeof input.reason === 'string' ? input.reason : null;
  return { actor, confidence, evidence, reason };
}

export function validateCanonicalRelations(
  relations: CanonicalRelation[],
  manifest: DomainManifest,
  collection: string
): boolean {
  const allowed = manifest.relations.filter((edge: ManifestRelation) => edge.from === collection);
  return relations.every((relation) =>
    allowed.some((edge) => edge.name === relation.name && (edge.to === '*' || manifest.collections.includes(edge.to)))
  );
}

export function makeNewThreadTitle(seedText: string): string {
  if (!seedText) {
    return 'New conversation';
  }

  return seedText.length > 20 ? `${seedText.slice(0, 20)}…` : seedText;
}
