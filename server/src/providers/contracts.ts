export const MCP_PROVIDER_DATA_HOMES = ['local_sqlite', 'notion', 'google_sheets', 'postgres', 'web', 'user'] as const;

export type McpProvider = (typeof MCP_PROVIDER_DATA_HOMES)[number];
export type MutableProvider = Exclude<McpProvider, 'postgres' | 'web' | 'user'>;
export type CanonicalProvider = 'sqlite' | 'notion' | 'google_sheets' | 'postgres' | 'web' | 'user';
export type ProviderOperation = 'create_record' | 'update_record' | 'archive_record';

export type CanonicalProviderSource = {
  provider: CanonicalProvider;
  external_id: string;
  url: string | null;
  observed_at: string;
  content_hash: string | null;
};

export type ProviderWriteResult = {
  ok: boolean;
  source: CanonicalProviderSource;
  source_snapshot: Record<string, unknown>;
  operation: ProviderOperation;
  reason?: string;
  requiredConfig?: string[];
};

export function nowIsoNow(): string {
  return new Date().toISOString();
}

export function isKnownProvider(value: unknown): value is McpProvider {
  return typeof value === 'string' && MCP_PROVIDER_DATA_HOMES.includes(value as McpProvider);
}

export function isMutableProvider(value: unknown): value is MutableProvider {
  return value === 'local_sqlite' || value === 'notion' || value === 'google_sheets';
}

export function toMutableProviderOrDefault(value: unknown, fallback: MutableProvider = 'local_sqlite'): MutableProvider {
  if (value === 'local_sqlite' || value === 'notion' || value === 'google_sheets') {
    return value;
  }
  return fallback;
}

export function resolveCanonicalProvider(value: MutableProvider): CanonicalProvider {
  return value === 'local_sqlite' ? 'sqlite' : value;
}
