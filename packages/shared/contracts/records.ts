export type RecordProvider = 'notion' | 'google_sheets' | 'sqlite' | 'postgres' | 'web' | 'user';

export interface CanonicalRelation {
  name: string;
  target_id: string;
}

export interface CanonicalSource {
  provider: RecordProvider;
  external_id: string;
  url: string | null;
  observed_at: string;
  content_hash: string | null;
}

export interface CanonicalProvenance {
  actor: 'user' | 'ai' | 'import' | 'sync' | 'agent' | 'api' | 'workflow';
  confidence: number | null;
  evidence: string[];
  reason: string | null;
}

export interface CanonicalRecord {
  id: string;
  domain: string;
  collection: string;
  title: string;
  properties: Record<string, unknown>;
  relations: CanonicalRelation[];
  source: CanonicalSource;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
  schema_version: string;
  deleted: boolean;
  privacy: 'private' | 'personal' | 'shared';
  provenance: CanonicalProvenance | null;
}
